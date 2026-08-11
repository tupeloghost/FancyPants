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

let ctx = null, master = null;
let muted = false;

function ensure() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.09;          // an accent under the music, never a voice over it          // present, never competing with the track
    master.connect(ctx.destination);
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
export function fanfare() {
  [0, 3, 5, 8].forEach((st, i) =>
    setTimeout(() => blip(stepFreq(st), 0.16, 'triangle', 0.65), i * 80));
}
