// Net layer — presence only. Each client simulates locally and broadcasts a
// small state blob at ~15Hz; everyone else renders those as ghosts.
// No shared physics, no authority, no reconciliation.
// If the socket drops, the world keeps running single-player, silently.

const SEND_HZ = 15;
const DROP_AFTER = 15000; // ms of silence before a peer is pruned — background tabs throttle to ~1Hz, so be patient

// Set your deployed PartyKit host here (e.g. 'fancy-pants.username.partykit.dev').
// Empty string = solo/sim only.
export const PARTYKIT_HOST = window.FANCYPANTS_HOST || '';

export const PALETTE = [
  0xff5c8a, 0xffb84d, 0xfff05c, 0x7dff6e, 0x53f5d6, 0x5cb8ff,
  0x8f7dff, 0xd96bff, 0xff7d5c, 0x6effb8, 0x5c7dff, 0xff5cd9,
];

export class Net {
  constructor() {
    this.participants = [
      { id: 'local', name: localStorage.getItem('fp_name') || '', x: 0, y: 0, z: 0,
        heading: 0, action: 'idle', local: true, color: 0, joinedAt: 0 },
    ];
    this.connected = false;
    this.spectator = false;
    this.room = null;
    this.owner = false;
    this.onJoin = null;    // (participant) => {} — the payoff moment
    this.onReject = null;  // () => {} — "pick another name"
    this.onSong = null;    // ({url,pos,playing}) => {} — sync to the host's music
    this.onRemoteTap = null; // (participant) => {} — someone else clicked their world
    this.onWorld = null;   // (key) => {} — the host moved the room to another world
    this.onEmote = null;   // (participant, idx) => {} — someone reacted
    this._ws = null;
    this._sendTimer = 0;
    this._targets = new Map(); // id -> {x,y,z,heading} for interpolation
    this._lastSeen = new Map();
    // rAF stops in a background tab; a timer merely slows to ~1Hz. This
    // heartbeat is what keeps a pocketed phone in everyone else's roster.
    setInterval(() => {
      if (this.connected && !this.spectator && this._ws && this._ws.readyState === 1) {
        const l = this.local;
        this._ws.send(JSON.stringify({
          t: 'state', x: +l.x.toFixed(2), y: +l.y.toFixed(2), z: +l.z.toFixed(2),
          heading: +l.heading.toFixed(2), action: l.action, score: l.score || 0,
          st: l.st || undefined,
        }));
      }
    }, 1000);
  }

  get local() { return this.participants[0]; }

  // ── real connection (PartyKit) ──
  join(room, name, asOwner = false) {
    if (!PARTYKIT_HOST) return false;
    this.room = room.toUpperCase();
    this.owner = asOwner;
    localStorage.setItem('fp_name', name);
    try {
      const proto = PARTYKIT_HOST.startsWith('localhost') ? 'ws' : 'wss';
      this._ws = new WebSocket(`${proto}://${PARTYKIT_HOST}/party/${this.room}`);
      this._ws.onopen = () => {
        this._ws.send(JSON.stringify({ t: 'join', name, owner: asOwner }));
      };
      this._ws.onmessage = e => this._onMessage(JSON.parse(e.data));
      this._ws.onclose = () => {
        this.connected = false;
        // a blip must not quietly convert a player to solo forever: retry
        // with backoff until the room answers or we were told to stop
        if (this._noRetry || !this.room) return;
        const n = (this._retry || 0) + 1;
        this._retry = n;
        const delay = Math.min(15000, 900 * Math.pow(1.6, n));
        clearTimeout(this._retryT);
        this._retryT = setTimeout(() => {
          if (!this.connected && this.room) this.join(this.room, this.local.name, this.owner);
        }, delay);
      };
      this._ws.onerror = () => { this.connected = false; };
    } catch { this.connected = false; }
    return true;
  }

  _onMessage(m) {
    if (m.t === 'welcome') {
      this.connected = true;
      this._retry = 0;   // the room answered; the slate is clean
      // a refreshed host joining by name gets the crown back — and is TOLD
      if (m.owner && !this.owner) {
        this.owner = true;
        if (this.onPromoted) this.onPromoted();
      }
      this.spectator = !!m.spectator;
      this.local.id = m.id;
      this.local.color = m.color;
      for (const p of m.roster || []) this._addPeer(p);
      if (m.song && !this.owner && this.onSong) this.onSong(m.song);
      if (m.world && !this.owner && this.onWorld) this.onWorld(m.world);
    } else if (m.t === 'join') {
      this._addPeer(m.p, true);
    } else if (m.t === 'state') {
      const t = this._targets.get(m.id);
      if (t) { t.x = m.x; t.y = m.y; t.z = m.z; t.heading = m.heading; }
      else this._who(m.id); // pruned them while our tab slept; ask who they are
      const p = this.participants.find(x => x.id === m.id);
      if (p) {
        // rising edge of a tap → replay their click in our world
        if (m.action === 'tap' && p.action !== 'tap' && this.onRemoteTap) this.onRemoteTap(p);
        p.action = m.action;
        p.score = m.score || 0;
        if (m.st) p.st = m.st;   // set-stats, for the end-of-set awards
      }
      this._lastSeen.set(m.id, performance.now());
    } else if (m.t === 'rejoin') {
      // server pruned US while the tab slept; slip back in (throttled —
      // several invites can already be queued behind one wake-up)
      const now = performance.now();
      if ((this._lastRejoin || 0) > now - 2000) return;
      this._lastRejoin = now;
      const name = this.local.name || localStorage.getItem('fp_name') || '';
      if (name && this._ws && this._ws.readyState === 1) {
        this._ws.send(JSON.stringify({ t: 'join', name, owner: this.owner }));
      }
    } else if (m.t === 'song') {
      if (!this.owner && this.onSong) this.onSong(m);
    } else if (m.t === 'world') {
      if (!this.owner && this.onWorld) this.onWorld(m.key);
    } else if (m.t === 'emote') {
      // NEVER drop an emote because the sender was pruned while our tab
      // slept — the rain is the payload, the name is just the label
      const p = this.participants.find(x => x.id === m.id);
      if (!p) this._who(m.id);
      if (this.onEmote) this.onEmote(p || { name: 'someone', color: 0 }, m.i, m.to);
    } else if (m.t === 'leave') {
      this._removePeer(m.id);
    } else if (m.t === 'reject') {
      this._noRetry = true;   // told no is not the same as cut off
      if (this.onReject) this.onReject();
      this._ws && this._ws.close();
    }
  }

