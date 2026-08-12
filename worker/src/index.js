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
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
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
    if (request.method === 'OPTIONS' && (url.pathname === '/waitlist' || url.pathname === '/log' || url.pathname === '/custom' || url.pathname === '/share-home')) {
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

    // the waiting list rides one well-known DO instance
    if (url.pathname === '/waitlist' || url.pathname === '/waitlist-list' ||
        url.pathname === '/custom' || url.pathname === '/custom-list' ||
        url.pathname === '/share-home') {
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
      const id = html.match(/cdn\d?\.suno\.ai\/([0-9a-fA-F-]{36})/)?.[1]
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
      return json({ id, title, artist });
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
          id = html.match(/cdn\d?\.suno\.ai\/([0-9a-fA-F-]{36})/)?.[1]
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
