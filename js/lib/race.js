import { TUNE } from './tune.js?v=222';
// Race — the shared rhythm-race model. Worlds supply the picture; this owns
// the rules, so a new world inherits a working race by declaring `rhythm` and
// reading `progress` rather than reimplementing any of it.
//
// The feel this is built around: a miss should cost you speed, never stop you.
// Being halted by one mistake is the difference between "I want another go"
// and "I'm out". So momentum bleeds constantly and hits top it back up — a
// good run accelerates, a bad patch feels like losing your footing, and even a
// player hitting nothing still creeps forward and finishes the song with the
// others rather than stranded at the start line.

// Tuned against simulated runs across skill levels rather than by feel. The
// first pass had a casual player finishing at 33% while a good one reached
// 79% — a gap that punishing turns a party game into a spectator sport for
// everyone who is not already good at rhythm games. The spread below keeps
// the race meaningful without stranding anybody.
const BASE = 0.50;        // stairs/sec with no hits at all — never truly stuck
const TOP = 1.9;          // extra stairs/sec at full momentum
const DECAY = 0.32;       // momentum lost per second
const GAIN_PERFECT = 0.26;
const GAIN_GOOD = 0.21;   // close to perfect: landing the note is what matters
const MISS_KEEP = 0.84;   // momentum surviving a miss

// Streak tiers. Deliberately far apart: a multiplier you reach by accident is
// not a reward, and the jump has to be worth chasing.
const TIERS = [
  { at: 26, mult: 1.55 },
  { at: 14, mult: 1.35 },
  { at: 6,  mult: 1.18 },
];

// The race measures in abstract steps so every world can map them to its own
// motion — stairs in Slinky, road in Blacktop. Feet is what a player is told,
// because "412 steps" means nothing and "412 ft" is a distance you can picture.
//
// The scale has to be per world, though. A giant slinky covers a few feet a
// stair; a car on a highway covers tens. Sharing one number had Blacktop
// racing a whole song at 4mph, which reads as broken rather than as a race.
const DEFAULT_FEET_PER_STEP = 3;

export class Race {
  constructor() {
    this.feetPerStep = DEFAULT_FEET_PER_STEP;
    this.mode = 'RACE';
    this.unit = 'FT';
    // one callback covers every world at once: whoever owns the race decides
    // what a hit SOUNDS like, and no world has to know sound exists
    this.onEvent = null;
    this.reset();
  }

  // set from the world's registry entry when it loads
  setScale(feetPerStep) { this.feetPerStep = feetPerStep || DEFAULT_FEET_PER_STEP; }
  setMode(mode, unit) {
    this.mode = mode || 'RACE';
    this.unit = unit || (this.mode === 'COLLECT' ? 'CAUGHT' : 'FT');
  }

  reset() {
    this.active = false;
    this.finished = false;
    this.progress = 0;      // stairs travelled
    this.finish = 0;        // stairs to the bottom
    this.momentum = 0;      // 0..1
    this.speed = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.perfect = 0;
    this.good = 0;
    this.missed = 0;
    this.finishedAt = null; // song-time you reached the bottom
    this.hits = 0;
    this.rubber = 0;        // 0..0.5 comeback aid, set from the field
  }

  // The finish is set from the track, so every song is a well-paced race with
  // no hand-tuning — which matters when the library keeps growing. Calibrated
  // so a strong run arrives near the last chorus and a weak one is still going
  // when the music stops (whoever is deepest at that point wins).
  // A RACE is a distance: momentum carries you and the finish is a place. A
  // COLLECT is a tally: nothing carries you, only what you catch counts, and
  // the "finish" is simply a very good haul — so the same rail can show both
  // without either pretending to be the other.
  start(durationSeconds, noteCount) {
    this.reset();
    if (this.mode === 'COLLECT') {
      // an excellent haul, not a reachable finish line: perfect play with
      // streaks runs to about 3x the note count, so this is the scale the rail
      // is drawn against rather than somewhere to arrive
      this.finish = Math.max(20, Math.round((noteCount || durationSeconds * 2.2) * 2.4));
    } else {
      this.finish = Math.max(40, Math.round(durationSeconds * 2.0));
    }
    this.active = true;
  }

  get multiplier() {
    for (const t of TIERS) if (this.streak >= t.at) return t.mult;
    return 1;
  }

