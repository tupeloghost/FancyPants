// SFX — the atmosphere answering your hands.
//
// The house sound is AMBIENT. Not effects, not chimes: the world has a
// character, and touching it makes that character swell for a moment and
// sink back. Four rules make it so, and every voice below obeys them:
//
//   1. No strike. Nothing has a percussive onset. Every voice fades UP over
//      a quarter-second or more, so a sound seems to surface out of the room
//      rather than to start in it. This single rule is the whole difference
//      between an effect and an atmosphere.
//   2. Drift. Each voice is two detuned oscillators panned wide, with a slow
//      LFO breathing on their tuning — the beating between them is what makes
//      a pad feel alive and analog instead of flat and digital.
//   3. Movement in the filter, not the pitch. A lowpass opens gently as the
//      voice swells and closes as it leaves, so sounds bloom and dim like
//      light rather than sliding around.
//   4. A long room. A convolution reverb from a synthesized four-second hall
//      sits behind everything, wet enough that tails blur together into
//      atmosphere instead of landing as separate events.
//
// Everything is synthesized at runtime — no files, nothing to load.

let ctx = null, master = null, room = null, roomSend = null, warmth = null, drift = null;
let muted = false;

const BASE = 0.085;                 // an accent under the music, never a voice over it

// a synthesized hall: exponentially decaying noise, darkening as it ages
// (air absorbs treble first), with a little early-reflection scatter
function buildIR(seconds) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += ((Math.random() * 2 - 1) - lp) * (0.32 - 0.26 * t);
      d[i] = lp * Math.pow(1 - t, 2.2);
    }
    [0.013, 0.023, 0.037, 0.053].forEach((tap, k) => {
      const at = Math.floor(rate * tap) + (ch ? 41 : 0);
      if (at < len) d[at] += (0.42 - k * 0.09) * (ch ? -1 : 1);
    });
  }
  return buf;
}

function ensure() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = BASE;
    warmth = ctx.createBiquadFilter();          // a soft ceiling over everything
    warmth.type = 'lowpass';
    warmth.frequency.value = 2200;
    warmth.Q.value = 0.5;
    master.connect(warmth);
    warmth.connect(ctx.destination);

    room = ctx.createConvolver();
    room.buffer = buildIR(window.__LITE ? 2.6 : 4.0);   // phones carry a smaller hall
    const roomTone = ctx.createBiquadFilter();
    roomTone.type = 'lowpass';
    roomTone.frequency.value = 1500;
    const roomLevel = ctx.createGain();
    roomLevel.gain.value = 1.35;                // wet: tails blur into weather
    roomSend = ctx.createGain();
    roomSend.gain.value = 1;
    roomSend.connect(room);
    room.connect(roomTone);
    roomTone.connect(roomLevel);
    // the room returns THROUGH master, so the fader and the mute govern the
    // tail too — a reverb that ignores the fader is a bug you hear at the
    // worst possible moment
    roomLevel.connect(master);

    // one slow breath shared by every voice: the detune LFO that keeps the
    // pads from ever sitting perfectly still
    drift = ctx.createOscillator();
    drift.type = 'sine';
    drift.frequency.value = 0.17;               // one cycle every six seconds
    drift.start();
  } catch { return false; }
  return true;
}

// a suspended context needs a nudge, and the nudge can legitimately fail
// (autoplay policy, an offline context) — never as an unhandled rejection
function wake() {
  if (ctx && ctx.state === 'suspended' && ctx.resume) {
    try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* not now, then */ }
  }
}

export function setSfxMuted(m) { muted = m; }
// a read-only handle so a test can confirm the front-door gate actually holds
export const isSfxMuted = () => muted;

export function setSfxLevel(v) {
  if (ensure()) master.gain.value = BASE * Math.max(0, Math.min(2, v));
}

// pentatonic in a low, warm register — pads live down here
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const stepFreq = s => 196 * Math.pow(2, SCALE[Math.max(0, Math.min(SCALE.length - 1, s))] / 12);

// One pad: a slow swell that surfaces and sinks. Two wide detuned voices, a
// filter that opens and closes with the swell, and the shared drift breathing
// on the tuning the whole time.
// Long tails are the point, but a fast chain of catches would stack a dozen
// of them into a drone. Voices started in the last second and a half quiet
// the next one down, so a flurry breathes as ONE swell instead of a pile-up.
const recent = [];
function crowding() {
  const now = performance.now();
  while (recent.length && now - recent[0] > 1500) recent.shift();
  recent.push(now);
  return 1 / (1 + (recent.length - 1) * 0.38);
}

