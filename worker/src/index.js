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
  }

  async fetch(request) {
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
    if (this.ownerName && norm === normalize(this.ownerName) && connId !== this.ownerId) return false;
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
      if ((m.owner && !this.ownerName) || connId === this.ownerId) {
        this.ownerName = name;
        this.ownerId = connId;
      }
      this.peers.set(connId, p);

      ws.send(JSON.stringify({
        t: 'welcome', id: connId, color: p.color, spectator,
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
    // room hibernates automatically when the last connection closes
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/party\/([A-Za-z0-9]{1,12})$/);
    if (!m) return new Response('Fancy Pants room server', { status: 200 });
    const room = m[1].toUpperCase();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
    return stub.fetch(request);
  },
};
