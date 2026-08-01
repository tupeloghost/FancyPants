// Shared shell: renderer, loop, audio engine, controls panel, world switcher.
// Single-player build — the net layer and participants list are stubbed so
// worlds already code against the final interface.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
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

// post-processing: render → bloom → output
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.3, 0.5
);
composer.addPass(bloomPass);

// color grade: vibrance + contrast after bloom — this is what makes the
// colors read as rich stained glass instead of washed pastel
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.45 },
    contrast: { value: 1.12 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      // vibrance: push saturation harder on less-saturated pixels
      vec3 sat = mix(vec3(luma), c.rgb, saturation);
      // gentle S-curve contrast around mid gray
      vec3 graded = (sat - 0.5) * contrast + 0.5;
      gl_FragColor = vec4(max(graded, 0.0), c.a);
    }
  `,
});
composer.addPass(gradePass);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
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
  colorMode: 'rainbow',
  pattern: 'spiral',
  shape: 'slat',
  hdr: 1.0,
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
fetch('audio/manifest.json?t=' + Date.now())
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

// pin initial slider values — the browser's form-state restoration otherwise
// resurrects stale positions across reloads
$('volume').value = 80;
$('reactivity').value = 100;
$('beat-sens').value = 140;
$('smoothing').value = 70;
$('hue').value = 210;
$('bloom').value = 70;
$('hdr').value = 100;
$('scrub').value = 0;

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
slider('hdr', 'hdr-val', v => (v / 100).toFixed(1), v => settings.hdr = v / 100);
slider('bloom', 'bloom-val', v => (v / 100).toFixed(1), v => {
  bloomPass.strength = v / 100;
  bloomPass.enabled = v > 0;
});

// mode toggle
function setAttract(on) {
  settings.attract = on;
  $('btn-attract').classList.toggle('on', on);
  $('btn-interactive').classList.toggle('on', !on);
}
$('btn-attract').addEventListener('click', () => setAttract(true));
$('btn-interactive').addEventListener('click', () => setAttract(false));

// ── chip pickers: every option shows what it looks like ──
const A = 'hsl(var(--accent-h), 90%, 55%)';
const A2 = 'hsl(calc(var(--accent-h) + 180), 90%, 55%)';
const A3 = 'hsl(calc(var(--accent-h) + 120), 90%, 55%)';

const COLOR_MODES = [
  ['rainbow', 'rainbow', 'linear-gradient(90deg,#f43,#fa0,#fe5,#3e6,#2cf,#55f,#c4f)'],
  ['duotone', 'duotone — your hue & its complement', `linear-gradient(90deg,${A},${A2})`],
  ['cycle', 'cycle — palette rotates over time', 'conic-gradient(#f43,#fe5,#3e6,#2cf,#55f,#c4f,#f43)'],
  ['fire', 'fire', 'linear-gradient(0deg,#310,#d30,#fa0,#ff7)'],
  ['ocean', 'ocean', 'linear-gradient(90deg,#036,#0af,#0fd,#08c)'],
  ['sunset', 'sunset', 'linear-gradient(0deg,#f70,#f36,#a3c)'],
  ['aurora', 'aurora', 'linear-gradient(75deg,#0e5,#3fa,#65f,#0e5)'],
  ['forest', 'forest', 'linear-gradient(90deg,#031,#0a4,#fd6 65%,#0a4)'],
  ['gold', 'gold', 'linear-gradient(105deg,#640,#fc3,#fff,#fc3,#640)'],
  ['cosmos', 'cosmos — starfield & nebula', 'radial-gradient(circle at 25% 30%,#fff 4%,transparent 6%),radial-gradient(circle at 70% 65%,#fff 3%,transparent 5%),linear-gradient(120deg,#103,#527,#215)'],
  ['glitter', 'glitter — tinted by hue', `radial-gradient(circle at 30% 40%,#fff 5%,transparent 8%),radial-gradient(circle at 75% 60%,#fff 4%,transparent 7%),linear-gradient(120deg,hsl(var(--accent-h),60%,14%),hsl(var(--accent-h),50%,26%))`],
  ['candy', 'candy', 'repeating-linear-gradient(45deg,#f6a 0 5px,#fff 5px 9px,#4de 9px 14px,#fd4 14px 18px)'],
  ['mono', 'mono — single hue', A],
  ['duo', 'duo — hue + complement, hard split', `linear-gradient(90deg,${A} 50%,${A2} 50%)`],
  ['triad', 'triad — three hues', `linear-gradient(90deg,${A} 33%,${A3} 33% 66%,${A2} 66%)`],
  ['pastel', 'pastel', 'linear-gradient(90deg,#fbc,#cfe,#dfc,#fec)'],
  ['neon', 'neon', 'linear-gradient(90deg,#f0f,#0ff,#ff0)'],
  ['random', 'random confetti', 'conic-gradient(#f43 0 14%,#2cf 0 32%,#fe5 0 47%,#c4f 0 66%,#3e6 0 82%,#f70 0)'],
  ['vapor', 'vapor', 'linear-gradient(90deg,#f9c,#8df,#caf,#fac)'],
  ['midnight', 'midnight', 'linear-gradient(90deg,#124,#36c,#89b,#236)'],
  ['coral', 'coral', 'linear-gradient(90deg,#f75,#fa8,#4cb,#f86)'],
];
const PATTERNS = [
  ['spiral', 'spiral', 'conic-gradient(from 0deg,#69f,#123 25%,#69f 50%,#123 75%,#69f)'],
  ['checker', 'checker', 'repeating-conic-gradient(#69f 0 25%,#123 0 50%)'],
  ['stripes', 'stripes', 'repeating-linear-gradient(90deg,#69f 0 4px,#123 4px 8px)'],
  ['plaid', 'plaid', 'repeating-linear-gradient(90deg,#69f 0 4px,transparent 4px 9px),repeating-linear-gradient(0deg,#4ad 0 4px,#123 4px 9px)'],
  ['paisley', 'paisley swirl', 'radial-gradient(circle at 30% 60%,#69f 15%,transparent 40%),radial-gradient(circle at 70% 30%,#4ad 15%,transparent 45%),#123'],
  ['polka', 'polka dot', 'radial-gradient(circle at 25% 30%,#69f 22%,transparent 26%),radial-gradient(circle at 75% 70%,#69f 22%,transparent 26%),#123'],
  ['waves', 'waves', 'repeating-radial-gradient(circle at 0% 50%,#69f 0 3px,#123 3px 9px)'],
  ['kaleido', 'kaleido — counter-rotating', 'conic-gradient(#69f 0 12%,#123 0 25%,#4ad 0 37%,#123 0 50%,#69f 0 62%,#123 0 75%,#4ad 0 87%,#123 0)'],
];
const SHAPES = [
  ['slat', 'slat', '&#9644;'],
  ['circle', 'circle', '&#9679;'],
  ['square', 'square', '&#9632;'],
  ['diamond', 'diamond', '&#9670;'],
  ['star', 'star', '&#9733;'],
];