function pad(freq, {
  dur = 3.0, gain = 0.2, attack = 0.5, delay = 0, open = 900, sub = 0.35,
  shimmer = 0, send = 1.4, width = 0.4, solo = false,
} = {}) {
  if (muted || !ensure()) return;
  wake();
  if (!solo) gain *= crowding();
  const t0 = ctx.currentTime + delay;
  const peak = t0 + attack;
  const end = t0 + dur;

  // the filter: light blooming, then dimming
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(220, t0);
  lp.frequency.linearRampToValueAtTime(open, peak + dur * 0.12);
  lp.frequency.linearRampToValueAtTime(260, end);

  // the envelope: no strike, a long sink
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), peak);
  g.gain.exponentialRampToValueAtTime(0.0001, end);

  lp.connect(g);
  g.connect(master);
  const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(roomSend);

  // two voices, panned apart, detuned against each other — the beating
  // between them IS the warmth
  [-1, 1].forEach(side => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.detune.value = side * 7;
    // the shared slow breath, a few cents deep
    const dg = ctx.createGain();
    dg.gain.value = 4 * side;
    drift.connect(dg); dg.connect(o.detune);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = side * width; o.connect(pan); pan.connect(lp); }
    else { o.connect(lp); }
    o.start(t0); o.stop(end + 0.1);
  });

  // an octave of air above, barely there — keeps a low pad from going muddy
  if (shimmer > 0) {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * 2.01;
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * shimmer), peak + 0.25);
    og.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(og); og.connect(master);
    const s2 = ctx.createGain(); s2.gain.value = send; og.connect(s2); s2.connect(roomSend);
    o.start(t0); o.stop(end + 0.1);
  }

  // the floor: an octave down, felt more than heard
  if (sub > 0) {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * 0.5;
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * sub), peak + 0.1);
    og.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(og); og.connect(master);
    const s3 = ctx.createGain(); s3.gain.value = send * 0.6; og.connect(s3); s3.connect(roomSend);
    o.start(t0); o.stop(end + 0.1);
  }
}

// a wash of air: dark filtered noise that rises and falls with no edge at all
function wash(dur = 2.2, gain = 0.05, openTo = 520) {
  if (muted || !ensure()) return;
  const t = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = last * 0.93 + (Math.random() * 2 - 1) * 0.07;   // heavy smoothing: weather, not hiss
    d[i] = last * 4.2;
  }
  const src = ctx.createBufferSource(); src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.3;
  lp.frequency.setValueAtTime(200, t);
  lp.frequency.linearRampToValueAtTime(openTo, t + dur * 0.45);
  lp.frequency.linearRampToValueAtTime(180, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.4);     // slow in
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);         // slow out
  src.connect(lp); lp.connect(g); g.connect(master);
  const s = ctx.createGain(); s.gain.value = 1.5; g.connect(s); s.connect(roomSend);
  src.start(t); src.stop(t + dur);
}

// ── the vocabulary ── every one of these is weather, not a noise

// a hit: the atmosphere lifts a little, pitched by your streak
export function hit(streak = 0, strong = false) {
  const s = Math.min(SCALE.length - 1, Math.floor(streak / 3));
  pad(stepFreq(s), {
    dur: strong ? 2.6 : 2.0, gain: strong ? 0.20 : 0.15,
    attack: strong ? 0.30 : 0.26, open: strong ? 1000 : 780,
    shimmer: strong ? 0.22 : 0.12,
  });
}

// a miss or a cost: the room sinks — felt, never punishing
export function thud() {
  pad(98, { dur: 2.4, gain: 0.17, attack: 0.35, open: 420, sub: 0.5 });
}

// a clear: three tones drifting in, overlapping into one chord
export function clear(chain = 1) {
  const base = Math.min(4, chain);
  [0, 2, 4].forEach((st, i) =>
    pad(stepFreq(st + base), {
      dur: 3.4, gain: 0.13, attack: 0.45, delay: i * 0.28, open: 850, shimmer: 0.15,
    }));
}

// an overtake: the air tilts up (you passed) or down (they did)
export function pass(up = true) {
  pad(stepFreq(up ? 3 : 6), { dur: 2.2, gain: 0.13, attack: 0.3, open: 700 });
  pad(stepFreq(up ? 6 : 3), { dur: 2.6, gain: 0.11, attack: 0.4, delay: 0.3, open: 800 });
}

// catching something — the whole world breathes in for a second.
// 'soft' (a small lift), 'air' (a fuller one with a fifth), 'bloom' (the
// rainbow ceremony: a chord that drifts in and hangs over everything).
export function swoosh(kind = 'air') {
  if (muted || !ensure()) return;
  wake();
  if (kind === 'bloom') {
    wash(3.2, 0.055, 620);
    // root, fifth, ninth, octave — arriving one at a time, none of them
    // announcing themselves
    [0, 7, 14, 12].forEach((semi, i) =>
      pad(147 * Math.pow(2, semi / 12), {
        dur: 5.0 - i * 0.3, gain: 0.15 - i * 0.016, attack: 0.7 + i * 0.12,
        delay: i * 0.22, open: 950 - i * 60, shimmer: i === 3 ? 0.3 : 0.1,
        sub: i === 0 ? 0.4 : 0,
      }));
  } else if (kind === 'soft') {
    wash(1.6, 0.03, 420);
    pad(stepFreq(2), { dur: 2.2, gain: 0.15, attack: 0.28, open: 620, shimmer: 0.12, sub: 0.3 });
  } else {
    wash(2.0, 0.038, 500);
    pad(stepFreq(4), { dur: 2.8, gain: 0.15, attack: 0.32, open: 780, shimmer: 0.18 });
    pad(stepFreq(7), { dur: 2.4, gain: 0.09, attack: 0.45, delay: 0.18, open: 900, sub: 0 });
  }
}

// a milestone or finish: the atmosphere rises through a chord and holds
export function fanfare() {
  wash(3.0, 0.045, 560);
  [0, 3, 5, 8].forEach((st, i) =>
    pad(stepFreq(st), {
      dur: 4.6 - i * 0.25, gain: 0.15 - i * 0.015, attack: 0.55 + i * 0.1,
      delay: i * 0.3, open: 900, shimmer: 0.14, sub: i === 0 ? 0.45 : 0,
    }));
}
