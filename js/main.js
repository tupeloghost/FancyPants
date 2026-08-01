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
import { Net } from './net.js';
import { Presence } from './lib/presence.js';
import { glowTexture } from './lib/glow.js';

// ── Renderer ──
const canvas = document.getElementById('canvas');
const IS_MOBILE = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE, powerPreference: 'high-performance' });

renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000208);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

// post-processing: render → bloom → output
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), IS_MOBILE ? 0.5 : 0.7, 0.3, 0.5
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

// ── Net + presence: participants come from the net layer ──
const net = new Net();
const participants = net.participants;
if (!net.local.name) net.local.name = 'you';
const presence = new Presence();
presence.init(scene);
net.onJoin = () => audio.joinChime();
window.__net = net; window.__presence = presence; // debug handles

// ── Global stardust: twinkling dust + shooting stars around the camera,
// world-agnostic so the dust toggle works everywhere ──
const DUST_N = 420, DUST_R = 150;
let dust, dustMeteors = [];
{
  const pos = new Float32Array(DUST_N * 3);
  const col = new Float32Array(DUST_N * 3);
  for (let i = 0; i < DUST_N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * DUST_R * 2;
    pos[i * 3 + 1] = (Math.random() - 0.5) * DUST_R * 2;
    pos[i * 3 + 2] = (Math.random() - 0.5) * DUST_R * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  dust = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.7, map: glowTexture(), transparent: true, vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  dust.frustumCulled = false;
  scene.add(dust);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 7),
      new THREE.MeshBasicMaterial({
        toneMapped: false, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    m.visible = false;
    m.userData = { vel: new THREE.Vector3(), t: 0 };
    scene.add(m);
    dustMeteors.push(m);
  }
}

function updateDust(dt, a, time) {
  dust.visible = settings.stardust;
  if (!dust.visible) { dustMeteors.forEach(m => m.visible = false); return; }
  const pos = dust.geometry.attributes.position;
  const col = dust.geometry.attributes.color;
  const cp = camera.position;
  const frame = Math.floor(time * 24);
  for (let i = 0; i < DUST_N; i++) {
    // wrap the cloud around the camera on all three axes
    for (let ax = 0; ax < 3; ax++) {
      const get = ax === 0 ? pos.getX : ax === 1 ? pos.getY : pos.getZ;
      const set = ax === 0 ? pos.setX : ax === 1 ? pos.setY : pos.setZ;
      const c = ax === 0 ? cp.x : ax === 1 ? cp.y : cp.z;
      let v = get.call(pos, i);
      if (v > c + DUST_R) v -= DUST_R * 2;
      else if (v < c - DUST_R) v += DUST_R * 2;
      set.call(pos, i, v);
    }
    const tw = Math.abs(Math.sin(i * 12.9898 + frame * 78.233));
    if (tw > 0.94) {
      const heat = 0.7 + a.volume * 0.7 + (tw - 0.94) * 9;
      col.setXYZ(i, heat * 0.85, heat * 0.9, heat);
    } else {
      col.setXYZ(i, 0.02, 0.025, 0.04);
    }
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  dust.material.size = 0.6 + a.volume * 0.4;

  // shooting stars streak past the camera on loud moments
  if (Math.random() < dt * (0.15 + a.volume * 1.1 + (a.beat ? 0.6 : 0))) {
    const m = dustMeteors.find(x => !x.visible);
    if (m) {
      m.visible = true;
      m.userData.t = 0;
      m.position.copy(cp).add(new THREE.Vector3(
        (Math.random() - 0.5) * 90, (Math.random() - 0.3) * 60, (Math.random() - 0.5) * 90));
      m.userData.vel.set((Math.random() - 0.5) * 2, -0.5 - Math.random(), (Math.random() - 0.5) * 2)
        .normalize().multiplyScalar(120);
      m.lookAt(m.position.clone().add(m.userData.vel));
    }
  }
  for (const m of dustMeteors) {
    if (!m.visible) continue;
    m.userData.t += dt;
    if (m.userData.t > 1.4) { m.visible = false; continue; }
    m.position.addScaledVector(m.userData.vel, dt);
    m.material.opacity = Math.min(1, (1.4 - m.userData.t) * 1.4) * 0.9;
    m.material.color.setHSL((settings.hue / 360 + 0.05) % 1, 0.3, 0.8);
    m.material.color.multiplyScalar(1.5);
  }
}

// ── Settings (live-tunable via panel) ──
const settings = {
  reactivity: 1.0,
  hue: 210,
  attract: false, // default to PLAY — the world responds to you out of the box
  colorMode: 'rainbow',
  pattern: 'spiral',
  shape: 'slat',
  hdr: 1.0,
  stardust: true,
  balls: 1500,
};

// ── URL params: every knob is shareable ──
{
  const qp = new URLSearchParams(location.search);
  if (qp.get('colors')) settings.colorMode = qp.get('colors');
  if (qp.get('pattern')) settings.pattern = qp.get('pattern');
  if (qp.get('shape')) settings.shape = qp.get('shape');
  if (qp.get('hue')) settings.hue = +qp.get('hue') || 210;
  if (qp.get('dust') === 'off') settings.stardust = false;
  if (qp.get('names') === 'off') window.__namesOff = true;
}

function updateURL() {
  const qp = new URLSearchParams(location.search);
  qp.set('colors', settings.colorMode);
  qp.set('pattern', settings.pattern);
  qp.set('shape', settings.shape);
  qp.set('hue', settings.hue);
  settings.stardust ? qp.delete('dust') : qp.set('dust', 'off');
  history.replaceState(null, '', '?' + qp.toString());
}

// ── World switcher ──
let world = null;
function switchWorld(key) {
  if (world) world.dispose();
  world = WORLDS[key].create();
  world.init(scene, camera);
  // only show controls this world actually implements — no dead buttons
  const caps = world.options || [];
  $('opt-pattern').style.display = caps.includes('pattern') ? '' : 'none';
  $('opt-shape').style.display = caps.includes('shape') ? '' : 'none';
  $('opt-balls').style.display = caps.includes('balls') ? '' : 'none';
}

// ── Panel wiring ──
const $ = id => document.getElementById(id);
const panel = $('panel');

$('panel-head').addEventListener('click', () => panel.classList.toggle('collapsed'));

// tabs: music / style / tune — remembered across sessions
document.querySelectorAll('#tabs .tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('#tabs .tab').forEach(x => x.classList.toggle('on', x === t));
    document.querySelectorAll('.tab-page').forEach(pg =>
      pg.classList.toggle('on', pg.id === 'page-' + t.dataset.tab));
    localStorage.setItem('fp_tab', t.dataset.tab);
  });
});
{
  const saved = localStorage.getItem('fp_tab');
  if (saved) document.querySelector(`#tabs .tab[data-tab="${saved}"]`)?.click();
}

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
$('hue').value = settings.hue;
$('hue-val').textContent = settings.hue;
document.documentElement.style.setProperty('--accent-h', settings.hue);
$('bloom').value = 70;
$('hdr').value = 100;
$('balls').value = 1500;
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
  updateURL();
});
slider('hdr', 'hdr-val', v => (v / 100).toFixed(1), v => settings.hdr = v / 100);
slider('balls', 'balls-val', v => v, v => settings.balls = v);
let bloomBase = 0.7;
slider('bloom', 'bloom-val', v => (v / 100).toFixed(1), v => {
  bloomBase = v / 100;
  bloomPass.strength = bloomBase;
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
  ['__group', 'FOLLOW THE HUE SLIDER'],
  ['rainbow', 'rainbow — full spectrum', 'linear-gradient(90deg,#f43,#fa0,#fe5,#3e6,#2cf,#55f,#c4f)'],
  ['duotone', 'duotone — your hue & its complement', `linear-gradient(90deg,${A},${A2})`],
  ['cycle', 'cycle — colors rotate over time', 'conic-gradient(#f43,#fe5,#3e6,#2cf,#55f,#c4f,#f43)'],
  ['mono', 'mono — one hue', A],
  ['duo', 'duo — hue + complement, hard split', `linear-gradient(90deg,${A} 50%,${A2} 50%)`],
  ['triad', 'triad — three hues', `linear-gradient(90deg,${A} 33%,${A3} 33% 66%,${A2} 66%)`],
  ['pastel', 'pastel — soft & dreamy', 'linear-gradient(90deg,#fbc,#cfe,#dfc,#fec)'],
  ['neon', 'neon — maximum glow', 'linear-gradient(90deg,#f0f,#0ff,#ff0)'],
  ['glitter', 'glitter — sparkles in your hue', `radial-gradient(circle at 30% 40%,#fff 5%,transparent 8%),radial-gradient(circle at 75% 60%,#fff 4%,transparent 7%),linear-gradient(120deg,hsl(var(--accent-h),60%,14%),hsl(var(--accent-h),50%,26%))`],
  ['cosmos', 'cosmos — starfield, nebula in your hue', 'radial-gradient(circle at 25% 30%,#fff 4%,transparent 6%),radial-gradient(circle at 70% 65%,#fff 3%,transparent 5%),linear-gradient(120deg,#103,#527,#215)'],
  ['__group', 'THEMES WITH THEIR OWN COLORS'],
  ['fire', 'fire — flickering flames', 'linear-gradient(0deg,#310,#d30,#fa0,#ff7)'],
  ['ocean', 'ocean — rolling teal swells', 'linear-gradient(90deg,#036,#0af,#0fd,#08c)'],
  ['sunset', 'sunset — orange below, violet above', 'linear-gradient(0deg,#f70,#f36,#a3c)'],
  ['aurora', 'aurora — green curtains, violet night', 'linear-gradient(75deg,#0e5,#3fa,#65f,#0e5)'],
  ['forest', 'forest — canopy & dappled light', 'linear-gradient(90deg,#031,#0a4,#fd6 65%,#0a4)'],
  ['gold', 'gold — polished metal shine', 'linear-gradient(105deg,#640,#fc3,#fff,#fc3,#640)'],
  ['candy', 'candy — glossy cane stripes', 'repeating-linear-gradient(45deg,#f6a 0 5px,#fff 5px 9px,#4de 9px 14px,#fd4 14px 18px)'],
  ['vapor', 'vapor — pink & cyan haze', 'linear-gradient(90deg,#f9c,#8df,#caf,#fac)'],
  ['midnight', 'midnight — deep blues', 'linear-gradient(90deg,#124,#36c,#89b,#236)'],
  ['coral', 'coral — warm reef tones', 'linear-gradient(90deg,#f75,#fa8,#4cb,#f86)'],
  ['random', 'random — confetti', 'conic-gradient(#f43 0 14%,#2cf 0 32%,#fe5 0 47%,#c4f 0 66%,#3e6 0 82%,#f70 0)'],
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

// modes where the theme brings its own palette — the hue slider is moot
const HUE_LOCKED = new Set(['fire', 'ocean', 'sunset', 'aurora', 'forest', 'gold',
                            'candy', 'vapor', 'midnight', 'coral', 'random']);
function refreshHueLock() {
  $('hue-row').classList.toggle('locked', HUE_LOCKED.has(settings.colorMode));
}

function buildChips(containerId, items, isGlyph, apply, initial, nameId) {
  const box = $(containerId);
  for (const item of items) {
    if (item[0] === '__group') {
      const gl = document.createElement('div');
      gl.className = 'chip-group';
      gl.textContent = item[1];
      box.appendChild(gl);
      continue;
    }
    const [id, label, visual] = item;
    const c = document.createElement('div');
    c.className = 'chip' + (id === initial ? ' on' : '');
    c.dataset.id = id;
    c.title = label;
    if (isGlyph) c.innerHTML = visual;
    else c.style.background = visual;
    c.addEventListener('click', () => {
      box.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
      if (nameId) $(nameId).textContent = label.split(' — ')[0];
      apply(id);
    });
    box.appendChild(c);
    if (nameId && id === initial) $(nameId).textContent = label.split(' — ')[0];
  }
}
buildChips('color-chips', COLOR_MODES, false, v => { settings.colorMode = v; refreshHueLock(); updateURL(); }, settings.colorMode, 'color-name');
// each pattern brings the element shape it needs: polka dots ARE circles,
// checker tiles ARE squares. You can still override shape afterward.
const PATTERN_SHAPES = {
  polka: 'circle', checker: 'square', kaleido: 'diamond',
  paisley: 'circle', spiral: 'slat', stripes: 'slat', plaid: 'slat', waves: 'slat',
};
buildChips('pattern-chips', PATTERNS, false, v => {
  settings.pattern = v;
  const sh = PATTERN_SHAPES[v];
  if (sh) {
    settings.shape = sh;
    setChipActive('shape-chips', sh);
    $('shape-name').textContent = sh;
  }
  updateURL();
}, settings.pattern, 'pattern-name');
buildChips('shape-chips', SHAPES, true, v => { settings.shape = v; updateURL(); }, settings.shape, 'shape-name');
refreshHueLock();

function setChipActive(boxId, id) {
  $(boxId).querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.id === id));
}

