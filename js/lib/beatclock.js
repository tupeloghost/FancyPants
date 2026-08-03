// Beat clock — a predicted beat grid for the currently playing track.
//
// Why this exists: the audio engine's `beat` flag is retrospective. It tells
// you a beat already happened, which is fine for making things flash but
// useless to play on, because players tap in ANTICIPATION. A game needs to
// know where the next beat is, not be told about the last one.
//
// Three stages, each solving a problem the one before it exposed.
//
// 1. ONSETS, by spectral flux. The engine's detector is "bass louder than its
//    own rolling average", which on dense music re-triggers at its cooldown
//    floor and in sparse passages goes silent. Measured on a real track it
//    gave intervals of 181, 184, 225, 257 and 2608ms — no grid fits that.
//    Spectral flux instead sums how much each frequency bin GREW since the
//    last frame: a note or a hit adds energy across many bins at once, which
//    stays sharp even when the bass never stops. Peaks are picked as local
//    maxima standing clear of a moving average.
//
// 2. PULSE, from the spacing between onsets. Fitting a period by phase
//    coherence over a long window looks elegant but collapses: at half a
//    second a beat, fourteen seconds is nearly thirty cycles, so a fraction of
//    a percent of drift smears everything. Intervals do not accumulate that
//    error, so the pulse comes from an interval histogram instead.
//
// 3. BEAT, from the pulse. The pulse found is usually the fastest regular
//    subdivision — on a real track the onsets came at a clean 250ms, which is
//    eighth notes, two per beat. Wrapping those at the beat period puts half
//    at phase 0 and half at phase 0.5 and they cancel exactly, which is why a
//    naive confidence measure reads ~0 on the most metronomic music there is.
//    So: lock phase to the fast pulse (where the alignment is real), multiply
//    up into a danceable tempo, and choose which of the pulse positions is the
//    downbeat by which one carries more onset energy.
//
// Time is always the SONG's clock, so pausing, seeking and replaying behave,
// and a lock belongs to exactly one track.

// All of these are in SECONDS, deliberately. Counting them in frames makes
// the detector behave differently at 60fps, at 120fps and on a phone that is
// struggling — the same track would produce different onsets on different
// machines, which for a shared race is unacceptable.
const FLUX_WINDOW = 1.5;   // seconds of flux history behind the moving threshold
const PICK_R = 0.028;      // a peak must beat everything within this radius
const PICK_DELTA = 0.28;   // how far above the local mean a peak must stand
const ONSET_GAP = 0.10;    // floor on how close two onsets can be

const MIN_BPM = 70;
const MAX_BPM = 180;
const PULSE_MIN = 0.09;    // fastest subdivision we will track — must reach
                           // sixteenths, or dense material cancels against the
                           // slower grid we would otherwise settle on
const PULSE_MAX = 0.90;
const HISTORY = 64;
const WINDOW = 12;         // seconds of onset history considered
const MIN_ONSETS = 12;
const REFIT_EVERY = 0.3;
const LOCK_R = 0.55;       // pulse-phase concentration needed to claim a lock

