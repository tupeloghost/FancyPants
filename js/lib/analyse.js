// Track analysis — charts a whole song before it plays.
//
// Why offline. Notes have to appear on screen about two seconds before they
// are played, and a realtime detector only knows about onsets once the audio
// has passed. You cannot chart the future from it. Every rhythm game solves
// this by charting in advance, and doing it here has a second benefit that
// matters more for a race: every player in the room gets a byte-identical
// chart, so nobody is racing an easier song than anybody else.
//
// Why the notes sit on measured onsets rather than on a fitted grid. It is
// tempting to fit one tempo and lay a grid across the track, but a tempo
// estimate that is 0.1% out drifts by 180ms over three minutes, which by the
// last chorus is a note visibly off the music. Onsets are measured, not
// predicted, so they do not drift — and charting them directly is also what
// produces real musical patterns: rests where the track rests, doubles where
// it is busy, density that follows the arrangement instead of a metronome.
//
// The grid is still fitted, but only to report a tempo and to mark accents.

import { fitGrid } from './beatclock.js?v=579';

const FFT_N = 1024;
const HOP = 512;              // ~11.6ms at 44.1k — 86 frames a second
const PICK_R = 0.028;
const PICK_DELTA = 0.30;
const MIN_GAP = 0.155;        // playability floor: about 6 presses a second
const FLUX_WIN = 1.5;

// ── a small radix-2 FFT; we only need magnitudes ────────────────────────────
function makeFFT(n) {
  const levels = Math.log2(n) | 0;
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i, r = 0;
    for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(2 * Math.PI * i / n);
    sin[i] = Math.sin(2 * Math.PI * i / n);
  }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

const decodeCtx = () => new (window.AudioContext || window.webkitAudioContext)();
let _sharedCtx = null;

const cache = new Map();   // url -> chart, so a replayed track is instant

export function cachedChart(url) { return cache.get(url) || null; }

// Analyse `url` and return { duration, bpm, confidence, notes: [{t, v, accent}] }.
// Yields to the frame loop regularly so the worlds keep animating throughout.
export async function analyseTrack(url, onProgress) {
  if (cache.has(url)) return cache.get(url);

  const res = await fetch(url);
  if (!res.ok) throw new Error('could not fetch track: ' + res.status);
  const bytes = await res.arrayBuffer();

  _sharedCtx = _sharedCtx || decodeCtx();
  const buf = await _sharedCtx.decodeAudioData(bytes.slice(0));

  const sr = buf.sampleRate;
  // mono sum — a hit is a hit in either ear, and it halves the work
  const L = buf.getChannelData(0);
  const Rc = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const len = buf.length;

  const fft = makeFFT(FFT_N);
  const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N);
  const win = new Float32Array(FFT_N);
  for (let i = 0; i < FFT_N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_N); // Hann

  const bins = Math.floor(FFT_N / 2 * 0.75);   // ignore the top — mostly air
  const prev = new Float32Array(bins);
  const frames = Math.max(0, Math.floor((len - FFT_N) / HOP));
  const flux = new Float32Array(frames);
  const times = new Float32Array(frames);

  let yieldAt = performance.now();
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT_N; i++) {
      const s = Rc ? (L[off + i] + Rc[off + i]) * 0.5 : L[off + i];
      re[i] = s * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let b = 0; b < bins; b++) {
      const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      const d = mag - prev[b];
      if (d > 0) sum += d;
      prev[b] = mag;
    }
    flux[f] = sum;
    times[f] = (off + FFT_N / 2) / sr;

    // hand the frame loop back regularly — analysis must never freeze the app
    if ((f & 255) === 0 && performance.now() - yieldAt > 12) {
      if (onProgress) onProgress(f / frames);
      await new Promise(r => setTimeout(r, 0));
      yieldAt = performance.now();
    }
  }

  // ── peak-pick onsets, exactly as the realtime clock does ──
  const onsets = [];
  const halfWin = Math.round((FLUX_WIN / 2) * sr / HOP);
  const rad = Math.max(1, Math.round(PICK_R * sr / HOP));
  let lastT = -99;
  for (let f = rad; f < frames - rad; f++) {
    const v = flux[f];
    let isMax = true;
    for (let k = f - rad; k <= f + rad; k++) if (k !== f && flux[k] > v) { isMax = false; break; }
    if (!isMax) continue;
    let sum = 0, cnt = 0;
    for (let k = Math.max(0, f - halfWin); k < Math.min(frames, f + halfWin); k++) { sum += flux[k]; cnt++; }
    const mean = sum / Math.max(1, cnt);
    if (v < mean * (1 + PICK_DELTA) || v <= 1e-6) continue;
    if (times[f] - lastT < MIN_GAP * 0.6) continue;   // dedupe doubles from one hit
    lastT = times[f];
    onsets.push({ t: times[f], v });
  }

  // normalise strength so accents mean the same thing on a quiet track
  let maxV = 0;
  for (const o of onsets) if (o.v > maxV) maxV = o.v;
  if (maxV > 0) for (const o of onsets) o.v /= maxV;

  // ── tempo, for display and for accenting ──
  // fitGrid weights by recency, so sample a window rather than the whole track
  let best = null;
  for (let start = 8; start < buf.duration - 20; start += 20) {
    const slice = onsets.filter(o => o.t >= start && o.t < start + 20);
    if (slice.length < 12) continue;
    const g = fitGrid(slice, start + 20);
    if (g && (!best || g.confidence > best.confidence)) best = g;
  }

  // ── the chart ──
  // Thin to something a person can actually play: never two notes closer than
  // MIN_GAP, and when the track is dense the stronger hit wins. This is what
  // turns an onset list into a playable pattern.
  const notes = [];
  for (const o of onsets) {
    const last = notes[notes.length - 1];
    if (last && o.t - last.t < MIN_GAP) {
      if (o.v > last.v) { last.t = o.t; last.v = o.v; }   // keep the stronger
      continue;
    }
    notes.push({ t: o.t, v: o.v, accent: false });
  }
  // accent the strongest quarter — that is where the bar structure reads
  const sorted = notes.map(n => n.v).sort((a, b) => a - b);
  const accentAt = sorted.length ? sorted[Math.floor(sorted.length * 0.72)] : 1;
  for (const n of notes) n.accent = n.v >= accentAt;

  const chart = {
    url,
    duration: buf.duration,
    bpm: best ? best.bpm : 0,
    confidence: best ? best.confidence : 0,
    notes,
  };
  cache.set(url, chart);
  if (onProgress) onProgress(1);
  return chart;
}
