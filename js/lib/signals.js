// SESSION SIGNALS — purely behavioral, world-agnostic. One sampler watches
// what the player's body does (moved / stayed), one ledger counts what their
// hands did (tweaks, songs, worlds), and that's the whole contract: any new
// world is fully covered the moment it exists, no authoring required.
//
// A world MAY volunteer extras — window.__declareSignals({ grewSomething: true })
// — and they ride along in the current segment. If a world declares nothing,
// the universal set still tells the story.
//
// Verification: window.__signals() returns the live snapshot; every closed
// segment is also console.debug'd as [signals] so a session can be watched.

const SAMPLE_MS = 500;
const MOVE_EPS = 0.05;      // position delta that counts as "moved"
const TURN_EPS = 0.01;      // heading delta that counts as "moved"
const BAIL_SECONDS = 30;

export class Signals {
  // getPos: () => [x, y, z, heading] — wherever the presence system keeps it
  constructor(getPos) {
    this.getPos = getPos;
    this.startedAt = Date.now();
    this.tweakCount = 0;
    this.songs = new Set();
    this.worldsVisited = new Set();
    this.roomSize = null;       // participants when the room settled
    this.wasAlone = null;
    this.rejoined = false;
    this.segments = [];         // closed world visits
    this.current = null;        // the open world visit
    this._prev = null;
    this._timer = setInterval(() => this._sample(), SAMPLE_MS);
    // the tab going dark is a real exit — close the book, don't guess later
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._close('hidden');
    });
  }

  _sample() {
    if (!this.current || document.visibilityState === 'hidden') return;
    const p = this.getPos();
    if (!p) return;
    const q = this._prev;
    this._prev = p.slice();
    if (!q) return;
    this.current.samples++;
    const moved = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > MOVE_EPS
      || Math.abs(p[3] - q[3]) > TURN_EPS;
    if (moved) this.current.moving++;
  }

  enterWorld(key) {
    if (this.current && this.current.world === key) return;
    this._close('switched');
    this.worldsVisited.add(key);
    this.current = { world: key, enteredAt: Date.now(), samples: 0, moving: 0, declared: {} };
    this._prev = null;
  }

  _close(why) {
    const c = this.current;
    if (!c) return;
    const seconds = (Date.now() - c.enteredAt) / 1000;
    const seg = {
      worldId: c.world,
      seconds: Math.round(seconds),
      movementRatio: c.samples ? +(c.moving / c.samples).toFixed(2) : 0,
      bailedEarly: seconds < BAIL_SECONDS,
      declared: c.declared,
      closedBy: why,
    };
    this.segments.push(seg);
    console.debug('[signals]', JSON.stringify(seg));
    this.current = why === 'hidden' ? c : null;   // hidden may resume; switch won't
    if (why === 'hidden') c.enteredAt = Date.now() - seconds * 1000; // keep clock honest on resume
  }

  tweak() { this.tweakCount++; }

  songStarted(name) { if (name) this.songs.add(name); }

  room(size, rejoined) {
    this.roomSize = size;
    this.wasAlone = size <= 1;
    this.rejoined = !!rejoined;
  }

  declare(obj) {
    if (this.current && obj && typeof obj === 'object') Object.assign(this.current.declared, obj);
  }

  // meta: { worldId, lookId, songTitle, artistName } supplied by the host app
  snapshot(meta = {}) {
    const c = this.current;
    return {
      ...meta,
      sessionSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      tweakCount: this.tweakCount,
      songsPlayed: this.songs.size,
      songs: [...this.songs],
      worldsVisited: this.worldsVisited.size,
      worlds: [...this.worldsVisited],
      roomSize: this.roomSize,
      wasAlone: this.wasAlone,
      rejoined: this.rejoined,
      current: c ? {
        worldId: c.world,
        seconds: Math.round((Date.now() - c.enteredAt) / 1000),
        movementRatio: c.samples ? +(c.moving / c.samples).toFixed(2) : 0,
        declared: c.declared,
      } : null,
      segments: this.segments,
    };
  }
}