// The grid fit, as a pure function so the realtime clock and the offline
// track analyser cannot drift apart — they must agree, or a player's chart
// would not match the beat they hear.
export function fitGrid(os, now) {
  const n = os.length;
  if (n < MIN_ONSETS) return null;
    
    // ── stage 2: the pulse, from interval spacing ─────────────────────────
    const BIN = 0.005, MAXLAG = 1.2;
    const bins = new Float32Array(Math.ceil(MAXLAG / BIN) + 2);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = os[j].t - os[i].t;
        if (d < PULSE_MIN * 0.6 || d > MAXLAG) continue;
        const wt = Math.exp(-(now - os[j].t) / (WINDOW * 0.8));
        const b = d / BIN, lo = Math.floor(b), fr = b - lo;
        bins[lo] += wt * (1 - fr);
        bins[lo + 1] += wt * fr;
      }
    }
    const sm = new Float32Array(bins.length);
    for (let i = 1; i < bins.length - 1; i++) {
      sm[i] = 0.25 * bins[i - 1] + 0.5 * bins[i] + 0.25 * bins[i + 1];
    }

    let pulse = 0, bestS = -1;
    for (let p = PULSE_MIN; p <= PULSE_MAX; p += 0.001) {
      let sc = 0;
      // score against multiples too, so a pulse still wins when hits are sparse
      for (let k = 1; k <= 4; k++) {
        const idx = Math.round(k * p / BIN);
        if (idx < sm.length) sc += sm[idx] / k;
      }
      if (sc > bestS) { bestS = sc; pulse = p; }
    }
    if (!pulse || bestS <= 0) { return null; }

    // How much onset energy lands on a grid of this period at this phase —
    // measured against what pure chance would score. A fine grid catches a lot
    // of random onsets by accident (a 180ms grid with a 45ms window captures
    // half of anything), so the raw share is not evidence of a pulse. Only the
    // excess over chance is, and correcting for it is what stops the clock
    // inventing a tempo for music that has none.
    const align = (per, phase) => {
      const tol = Math.min(0.045, per * 0.25);
      let hit = 0, all = 0;
      for (const o of os) {
        const k = Math.round((o.t - phase) / per);
        if (Math.abs(o.t - (phase + k * per)) <= tol) hit += o.v;
        all += o.v;
      }
      const raw = all > 0 ? hit / all : 0;
      const chance = Math.min(0.95, 2 * tol / per);
      return (raw - chance) / (1 - chance);
    };

    // The histogram finds *a* regular spacing, but the true tatum may be a
    // division of it — and if we grid at the coarser one, every hit in between
    // reads as a miss. Try the divisions too and keep whichever explains the
    // onsets best. Phase comes from a search rather than a circular mean,
    // which cancels to nothing whenever onsets are denser than the grid.
    let pulsePhase = 0, R = -Infinity;
    for (const cand of [pulse, pulse / 2, pulse / 3, pulse / 4]) {
      if (cand < PULSE_MIN) continue;
      for (let i = 0; i < 24; i++) {
        const ph = os[0].t + (i / 24) * cand;
        const sc = align(cand, ph);
        if (sc > R) { R = sc; pulsePhase = ph; pulse = cand; }
      }
    }
    R = Math.max(0, Math.min(1, R));

    // ── stage 3: which multiple of the pulse is the beat ──────────────────
    // Nearest-to-120bpm alone is not enough: a 150ms tatum reads as 133bpm at
    // three tatums and 100bpm at four, and three wins on distance while four
    // is the musical answer. Western music divides in twos and fours, so
    // binary multiples are strongly preferred and triplet feels only win when
    // they are clearly better.
    const MULT_BIAS = { 1: 1, 2: 1, 4: 1, 8: 1, 3: 0.72, 6: 0.72, 5: 0.5, 7: 0.5 };
    let mult = 1, bestScore = -1;
    for (let m = 1; m <= 8; m++) {
      const bpm = 60 / (pulse * m);
      if (bpm < MIN_BPM || bpm > MAX_BPM) continue;
      const closeness = 1 - Math.min(1, Math.abs(bpm - 120) / 90);
      const sc = (MULT_BIAS[m] || 0.5) * closeness;
      if (sc > bestScore) { bestScore = sc; mult = m; }
    }
    const period = pulse * mult;

    // and which of the `mult` pulse positions carries the most weight —
    // downbeats hit harder than the subdivisions between them
    let bestClass = 0, bestEnergy = -1;
    for (let c = 0; c < mult; c++) {
      let e = 0;
      for (const o of os) {
        const k = Math.round((o.t - pulsePhase) / pulse);
        if (((k % mult) + mult) % mult === c) e += o.v;
      }
      if (e > bestEnergy) { bestEnergy = e; bestClass = c; }
    }

    let anchor = pulsePhase + bestClass * pulse;
    anchor += Math.ceil((now - anchor) / period) * period;
    while (anchor > now) anchor -= period;

  return { pulse, period, bpm: 60 / period, anchor, confidence: R, locked: R >= LOCK_R };
}

export class BeatClock {
  constructor(analyser) {
    this.analyser = analyser || null;
    this._spec = null;
    this._prev = null;
    this.reset();
  }

  setAnalyser(a) {
    this.analyser = a;
    this._spec = null;
    this._prev = null;
  }

  reset() {
    this._onsets = [];      // {t, v} — time and flux strength
    this._flux = [];
    this._lastOnset = -99;
    this._pickedTo = -99;
    this._lastFit = -99;
    this.flux = 0;
    this.onsetAt = null;
    this.period = 0;        // seconds per BEAT
    this.pulse = 0;         // seconds per fastest tracked subdivision
    this.bpm = 0;
    this.anchor = 0;
    this.confidence = 0;
    this.locked = false;
    this.beatIndex = -1;
    this._lastEmitted = -1;
  }