function buildChips(containerId, items, isGlyph, apply, initial) {
  const box = $(containerId);
  for (const [id, label, visual] of items) {
    const c = document.createElement('div');
    c.className = 'chip' + (id === initial ? ' on' : '');
    c.title = label;
    if (isGlyph) c.innerHTML = visual;
    else c.style.background = visual;
    c.addEventListener('click', () => {
      box.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
      apply(id);
    });
    box.appendChild(c);
  }
}
buildChips('color-chips', COLOR_MODES, false, v => settings.colorMode = v, settings.colorMode);
buildChips('pattern-chips', PATTERNS, false, v => settings.pattern = v, settings.pattern);
buildChips('shape-chips', SHAPES, true, v => settings.shape = v, settings.shape);

// hotkeys
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'h' || e.key === 'H') panel.classList.toggle('hidden');
  if (e.key === 'c' || e.key === 'C') panel.classList.toggle('collapsed');
  if (e.key === 's' || e.key === 'S') screenshotQueued = true;
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

// click/tap interaction — part of the world contract, works in both modes
canvas.addEventListener('pointerdown', e => {
  spawnRipple(e.clientX, e.clientY);
  if (!world || !world.onTap) return;
  world.onTap((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
});

// ── Custom cursor: glowing reticle, lerps to the pointer, pulses with the beat ──
const cursorEl = $('cursor');
const cursor = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2, scale: 1 };
window.addEventListener('pointermove', e => {
  cursor.tx = e.clientX; cursor.ty = e.clientY;
  cursorEl.classList.add('live');
});
window.addEventListener('pointerleave', () => cursorEl.classList.remove('live'));

function spawnRipple(x, y) {
  const r = document.createElement('div');
  r.className = 'cursor-ripple';
  r.style.transform = '';
  r.style.left = x + 'px'; r.style.top = y + 'px';
  document.body.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}

function updateCursor(dt, a) {
  const k = Math.min(1, dt * 22);
  cursor.x += (cursor.tx - cursor.x) * k;
  cursor.y += (cursor.ty - cursor.y) * k;
  const target = 1 + a.bass * 0.5 + (a.beat ? 0.9 : 0) + a.beatIntensity * 0.4;
  cursor.scale += (target - cursor.scale) * Math.min(1, dt * 10);
  cursorEl.style.transform =
    `translate(${cursor.x}px, ${cursor.y}px) scale(${cursor.scale.toFixed(3)}) rotate(${(performance.now() * 0.02) % 360}deg)`;
}
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

// ── Spectrum strip: live view of the 5 bands + beat flash, for tuning ──
const specCanvas = $('spectrum');
const specCtx = specCanvas.getContext('2d');
const SPEC_BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];
let beatFlash = 0;

