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

export class Race {
  constructor() { this.reset(); }

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
  }

  // The finish is set from the track, so every song is a well-paced race with
  // no hand-tuning — which matters when the library keeps growing. Calibrated
  // so a strong run arrives near the last chorus and a weak one is still going
  // when the music stops (whoever is deepest then takes it).
  start(durationSeconds) {
    this.reset();
    this.finish = Math.max(40, Math.round(durationSeconds * 2.0));
    this.active = true;
  }

  get multiplier() {
    for (const t of TIERS) if (this.streak >= t.at) return t.mult;
    return 1;
  }

  // 0..1 to the bottom
  get fraction() { return this.finish ? Math.min(1, this.progress / this.finish) : 0; }

  hit(rank) {
    if (!this.active || this.finished) return;
    this.streak++;
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    if (rank === 'perfect') this.perfect++; else this.good++;
    const gain = (rank === 'perfect' ? GAIN_PERFECT : GAIN_GOOD) * this.multiplier;
    this.momentum = Math.min(1, this.momentum + gain);
  }

  miss() {
    if (!this.active || this.finished) return;
    this.missed++;
    this.streak = 0;
    this.momentum *= MISS_KEEP;
  }

  update(dt, songTime) {
    if (!this.active) return;
    if (this.finished) { this.speed = 0; this.momentum = 0; return; }
    this.momentum = Math.max(0, this.momentum - DECAY * dt);
    this.speed = BASE + this.momentum * TOP;
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