function setHue(v) {
  settings.hue = v;
  $('hue').value = v;
  $('hue-val').textContent = v;
  setFill($('hue'));
  document.documentElement.style.setProperty('--accent-h', v);
}

// ── preset looks: one click sets the whole vibe ──
const PRESETS = [
  ['Deep Space',      { colorMode: 'cosmos',  pattern: 'spiral',  shape: 'circle',  hue: 230 }],
  ['Amethyst Glitter',{ colorMode: 'glitter', pattern: 'spiral',  shape: 'slat',    hue: 285 }],
  ['Candy Shop',      { colorMode: 'candy',   pattern: 'polka',   shape: 'circle',  hue: 330 }],
  ['Molten',          { colorMode: 'fire',    pattern: 'waves',   shape: 'slat',    hue: 20 }],
  ['Aurora Night',    { colorMode: 'aurora',  pattern: 'stripes', shape: 'slat',    hue: 150 }],
  ['Gold Rush',       { colorMode: 'gold',    pattern: 'kaleido', shape: 'diamond', hue: 45 }],
  ['Ocean Drift',     { colorMode: 'ocean',   pattern: 'waves',   shape: 'circle',  hue: 190 }],
  ['Rainbow Road',    { colorMode: 'rainbow', pattern: 'checker', shape: 'square',  hue: 210 }],
];
{
  const box = $('preset-chips');
  for (const [name, cfg] of PRESETS) {
    const c = document.createElement('div');
    c.className = 'chip chip-preset';
    c.textContent = name;
    c.style.background = `linear-gradient(120deg, hsla(${cfg.hue}, 70%, 30%, 0.9), hsla(${cfg.hue}, 80%, 14%, 0.9))`;
    c.addEventListener('click', () => {
      settings.colorMode = cfg.colorMode;
      settings.pattern = cfg.pattern;
      settings.shape = cfg.shape;
      setHue(cfg.hue);
      setChipActive('color-chips', cfg.colorMode);
      setChipActive('pattern-chips', cfg.pattern);
      setChipActive('shape-chips', cfg.shape);
      $('color-name').textContent = cfg.colorMode;
      $('pattern-name').textContent = cfg.pattern;
      $('shape-name').textContent = cfg.shape;
      refreshHueLock();
      updateURL();
    });
    box.appendChild(c);
  }
}