  // ── stage 1: find onsets ────────────────────────────────────────────────
  _detect(songTime) {
    const an = this.analyser;
    if (!an) return;
    const n = an.frequencyBinCount;
    if (!this._spec || this._spec.length !== n) {
      this._spec = new Uint8Array(n);
      this._prev = new Float32Array(n);
    }
    an.getByteFrequencyData(this._spec);

    // only the rises count; the top of the range is mostly air and adds jitter
    const top = Math.floor(n * 0.75);
    let flux = 0;
    for (let i = 0; i < top; i++) {
      const v = this._spec[i];
      const d = v - this._prev[i];
      if (d > 0) flux += d;
      this._prev[i] = v;
    }
    flux /= top * 255;
    this.flux = flux;

    this._flux.push({ t: songTime, v: flux });
    while (this._flux.length && songTime - this._flux[0].t > FLUX_WINDOW) this._flux.shift();

    // Peak-pick the frame PICK_R behind the head, now that both sides of it
    // are visible. Everything is measured in time, so the same audio gives the
    // same onsets whatever the frame rate.
    const f = this._flux;
    if (f.length < 5) return;
    const headT = f[f.length - 1].t;
    let idx = -1;
    for (let i = f.length - 1; i >= 0; i--) {
      if (headT - f[i].t >= PICK_R) { idx = i; break; }
    }
    if (idx < 1) return;
    const here = f[idx];
    if (here.t <= this._pickedTo) return;      // never judge the same frame twice
    this._pickedTo = here.t;

    for (const s of f) {
      if (s !== here && Math.abs(s.t - here.t) <= PICK_R && s.v > here.v) return;
    }
    let sum = 0;
    for (const s of f) sum += s.v;
    const mean = sum / f.length;
    if (here.v < mean * (1 + PICK_DELTA) || here.v <= 0.0004) return;
    if (here.t - this._lastOnset < ONSET_GAP) return;

    this._lastOnset = here.t;
    this._onsets.push({ t: here.t, v: here.v });
    if (this._onsets.length > HISTORY) this._onsets.shift();
    this.onsetAt = here.t;
  }

  // Call once a frame. True on the frame a PREDICTED beat crosses — which
  // also fires through gaps where nothing was detected at all.
  update(songTime) {
    this.onsetAt = null;
    this._detect(songTime);

    while (this._onsets.length && songTime - this._onsets[0].t > WINDOW) this._onsets.shift();

    if (songTime - this._lastFit >= REFIT_EVERY) {
      this._lastFit = songTime;
      this._fit(songTime);
    }
    if (!this.locked) return false;

    const idx = Math.floor((songTime - this.anchor) / this.period);
    if (idx !== this._lastEmitted) {
      this._lastEmitted = idx;
      this.beatIndex = idx;
      return true;
    }
    return false;
  }

  _fit(now) {
    // Flux needs to be sampled densely; below about 30fps the spectrum is
    // aliased and any grid fitted to it would be fiction. Report unlocked
    // rather than pretending.
    if (this._flux.length / FLUX_WINDOW < 30) { this.locked = false; this.confidence = 0; return; }

    const g = fitGrid(this._onsets, now);
    if (!g) { this.locked = false; this.confidence = 0; return; }
    this.pulse = g.pulse; this.period = g.period; this.bpm = g.bpm;
    this.anchor = g.anchor; this.confidence = g.confidence;
    this.locked = g.locked;
    if (!this.locked) this._lastEmitted = -1;
  }

  // Song-time of the next predicted beat after `songTime`.
  nextBeat(songTime) {
    if (!this.locked) return null;
    const k = Math.floor((songTime - this.anchor) / this.period) + 1;
    return this.anchor + k * this.period;
  }

  // 0 at a beat, rising to 1 just before the next — the anticipation signal.
  phase(songTime) {
    if (!this.locked) return 0;
    const x = (songTime - this.anchor) / this.period;
    return x - Math.floor(x);
  }

  // Signed seconds from `songTime` to the nearest grid beat. Negative is
  // early, positive is late. This is what judges a tap.
  offset(songTime) {
    if (!this.locked) return null;
    const x = (songTime - this.anchor) / this.period;
    return (x - Math.round(x)) * this.period;
  }
}
