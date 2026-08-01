// Shared shell: renderer, loop, audio engine, controls panel, world switcher.
// Single-player build — the net layer and participants list are stubbed so
// worlds already code against the final interface.

import * as THREE from 'three';
import { AudioEngine } from './audio-engine.js';
import { WORLDS } from './worlds/registry.js';

// ── Renderer ──
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000208);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ── Audio ──
const audio = new AudioEngine();

// ── Participants (single-player: just the local one) ──
const participants = [
  { id: 'local', name: localStorage.getItem('sw_name') || 'you', x: 0, y: 0, z: 0, heading: 0, action: 'idle', local: true, color: 0 },
];

// ── Settings (live-tunable via panel) ──
const settings = {
  reactivity: 1.0,
  hue: 210,
  attract: true,
};

// ── World switcher ──
let world = null;
function switchWorld(key) {
  if (world) world.dispose();
  world = WORLDS[key].create();
  world.init(scene, camera);
}

// ── Panel wiring ──
const $ = id => document.getElementById(id);
const panel = $('panel');

$('panel-head').addEventListener('click', () => panel.classList.toggle('collapsed'));

// world select
for (const [key, w] of Object.entries(WORLDS)) {
  const opt = document.createElement('option');
  opt.value = key; opt.textContent = w.label;
  $('world-select').appendChild(opt);
}
$('world-select').addEventListener('change', e => switchWorld(e.target.value));

// tracks from /audio/manifest.json (optional file — silently skipped if absent)
fetch('audio/manifest.json')
  .then(r => (r.ok ? r.json() : []))
  .then(list => {
    for (const f of list) {
      const opt = document.createElement('option');
      opt.value = 'audio/' + f; opt.textContent = f;
      $('track-select').appendChild(opt);
    }
  })
  .catch(() => {});
$('track-select').addEventListener('change', e => {
  if (!e.target.value) return;
  audio.loadURL(e.target.value);
  audio.play().catch(() => {});
  updatePlayBtn();
});
$('file-input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  $('file-label').textContent = '♪ ' + f.name;
  audio.loadFile(f);
  audio.play().catch(() => {});
  updatePlayBtn();
});

function updatePlayBtn() {
  $('btn-play').textContent = audio.playing ? '⏸' : '▶';
}
$('btn-play').addEventListener('click', () => {
  audio.playing ? audio.pause() : audio.play().catch(() => {});
  updatePlayBtn();
});
audio.el.addEventListener('play', updatePlayBtn);
audio.el.addEventListener('pause', updatePlayBtn);

// scrub
let scrubbing = false;
$('scrub').addEventListener('input', e => {
  scrubbing = true;
  audio.seek((e.target.value / 1000) * audio.duration);
  setFill(e.target);
});
$('scrub').addEventListener('change', () => { scrubbing = false; });

$('volume').addEventListener('input', e => {
  audio.setVolume(e.target.value / 100);
  $('vol-val').textContent = e.target.value;
  setFill(e.target);
});
audio.setVolume(0.8);

// sliders — keep the filled portion of the track in sync via --fill
function setFill(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--fill', pct + '%');
}
document.querySelectorAll('input[type="range"]').forEach(setFill);

function slider(id, valId, fmt, apply) {
  $(id).addEventListener('input', e => {
    const v = +e.target.value;
    $(valId).textContent = fmt(v);
    setFill(e.target);
    apply(v);
  });
}
slider('reactivity', 'react-val', v => (v / 100).toFixed(1), v => settings.reactivity = v / 100);
slider('beat-sens', 'beat-val', v => (v / 100).toFixed(2), v => audio.params.beatThreshold = v / 100);
slider('smoothing', 'smooth-val', v => (v / 100).toFixed(2), v => audio.params.smoothing = v / 100);
slider('hue', 'hue-val', v => v, v => {
  settings.hue = v;
  document.documentElement.style.setProperty('--accent-h', v);
});

// mode toggle
function setAttract(on) {
  settings.attract = on;
  $('btn-attract').classList.toggle('on', on);
  $('btn-interactive').classList.toggle('on', !on);
}
$('btn-attract').addEventListener('click', () => setAttract(true));
$('btn-interactive').addEventListener('click', () => setAttract(false));

// hotkeys
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'h' || e.key === 'H') panel.classList.toggle('hidden');
  if (e.key === 'c' || e.key === 'C') panel.classList.toggle('collapsed');
  if (e.key === ' ') {
    e.preventDefault();
    audio.playing ? audio.pause() : audio.play().catch(() => {});
    updatePlayBtn();
  }
});

// pointer steering (interactive mode)
function steerFromPointer(cx, cy) {
  if (settings.attract || !world || !world.setInput) return;
  world.setInput((cx / window.innerWidth) * 2 - 1, -((cy / window.innerHeight) * 2 - 1));
}
window.addEventListener('pointermove', e => steerFromPointer(e.clientX, e.clientY));
window.addEventListener('touchmove', e => {
  if (e.touches[0]) steerFromPointer(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

// tilt steering on mobile (interactive mode)
window.addEventListener('deviceorientation', e => {
  if (settings.attract || !world || !world.setInput || e.gamma == null) return;
  world.setInput(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - 45) / -30)));
});

// tap-to-start unlocks the AudioContext
const tap = $('tap-to-start');
tap.addEventListener('click', () => {
  audio.ensureContext();
  tap.classList.add('gone');
});

// URL params (?world=tunnel supported now; room/names reserved for later phases)
const params = new URLSearchParams(location.search);
const startWorld = WORLDS[params.get('world')] ? params.get('world') : 'tunnel';
$('world-select').value = startWorld;
switchWorld(startWorld);

// ── Loop ──
let last = performance.now();
let fpsFrames = 0, fpsTime = 0, time = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  const a = audio.update(dt);
  world.update(dt, a, participants, {
    reactivity: settings.reactivity,
    hue: settings.hue,
    attract: settings.attract,
    time,
  });
  renderer.render(scene, camera);

  // panel readouts
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    $('fps').textContent = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0; fpsTime = 0;
    if (!scrubbing && audio.duration) {
      $('scrub').value = (audio.currentTime / audio.duration) * 1000;
      setFill($('scrub'));
    }
    const f = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    $('time-cur').textContent = f(audio.currentTime);
    $('time-dur').textContent = f(audio.duration);
    $('pcount').textContent = participants.length;
  }
}
requestAnimationFrame(frame);