// stardust toggle
$('btn-stardust').classList.toggle('on', settings.stardust);
$('btn-stardust').addEventListener('click', () => {
  settings.stardust = !settings.stardust;
  $('btn-stardust').classList.toggle('on', settings.stardust);
  updateURL();
});

// hotkeys
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'h' || e.key === 'H') panel.classList.toggle('hidden');
  if (e.key === 'b' || e.key === 'B') {
    // broadcast mode: clean frame, wider camera, crowd-first
    settings.broadcast = !settings.broadcast;
    panel.classList.toggle('hidden', settings.broadcast);
  }
  if (e.key === 'n' || e.key === 'N') presence.namesVisible = !presence.namesVisible; // instant
  if (e.key === 'p' || e.key === 'P') { $('plist').classList.toggle('hidden'); renderPlist(); }
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
let clickPulse = 0;
canvas.addEventListener('pointerdown', e => {
  clickPulse = 1; // global color surge: every click makes the whole frame answer
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

// ── Join flow ──
const tap = $('tap-to-start');
const ROOM_CHARS = 'ACDEFGHJKMNPQRTUVWXYZ2346789'; // no O/0, I/1, ambiguous glyphs
const genCode = () => Array.from({ length: 4 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('');
const validName = n => /^[a-zA-Z0-9_]{3,14}$/.test(n);

$('join-name').value = net.local.name === 'you' ? '' : net.local.name;

function dismissOverlay() {
  audio.ensureContext();
  tap.classList.add('gone');
  // iOS: tilt controls need explicit permission, and the request must come
  // from a user gesture — this tap is our one chance
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
  // phones: start with the panel collapsed — the world is the point
  if (IS_MOBILE) { panel.classList.remove('hidden'); panel.classList.add('collapsed'); }
}
if (IS_MOBILE) panel.classList.add('hidden'); // hidden behind the join card
function startRoom(code, name, asOwner) {
  if (!validName(name)) { $('join-msg').textContent = 'name: 3-14 letters, numbers, _'; return; }
  net.local.name = name;
  localStorage.setItem('fp_name', name);
  $('room-badge').textContent = code;
  $('room-badge').classList.remove('hidden');
  net.onReject = () => { tap.classList.remove('gone'); $('join-msg').textContent = 'pick another name'; };
  net.join(code, name, asOwner); // no host configured → runs solo, silently
  dismissOverlay();
  updateURL();
}
$('btn-join').addEventListener('click', () => {
  const code = $('join-room').value.trim().toUpperCase();
  if (code.length < 4) { $('join-msg').textContent = 'enter a room code'; return; }
  startRoom(code, $('join-name').value.trim(), false);
});
$('btn-host').addEventListener('click', () => {
  startRoom(genCode(), $('join-name').value.trim() || 'host', true);
});
$('btn-solo').addEventListener('click', () => {
  if ($('join-name').value.trim()) net.local.name = $('join-name').value.trim();
  dismissOverlay();
});
// clicking outside the card still starts solo (the old behavior)
tap.addEventListener('click', e => { if (e.target === tap) dismissOverlay(); });

// URL params (?world=tunnel supported now; room/names reserved for later phases)
const params = new URLSearchParams(location.search);
const startWorld = WORLDS[params.get('world')] ? params.get('world') : 'tunnel';
$('world-select').value = startWorld;
switchWorld(startWorld);

// participants overlay: click a name to kill just that name (they keep playing)
function renderPlist() {
  const box = $('plist-rows');
  box.innerHTML = '';
  for (const p of participants) {
    const row = document.createElement('div');
    row.className = 'plist-row' + (presence.hiddenNames.has(p.name) ? ' muted' : '');
    row.innerHTML = `<span>${p.name}</span><span>${p.local ? 'you' : ''}</span>`;
    row.addEventListener('click', () => {
      presence.hiddenNames.has(p.name) ? presence.hiddenNames.delete(p.name) : presence.hiddenNames.add(p.name);
      renderPlist();
    });
    box.appendChild(row);
  }
}

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

// names=off param + sim mode + auto-join from ?room=
if (window.__namesOff) presence.namesVisible = false;
{
  const qp = new URLSearchParams(location.search);
  const sim = parseInt(qp.get('sim') || '0', 10);
  if (sim > 0) net.simulate(Math.min(sim, 60));
  const room = qp.get('room');
  if (room) $('join-room').value = room.toUpperCase();
}
settings.broadcast = false;

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
  net.update(dt, time);
  updateCursor(dt, a);

  // click color-pulse: hue kicks sideways, saturation and bloom surge, then settle
  clickPulse *= Math.pow(0.03, dt);
  const hueEff = (settings.hue + clickPulse * 40) % 360;
  gradePass.uniforms.saturation.value = 1.45 + clickPulse * 0.55;
  gradePass.uniforms.contrast.value = 1.12 + clickPulse * 0.08;
  if (bloomPass.enabled) bloomPass.strength = bloomBase * (1 + clickPulse * 0.5);

  world.update(dt, a, participants, {
    reactivity: settings.reactivity,
    hue: hueEff,
    attract: settings.attract,
    colorMode: settings.colorMode,
    pattern: settings.pattern,
    shape: settings.shape,
    hdr: settings.hdr,
    stardust: settings.stardust,
    balls: settings.balls,
    time,
  });

  updateDust(dt, a, time);

  // ghosts render through the same path in every world
  presence.update(dt, participants,
    world.placeGhost ? world.placeGhost.bind(world) : (p, i, out) => out.set(p.x, p.y, p.z),
    { beatIntensity: a.beatIntensity, time });

  if (settings.broadcast) {
    // widen to frame the crowd, not the local player
    camera.fov = Math.min(118, camera.fov + 9);
    camera.updateProjectionMatrix();
  }

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
    if (!$('plist').classList.contains('hidden')) renderPlist();
  }
}
requestAnimationFrame(frame);
