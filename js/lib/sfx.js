// SFX — the voice of your own hands.
//
// Every reward in this game was silent: combos, ring clears, gates, catches —
// the music played underneath but the player's own actions had no sound, and
// a silent reward is half a reward. This is the missing dopamine channel, and
// it covers every world at once because it hooks the race model, not the
// worlds.
//
// Everything is synthesized — no files, nothing to load. The one trick that
// matters: hit pitch CLIMBS a pentatonic scale with your streak, so a run
// literally plays a rising melody and a miss drops the needle. Rising pitch
// under repeated success is the oldest reliable joy-circuit in games.

let ctx = null, master = null, wet = null;
let muted = false;

function ensure() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.09;          // an accent under the music, never a voice over it
    master.connect(ctx.destination);
    // a small synthesized room: two cross-fed delays behind a dark lowpass.
    // Dry sounds are effects; sounds with a tail are production.
    wet = ctx.createGain();
    wet.gain.value = 0.5;
    const d1 = ctx.createDelay(0.5), d2 = ctx.createDelay(0.5);
    d1.delayTime.value = 0.083; d2.delayTime.value = 0.127;
    const f1 = ctx.createGain(), f2 = ctx.createGain();
    f1.gain.value = 0.32; f2.gain.value = 0.28;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass'; dark.frequency.value = 2600;
    wet.connect(d1); wet.connect(d2);
    d1.connect(f1); f1.connect(d2);
    d2.connect(f2); f2.connect(d1);
    d1.connect(dark); d2.connect(dark);
    dark.connect(master);
  } catch { return false; }
  return true;
}

export function setSfxMuted(m) { muted = m; }

export function setSfxLevel(v) {
  if (ensure()) master.gain.value = 0.09 * Math.max(0, Math.min(2, v));
}

// pentatonic, so any climb is musical against any track
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const stepFreq = s => 330 * Math.pow(2, SCALE[Math.max(0, Math.min(SCALE.length - 1, s))] / 12);

function blip(freq, dur, type, gain, glideTo = 0) {
  if (muted || !ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

// ── the vocabulary ──

// a hit: short bright pop, pitch climbing with the streak
export function hit(streak = 0, strong = false) {
  const s = Math.min(SCALE.length - 1, Math.floor(streak / 3));
  blip(stepFreq(s), 0.09, 'triangle', strong ? 0.9 : 0.6);
  if (strong) blip(stepFreq(s) * 2, 0.14, 'sine', 0.35);
}

// a miss or a cost: soft low thud — felt, never punishing
export function thud() {
  blip(110, 0.16, 'sine', 0.7, 70);
}

// a clear (ring, region, tier): quick rising arpeggio
export function clear(chain = 1) {
  const base = Math.min(4, chain);
  [0, 2, 4].forEach((st, i) =>
    setTimeout(() => blip(stepFreq(st + base), 0.12, 'triangle', 0.7), i * 55));
}

// an overtake: a glissando up (you passed) or down (they did)
export function pass(up = true) {
  blip(up ? 300 : 620, 0.22, 'sine', 0.55, up ? 620 : 300);
}

// a milestone or finish: a little fanfare climb
// swooshes: filtered noise sweeps in three weights — 'soft' (a breath),
// 'air' (a real whoosh), 'bloom' (the rainbow ceremony). Noise-based means
// key-agnostic: they sit under any song like wind, never like a game.
export function swoosh(kind = 'air') {
  if (muted || !ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;
  const P = kind === 'bloom'
    ? { dur: 0.8, f0: 260, f1: 3800, q: 1.1, gain: 0.9, attack: 0.05 }
    : kind === 'soft'
      ? { dur: 0.28, f0: 700, f1: 1900, q: 2.2, gain: 0.28, attack: 0.03 }
      : { dur: 0.42, f0: 450, f1: 2500, q: 1.6, gain: 0.5, attack: 0.04 };
  const buf = ctx.createBuffer(1, ctx.sampleRate * P.dur, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 0.6);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = P.q;
  bp.frequency.setValueAtTime(P.f0, t);
  bp.frequency.exponentialRampToValueAtTime(P.f1, t + P.dur * 0.85);
  // a soft lowpass on top takes the hiss off — breath, not static
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(P.gain, t + P.attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + P.dur);
  // gentle stereo placement + the room tail — alive, not clinical
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const out = pan || g;
  if (pan) { pan.pan.value = (Math.random() * 2 - 1) * 0.4; g.connect(pan); }
  src.connect(bp); bp.connect(lp); lp.connect(g);
  out.connect(master);
  out.connect(wet);
  src.start(t); src.stop(t + P.dur);
  if (kind === 'bloom') {
    // a warm chord swell instead of chimes — pads, not pinball
    [0, 7, 12].forEach(semi => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 262 * Math.pow(2, semi / 12);
      og.gain.setValueAtTime(0.001, t);
      og.gain.exponentialRampToValueAtTime(0.16, t + 0.25);
      og.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      o.connect(og); og.connect(master); og.connect(wet);
      o.start(t + 0.1); o.stop(t + 1.2);
    });
  }
}

export function fanfare() {
  [0, 3, 5, 8].forEach((st, i) =>
    setTimeout(() => blip(stepFreq(st), 0.16, 'triangle', 0.65), i * 80));
}
