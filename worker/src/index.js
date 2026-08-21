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
      // their promoted songs appear automatically: every /w/{slug}/... link
      const wl = await this.state.storage.list({ prefix: 'w:' + slug + '/' });
      const songs = [];
      for (const [k] of wl) {
        const path = k.slice(2);
        if (!page.hidden.includes(path)) songs.push(path);
      }
      const out = { slug: page.slug, name: page.name, bio: page.bio, links: page.links, next: page.next, nextAt: page.nextAt || '', tip: page.tip || '', songs };
      if (url.searchParams.get('key') === page.editKey) {
        out.hidden = page.hidden;
        out.plays = {};
        const allW = await this.state.storage.list({ prefix: 'w:' + slug + '/' });
        for (const [k] of allW) {
          const path = k.slice(2);
          out.plays[path] = (await this.state.storage.get('wv:' + path)) || 0;
        }
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
      const dest = row.song
        ? SITE_URL + '?suno=' + encodeURIComponent(row.song) + (row.world ? '&world=' + row.world : '')
        : SITE_URL;
      const title = wslug[2].replace(/-/g, ' ') + ' by ' + wslug[1].replace(/-/g, ' ');
      const image = row.world && ['tunnel', 'surfer', 'slide'].includes(row.world)
        ? SITE_URL + 'previews/' + row.world + '.jpg' : null;
      return unfurl(title, 'hearing it is fine. being in it is better. no app, just a browser.', dest, image);
    }
    // /p/{world}/{file} — the short front door for a house song: a clean
    // link that unfurls with the song's name instead of a query-string tail
    const pslug = url.pathname.match(/^\/p\/([a-z0-9-]{1,24})\/([A-Za-z0-9_.-]{1,60}\.mp3)$/);
    if (pslug) {
      const dest = SITE_URL + '?world=' + pslug[1] + '&track=' + encodeURIComponent(pslug[2]);
      const title = pslug[2].replace(/\.mp3$/, '').replace(/[_-]+/g, ' ');
      const image = ['tunnel', 'surfer', 'slide'].includes(pslug[1])
        ? SITE_URL + 'previews/' + pslug[1] + '.jpg' : null;
      return unfurl(title + ', from the inside',
        'it moves when the music does, and again when you do. no app, just a browser.', dest, image);
    }
    // /c/{slug} — a creator's page: reachable only by its link, never listed
    const cslug = url.pathname.match(/^\/c\/([a-z0-9-]{3,30})$/);
    if (cslug) {
      const id = env.ROOMS.idFromName('THE-WAITING-LIST');
      const r = await env.ROOMS.get(id).fetch(new Request('https://do/c-get?slug=' + cslug[1]));
      const pg = await r.json().catch(() => ({}));
      if (!pg.slug) return new Response('no such page', { status: 404 });
      const esc = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
      const songRows = (pg.songs || []).map(p2 => {
        const title = p2.split('/')[1].replace(/-/g, ' ');
        return '<a class="song" href="https://fancy-pants.tupeloghost.workers.dev/w/' + p2 + '">\u266a ' + esc(title) + ' <span>play it \u2192</span></a>';
      }).join('');
      const linkRows = (pg.links || []).map(l =>
        '<a class="pill" href="' + esc(l.url) + '" rel="noopener">' + esc(l.label) + '</a>').join('');
      const html = '<!doctype html><html><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta name="robots" content="noindex">'
        + '<title>' + esc(pg.name) + '</title>'
        + '<meta property="og:title" content="' + esc(pg.name) + '">'
        + '<meta property="og:description" content="' + esc(pg.nextAt && pg.next ? pg.next : (pg.bio || 'songs you can step inside, right in the browser')) + '">'
        + '<meta property="og:site_name" content="Fancy Britches">'
        + '<meta property="og:image" content="' + SITE_URL + 'og.jpg">'
        + '<meta name="twitter:card" content="summary_large_image">'
        + '<meta name="twitter:title" content="' + esc(pg.name) + '">'
        + '<meta name="twitter:image" content="' + SITE_URL + 'og.jpg">'
        + '<style>'
        + 'body{margin:0;min-height:100vh;background:radial-gradient(1200px 700px at 50% -10%,#1a1430,#07060f 60%);'
        + 'color:#eceafb;font:16px/1.6 Georgia,serif;display:flex;justify-content:center;padding:48px 18px;}'
        + '.card{max-width:520px;width:100%;text-align:center;}'
        + 'h1{font-family:Didot,"Bodoni 72",Georgia,serif;font-weight:400;font-size:44px;margin:0 0 6px;letter-spacing:1px;}'
        + '.bio{font-style:italic;color:#b9b3da;margin:0 0 22px;white-space:pre-wrap;}'
        + '.next{color:#eece78;font-style:italic;margin:0 0 26px;}'
        + '.pill{display:inline-block;margin:5px;padding:11px 20px;border:1px solid rgba(180,170,230,0.35);'
        + 'border-radius:24px;color:#e6e2fa;text-decoration:none;background:rgba(255,255,255,0.05);}'
        + '.pill:hover{border-color:#a99ce8;}'
        + '.tip{display:inline-block;margin:2px 0 18px;padding:13px 30px;border-radius:999px;color:#1b1430;'
        + 'background:linear-gradient(175deg,#ffe9a8,#eece78);font-weight:600;text-decoration:none;'
        + 'box-shadow:0 4px 22px rgba(238,206,120,0.35);}'
        + '.songs{margin:30px 0 0;display:flex;flex-direction:column;gap:9px;}'
        + '.song{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-radius:14px;'
        + 'background:rgba(255,255,255,0.055);border:1px solid rgba(180,170,230,0.22);color:#f0eefc;text-decoration:none;}'
        + '.song span{color:#b9b3da;font-size:13px;}'
        + '.song:hover{border-color:#a99ce8;}'
        + 'footer{margin-top:44px;font-size:12.5px;color:#8d87b0;}footer a{color:#b9b3da;}'
        + '</style></head><body><div class="card">'
        + '<h1>' + esc(pg.name) + '</h1>'
        + (pg.bio ? '<p class="bio">' + esc(pg.bio) + '</p>' : '')
        + (pg.next ? '<p class="next"' + (pg.nextAt ? ' data-at="' + esc(pg.nextAt) + '"' : '') + '>' + esc(pg.next) + '</p>' : '')
        + (pg.tip ? '<a class="tip" href="' + esc(pg.tip) + '" rel="noopener">&#10024; support ' + esc(pg.name) + '</a>' : '')
        + (linkRows ? '<div>' + linkRows + '</div>' : '')
        + (songRows ? '<div class="songs">' + songRows + '</div>' : '')
        + '<footer>every song here is an experience. <a href="https://tupeloghost.github.io/FancyPants/">turn yours into one at fancy britches</a></footer>'
        + '</div>'        + (pg.nextAt ? '<script>(function(){var e=document.querySelector(".next[data-at]");if(!e)return;var d=new Date(e.getAttribute("data-at"));if(isNaN(d))return;e.textContent="going live "+d.toLocaleString(undefined,{weekday:"long",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});})();</scr'+'ipt>' : '')        + '</body></html>';
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

    // /thisweek — wherever the special is right now
    if (url.pathname === '/thisweek') {
      const FEATURED = ['tunnel', 'surfer'];
      const ALL = ['blacktop', 'bloom', 'cherry', 'comets', 'funhouse', 'garden', 'lava',
                   'orbit', 'paint', 'plasma', 'river', 'signal', 'slide', 'slinky',
                   'surfer', 'trail', 'tunnel'];
      const pool = ALL.filter(k => !FEATURED.includes(k)).sort();
      // slide leads the parade from the week of Mon Aug 17 2026 (matches client)
      const i = pool.indexOf('slide');
      const rot = [...pool.slice(i), ...pool.slice(0, i)];
      const LAUNCH_WEEK = Math.floor((Date.UTC(2026, 7, 17) - 4 * 86400000) / 604800000);
      const weeksIn = Math.max(0, Math.floor((Date.now() - 4 * 86400000) / 604800000) - LAUNCH_WEEK);
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