function drawSpectrum(a) {
  const W = specCanvas.width, H = specCanvas.height;
  const hue = settings.hue;
  specCtx.clearRect(0, 0, W, H);

  const n = SPEC_BANDS.length;
  const gap = 3, bw = (W - gap * (n + 1)) / n;
  for (let i = 0; i < n; i++) {
    const v = a[SPEC_BANDS[i]];
    const h = Math.max(2, v * (H - 4));
    specCtx.fillStyle = `hsl(${(hue + i * 16) % 360}, 85%, ${35 + v * 35}%)`;
    specCtx.beginPath();
    specCtx.roundRect(gap + i * (bw + gap), H - 2 - h, bw, h, 2);
    specCtx.fill();
  }

  // volume line
  specCtx.fillStyle = `hsla(${hue}, 30%, 90%, 0.55)`;
  specCtx.fillRect(0, H - 2 - a.volume * (H - 4), W, 1);

  // beat flash frame
  if (a.beat) beatFlash = 1;
  if (beatFlash > 0.02) {
    specCtx.strokeStyle = `hsla(${hue}, 95%, 75%, ${beatFlash})`;
    specCtx.lineWidth = 2;
    specCtx.strokeRect(1, 1, W - 2, H - 2);
    beatFlash *= 0.82;
  }
}

// ── Loop ──
let last = performance.now();
let fpsFrames = 0, fpsTime = 0, time = 0, lowFpsStreak = 0;
let screenshotQueued = false;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  const a = audio.update(dt);
  updateCursor(dt, a);
  world.update(dt, a, participants, {
    reactivity: settings.reactivity,
    hue: settings.hue,
    attract: settings.attract,
    colorMode: settings.colorMode,
    pattern: settings.pattern,
    shape: settings.shape,
    hdr: settings.hdr,
    time,
  });
  composer.render();

  // PNG export must happen in the same frame as the render (no preserveDrawingBuffer)
  if (screenshotQueued) {
    screenshotQueued = false;
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `soundworlds-${world.name.toLowerCase()}-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  drawSpectrum(a);

  // panel readouts + bloom auto-degrade on sustained low fps
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    const fps = Math.round(fpsFrames / fpsTime);
    $('fps').textContent = fps;
    fpsFrames = 0; fpsTime = 0;
    lowFpsStreak = fps < 42 ? lowFpsStreak + 1 : 0;
    if (lowFpsStreak >= 8 && bloomPass.enabled) {
      if (bloomPass.strength > 0.45) {
        bloomPass.strength *= 0.5;
      } else {
        bloomPass.enabled = false;
      }
      $('bloom-val').textContent = bloomPass.enabled ? bloomPass.strength.toFixed(1) + ' (auto)' : 'off (auto)';
      lowFpsStreak = 0;
    }
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
