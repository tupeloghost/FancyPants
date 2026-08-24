// Fancy Pants room server — Cloudflare Durable Object port of the PartyKit
// server (PartyKit's shared platform hit its app cap, so this runs on the
// user's own Cloudflare account). Same protocol, same /party/<ROOM> path:
// presence relay only. No physics, no authority: validate names, assign
// colors, fan out state, drop the silent.

import leo from 'leo-profanity';

const MAX_ACTIVE = 120;      // beyond this, joiners become spectators
const DROP_AFTER = 5000;     // ms of silence
const NAME_RE = /^[a-zA-Z0-9_]{3,14}$/;
const PALETTE_SIZE = 12;
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' };

function normalize(name) {
  let n = name.normalize('NFKC').toLowerCase();
  n = n.replace(/[013457 8@$]/g, c => LEET[c] || '');
  n = n.replace(/[^a-z]/g, '');
  n = n.replace(/(.)\1+/g, '$1'); // collapse repeats
  return n;
}

export class FancyPantsRoom {
  constructor(state) {
    this.state = state;
    this.conns = new Map();      // ws -> connId
    this.peers = new Map();      // connId -> {ws, name, color, lastSeen, spectator, lastRename, x, y, z}
    this.ownerName = null;
    this.ownerId = null;         // conn allowed to reclaim the owner name
    this.nextColor = 0;
    this.song = null;            // {url, pos, playing, at} — what the host is playing
    this.promo = null;           // {label, url} — what the host is promoting
    this.worldKey = null;        // which world the host has the room in
  }

  songNow() {
    if (!this.song) return null;
    const { url, title, pos, playing, at } = this.song;
    return { url, title, playing, pos: playing ? pos + (Date.now() - at) / 1000 : pos };
  }