  // anyone: react — rate-limited so nobody can carpet the stream
  sendEmote(idx, to) {
    const now = performance.now();
    if ((this._lastEmote || 0) > now - 700) return;
    this._lastEmote = now;
    if (!this.connected || !this._ws || this._ws.readyState !== 1) return;
    this._ws.send(JSON.stringify({ t: 'emote', i: idx, to }));
  }

  // host: move the whole room to another world
  sendWorld(key) {
    if (!this.owner || !this.connected || !this._ws || this._ws.readyState !== 1) return;
    this._ws.send(JSON.stringify({ t: 'world', key }));
  }

  // host: tell the room what's playing (call on change and every few seconds)
  sendSong(url, pos, playing, title) {
    if (!this.owner || !this.connected || !this._ws || this._ws.readyState !== 1) return;
    this._ws.send(JSON.stringify({ t: 'song', url, pos, playing, title: title || '' }));
  }

  _who(id) {
    // ask the server to replay a stranger's join card (throttled per id)
    if (!this._whoAsked) this._whoAsked = new Map();
    const now = performance.now();
    if ((this._whoAsked.get(id) || 0) > now - 3000) return;
    this._whoAsked.set(id, now);
    if (this._ws && this._ws.readyState === 1) {
      this._ws.send(JSON.stringify({ t: 'who', id }));
    }
  }

  _addPeer(p, celebrate = false) {
    if (this.participants.find(x => x.id === p.id)) return;
    const peer = {
      id: p.id, name: p.name, x: p.x || 0, y: p.y || 0, z: p.z || 0,
      heading: 0, action: 'idle', local: false, color: p.color || 0,
      joinedAt: performance.now(),
    };
    this.participants.push(peer);
    this._targets.set(p.id, { x: peer.x, y: peer.y, z: peer.z, heading: 0 });
    this._lastSeen.set(p.id, performance.now());
    if (celebrate && this.onJoin) this.onJoin(peer);
  }

  _removePeer(id) {
    const i = this.participants.findIndex(x => x.id === id);
    if (i > 0) this.participants.splice(i, 1);
    this._targets.delete(id);
    this._lastSeen.delete(id);
  }

  // ── sim mode: fake crowd for testing / demos (?sim=N) ──
  simulate(n) {
    const NAMES = ['nova', 'pixel', 'echo', 'wren', 'zumi', 'flux', 'momo', 'drift',
                   'lumen', 'koda', 'vex', 'sable', 'juno', 'orbit_cat', 'neon_fox', 'star_x'];
    let spawned = 0;
    const spawnOne = () => {
      if (spawned >= n) return;
      const id = 'sim' + spawned;
      const p = { id, name: NAMES[spawned % NAMES.length] + (spawned >= NAMES.length ? spawned : ''),
                  x: 0, y: 0, z: 0, color: spawned % PALETTE.length, _phase: Math.random() * 100 };
      this._addPeer(p, true);
      spawned++;
      setTimeout(spawnOne, 900 + Math.random() * 2200); // staggered arrivals
    };
    setTimeout(spawnOne, 1500);
    this._sim = true;
  }

  update(dt, time) {
    // interpolate remotes toward their network targets
    for (let i = 1; i < this.participants.length; i++) {
      const p = this.participants[i];
      if (p.id.startsWith('sim')) {
        // fake peers wander on their own
        const ph = (this._targets.get(p.id) || {}).phase || i * 7.3;
        p.x = Math.sin(time * 0.4 + ph) * 0.7;
        p.y = Math.cos(time * 0.31 + ph * 1.7) * 0.5;
        p.action = Math.sin(time * 0.8 + ph) > 0.93 ? 'pulse' : 'moving';
        continue;
      }
      const t = this._targets.get(p.id);
      if (!t) continue;
      const k = Math.min(1, dt * 10);
      p.x += (t.x - p.x) * k;
      p.y += (t.y - p.y) * k;
      p.z += (t.z - p.z) * k;
      p.heading += (t.heading - p.heading) * k;
    }

    // prune silent peers
    if (this.connected) {
      const now = performance.now();
      for (const [id, seen] of this._lastSeen) {
        if (now - seen > DROP_AFTER) this._removePeer(id);
      }
    }

    // broadcast local state at ~15Hz — and see the constructor's heartbeat,
    // which keeps us alive from a background tab where this loop never runs
    if (this.connected && !this.spectator && this._ws && this._ws.readyState === 1) {
      this._sendTimer += dt;
      if (this._sendTimer >= 1 / SEND_HZ) {
        this._sendTimer = 0;
        const l = this.local;
        this._ws.send(JSON.stringify({
          t: 'state', x: +l.x.toFixed(2), y: +l.y.toFixed(2), z: +l.z.toFixed(2),
          heading: +l.heading.toFixed(2), action: l.action, score: l.score || 0,
          st: l.st || undefined,
        }));
      }
    }
  }
}
