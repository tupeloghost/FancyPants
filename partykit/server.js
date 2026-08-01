// Fancy Pants PartyKit server — presence relay, one instance per room code.
// No physics, no authority: validate names, assign colors, fan out state,
// drop the silent. Designed for spiky load: joins are O(1), state relay is
// a straight broadcast.

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

export default class FancyPantsRoom {
  constructor(room) {
    this.room = room;
    this.peers = new Map();      // connId -> {name, color, lastSeen, spectator, lastRename}
    this.ownerName = null;
    this.nextColor = 0;
  }

  nameTaken(norm) {
    for (const p of this.peers.values()) {
      if (normalize(p.name) === norm) return true;
    }
    return false;
  }

  nameOk(name) {
    if (!NAME_RE.test(name)) return false;
    const norm = normalize(name);
    if (!norm || leo.check(norm) || leo.check(name.toLowerCase())) return false;
    if (this.ownerName && norm === normalize(this.ownerName)) return false; // no impersonation
    if (this.nameTaken(norm)) return false;
    return true;
  }

  onConnect(conn) {
    conn.addEventListener('message', e => this.onMessage(conn, e.data));
    conn.addEventListener('close', () => this.onLeave(conn));
  }

  onMessage(conn, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const now = Date.now();

    if (m.t === 'join') {
      const name = String(m.name || '').slice(0, 14);
      const peer = this.peers.get(conn.id);
      if (peer) {
        // rename: rate-limited to one per 30s
        if (now - peer.lastRename < 30000 || !this.nameOk(name)) {
          conn.send(JSON.stringify({ t: 'reject' }));
          return;
        }
        peer.name = name;
        peer.lastRename = now;
        return;
      }
      if (!this.nameOk(name)) {
        conn.send(JSON.stringify({ t: 'reject' }));
        return;
      }
      const active = [...this.peers.values()].filter(p => !p.spectator).length;
      const spectator = active >= MAX_ACTIVE;
      const p = {
        name, color: this.nextColor++ % PALETTE_SIZE,
        lastSeen: now, lastRename: now, spectator,
        x: 0, y: 0, z: 0,
      };
      if (m.owner && !this.ownerName) this.ownerName = name;
      this.peers.set(conn.id, p);

      conn.send(JSON.stringify({
        t: 'welcome', id: conn.id, color: p.color, spectator,
        roster: [...this.peers.entries()]
          .filter(([id]) => id !== conn.id)
          .map(([id, q]) => ({ id, name: q.name, color: q.color, x: q.x, y: q.y, z: q.z })),
      }));
      this.room.broadcast(
        JSON.stringify({ t: 'join', p: { id: conn.id, name: p.name, color: p.color } }),
        [conn.id]
      );
      return;
    }

    if (m.t === 'state') {
      const p = this.peers.get(conn.id);
      if (!p || p.spectator) return; // spectators receive, never send
      p.lastSeen = now;
      p.x = m.x; p.y = m.y; p.z = m.z;
      this.room.broadcast(JSON.stringify({
        t: 'state', id: conn.id, x: m.x, y: m.y, z: m.z, heading: m.heading, action: m.action,
      }), [conn.id]);

      // opportunistic prune of the silent
      for (const [id, q] of this.peers) {
        if (now - q.lastSeen > DROP_AFTER) {
          this.peers.delete(id);
          this.room.broadcast(JSON.stringify({ t: 'leave', id }));
        }
      }
    }
  }

  onLeave(conn) {
    if (this.peers.delete(conn.id)) {
      this.room.broadcast(JSON.stringify({ t: 'leave', id: conn.id }));
    }
    // room disposes automatically when the last connection closes
  }
}