  // 0..1 to the bottom
  get fraction() { return this.finish ? Math.min(1, this.progress / this.finish) : 0; }

  // what the player is shown
  get feet() {
    return this.mode !== 'RACE'
      ? Math.round(this.progress)
      : Math.round(this.progress * this.feetPerStep);
  }
  get feetTotal() {
    return this.mode !== 'RACE'
      ? Math.round(this.finish)
      : Math.round(this.finish * this.feetPerStep);
  }
  get feetLeft() { return Math.max(0, this.feetTotal - this.feet); }
  get fractionShown() { return this.finish ? Math.min(1, this.progress / this.finish) : 0; }
  get mph() { return +(this.speed * this.feetPerStep * 3600 / 5280).toFixed(1); }

  hit(rank) {
    if (!this.active || this.finished) return;
    this.streak++;
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    if (rank === 'perfect') this.perfect++; else this.good++;
    this.hits++;              // worlds watch this to answer a catch
    if (this.onEvent) this.onEvent('hit', { streak: this.streak, strong: rank === 'perfect' });

    if (this.mode === 'COLLECT') {
      // a clean strike is worth more than a scrape, and a streak multiplies it
      const base = rank === 'perfect' ? 2 : 1;
      // No finish line to cross — the song's last note is the bell and the
      // the biggest haul wins, so the tally is never capped.
      this.progress += base * this.multiplier;
      return;
    }
    // Mario Kart's other secret: the field pulls you back in. `rubber` is set
    // by the harness from how far the leader is ahead — behind, your hits are
    // worth up to half again as much. The leader earns clean; the chaser
    // closes. Nobody is ever out of it, which is the whole reason to keep
    // pressing at 40% down.
    const gain = (rank === 'perfect' ? GAIN_PERFECT : GAIN_GOOD) * this.multiplier * (1 + (this.rubber || 0));
    this.momentum = Math.min(1, this.momentum + gain);
  }

  // A CATCH round is scored by the world, not by the cue: what matters is what
  // landed in your basket, and the world is the only thing that knows.
  collect(n = 1) {
    if (!this.active) return;
    this.progress += n;
    this.hits++;
    this.streak++;
    if (this.onEvent) this.onEvent('hit', { streak: this.streak, strong: n > 1 });
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    this.perfect++;
  }

  drop(n = 1) {
    if (!this.active) return;
    this.progress = Math.max(0, this.progress - n);
    this.streak = 0;
    this.missed++;
    if (this.onEvent) this.onEvent(n > 0 ? 'cost' : 'break');
  }

  miss() {
    if (!this.active || this.finished) return;
    this.missed++;
    this.streak = 0;
    this.momentum *= MISS_KEEP;
    if (this.onEvent) this.onEvent('cost');
  }

  update(dt, songTime) {
    if (!this.active) return;
    // Nothing carries you in a COLLECT round — the tally only moves when you
    // catch something, so there is no speed to integrate.
    if (this.mode === 'COLLECT' || this.mode === 'CATCH' || this.mode === 'DODGE') return;
    if (this.finished) { this.speed = 0; this.momentum = 0; return; }
    this.momentum = Math.max(0, this.momentum - DECAY * dt);
    this.speed = (BASE + this.momentum * TOP) * TUNE.speed;
    this.progress += this.speed * dt;
    if (this.progress >= this.finish) {
      this.progress = this.finish;
      this.finished = true;
      this.finishedAt = songTime;
      this.speed = 0;          // you are at the bottom; stop walking
      this.momentum = 0;
    }
  }

  // Accuracy over the notes actually presented so far.
  get accuracy() {
    const seen = this.perfect + this.good + this.missed;
    return seen ? (this.perfect + this.good * 0.6) / seen : 0;
  }
}

// Standing among everyone in the room, by how deep they are. Progress rides on
// the state blob's z, so this needs no protocol change and interpolates for
// free between updates.
export function standings(participants) {
  return participants
    .map((p, i) => ({ p, i, depth: p.z || 0 }))
    .sort((a, b) => b.depth - a.depth);
}

export function placeOf(participants) {
  const me = participants[0];
  if (!me) return 1;
  const mine = me.z || 0;
  let ahead = 0;
  for (let i = 1; i < participants.length; i++) if ((participants[i].z || 0) > mine) ahead++;
  return ahead + 1;
}
