// SFX — the voice of your own hands.
//
// Every reward in this game was silent: combos, ring clears, gates, catches —
// the music played underneath but the player's own actions had no sound, and
// a silent reward is half a reward. This is the missing dopamine channel, and
// it covers every world at once because it hooks the race model, not the
// worlds.
//
// The house sound is CALM. Three rules make it so, and every voice below
// obeys them: nothing starts instantly (every envelope has a real attack, so
// no clicks), nothing is bright (a warmth filter rounds the whole bus off
// before it leaves), and everything has a tail (a slow room behind it, so
// sounds dissolve instead of stopping). Pitch still climbs a pentatonic scale
// with a streak — the joy circuit stays — it's just spoken softly.
//
// Everything is synthesized — no files, nothing to load.

let ctx = null, master = null, wet = null, warmth = null;
let muted = false;
let level = 1;

const BASE = 0.075;                  // an accent under the music, never a voice over it

function ensure() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = BASE;
    // the warmth filter: the whole bus leaves through a soft ceiling, so no
    // voice can ever get glassy no matter what it does on the way in
    warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 2300;
    warmth.Q.value = 0.6;
    master.connect(warmth);
    warmth.connect(ctx.destination);
    // a slow synthesized room: two cross-fed delays behind a dark lowpass.
    // Longer and wetter than a game needs, which is exactly why it soothes.
    wet = ctx.createGain();
    wet.gain.value = 0.62;
    const d1 = ctx.createDelay(0.9), d2 = ctx.createDelay(0.9);
    d1.delayTime.value = 0.113; d2.delayTime.value = 0.173;
    const f1 = ctx.createGain(), f2 = ctx.createGain();
    f1.gain.value = 0.40; f2.gain.value = 0.36;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass'; dark.frequency.value = 1700;
    wet.connect(d1); wet.connect(d2);
    d1.connect(f1); f1.connect(d2);
    d2.connect(f2); f2.connect(d1);
    d1.connect(dark); d2.connect(dark);
    dark.connect(master);
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

export function setSfxLevel(v) {
  level = Math.max(0, Math.min(2, v));
  if (ensure()) master.gain.value = BASE * level;
}

// pentatonic, so any climb is musical against any track
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const stepFreq = s => 330 * Math.pow(2, SCALE[Math.max(0, Math.min(SCALE.length - 1, s))] / 12);

// One rounded voice. `attack` is never zero — that single value is most of
// the difference between a game beep and an instrument.
function tone(freq, {
  dur = 0.6, attack = 0.05, gain = 0.4, type = 'sine',
  glideTo = 0, delay = 0, send = 0.8, tilt = 1400,
} = {}) {
  if (muted || !ensure()) return;
  wake();
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  // a per-voice lowpass takes the edge off the harmonics before the bus does
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.max(400, tilt), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, tilt * 0.55), t + dur);
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur * 0.9);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp); lp.connect(g);
  g.connect(master);
  if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(wet); }
  o.start(t); o.stop(t + dur + 0.05);
}

// ── the vocabulary ──

// a hit: a soft mallet, pitch climbing with the streak. Rounded, not popped.
export function hit(streak = 0, strong = false) {
  const s = Math.min(SCALE.length - 1, Math.floor(streak / 3));
  const f = stepFreq(s);
  tone(f, { dur: strong ? 0.7 : 0.5, attack: 0.028, gain: strong ? 0.42 : 0.3, tilt: 1600 });
  tone(f * 2, { dur: 0.55, attack: 0.05, gain: strong ? 0.12 : 0.07, tilt: 2000, delay: 0.01 });
}

// a miss or a cost: a low soft settle — felt, never punishing
export function thud() {
  tone(132, { dur: 0.75, attack: 0.045, gain: 0.34, glideTo: 88, tilt: 700 });
}

// a clear (ring, region, tier): three notes that bloom rather than rattle
export function clear(chain = 1) {
  const base = Math.min(4, chain);
  [0, 2, 4].forEach((st, i) =>
    tone(stepFreq(st + base), { dur: 0.8, attack: 0.05, gain: 0.26, delay: i * 0.11, tilt: 1700 }));
}

// an overtake: a slow glide up (you passed) or down (they did)
export function pass(up = true) {
  tone(up ? 294 : 588, { dur: 0.7, attack: 0.06, gain: 0.26, glideTo: up ? 588 : 294, tilt: 1500 });
}

// swooshes: a BREATH, not a whoosh. Noise runs through a lowpass that opens
// and closes again — air moving past you — under a quiet pentatonic body tone
// so it lands in key with whatever is playing. Three weights: 'soft' (a small
// exhale), 'air' (a fuller one), 'bloom' (the rainbow ceremony: a slow chord).
export function swoosh(kind = 'air') {
  if (muted || !ensure()) return;
  wake();
  const t = ctx.currentTime;
  const P = kind === 'bloom'
    ? { dur: 1.5, open: 1500, gain: 0.46, attack: 0.16 }
    : kind === 'soft'
      ? { dur: 0.6, open: 800, gain: 0.19, attack: 0.08 }
      : { dur: 0.85, open: 1150, gain: 0.30, attack: 0.10 };

  // the air bed — pink-ish noise (averaged, so it hisses far less than white)
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * P.dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last * 0.86) + (w * 0.14);          // one-pole smoothing = soft air
    d[i] = last * 3.2;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  // opens gently, then closes again — a breath in and out, never a rising hiss
  lp.frequency.setValueAtTime(360, t);
  lp.frequency.linearRampToValueAtTime(P.open, t + P.dur * 0.42);
  lp.frequency.linearRampToValueAtTime(300, t + P.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(P.gain, t + P.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + P.dur);
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  src.connect(lp); lp.connect(g);
  if (pan) { pan.pan.value = (Math.random() * 2 - 1) * 0.3; g.connect(pan); pan.connect(master); pan.connect(wet); }
  else { g.connect(master); g.connect(wet); }
  src.start(t); src.stop(t + P.dur);

  // the body: a quiet tone so the breath has a pitch to belong to
  if (kind === 'bloom') {
    // the ceremony — a slow warm chord that swells and dissolves
    [0, 7, 12, 16].forEach((semi, i) =>
      tone(196 * Math.pow(2, semi / 12), {
        dur: 2.2 - i * 0.15, attack: 0.30, gain: 0.20 - i * 0.028,
        delay: 0.06 * i, tilt: 1300,
      }));
  } else {
    tone(kind === 'soft' ? 392 : 294, {
      dur: P.dur * 1.2, attack: P.attack, gain: kind === 'soft' ? 0.15 : 0.20, tilt: 1200,
    });
  }
}

// a milestone or finish: a slow bloom upward — a sigh of satisfaction
export function fanfare() {
  [0, 3, 5, 8].forEach((st, i) =>
    tone(stepFreq(st), { dur: 1.3, attack: 0.07, gain: 0.24 - i * 0.02, delay: i * 0.14, tilt: 1600 }));
}