  async fetch(request) {
    const url = new URL(request.url);
    // ── the artist waiting list lives in one special DO's durable storage ──
    if (url.pathname === '/waitlist' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const email = body && String(body.email || '').trim().slice(0, 200);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response('bad email', { status: 400 });
      }
      const key = 'wl:' + email.toLowerCase();
      const existing = await this.state.storage.get(key);
      if (!existing) await this.state.storage.put(key, { email, at: Date.now(), note: String(body.note || '').slice(0, 500) });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    // ── custom world inquiries: the commission book ──
    if (url.pathname === '/custom' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const email = body && String(body.email || '').trim().slice(0, 200);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response('bad email', { status: 400 });
      }
      const key = 'cw:' + Date.now() + ':' + email.toLowerCase();
      await this.state.storage.put(key, {
        email,
        occasion: String((body && body.occasion) || '').slice(0, 60),
        vision: String((body && body.vision) || '').slice(0, 1200),
        timeline: String((body && body.timeline) || '').slice(0, 80),
        budget: String((body && body.budget) || '').slice(0, 40),
        at: Date.now(),
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname === '/custom-list') {
      if (url.searchParams.get('key') !== '8a1b05350b66afe0803aabb4') return new Response('no', { status: 403 });
      const all = await this.state.storage.list({ prefix: 'cw:' });
      return new Response(JSON.stringify([...all.values()], null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    // ── a shared song lives in ONE world at a time: sharing claims the home,
    // moving it re-points every link ever sent (links look up the home) ──
    if (url.pathname === '/share-home' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const song = body && String(body.song || '').trim().slice(0, 64);
      const world = body && String(body.world || '').trim().slice(0, 24);
      if (!song || !world || !/^[A-Za-z0-9_s-]+$/.test(song)) {
        return new Response('bad claim', { status: 400 });
      }
      await this.state.storage.put('sh:' + song, { world, at: Date.now() });
      // a named claim also mints the permanent address: /w/{artist}/{song} —
      // same names in, same link out, every single time
      const slug = t => String(t || '').toLowerCase().normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      let permUrl = null;
      const sa = slug(body.artist), st = slug(body.title);
      if (sa && st) {
        await this.state.storage.put('w:' + sa + '/' + st, { song, at: Date.now() });
        permUrl = 'https://fancy-pants.tupeloghost.workers.dev/w/' + sa + '/' + st;
      }
      return new Response(JSON.stringify({ ok: true, url: permUrl }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    // resolve a permanent slug: the song id + its CURRENT home world, and
    // count the visit (private to the creator)
    if (url.pathname.startsWith('/w-get/')) {
      const slugPath = decodeURIComponent(url.pathname.slice(7)).slice(0, 90);
      const row = await this.state.storage.get('w:' + slugPath);
      if (!row) return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      const home = await this.state.storage.get('sh:' + row.song);
      const visits = ((await this.state.storage.get('wv:' + slugPath)) || 0) + 1;
      await this.state.storage.put('wv:' + slugPath, visits);
      return new Response(JSON.stringify({ song: row.song, world: home ? home.world : null }), { headers: { 'Content-Type': 'application/json' } });
    }
    // ── test screenshots: the dev panel posts a jpeg, gets back a URL that
    // rides the note — so feedback carries its own pictures, no dragging ──
    if (url.pathname === '/shot' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const img = body && String(body.img || '');
      if (!img || img.length > 260000 || !/^[A-Za-z0-9+/=]+$/.test(img)) {
        return new Response('bad shot', { status: 400 });
      }
      const id = Math.random().toString(36).slice(2, 10);
      await this.state.storage.put('shot:' + id, { img, at: Date.now(), note: String(body.note || '').slice(0, 300) });
      return new Response(JSON.stringify({ url: 'https://fancy-pants.tupeloghost.workers.dev/shot/' + id }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname.startsWith('/shot/')) {
      const row = await this.state.storage.get('shot:' + url.pathname.slice(6).replace(/[^a-z0-9]/g, ''));
      if (!row) return new Response('gone', { status: 404 });
      const bin = Uint8Array.from(atob(row.img), c => c.charCodeAt(0));
      return new Response(bin, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' } });
    }
    // ── creator pages ── one page per slug, reachable only by its link.
    // Creating one returns a secret edit key (the magic link, in URL form).
    if (url.pathname === '/c-create' && request.method === 'POST') {
      const b = await request.json().catch(() => null);
      const slug = b && String(b.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
      if (!slug || slug.length < 3) return new Response('bad slug', { status: 400 });
      if (await this.state.storage.get('cp:' + slug)) {
        return new Response(JSON.stringify({ error: 'taken' }), { status: 409, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      const editKey = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
      const page = {
        slug, editKey,
        name: String(b.name || slug).slice(0, 60),
        bio: String(b.bio || '').slice(0, 500),
        links: (Array.isArray(b.links) ? b.links : []).slice(0, 6).map(l => ({
          label: String(l.label || '').slice(0, 40), url: String(l.url || '').slice(0, 300),
        })).filter(l => l.label && /^https?:\/\//.test(l.url)),
        next: String(b.next || '').slice(0, 120),
        nextAt: String(b.nextAt || '').slice(0, 30),
        tip: /^https?:\/\//.test(String(b.tip || '')) ? String(b.tip).slice(0, 300) : '',
        // the page's kind picks what it leads with; photo + hue make it THEIRS
        type: ['artist', 'streamer'].includes(b.type) ? b.type : 'artist',
        photo: /^https?:\/\//.test(String(b.photo || '')) ? String(b.photo).slice(0, 400) : '',
        watch: /^https?:\/\//.test(String(b.watch || '')) ? String(b.watch).slice(0, 300) : '',
        hue: Number.isFinite(+b.hue) ? ((+b.hue % 360) + 360) % 360 : 265,
        look: /^[a-z]+\.[a-z]+\.[a-z]+\.\d{1,3}$/.test(String(b.look || '')) ? String(b.look) : '',
        mood: String(b.mood || '').slice(0, 80),
        quiz: /^[1-5]{20}$/.test(String(b.quiz || '')) ? String(b.quiz) : '',
        // what they're here for, and a few things said in their own words
        intents: (Array.isArray(b.intents) ? b.intents : []).filter(x => ['friends', 'collaborators', 'business'].includes(x)).slice(0, 3),
        prompts: (Array.isArray(b.prompts) ? b.prompts : []).slice(0, 3).map(x => ({
          q: String((x && x.q) || '').slice(0, 60), a: String((x && x.a) || '').slice(0, 160),
        })).filter(x => x.q && x.a),
        hidden: [],
        at: Date.now(),
      };
      await this.state.storage.put('cp:' + slug, page);
      return new Response(JSON.stringify({ ok: true, editKey }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname === '/c-update' && request.method === 'POST') {
      const b = await request.json().catch(() => null);
      const slug = b && String(b.slug || '').toLowerCase().slice(0, 30);
      const page = slug && await this.state.storage.get('cp:' + slug);
      if (!page || page.editKey !== String(b.editKey || '')) {
        return new Response('no', { status: 403 });
      }
      if ('name' in b) page.name = String(b.name || page.slug).slice(0, 60);
      if ('bio' in b) page.bio = String(b.bio || '').slice(0, 500);
      if ('next' in b) page.next = String(b.next || '').slice(0, 120);
      if ('nextAt' in b) page.nextAt = String(b.nextAt || '').slice(0, 30);
      if ('tip' in b) page.tip = /^https?:\/\//.test(String(b.tip || '')) ? String(b.tip).slice(0, 300) : '';
      if ('type' in b) page.type = ['artist', 'streamer'].includes(b.type) ? b.type : 'artist';
      if ('photo' in b) page.photo = /^https?:\/\//.test(String(b.photo || '')) ? String(b.photo).slice(0, 400) : '';
      if ('watch' in b) page.watch = /^https?:\/\//.test(String(b.watch || '')) ? String(b.watch).slice(0, 300) : '';
      if ('hue' in b && Number.isFinite(+b.hue)) page.hue = ((+b.hue % 360) + 360) % 360;
      if ('look' in b) page.look = /^[a-z]+\.[a-z]+\.[a-z]+\.\d{1,3}$/.test(String(b.look || '')) ? String(b.look) : '';
      if ('mood' in b) page.mood = String(b.mood || '').slice(0, 80);
      if ('quiz' in b) page.quiz = /^[1-5]{20}$/.test(String(b.quiz || '')) ? String(b.quiz) : '';
      if ('intents' in b) page.intents = (Array.isArray(b.intents) ? b.intents : []).filter(x => ['friends', 'collaborators', 'business'].includes(x)).slice(0, 3);
      if ('prompts' in b) page.prompts = (Array.isArray(b.prompts) ? b.prompts : []).slice(0, 3).map(x => ({
        q: String((x && x.q) || '').slice(0, 60), a: String((x && x.a) || '').slice(0, 160),
      })).filter(x => x.q && x.a);
      if ('links' in b) page.links = (Array.isArray(b.links) ? b.links : []).slice(0, 6).map(l => ({
        label: String(l.label || '').slice(0, 40), url: String(l.url || '').slice(0, 300),
      })).filter(l => l.label && /^https?:\/\//.test(l.url));
      if ('hidden' in b) page.hidden = (Array.isArray(b.hidden) ? b.hidden : []).map(x => String(x).slice(0, 90)).slice(0, 50);
      await this.state.storage.put('cp:' + slug, page);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    // page data: public shape by default; the edit key unlocks private plays
    if (url.pathname === '/c-get') {
      const slug = String(url.searchParams.get('slug') || '').toLowerCase().slice(0, 30);
      const page = slug && await this.state.storage.get('cp:' + slug);
      if (!page) return new Response('{}', { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      // a public reading ticks the artist's private odometer
      if (url.searchParams.get('count') === '1' && url.searchParams.get('key') !== page.editKey) {
        await this.state.storage.put('cv:' + slug, ((await this.state.storage.get('cv:' + slug)) || 0) + 1);
      }
      // their promoted songs appear automatically: every /w/{slug}/... link
      const wl = await this.state.storage.list({ prefix: 'w:' + slug + '/' });
      const songs = [];
      for (const [k, v] of wl) {
        const path = k.slice(2);
        if (page.hidden.includes(path)) continue;
        // each song's home world rides along, so the page can show it
        const home = v && v.song ? await this.state.storage.get('sh:' + v.song) : null;
        songs.push({ path, world: (home && home.world) || '' });
      }
      const out = { slug: page.slug, name: page.name, bio: page.bio, links: page.links, next: page.next, nextAt: page.nextAt || '', tip: page.tip || '',
        type: page.type || 'artist', photo: page.photo || '', watch: page.watch || '', hue: Number.isFinite(+page.hue) ? +page.hue : 265,
        look: page.look || '', mood: page.mood || '', intents: page.intents || [], prompts: page.prompts || [], quiz: page.quiz || '', songs };
      if (url.searchParams.get('key') === page.editKey) {
        out.hidden = page.hidden;
        out.plays = {};
        const allW = await this.state.storage.list({ prefix: 'w:' + slug + '/' });
        for (const [k] of allW) {
          const path = k.slice(2);
          out.plays[path] = (await this.state.storage.get('wv:' + path)) || 0;
        }
        out.views = (await this.state.storage.get('cv:' + slug)) || 0;
        out.canEdit = true;
      }
      return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname === '/w-stats') {
      if (url.searchParams.get('key') !== '8a1b05350b66afe0803aabb4') return new Response('no', { status: 403 });
      const all = await this.state.storage.list({ prefix: 'wv:' });
      const out = {};
      for (const [k, v] of all) out[k.slice(3)] = v;
      return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/share-home' && request.method === 'GET') {
      const song = String(url.searchParams.get('song') || '').slice(0, 64);
      const row = song ? await this.state.storage.get('sh:' + song) : null;
      return new Response(JSON.stringify(row || {}), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname === '/waitlist-list') {
      if (url.searchParams.get('key') !== '8a1b05350b66afe0803aabb4') return new Response('no', { status: 403 });
      const all = await this.state.storage.list({ prefix: 'wl:' });
      const rows = [...all.values()];
      return new Response(JSON.stringify(rows, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const id = crypto.randomUUID().slice(0, 8);
    this.conns.set(server, id);
    server.addEventListener('message', e => this.onMessage(server, e.data));
    server.addEventListener('close', () => this.onLeave(server));
    server.addEventListener('error', () => this.onLeave(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg, exceptId) {
    for (const [cid, p] of this.peers) {
      if (cid === exceptId) continue;
      try { p.ws.send(msg); } catch { /* dead socket; prune handles it */ }
    }
  }

  nameTaken(norm) {
    for (const p of this.peers.values()) {
      if (normalize(p.name) === norm) return true;
    }
    return false;
  }

  nameOk(name, connId) {
    if (!NAME_RE.test(name)) return false;
    const norm = normalize(name);
    if (!norm || leo.check(norm) || leo.check(name.toLowerCase())) return false;
    // no impersonating the owner — but the owner's own connection may reclaim it
    if (this.ownerName && norm === normalize(this.ownerName) && this.ownerId !== null && connId !== this.ownerId) return false;
    if (this.nameTaken(norm)) return false;
    return true;
  }

  onMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const connId = this.conns.get(ws);
    if (!connId) return;
    const now = Date.now();

    if (m.t === 'join') {
      const name = String(m.name || '').slice(0, 14);
      const peer = this.peers.get(connId);
      if (peer) {
        // same name again (duplicate rejoin) — already in, ignore silently
        if (normalize(name) === normalize(peer.name)) return;
        // rename: rate-limited to one per 30s
        if (now - peer.lastRename < 30000 || !this.nameOk(name, connId)) {
          ws.send(JSON.stringify({ t: 'reject' }));
          return;
        }
        peer.name = name;
        peer.lastRename = now;
        return;
      }
      if (!this.nameOk(name, connId)) {
        ws.send(JSON.stringify({ t: 'reject' }));
        return;
      }
      const active = [...this.peers.values()].filter(p => !p.spectator).length;
      const spectator = active >= MAX_ACTIVE;
      const p = {
        ws, name, color: this.nextColor++ % PALETTE_SIZE,
        lastSeen: now, lastRename: now, spectator,
        x: 0, y: 0, z: 0,
      };
      // Who wears the crown: the first joiner of a fresh (or hibernated —
      // memory wiped) room, the same connection that already has it, or the
      // reserved owner NAME returning while the crown sits vacant. A room
      // must never be headless: headless means nobody can start a round.
      if (!this.ownerName || connId === this.ownerId ||
          (this.ownerId === null && normalize(name) === normalize(this.ownerName))) {
        this.ownerName = name;
        this.ownerId = connId;
      }
      this.peers.set(connId, p);

      ws.send(JSON.stringify({
        t: 'welcome', id: connId, color: p.color, spectator, song: this.songNow(), world: this.worldKey,
        look: this.lookNow || undefined,
        gift: this.gift || undefined,
        owner: connId === this.ownerId,
        promo: this.promo,
        roster: [...this.peers.entries()]
          .filter(([id]) => id !== connId)
          .map(([id, q]) => ({ id, name: q.name, color: q.color, x: q.x, y: q.y, z: q.z })),
      }));
      this.broadcast(
        JSON.stringify({ t: 'join', p: { id: connId, name: p.name, color: p.color } }),
        connId
      );
      return;
    }

    // gift hoops: the HOST drops an emoji into the world; the first player
    // through a wonder door catches it. The server is the referee — one
    // gift at a time, first catch wins, everyone hears both moments.
    if (m.t === 'gift') {
      const p = this.peers.get(connId);
      if (!p || connId !== this.ownerId) return;
      const e = String(m.e || '').slice(0, 8);
      if (!e) return;
      this.gift = { e, from: p.name };
      this.broadcast(JSON.stringify({ t: 'gift', name: p.name, e }));
      return;
    }
    if (m.t === 'catch') {
      const p = this.peers.get(connId);
      if (!p || p.spectator || !this.gift) return;
      const g = this.gift;
      this.gift = null;
      this.broadcast(JSON.stringify({ t: 'caught', id: connId, name: p.name, e: g.e, from: g.from }));
      return;
    }

    // the room wears ONE look: any player's wonder door redresses everyone.
    // The sender's name rides along so every screen can say who did it.
    if (m.t === 'look') {
      const p = this.peers.get(connId);
      if (!p || p.spectator) return;
      if (p.lastLook && now - p.lastLook < 1500) return;   // one change per breath
      p.lastLook = now;
      const cfg = {
        colorMode: String(m.colorMode || '').slice(0, 24),
        pattern: String(m.pattern || '').slice(0, 24),
        shape: String(m.shape || '').slice(0, 24),
        hue: Math.max(0, Math.min(360, Number(m.hue) || 0)),
      };
      if (!cfg.colorMode) return;
      this.lookNow = cfg;
      this.broadcast(JSON.stringify({ t: 'look', id: connId, name: p.name, ...cfg }), connId);
      return;
    }

    // emotes: anyone can react, everyone sees it (server-side rate limit too)
    if (m.t === 'go') {
      // the starting gun: only the host fires it, everyone hears it at once
      if (connId !== this.ownerId) return;
      this.broadcast(JSON.stringify({ t: 'go', at: Number(m.at) || 0 }), connId);
      return;
    }

    if (m.t === 'promo') {
      if (connId !== this.ownerId) return;   // only the host promotes
      const label = typeof m.label === 'string' ? m.label.slice(0, 48) : '';
      const rawUrl = typeof m.url === 'string' ? m.url.slice(0, 300) : '';
      this.promo = (label && /^https?:\/\//.test(rawUrl)) ? { label, url: rawUrl } : null;
      this.broadcast(JSON.stringify({ t: 'promo', promo: this.promo }));
      return;
    }

    if (m.t === 'emote') {
      const p = this.peers.get(connId);
      if (!p) return;
      if (now - (p.lastEmote || 0) < 600) return;
      p.lastEmote = now;
      // 0-7 are bombs, 100-101 are tricks. The old clamp to 4 crushed
      // poop, tongue, kiss AND both tricks into sparkles — the great
      // sparkle mystery, solved.
      const i = Math.max(0, Math.min(120, Number(m.i) || 0));
      const e = typeof m.e === 'string' ? m.e.slice(0, 8) : undefined;
      // `to` targets one player's screen; everyone still hears about it
      this.broadcast(JSON.stringify({ t: 'emote', id: connId, i, e, to: typeof m.to === 'string' ? m.to.slice(0, 14) : undefined }), connId);
      return;
    }

    // host switches the world; the whole room follows
    if (m.t === 'world') {
      if (connId !== this.ownerId) return; // only the host steers the room
      const key = String(m.key || '').slice(0, 24);
      if (!/^[a-z]+$/.test(key)) return;
      if (key !== this.worldKey) {
        this.worldKey = key;
        this.broadcast(JSON.stringify({ t: 'world', key }), connId);
      }
      return;
    }

    // host announces what's playing; fan out so every phone syncs to it
    if (m.t === 'song') {
      if (connId !== this.ownerId) return; // only the host drives the music
      this.song = {
        url: String(m.url || '').slice(0, 200),
        title: String(m.title || '').slice(0, 120),
        pos: Number(m.pos) || 0,
        playing: !!m.playing,
        at: now,
      };
      this.broadcast(JSON.stringify({ t: 'song', ...this.songNow() }), connId);
      return;
    }

    // peer asks about an id it doesn't recognize (e.g. it pruned someone
    // whose phone locked, and they came back) — replay their join card
    if (m.t === 'who') {
      const q = this.peers.get(m.id);
      if (q) ws.send(JSON.stringify({ t: 'join', p: { id: m.id, name: q.name, color: q.color } }));
      return;
    }

    if (m.t === 'state') {
      const p = this.peers.get(connId);
      if (!p) {
        // sender was pruned while their tab slept; invite them back in
        ws.send(JSON.stringify({ t: 'rejoin' }));
        return;
      }
      if (p.spectator) return; // spectators receive, never send
      p.lastSeen = now;
      p.x = m.x; p.y = m.y; p.z = m.z;
      this.broadcast(JSON.stringify({
        t: 'state', id: connId, x: m.x, y: m.y, z: m.z, heading: m.heading, action: m.action,
        score: Number(m.score) || 0,
        // set-stats for the end-of-set awards: [bombs, passes, passed, streak, acc]
        st: Array.isArray(m.st) ? m.st.slice(0, 6).map(n => Number(n) || 0) : undefined,
      }), connId);

      // opportunistic prune of the silent
      for (const [id, q] of this.peers) {
        if (now - q.lastSeen > DROP_AFTER) {
          this.peers.delete(id);
          this.broadcast(JSON.stringify({ t: 'leave', id }));
        }
      }
    }
  }

  onLeave(ws) {
    const connId = this.conns.get(ws);
    this.conns.delete(ws);
    if (connId && this.peers.delete(connId)) {
      this.broadcast(JSON.stringify({ t: 'leave', id: connId }));
    }
    // the host's crown outlives their socket: a refresh or blip must never
    // leave the room permanently headless. The NAME stays reserved; the
    // next join wearing it (with owner intent) reclaims the room.
    if (connId === this.ownerId) this.ownerId = null;
    // room hibernates automatically when the last connection closes
  }
}

// Only this project's own pages may use the relay — otherwise anyone who
// spots the pattern can proxy audio on our bandwidth.
const ALLOWED = [
  'https://tupeloghost.github.io',
  'http://localhost:8807',
  'http://127.0.0.1:8807',
];
function allowedOrigin(request) {
  const o = request.headers.get('Origin') || '';
  if (o) return ALLOWED.includes(o);
  const r = request.headers.get('Referer') || '';
  return ALLOWED.some(a => r.startsWith(a));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // browsers preflight cross-origin JSON POSTs — answer politely
    if (request.method === 'OPTIONS' && (url.pathname === '/waitlist' || url.pathname === '/log' || url.pathname === '/custom' || url.pathname === '/share-home' || url.pathname === '/shot' || url.pathname === '/c-create' || url.pathname === '/c-update')) {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      } });
    }

    // ── crash telemetry: the launch-day eyes. Browsers POST their errors
    // here; they land in the worker logs (dashboard > Workers > Logs).
    if (url.pathname === '/log' && request.method === 'POST') {
      const body = await request.text().catch(() => '');
      console.log('CLIENT-ERROR', body.slice(0, 2000));
      return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // /w/{artist}/{song} — the permanent front door for a promoted song.
    // Resolves through the song's current home world, so links never stale.
    // NOT a bare redirect: link crawlers (iMessage, Discord, X) don't follow
    // JS but do read og tags — so the page itself carries the song's card,
    // and a human is bounced onward before they can blink. The pasted link
    // unfurls as THE SONG, which is the whole ad.
    const SITE_URL = 'https://tupeloghost.github.io/FancyPants/';
    const unfurl = (title, desc, dest, image) => {
      const esc = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
      const img = image || SITE_URL + 'og.jpg';
      return new Response('<!doctype html><html><head><meta charset="utf-8">'
        + '<title>' + esc(title) + '</title>'
        + '<meta property="og:title" content="' + esc(title) + '">'
        + '<meta property="og:description" content="' + esc(desc) + '">'
        + '<meta property="og:type" content="website">'
        + '<meta property="og:site_name" content="Fancy Britches">'
        + '<meta property="og:image" content="' + esc(img) + '">'
        + '<meta name="twitter:card" content="summary_large_image">'
        + '<meta name="twitter:title" content="' + esc(title) + '">'
        + '<meta name="twitter:description" content="' + esc(desc) + '">'
        + '<meta name="twitter:image" content="' + esc(img) + '">'
        + '<meta http-equiv="refresh" content="0;url=' + esc(dest) + '">'
        + '<script>location.replace(' + JSON.stringify(dest) + ')</scr' + 'ipt>'
        + '</head><body style="background:#07060f"></body></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    };
    const wslug = url.pathname.match(/^\/w\/([a-z0-9-]{1,40})\/([a-z0-9-]{1,40})$/);
    if (wslug) {
      const id = env.ROOMS.idFromName('THE-WAITING-LIST');
      const r = await env.ROOMS.get(id).fetch(new Request('https://do/w-get/' + wslug[1] + '/' + wslug[2]));
      const row = await r.json().catch(() => ({}));
      const go = url.searchParams.get('go') === '1' ? '&go=1' : '';
      const dest = (row.song
        ? SITE_URL + '?suno=' + encodeURIComponent(row.song) + (row.world ? '&world=' + row.world : '')
        : SITE_URL + '?_=1') + go;
      const title = wslug[2].replace(/-/g, ' ') + ' by ' + wslug[1].replace(/-/g, ' ');
      const image = row.world && ['tunnel', 'surfer', 'slide'].includes(row.world)
        ? SITE_URL + 'previews/' + row.world + '.jpg' : null;
      return unfurl(title, 'hearing it is fine. being in it is better.', dest, image);
    }
    // /p/{world}/{file} — the short front door for a house song: a clean
    // link that unfurls with the song's name instead of a query-string tail
    const pslug = url.pathname.match(/^\/p\/([a-z0-9-]{1,24})\/([A-Za-z0-9_.-]{1,60}\.mp3)$/);
    if (pslug) {
      const dest = SITE_URL + '?world=' + pslug[1] + '&track=' + encodeURIComponent(pslug[2])
        + (url.searchParams.get('go') === '1' ? '&go=1' : '');
      const title = pslug[2].replace(/\.mp3$/, '').replace(/[_-]+/g, ' ');
      const image = ['tunnel', 'surfer', 'slide'].includes(pslug[1])
        ? SITE_URL + 'previews/' + pslug[1] + '.jpg' : null;
      return unfurl(title + ', from the inside',
        'it moves when the music does, and again when you do.', dest, image);
    }
    // /c/{slug} — a creator's page: reachable only by its link, never listed
    const cslug = url.pathname.match(/^\/c\/([a-z0-9-]{3,30})$/);
    if (cslug) {
      const id = env.ROOMS.idFromName('THE-WAITING-LIST');
      const ckey = String(url.searchParams.get('key') || '').replace(/[^a-f0-9]/g, '').slice(0, 32);
      const r = await env.ROOMS.get(id).fetch(new Request('https://do/c-get?slug=' + cslug[1] + '&count=1' + (ckey ? '&key=' + ckey : '')));
      const pg = await r.json().catch(() => ({}));
      if (!pg.slug) return new Response('no such page', { status: 404 });
      const esc = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
      const songs = (pg.songs || []).map(o => {
        const p2 = typeof o === 'string' ? o : o.path;
        const world = (typeof o === 'string' ? '' : o.world) || 'tunnel';
        return { p: p2, world, label: world.toUpperCase(), title: (p2.split('/')[1] || '').replace(/-/g, ' ') };
      });
      const lead = songs[0];
      const heroImg = lead ? SITE_URL + 'previews/' + esc(lead.world) + '.jpg' : SITE_URL + 'og.jpg';
      const H = Number.isFinite(+pg.hue) ? +pg.hue : 265;
      const isStreamer = pg.type === 'streamer';
      const liveSoon = !!(pg.nextAt && !isNaN(new Date(pg.nextAt)) && new Date(pg.nextAt).getTime() > Date.now() - 3 * 3600e3);
      // a streamer leads with the stream: when it is, where to watch, and a
      // door into the room. Off-air, the lead song takes the stage like anyone's.
      const liveBlock = isStreamer && liveSoon
        ? '<div class="live"><span class="eyebrow">going live</span><b class="next" data-at="' + esc(pg.nextAt) + '">' + esc(pg.next || 'soon') + '</b>'
          + (pg.watch ? '<a class="watch" href="' + esc(pg.watch) + '" rel="noopener">watch here \u2192</a>' : '')
          + '<a class="room" href="' + SITE_URL + '">step inside and play along</a></div>'
        : '';
      const kind = isStreamer ? 'streamer' : 'artist';
      // every page has a standing room: "play together" drops a visitor into
      // it. Whoever's there plays together; the first in the door hosts.
      const roomCode = pg.slug.replace(/[^a-z0-9]/g, '').toUpperCase().slice(0, 12);
      const playBtn = '<a class="together" href="' + SITE_URL + '?room=' + roomCode + '&with=' + encodeURIComponent(pg.name.slice(0, 24)) + '">'
        + '<b>play together</b><i>' + esc(pg.name) + '\u2019s room \u00b7 ' + roomCode + '</i></a>';
      // ── the vibe check, grounded ── ten short statements on a 5-point scale,
      // drawn from what friendship research actually predicts:
      //   · similarity in VALUES and OPENNESS (Byrne; Montoya & Horton meta-
      //     analysis: actual similarity predicts attraction in new acquaintances)
      //   · each person's AGREEABLENESS/warmth (predicts friendship quality
      //     more than trait-matching does)
      //   · matching RHYTHMS: chronotype and social energy decide whether two
      //     people can actually make plans (propinquity is the real engine)
      // Items paraphrase the TIPI (Gosling 2003) for O, A, E, C plus two value
      // items and one chronotype item. R = reverse-scored.
      // Forced choice between two EQUALLY fine things to be: no item has a
      // 'better' answer, which is the standard guard against people picking
      // what they think makes them likeable (social-desirability bias).
      // Five steps between the poles; R items are reverse-scored.
      const VQ = [
        // values: benevolence vs achievement
        ['the friend who shows up', 'the friend who pushes you'],
        ['I’d rather be useful', 'I’d rather be remarkable'],
        // values: stimulation/self-direction vs security/tradition
        ['somewhere new every time', 'my usual spot'],
        ['shake things up', 'keep what works'],
        // openness (aesthetic): music taste breadth and texture
        ['songs I already love', 'something I’ve never heard'],
        ['polished and clean', 'weird and a little messy'],
        // extraversion / social energy
        ['recharge alone', 'recharge in a crowd'],
        ['warm up slowly', 'talk to strangers easily'],
        // agreeableness / warmth (how I give it)
        ['say it straight', 'smooth it over'],
        ['call it like I see it', 'let it slide'],
        // conscientiousness / planning
        ['wing it', 'plan it'],
        ['show up when I get there', 'show up early'],
        // rhythm: chronotype, pace
        ['early hours', 'late hours'],
        ['one thing at a time', 'ten tabs open'],
        // expectations: contact frequency, closeness pace
        ['catch up when we catch up', 'talk most days'],
        ['let it build', 'get deep fast'],
        // humor style
        ['dry', 'silly'],
        ['I go easy on the people I love', 'I tease the people I love'],
        // conflict: cool-off vs now; how I want to be told
        ['cool off first', 'talk it out now'],
        ['I’d rather be told straight', 'I’d rather be told gently'],
      ];
      const VIBE_ON = false;   // tabled 2026-08-24: artist value first; flip to bring the vibe check back
      const vibeBlock = (VIBE_ON && pg.quiz && pg.quiz.length === 20)
        ? '<div class="vibe" id="vibe" data-q="' + esc(pg.quiz) + '" data-i="' + esc((pg.intents || []).join(',')) + '" data-n="' + esc(pg.name) + '">'
          + '<button class="vgo" id="vgo">see how you two would click <i>twenty quick picks, about a minute</i></button></div>'
        : '';
      const vibeScript = (VIBE_ON && pg.quiz && pg.quiz.length === 20) ? '<script>(function(){'
        + 'var VQ=' + JSON.stringify(VQ) + ';'
        + 'var box=document.getElementById("vibe");if(!box)return;'
        + 'var theirs=box.getAttribute("data-q"),tI=(box.getAttribute("data-i")||"").split(",").filter(Boolean),name=box.getAttribute("data-n");'
        + 'function esc(t){return String(t).replace(/[<>&]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;"}[c]})}'
        + 'function prof(q){var v=q.split("").map(Number);function m(i,j){return (v[i]+v[j])/2}'
        + 'return {Vb:m(0,1),Vs:m(2,3),O:m(4,5),E:m(6,7),A:m(8,9),C:m(10,11),N:v[12],P:v[13],F:v[14],D:v[15],H1:v[16],H2:v[17],X:v[18],R:v[19]}}'
        + 'function sim(a,b){return 1-Math.abs(a-b)/4}'
        + 'function score(mine,mI){var m=prof(mine),t=prof(theirs);'
        // values: the strongest attitudinal predictor of liking
        + 'var values=0.5*sim(m.Vb,t.Vb)+0.5*sim(m.Vs,t.Vs);'
        // rhythm: matched EXPECTATIONS of contact and closeness dominate; then hours, pace, planning
        + 'var rhythm=0.30*sim(m.F,t.F)+0.20*sim(m.D,t.D)+0.20*sim(m.N,t.N)+0.15*sim(m.P,t.P)+0.15*sim(m.C,t.C);'
        // vibe: humor style similarity, social energy, aesthetic openness
        + 'var vibe=0.30*sim(m.H1,t.H1)+0.20*sim(m.H2,t.H2)+0.25*sim(m.E,t.E)+0.25*sim(m.O,t.O);'
        // conflict fit: how I give (A) vs how you want it (R), both directions, plus cool-off match
        + 'var give=function(p){return p.A};var want=function(p){return p.R};'
        + 'var fit=0.6*((sim(give(m),want(t))+sim(give(t),want(m)))/2)+0.4*sim(m.X,t.X);'
        // warmth: each person's agreeableness predicts friendship quality (additive, not matched)
        + 'var warmth=((m.A+t.A)/2-1)/4*8;'
        + 'var shared=mI.filter(function(x){return tI.indexOf(x)>-1}).length;'
        + 'var core=0.30*values+0.25*rhythm+0.25*vibe+0.20*fit;'
        + 'var pct=Math.min(97,Math.round(30+55*core+warmth+Math.min(2,shared)*4));'
        + 'var D=[["Vb","show-up friends","one of you prizes the friend who shows up, the other the one who pushes"],'
        + '["Vs","shake-it-up people","one of you shakes things up, the other keeps what works"],'
        + '["O","ones for something new","one of you wants the new thing, the other the loved thing"],'
        + '["E","crowd-rechargers","one of you recharges in a crowd, the other alone"],'
        + '["F","talk-most-days people","one of you wants to talk most days, the other catches up when you catch up"],'
        + '["D","get-deep-fast people","one of you gets deep fast, the other lets it build"],'
        + '["N","late-hours people","one of you runs late, the other early"],'
        + '["H1","silly people","one of you is silly, the other dry"],'
        + '["H2","teasers","one of you teases, the other goes easy"],'
        + '["C","planners","one of you plans, the other wings it"],'
        + '["X","talk-it-out-now people","one of you cools off first, the other wants to talk now"]];'
        + 'var LO={Vb:"push-you friends",Vs:"keep-what-works people",O:"ones for the songs you already love",E:"alone-rechargers",F:"catch-up-when-we-catch-up people",D:"let-it-build people",N:"early-hours people",H1:"dry people",H2:"go-easy people",C:"wing-it people",X:"cool-off-first people"};'
        + 'var same=[],diff=[];for(var i=0;i<D.length;i++){var k=D[i][0],a=m[k],b=t[k],hi=a>=3.5&&b>=3.5,lo=a<=2.5&&b<=2.5;'
        + 'if(hi)same.push(D[i][1]);else if(lo)same.push(LO[k]);'
        + 'else if(Math.abs(a-b)>=2)diff.push(D[i][2])}'
        // the feedback-fit line is its own kind of insight: it's about how to TALK to each other
        + 'var gm=give(m)>=3.5?"gently":give(m)<=2.5?"straight":"",wt=want(t)>=3.5?"gently":want(t)<=2.5?"straight":"";'
        + 'var tip=(gm&&wt&&gm!==wt)?"you tend to say things "+gm+"; they’d rather be told "+wt:"";'
        + 'var tag=pct>=85?"you’d click fast":pct>=70?"easy company":pct>=55?"different, in a good way":"a stretch, but stretches are fun";'
        + 'var how=pct>=85?"the three things that make friendships easy all line up":pct>=70?"most of it lines up, with a little texture":pct>=55?"you share some ground and would learn from the rest":"not much lines up on paper, which is sometimes the best kind";'
        + 'return {pct:pct,tag:tag,how:how,same:same,diff:diff,shared:shared,tip:tip,facets:[["values",values],["rhythm",rhythm],["vibe",vibe]]}}'
        + 'function show(r){var lines="";'
        + 'var bars="<div class=\\"vfacets\\">";for(var i=0;i<r.facets.length;i++){var f=r.facets[i],w=Math.round(f[1]*100);bars+="<div class=\\"vf\\"><span>"+f[0]+"</span><i><b style=\\"width:"+w+"%\\"></b></i></div>"}bars+="</div>";lines+=bars;'
        + 'lines+="<p class=\\"vhow\\">"+esc(r.how)+"</p>";'
        + 'if(r.tip)lines+="<p class=\\"vtip\\">"+esc(r.tip)+"</p>";'
        + 'if(r.same.length)lines+="<p>you’re both <b>"+r.same.slice(0,3).map(esc).join("</b>, <b>")+"</b></p>";'
        + 'if(r.diff.length)lines+="<p>mind this: "+esc(r.diff[0])+"</p>";'
        + 'if(r.shared)lines+="<p>and you’re here for the same thing</p>";'
        + 'box.innerHTML="<div class=\\"vres\\"><span class=\\"vtag\\">"+esc(r.tag)+"</span>"+lines'
        + '+"<p class=\\"vwhy\\">based on what friendship research actually predicts: shared values, matched expectations of contact, humor style, warmth, and whether you can be straight with each other</p>"'
        + '+"<a href=\\"#\\" id=\\"vredo\\">retake</a></div>";'
        + 'document.getElementById("vredo").onclick=function(e){e.preventDefault();localStorage.removeItem("fb_quiz");quiz()}}'
        + 'function quiz(){var ans=[],idx=0;function step(){if(idx>=VQ.length){'
        + 'box.innerHTML="<div class=\\"vq\\"><p class=\\"vqq\\">and you’re here for</p><div class=\\"vopts\\"><button data-i=\\"friends\\">friends</button><button data-i=\\"collaborators\\">collaborators</button><button data-i=\\"business\\">business</button></div><a href=\\"#\\" id=\\"vskip\\">skip</a></div>";'
        + 'var picked=[];var bs=box.querySelectorAll(".vopts button");for(var k=0;k<bs.length;k++)bs[k].onclick=function(){this.classList.toggle("on");picked=[].map.call(box.querySelectorAll(".vopts button.on"),function(b){return b.getAttribute("data-i")})};'
        + 'document.getElementById("vskip").onclick=function(e){e.preventDefault();finish()};'
        + 'var done=document.createElement("button");done.className="vdone";done.textContent="see it";done.onclick=finish;box.querySelector(".vq").appendChild(done);'
        + 'function finish(){var q=ans.join("");localStorage.setItem("fb_quiz",q);localStorage.setItem("fb_intents",picked.join(","));show(score(q,picked))}return}'
        + 'var L=VQ[idx][0],R=VQ[idx][1];var SC=["\\u25c0 this","lean \\u25c0","honestly, both","lean \\u25b6","that \\u25b6"];'
        + 'var h="<div class=\\"vq\\"><p class=\\"vqq\\">"+(idx+1)+" of "+VQ.length+" · which is more you</p><div class=\\"vpoles\\"><span>"+esc(L)+"</span><span>"+esc(R)+"</span></div><div class=\\"vopts vsc\\">";'
        + 'for(var j=0;j<5;j++)h+="<button data-v=\\""+(j+1)+"\\">"+esc(SC[j])+"</button>";box.innerHTML=h+"</div></div>";'
        + 'var b2=box.querySelectorAll(".vopts button");for(var k=0;k<b2.length;k++)b2[k].onclick=function(){ans.push(this.getAttribute("data-v"));idx++;step()}}step()}'
        + 'var mine=localStorage.getItem("fb_quiz")||"";var mI=(localStorage.getItem("fb_intents")||"").split(",").filter(Boolean);'
        + 'if(/^[1-5]{20}$/.test(mine))show(score(mine,mI));else document.getElementById("vgo").onclick=quiz;'
        + '})();</scr' + 'ipt>' : '';
      const intentRow = (pg.intents || []).length
        ? '<p class="here">here for ' + pg.intents.map(x => '<b>' + esc(x) + '</b>').join(' · ') + '</p>' : '';
      const promptRows = (pg.prompts || []).map(x =>
        '<div class="prompt"><em>' + esc(x.q) + '</em><span>' + esc(x.a) + '</span></div>').join('');
      // the page IS their world: the game runs silently behind the card in
      // stage mode, wearing their look, moving to a heartbeat
      const stageSrc = SITE_URL + '?stage=1&world=' + encodeURIComponent(lead ? lead.world : 'tunnel')
        + (pg.look ? '&look=' + encodeURIComponent(pg.look) : '&hue=' + H);
      // the OWNER's seat: with their edit key in the link, the page opens with
      // their numbers - screenshot-able, invisible to everyone else
      const privStrip = pg.canEdit
        ? '<div class="mine"><span class="meye">your numbers \u00b7 only you see this</span>'
          + '<div class="mrow"><b>' + (pg.views || 0) + '</b><i>page visits</i></div>'
          + songs.map(sg => '<div class="mrow"><b>' + ((pg.plays || {})[sg.p] || 0) + '</b><i>stepped inside \u2018' + esc(sg.title) + '\u2019</i></div>').join('')
          + '</div>'
        : '';
      // the lead song is the page's thesis: one big door. the rest are rows.
      const heroBtn = lead
        ? '<a class="hero" href="https://fancy-pants.tupeloghost.workers.dev/w/' + esc(lead.p) + '">'
          + '<span class="eyebrow">step inside</span><b>' + esc(lead.title) + '</b><i>in ' + esc(lead.label) + '</i></a>'
        : '';
      const songRows = songs.slice(1).map(sg =>
        '<a class="song" href="https://fancy-pants.tupeloghost.workers.dev/w/' + esc(sg.p) + '">'
        + '<img src="' + SITE_URL + 'previews/' + esc(sg.world) + '.jpg" alt="">'
        + '<span class="t">' + esc(sg.title) + '<em>in ' + esc(sg.label) + '</em></span>'
        + '<span class="go">step inside →</span></a>').join('');
      const linkRows = (pg.links || []).map(l =>
        '<a class="pill" href="' + esc(l.url) + '" rel="noopener">' + esc(l.label) + '</a>').join('');
      const html = '<!doctype html><html><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        + '<meta name="robots" content="noindex">'
        + '<title>' + esc(pg.name) + '</title>'
        + '<meta property="og:title" content="' + esc(pg.name) + (lead ? ' · step inside ‘' + esc(lead.title) + '’' : '') + '">'
        + '<meta property="og:description" content="' + esc(pg.nextAt && pg.next ? pg.next : (pg.bio || 'songs you can step inside, right in the browser')) + '">'
        + '<meta property="og:site_name" content="Fancy Britches">'
        + '<meta property="og:image" content="' + heroImg + '">'
        + '<meta name="twitter:card" content="summary_large_image">'
        + '<meta name="twitter:title" content="' + esc(pg.name) + '">'
        + '<meta name="twitter:image" content="' + heroImg + '">'
        + '<style>'
        + ':root{--h:' + H + '}'
        + '.stage{position:fixed;inset:0;width:100%;height:100%;border:0;z-index:0;pointer-events:none;filter:brightness(0.62) saturate(1.1)}'
        + '.mood{margin:-2px 0 18px;font-style:italic;color:hsl(var(--h),80%,82%);font-size:17px}'
        + '.mine{margin:0 auto 26px;max-width:420px;padding:14px 18px;border-radius:16px;text-align:left;background:hsla(var(--h),60%,30%,0.22);border:1px dashed hsla(var(--h),70%,75%,0.5)}'
        + '.meye{display:block;font:11px ui-monospace,Menlo,monospace;letter-spacing:2px;text-transform:uppercase;color:hsl(var(--h),70%,80%);margin-bottom:8px}'
        + '.mrow{display:flex;align-items:baseline;gap:10px;margin:3px 0}'
        + '.mrow b{font-family:Didot,"Bodoni 72",Georgia,serif;font-weight:400;font-size:24px;min-width:44px;text-align:right;color:#fff}'
        + '.mrow i{font-style:normal;font-size:13px;color:#c4bfe3}'
        + '.together{display:block;margin:-8px auto 26px;max-width:420px;padding:14px 18px;border-radius:18px;text-decoration:none;color:#f0eefc;'
        + 'background:rgba(255,255,255,0.07);border:1px solid hsla(var(--h),70%,75%,0.45)}'
        + '.together b{display:block;font-family:Didot,"Bodoni 72",Georgia,serif;font-weight:400;font-size:19px;letter-spacing:1px}'
        + '.together i{display:block;font-style:normal;font:11px ui-monospace,Menlo,monospace;letter-spacing:1.6px;color:#9a94c4;margin-top:2px;text-transform:uppercase}'
        + '.together:hover{background:rgba(255,255,255,0.11)}'
        + '.vibe{margin:0 auto 24px;max-width:440px;padding:16px 18px;border-radius:18px;background:rgba(255,255,255,0.06);border:1px solid hsla(var(--h),70%,75%,0.35)}'
        + '.vgo{width:100%;padding:13px 16px;border-radius:999px;border:0;cursor:pointer;color:#130f26;background:linear-gradient(175deg,hsl(var(--h),90%,92%),hsl(var(--h),80%,76%));font:600 15px Georgia,serif}'
        + '.vgo i{display:block;font:11px ui-monospace,Menlo,monospace;letter-spacing:1.6px;color:#4b3f7a;font-style:normal;margin-top:2px}'
        + '.vq .vqq{margin:0 0 10px;font:11px ui-monospace,Menlo,monospace;letter-spacing:2px;text-transform:uppercase;color:#9a94c4}'
        + '.vopts{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}'
        + '.vopts button{flex:1;min-width:120px;padding:13px 12px;border-radius:14px;cursor:pointer;color:#f0eefc;background:rgba(255,255,255,0.07);border:1px solid rgba(180,170,230,0.35);font:15px Georgia,serif}'
        + '.vopts button:hover,.vopts button.on{background:hsla(var(--h),70%,60%,0.35);border-color:hsl(var(--h),80%,80%)}'
        + '.vq a,.vres a{display:inline-block;margin-top:10px;font:11px ui-monospace,Menlo,monospace;letter-spacing:1.6px;color:#9a94c4;text-transform:uppercase}'
        + '.vdone{margin:10px 0 0 12px;padding:9px 18px;border-radius:999px;border:0;cursor:pointer;color:#130f26;background:hsl(var(--h),80%,80%);font:600 13px Georgia,serif}'
        + '.vpoles{display:flex;justify-content:space-between;gap:12px;margin:0 0 10px;font-family:Didot,"Bodoni 72",Georgia,serif;font-size:17px;color:#fff}.vpoles span:last-child{text-align:right}'
        + '.vfacets{display:flex;flex-direction:column;gap:6px;margin:10px auto 6px;max-width:300px}'
        + '.vf{display:flex;align-items:center;gap:10px;font:11px ui-monospace,Menlo,monospace;letter-spacing:1.6px;text-transform:uppercase;color:#9a94c4}'
        + '.vf span{width:58px;text-align:right}.vf i{flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;display:block}'
        + '.vf b{display:block;height:100%;background:linear-gradient(90deg,hsl(var(--h),80%,70%),hsl(var(--h),90%,85%))}'
        + '.vtip{font-style:italic;color:hsl(var(--h),80%,84%)!important}'
        + '.vhow{color:#c4bfe3!important;font-style:italic}'
        + '.vst{font-family:Didot,"Bodoni 72",Georgia,serif;font-size:19px;color:#fff;margin:0 0 12px;line-height:1.3}'
        + '.vsc button{min-width:0;flex:1;padding:11px 4px;font-size:13px}'
        + '.vwhy{font-size:12px!important;color:#8d87b0!important;margin-top:10px!important;font-style:italic}'
        + '.vres .vpct{font-family:Didot,"Bodoni 72",Georgia,serif;font-size:46px;line-height:1;color:hsl(var(--h),85%,84%);display:block}'
        + '.vres .vtag{display:block;font-family:Didot,"Bodoni 72",Georgia,serif;font-size:30px;line-height:1.1;color:hsl(var(--h),85%,86%);margin:0 0 10px}'
        + '.vres p{margin:4px 0;color:#c4bfe3;font-size:14.5px}.vres b{color:#fff;font-weight:400}'
        + '.here{margin:0 0 16px;font:11.5px ui-monospace,Menlo,monospace;letter-spacing:2px;text-transform:uppercase;color:#9a94c4}.here b{font-weight:400;color:hsl(var(--h),85%,84%)}'
        + '.prompts{margin:6px auto 26px;max-width:460px;display:flex;flex-direction:column;gap:10px;text-align:left}'
        + '.prompt{padding:12px 16px;border-radius:14px;background:rgba(255,255,255,0.05);border:1px solid rgba(180,170,230,0.18)}'
        + '.prompt em{display:block;font-style:normal;font:11px ui-monospace,Menlo,monospace;letter-spacing:1.6px;text-transform:uppercase;color:#9a94c4;margin-bottom:3px}'
        + '.prompt span{font-style:italic;color:#ece8ff}'
        + '.mood::before{content:"\\201C"}.mood::after{content:"\\201D"}'
        + '*{box-sizing:border-box}'
        + 'body{margin:0;min-height:100vh;background:#07060f;color:#eceafb;font:16px/1.6 Georgia,serif;}'
        + '.bg{position:fixed;inset:0;background:url(' + heroImg + ') center/cover;filter:blur(38px) saturate(1.3) brightness(0.45);transform:scale(1.15);z-index:0}'
        + '.veil{position:fixed;inset:0;background:radial-gradient(900px 600px at 50% 0%,rgba(20,16,40,0.15),rgba(7,6,15,0.82) 75%);z-index:0}'
        + '.card{position:relative;z-index:1;max-width:560px;margin:0 auto;padding:52px 18px 40px;text-align:center;}'
        + '.on{font:11px ui-monospace,Menlo,monospace;letter-spacing:3px;color:#9a94c4;text-transform:uppercase;margin:0 0 10px}'
        + 'h1{font-family:Didot,"Bodoni 72",Georgia,serif;font-weight:400;font-size:46px;margin:0 0 8px;letter-spacing:1px;line-height:1.1}'
        + '.bio{font-style:italic;color:#c4bfe3;margin:0 auto 22px;max-width:460px;white-space:pre-wrap;}'
        + '.next{color:#eece78;font-style:italic;margin:0 0 22px;}'
        + '.hero{display:block;margin:8px auto 26px;max-width:420px;padding:22px 26px;border-radius:22px;text-decoration:none;color:#130f26;'
        + 'background:linear-gradient(175deg,hsl(var(--h),90%,94%),hsl(var(--h),80%,82%) 60%,hsl(var(--h),75%,72%));box-shadow:0 14px 50px hsla(var(--h),80%,65%,0.35),inset 0 1px 0 rgba(255,255,255,0.8);}'
        + '.photo{width:108px;height:108px;border-radius:50%;object-fit:cover;margin:0 auto 14px;display:block;border:2px solid hsla(var(--h),80%,80%,0.6);box-shadow:0 10px 40px hsla(var(--h),80%,60%,0.35)}'
        + '.live{margin:6px auto 22px;max-width:440px;padding:20px 22px;border-radius:22px;background:rgba(255,255,255,0.06);border:1px solid hsla(var(--h),70%,75%,0.35)}'
        + '.live .eyebrow{display:block;font:11px ui-monospace,Menlo,monospace;letter-spacing:3px;text-transform:uppercase;color:hsl(var(--h),80%,80%)}'
        + '.live .eyebrow::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff5a5a;margin-right:8px;box-shadow:0 0 12px #ff5a5a;vertical-align:middle;animation:blink 1.4s infinite}'
        + '@keyframes blink{50%{opacity:0.35}}'
        + '.live b{display:block;font-family:Didot,"Bodoni 72",Georgia,serif;font-weight:400;font-size:22px;margin:6px 0 12px;color:#fff;font-style:normal}'
        + '.live .watch{display:inline-block;margin:0 6px 8px 0;padding:11px 20px;border-radius:999px;text-decoration:none;color:#130f26;background:linear-gradient(175deg,hsl(var(--h),90%,92%),hsl(var(--h),80%,76%));font-weight:600}'
        + '.live .room{display:inline-block;padding:11px 18px;border-radius:999px;text-decoration:none;color:#e6e2fa;border:1px solid rgba(180,170,230,0.4)}'
        + '.hero .eyebrow{display:block;font:11px ui-monospace,Menlo,monospace;letter-spacing:3px;text-transform:uppercase;color:#4b3f7a}'
        + '.hero b{display:block;font-family:Didot,"Bodoni 72",Georgia,serif;font-weight:400;font-size:30px;line-height:1.15;margin:4px 0 2px;text-transform:capitalize}'
        + '.hero i{display:block;font-size:13px;color:#5a4f8a}'
        + '.songs{margin:0 0 26px;display:flex;flex-direction:column;gap:10px;}'
        + '.song{display:flex;align-items:center;gap:14px;padding:10px 14px 10px 10px;border-radius:16px;text-align:left;'
        + 'background:rgba(255,255,255,0.06);border:1px solid rgba(180,170,230,0.22);color:#f0eefc;text-decoration:none;}'
        + '.song img{width:58px;height:40px;object-fit:cover;border-radius:9px;flex:none}'
        + '.song .t{flex:1;text-transform:capitalize}.song .t em{display:block;font-style:normal;font-size:12px;color:#9a94c4;text-transform:none}'
        + '.song .go{color:#d9c8ff;font-size:13px;white-space:nowrap}'
        + '.song:hover{border-color:#a99ce8;background:rgba(255,255,255,0.09)}'
        + '.tip{display:inline-block;margin:2px 0 18px;padding:13px 30px;border-radius:999px;color:#1b1430;'
        + 'background:linear-gradient(175deg,#ffe9a8,#eece78);font-weight:600;text-decoration:none;'
        + 'box-shadow:0 4px 22px rgba(238,206,120,0.35);}'
        + '.pill{display:inline-block;margin:5px;padding:10px 18px;border:1px solid rgba(180,170,230,0.35);'
        + 'border-radius:24px;color:#e6e2fa;text-decoration:none;background:rgba(255,255,255,0.05);font-size:14px}'
        + '.pill:hover{border-color:#a99ce8;}'
        + 'footer{margin-top:40px;font-size:12.5px;color:#8d87b0;}footer a{color:#b9b3da;}'
        + '</style></head><body><div class="bg"></div>'
        + '<iframe class="stage" src="' + stageSrc + '" title="" tabindex="-1" aria-hidden="true" loading="lazy" allow="autoplay"></iframe>'
        + '<div class="veil"></div><div class="card">'
        + privStrip
        + (pg.photo ? '<img class="photo" src="' + esc(pg.photo) + '" alt="">' : '')
        + '<p class="on">' + kind + ' on fancy britches</p>'
        + '<h1>' + esc(pg.name) + '</h1>'
        + (pg.mood ? '<p class="mood">' + esc(pg.mood) + '</p>' : '')
        + (pg.bio ? '<p class="bio">' + esc(pg.bio) + '</p>' : '')
        // seat order: a visitor came for the EXPERIENCE — the stream if it's
        // on, then the music doors, then playing together. Who the artist is
        // as a person (intents, vibe check, prompts) is the second act.
        + (liveBlock ? liveBlock : (pg.next ? '<p class="next"' + (pg.nextAt ? ' data-at="' + esc(pg.nextAt) + '"' : '') + '>' + esc(pg.next) + '</p>' : ''))
        + heroBtn
        + (songRows ? '<div class="songs">' + songRows + '</div>' : '')
        + playBtn
        + intentRow
        + vibeBlock
        + (promptRows ? '<div class="prompts">' + promptRows + '</div>' : '')
        + (pg.tip ? '<a class="tip" href="' + esc(pg.tip) + '" rel="noopener">&#10024; support ' + esc(pg.name) + '</a>' : '')
        + (linkRows ? '<div>' + linkRows + '</div>' : '')
        + '<footer>every song here is an experience. <a href="https://tupeloghost.github.io/FancyPants/">turn yours into one at fancy britches</a></footer>'
        + '</div>'
        + vibeScript
        + (pg.nextAt ? '<script>(function(){var e=document.querySelector(".next[data-at]");if(!e)return;var d=new Date(e.getAttribute("data-at"));if(isNaN(d))return;e.textContent=(e.closest(".live")?"":"going live ")+d.toLocaleString(undefined,{weekday:"long",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});})();</scr'+'ipt>' : '')
        + '</body></html>';
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── /link-meta ── a pasted link we cannot play, made presentable.
    // Every big platform publishes oEmbed, so one server-side lookup turns a
    // bare URL into a real title. Done here rather than in the page because
    // most of these endpoints refuse cross-origin reads.
    if (url.pathname === '/link-meta') {
      const target = url.searchParams.get('url') || '';
      let host = '';
      const reply = o => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      try { host = new URL(target).hostname.replace(/^www\./, ''); } catch { return reply({ ok: false }); }
      const PROVIDERS = [
        [/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)music\.youtube\.com$/, 'YouTube', 'https://www.youtube.com/oembed?format=json&url='],
        [/(^|\.)spotify\.com$/, 'Spotify', 'https://open.spotify.com/oembed?url='],
        [/(^|\.)soundcloud\.com$/, 'SoundCloud', 'https://soundcloud.com/oembed?format=json&url='],
        [/(^|\.)bandcamp\.com$/, 'Bandcamp', 'https://bandcamp.com/api/mobile/24/oembed?url='],
        [/(^|\.)music\.apple\.com$|(^|\.)apple\.com$/, 'Apple Music', ''],
        [/(^|\.)tidal\.com$/, 'Tidal', ''],
        [/(^|\.)deezer\.com$/, 'Deezer', ''],
      ];
      let provider = host, endpoint = '';
      for (const [re, name, ep] of PROVIDERS) if (re.test(host)) { provider = name; endpoint = ep; break; }
      let title = '';
      if (endpoint) {
        try {
          const r = await fetch(endpoint + encodeURIComponent(target), { cf: { cacheTtl: 3600 } });
          if (r.ok) { const j = await r.json(); title = String(j.title || '').slice(0, 90); }
        } catch { /* a missing title is not a failure; the provider still is one */ }
      }
      return reply({ ok: true, provider, title });
    }

    // /badge.svg?t=TITLE — the embed button artists paste onto their own
    // sites: a dark pill, accent rim, "step inside 'song'" in the house serif.
    // Served as an image so it works anywhere an <img> does.
    if (url.pathname === '/badge.svg') {
      const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const t = (url.searchParams.get('t') || '').trim().slice(0, 40);
      const label = t ? `step inside \u2018${t}\u2019` : 'step inside the song';
      const w = Math.max(260, Math.min(600, Math.round(label.length * 11.5 + 180)));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="52" viewBox="0 0 ${w} 52" role="img" aria-label="${esc(label)} on Fancy Britches">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9ad5"/><stop offset="1" stop-color="#7b6cff"/></linearGradient></defs>
<rect x="1" y="1" width="${w - 2}" height="50" rx="25" fill="#0b0c14" stroke="url(#g)" stroke-width="1.5"/>
<circle cx="30" cy="26" r="9" fill="none" stroke="url(#g)" stroke-width="1.6"/><circle cx="30" cy="26" r="2.4" fill="url(#g)"/>
<text x="50" y="31" font-family="Didot, 'Bodoni 72', Georgia, serif" font-size="16" letter-spacing="1.2" fill="#f3f0ff">${esc(label)}</text>
<text x="${w - 14}" y="31" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="8.5" letter-spacing="1.6" fill="#9a94c4">FANCY BRITCHES</text>
</svg>`;
      return new Response(svg, { headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      } });
    }

    // /thisweek — wherever the special is right now
    if (url.pathname === '/thisweek') {
      const FEATURED = ['tunnel'];
      const ALL = ['blacktop', 'bloom', 'cherry', 'comets', 'funhouse', 'garden', 'lava',
                   'orbit', 'paint', 'plasma', 'river', 'signal', 'slide', 'slinky',
                   'surfer', 'trail', 'tunnel'];
      // sunday's best: slide leads from launch Sunday Aug 23 2026, surfer next (matches client)
      const pool = ALL.filter(k => !FEATURED.includes(k) && k !== 'slide' && k !== 'surfer').sort();
      const rot = ['slide', 'surfer', ...pool];
      const SHIFT = 3 * 86400000 + 16 * 3600000;   // sunday 16:00 UTC, matches the client
      const LAUNCH_WEEK = Math.floor((Date.UTC(2026, 7, 30, 16) - SHIFT) / 604800000);
      const weeksIn = Math.max(0, Math.floor((Date.now() - SHIFT) / 604800000) - LAUNCH_WEEK);
      const wk = rot[weeksIn % rot.length];
      return Response.redirect(SITE_URL + '?world=' + wk, 302);
    }

    // the waiting list rides one well-known DO instance
    if (url.pathname === '/waitlist' || url.pathname === '/waitlist-list' ||
        url.pathname === '/custom' || url.pathname === '/custom-list' ||
        url.pathname === '/share-home' || url.pathname === '/w-stats' ||
        url.pathname === '/shot' || url.pathname.startsWith('/shot/') ||
        url.pathname === '/c-create' || url.pathname === '/c-update' || url.pathname === '/c-get') {
      const id = env.ROOMS.idFromName('THE-WAITING-LIST');
      return env.ROOMS.get(id).fetch(request);
    }
    if (url.pathname.startsWith('/suno') && !allowedOrigin(request)) {
      return new Response('not available', { status: 403 });
    }

    // audio relay: browsers can't analyse cross-origin audio without CORS,
    // so Suno tracks stream through here with the right headers attached.
    // Locked to Suno by construction — only an id or short code passes through.
    const streamSuno = async id => {
      const fwd = {};
      const range = request.headers.get('Range');
      if (range) fwd.Range = range;
      let upstream = await fetch(`https://cdn1.suno.ai/${id}.mp3`, { headers: fwd });
      if (upstream.status === 403 || upstream.status === 404) {
        upstream = await fetch(`https://cdn2.suno.ai/${id}.mp3`, { headers: fwd });
      }
      const h = new Headers(upstream.headers);
      h.set('Access-Control-Allow-Origin', '*');
      h.set('Accept-Ranges', 'bytes');
      return new Response(upstream.body, { status: upstream.status, headers: h });
    };

    const suno = url.pathname.match(/^\/suno\/([0-9a-fA-F-]{36})\.mp3$/);
    if (suno) return streamSuno(suno[1]);

    // resolve a link to {id, title, artist} so the panel can name the track —
    // and so a link that ISN'T a song fails honestly instead of grabbing
    // whatever id happens to be on the page
    const meta = url.pathname.match(/^\/suno-meta\/([A-Za-z0-9_-]{4,64})$/);
    if (meta) {
      const token = meta[1];
      const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
      const page = token.match(UUID)
        ? `https://suno.com/song/${token}`
        : `https://suno.com/s/${token}`;
      const json = (o, status = 200) => new Response(JSON.stringify(o), {
        status, headers: { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' },
      });
      let html = '';
      try {
        const r = await fetch(page, {
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FancyPants/1.0)' },
        });
        html = await r.text();
      } catch {
        return json({ error: 'unreachable' }, 502);
      }
      // the audio id only ever appears as a real CDN url — no loose matching
      // anchor to .mp3 — the same CDN now serves cover art with its own ids
      const id = html.match(/cdn\d?\.suno\.ai\/([0-9a-fA-F-]{36})\.mp3/)?.[1]
        || (token.match(UUID)?.[0] ?? null);
      if (!id) return json({ error: 'not a song link' }, 404);
      // "<title>Song by Artist | Suno</title>" carries both
      const t = html.match(/<title>([^<]*)<\/title>/)?.[1] || '';
      const m = t.match(/^(.*?)\s+by\s+(.*?)\s*\|\s*Suno/i);
      const title = m?.[1] || html.match(/property="og:title"\s+content="([^"]*)"/)?.[1] || '';
      const artist = m?.[2] || '';
      // a share code that lands on a generic Suno page is a dead link, not a
      // song — say so rather than handing back whatever id was lying around
      if (!token.match(UUID) && !artist) return json({ error: 'not a song link' }, 404);
      // the words ride along: suno embeds the lyric sheet in the page payload
      let lyrics = '';
      const lm = html.match(/\\"prompt\\":\\"([\s\S]*?)\\",/);
      if (lm) {
        lyrics = lm[1]
          .replace(/\\\\n/g, '\n')
          .replace(/\\n/g, '\n')
          .replace(/\\'/g, '\'')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .slice(0, 4000);
      }
      return json({ id, title, artist, lyrics });
    }

    // a playlist link becomes an ordered song list — one fetch, every id and
    // title paired from the rendered song rows (og:audio is the fallback,
    // order-true but nameless)
    const plist = url.pathname.match(/^\/suno-list\/([0-9a-fA-F-]{36})$/);
    if (plist) {
      const json = (o, status = 200) => new Response(JSON.stringify(o), {
        status, headers: { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' },
      });
      let html = '';
      try {
        const r = await fetch(`https://suno.com/playlist/${plist[1]}`, {
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
        });
        html = await r.text();
      } catch {
        return json({ error: 'unreachable' }, 502);
      }
      const songs = [];
      const seen = new Set();
      const rowRe = /href="\/song\/([0-9a-fA-F-]{36})"><span[^>]*>([^<]+)<\/span>/g;
      for (let m; (m = rowRe.exec(html)); ) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        songs.push({ id: m[1], title: m[2] });
      }
      if (!songs.length) {
        // fallback: og:audio metas carry the ids in playlist order, untitled
        const ogRe = /og:audio"\s+content="https:\/\/cdn\d?\.suno\.ai\/([0-9a-fA-F-]{36})\.mp3"/g;
        for (let m; (m = ogRe.exec(html)); ) {
          if (seen.has(m[1])) continue;
          seen.add(m[1]);
          songs.push({ id: m[1], title: '' });
        }
      }
      if (!songs.length) return json({ error: 'not a playlist link' }, 404);
      const pt = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s*\|\s*Suno.*$/i, '') || '';
      return json({ title: pt, songs: songs.slice(0, 20) });
    }

    // share links (suno.com/s/CODE) don't carry the song id — resolve them
    const short = url.pathname.match(/^\/suno-s\/([A-Za-z0-9_-]{4,40})\.mp3$/);
    if (short) {
      const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
      let id = null;
      try {
        const page = await fetch(`https://suno.com/s/${short[1]}`, {
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FancyPants/1.0)' },
        });
        id = (page.url || '').match(UUID)?.[0] || null;
        if (!id) {
          const html = await page.text();
          id = html.match(/cdn\d?\.suno\.ai\/([0-9a-fA-F-]{36})\.mp3/)?.[1]
            || html.match(/"(?:clip_id|audio_url|id)"\s*:\s*"[^"]*?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/)?.[1]
            || html.match(UUID)?.[0] || null;
        }
      } catch { /* fall through to the 404 below */ }
      if (!id) {
        return new Response('could not resolve that suno link', {
          status: 404, headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }
      return streamSuno(id);
    }

    const m = url.pathname.match(/^\/party\/([A-Za-z0-9]{1,12})$/);
    if (!m) return new Response('Fancy Pants room server', { status: 200 });
    const room = m[1].toUpperCase();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
    return stub.fetch(request);
  },
};
