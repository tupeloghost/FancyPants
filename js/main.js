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
import { Net, PALETTE } from './net.js';
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
let currentWorldKey = 'tunnel';
function switchWorld(key) {
  if (world) world.dispose();
  currentWorldKey = key;
  if (window.__touchSteer) { window.__touchSteer.x = 0; window.__touchSteer.y = 0; }
  zoom = zoomTarget = 1;   // never carry a pinch into a new world
  pan.x = pan.y = 0;
  if (window.__setFigure) window.__setFigure(null); // cleared first; worlds opt back in during init
  world = WORLDS[key].create();
  world.init(scene, camera);
  // only show controls this world actually implements — no dead buttons
  const caps = world.options || [];
  $('opt-pattern').style.display = caps.includes('pattern') ? '' : 'none';
  $('opt-shape').style.display = caps.includes('shape') ? '' : 'none';
  $('opt-balls').style.display = caps.includes('balls') ? '' : 'none';
  document.querySelectorAll('.wchip').forEach(b => b.classList.toggle('on', b.dataset.key === key));
  if (window.__applyWorldBloom) window.__applyWorldBloom(key); // world's bloom default (or your remembered tweak)
  showWorldIntro(key); // nobody should ever wonder what this world wants
  net.sendWorld(key); // no-op unless we're the connected host
}

// ── Panel wiring ──
const $ = id => document.getElementById(id);
const panel = $('panel');

$('panel-head').addEventListener('click', () => panel.classList.toggle('collapsed'));

// mobile: swipe down on the sheet (from its top, not mid-scroll) to dismiss
if (IS_MOBILE) {
  let sheetY0 = 0, sheetScroll0 = 0, sheetTracking = false;
  panel.addEventListener('touchstart', e => {
    sheetY0 = e.touches[0].clientY;
    sheetScroll0 = panel.scrollTop;
    sheetTracking = true;
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (!sheetTracking) return;
    const dy = e.touches[0].clientY - sheetY0;
    if (dy > 55 && sheetScroll0 <= 0 && panel.scrollTop <= 0) {
      panel.classList.add('collapsed');
      sheetTracking = false;
    }
  }, { passive: true });
}

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

// world select (hidden element keeps URL/param plumbing) + visible chip grid
for (const [key, w] of Object.entries(WORLDS)) {
  const opt = document.createElement('option');
  opt.value = key; opt.textContent = w.label;
  $('world-select').appendChild(opt);

  const b = document.createElement('button');
  b.className = 'wchip'; b.dataset.key = key; b.textContent = w.label;
  b.addEventListener('click', () => { $('world-select').value = key; switchWorld(key); });
  $('world-chips').appendChild(b);
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

// ── Suno: paste a song link, we stream it through our relay so the
// analyser can actually see the audio (CORS) ──
const SUNO_PROXY = window.FANCYPANTS_HOST ? `https://${window.FANCYPANTS_HOST}/` : '';
// suno gives out two link shapes: the long song page (…/song/<uuid>) and the
// short share link (…/s/<code>). Take either — the worker resolves the short
// one by following it to the song.
function sunoPathFrom(text) {
  const t = String(text).trim();
  const uuid = t.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (uuid) return `suno/${uuid[0]}.mp3`;
  const short = t.match(/suno\.com\/s\/([A-Za-z0-9_-]{4,40})/);
  if (short) return `suno-s/${short[1]}.mp3`;
  return null;
}
function sunoSay(msg, kind) {
  const st = $('suno-status');
  st.textContent = msg || '';
  st.className = kind || '';
}
let sunoLoading = null;
function loadSuno() {
  const el = $('suno-input');
  if (!el.value.trim()) return;
  const path = sunoPathFrom(el.value);
  if (!path || !SUNO_PROXY) {
    // leave what they pasted alone — wiping it looks like paste is broken
    el.classList.add('bad');
    setTimeout(() => el.classList.remove('bad'), 1400);
    sunoSay("that doesn't look like a suno link", 'err');
    return;
  }
  if (sunoLoading === path) return;      // don't re-fire on the same link
  sunoLoading = path;
  el.classList.remove('bad');
  sunoSay('looking it up…');
  // ask the relay what the track is before playing it: that gives us the
  // title and artist, and turns a dead link into an honest error
  const token = path.replace(/^suno-s\//, '').replace(/^suno\//, '').replace(/\.mp3$/, '');
  fetch(`${SUNO_PROXY}suno-meta/${token}`)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('no song'))))
    .then(info => {
      if (!info.id) throw new Error('no song');
      sunoTrack = [info.title, info.artist].filter(Boolean).join(' — ') || 'a suno track';
      sunoSay(sunoTrack, 'ok');
      audio.loadURL(`${SUNO_PROXY}suno/${info.id}.mp3`);
      $('track-select').value = '';
      audio.play().catch(() => {});
      updatePlayBtn();
      el.select();   // leave the link in place, selected, ready to be replaced
    })
    .catch(() => {
      sunoLoading = null;
      sunoTrack = '';
      sunoSay("couldn't find that song — use the Share link from Suno", 'err');
    });
}
let sunoTrack = '';   // what's playing, for the guests' now-playing line
$('suno-go').addEventListener('click', () => { sunoLoading = null; loadSuno(); });
$('suno-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadSuno(); });
$('suno-input').addEventListener('paste', () => setTimeout(loadSuno, 60));
// catch every other way text can arrive (long-press paste, drag, dictation,
// autofill) — settle briefly so we read the finished value, not a keystroke
let sunoTypeT = 0;
$('suno-input').addEventListener('input', () => {
  sunoLoading = null;
  clearTimeout(sunoTypeT);
  if (sunoPathFrom($('suno-input').value)) sunoTypeT = setTimeout(loadSuno, 350);
});
$('suno-input').addEventListener('drop', () => setTimeout(loadSuno, 60));

function updatePlayBtn() {
  $('btn-play').textContent = audio.playing ? '⏸' : '▶';
}
$('btn-play').addEventListener('click', () => {
  audio.playing ? audio.pause() : audio.play().catch(() => {});
  updatePlayBtn();
});
audio.el.addEventListener('play', updatePlayBtn);
audio.el.addEventListener('pause', updatePlayBtn);

// ── song sync: the host's music follows everyone into the room ──
// host: announce the current track + position on any change and every 4s
function hostSong() {
  const src = audio.el.src || '';
  const i = src.indexOf('audio/');
  let share = '';
  if (i !== -1) share = src.slice(i);                       // built-in track
  else if (SUNO_PROXY && src.startsWith(SUNO_PROXY)) share = src; // suno relay URL works for everyone
  if (!share) return; // local files exist only on the host's disk — can't sync
  net.sendSong(share, audio.currentTime, audio.playing, sunoTrack);
}
setInterval(() => { hostSong(); net.sendWorld(currentWorldKey); }, 4000);
audio.el.addEventListener('play', hostSong);
audio.el.addEventListener('pause', hostSong);
audio.el.addEventListener('seeked', hostSong);

// joiner: follow whatever the host plays
net.onSong = s => {
  if (!s || !s.url) return;
  const isSuno = SUNO_PROXY && s.url.startsWith(SUNO_PROXY);
  if (!s.url.startsWith('audio/') && !isSuno) return;
  if (!(audio.el.src || '').endsWith(s.url)) {
    audio.loadURL(s.url);
    $('track-select').value = isSuno ? '' : s.url;
  }
  $('guest-track').textContent = isSuno
    ? (s.title ? `${s.title} — picked by the host` : 'a suno track — picked by the host')
    : decodeURIComponent(s.url.split('/').pop()).replace(/\.\w+$/, '').replace(/_/g, ' ') + ' — picked by the host';
  const apply = () => {
    if (Math.abs(audio.currentTime - s.pos) > 2) audio.seek(s.pos);
    if (s.playing && !audio.playing) audio.play().catch(showTapToPlay);
    if (!s.playing && audio.playing) audio.pause();
    updatePlayBtn();
  };
  if (audio.el.readyState >= 1) apply();
  else audio.el.addEventListener('loadedmetadata', apply, { once: true });
};

// guest: follow the host between worlds
net.onWorld = key => {
  if (WORLDS[key] && key !== currentWorldKey) {
    $('world-select').value = key;
    switchWorld(key);
  }
};

// phones block audio that doesn't start from a tap — offer the tap
let tapPlayBtn = null;
function showTapToPlay() {
  if (tapPlayBtn) return;
  tapPlayBtn = document.createElement('button');
  tapPlayBtn.textContent = '▶ tap to join the music';
  Object.assign(tapPlayBtn.style, {
    position: 'fixed', left: '50%', bottom: '18%', transform: 'translateX(-50%)',
    zIndex: 60, padding: '14px 26px', borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(10,12,24,0.75)',
    color: '#fff', font: '600 16px system-ui', backdropFilter: 'blur(8px)',
  });
  tapPlayBtn.addEventListener('click', () => {
    audio.play().catch(() => {});
    updatePlayBtn();
    tapPlayBtn.remove(); tapPlayBtn = null;
  });
  document.body.appendChild(tapPlayBtn);
}

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
// per-world bloom defaults — TRAIL runs nearly clean so its colors read
// true; every world still obeys the slider, and manual tweaks are
// remembered per world for the session.
const WORLD_BLOOM = { trail: 0.15, paint: 0.1 };  // a paper plate must not bloom
const userBloom = {};
let bloomBase = 0.7;
function applyBloom(v) { // v in slider units (0-300)
  bloomBase = v / 100;
  bloomPass.strength = bloomBase;
  bloomPass.enabled = v > 0;
  $('bloom').value = v;
  $('bloom-val').textContent = (v / 100).toFixed(1);
  setFill($('bloom'));
}
slider('bloom', 'bloom-val', v => (v / 100).toFixed(1), v => {
  userBloom[currentWorldKey] = v; // this world, your way
  applyBloom(v);
});
window.__applyWorldBloom = key => applyBloom(userBloom[key] ?? (WORLD_BLOOM[key] ?? 0.7) * 100);

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
    if (document.body.classList.contains('guest')) return; // host drives the music
    audio.playing ? audio.pause() : audio.play().catch(() => {});
    updatePlayBtn();
  }
});

const aim = { x: 0, y: 0 };   // last pointer position in clip space

// ── Drag to shove the view about (worlds opt in with world.pannable) ──
const pan = { x: 0, y: 0 };
let dragging = false, dragPX = 0, dragPY = 0;
canvas.addEventListener('pointerdown', e => { dragging = true; dragPX = e.clientX; dragPY = e.clientY; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointercancel', () => { dragging = false; });
window.addEventListener('pointermove', e => {
  if (!dragging || !world || !world.pannable) return;
  // scale the shove to how tight the framing is, so it feels the same zoomed
  const k = camera.fov * 0.0016;
  pan.x -= (e.clientX - dragPX) * k;
  pan.y += (e.clientY - dragPY) * k;
  const lim = 40;
  pan.x = Math.max(-lim, Math.min(lim, pan.x));
  pan.y = Math.max(-lim, Math.min(lim, pan.y));
  dragPX = e.clientX; dragPY = e.clientY;
});

// pointer steering (interactive mode) — mouse maps screen position directly
function steerFromPointer(cx, cy) {
  aim.x = (cx / window.innerWidth) * 2 - 1;
  aim.y = -((cy / window.innerHeight) * 2 - 1);
  if (settings.attract || !world || !world.setInput) return;
  world.setInput((cx / window.innerWidth) * 2 - 1, -((cy / window.innerHeight) * 2 - 1));
}
window.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return; // touch steers by dragging, below
  steerFromPointer(e.clientX, e.clientY);
});

// ── Pinch to zoom: the viewer frames the shot, not the world ──
// worlds keep driving camera.fov; this is a multiplier applied after them.
let zoom = 1;                       // 1 = as the world intends
let zoomTarget = 1;                 // eased toward, so nothing ever jumps
const clampZoom = z => Math.max(0.4, Math.min(1.6, z));
let pinchStart = 0, pinchZoom0 = 1;
const pinchDist = e => {
  const [a, b] = [e.touches[0], e.touches[1]];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
};
canvas.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    pinchStart = pinchDist(e);
    pinchZoom0 = zoomTarget;
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    aim.x = (mx / window.innerWidth) * 2 - 1;
    aim.y = -((my / window.innerHeight) * 2 - 1);
  }
}, { passive: true });
canvas.addEventListener('touchmove', e => {
  if (e.touches.length !== 2 || !pinchStart) return;
  // spread fingers = zoom in = narrower field of view
  zoomTarget = clampZoom(pinchZoom0 * (pinchStart / pinchDist(e)));
  showZoom();
}, { passive: true });
canvas.addEventListener('touchend', e => { if (e.touches.length < 2) pinchStart = 0; }, { passive: true });
// desktop gets the same control on the scroll wheel — gently, and never
// stealing the browser's own ctrl/cmd-zoom
canvas.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) return;         // that one belongs to the browser
  e.preventDefault();
  aim.x = (e.clientX / window.innerWidth) * 2 - 1;
  aim.y = -((e.clientY / window.innerHeight) * 2 - 1);
  zoomTarget = clampZoom(zoomTarget * (1 + Math.sign(e.deltaY) * 0.025));
  showZoom();
}, { passive: false });

// double-click (or double-tap) puts the framing back where the world wants it
let zoomHideT = 0;
function showZoom() {
  const el = $('zoom-badge');
  el.textContent = (1 / zoom).toFixed(2).replace(/\.?0+$/, '') + '\u00d7';
  el.classList.add('on');
  clearTimeout(zoomHideT);
  zoomHideT = setTimeout(() => el.classList.remove('on'), 1100);
}
canvas.addEventListener('dblclick', () => { zoomTarget = 1; pan.x = pan.y = 0; showZoom(); });
let lastTapT = 0;
canvas.addEventListener('touchend', e => {
  if (e.touches.length) return;
  const now = performance.now();
  if (now - lastTapT < 300) { zoomTarget = 1; pan.x = pan.y = 0; showZoom(); }   // double-tap resets
  lastTapT = now;
}, { passive: true });

// touch steering — drag-relative, so repeated swipes keep carrying you and a
// portrait phone can steer the full range without reaching for landscape.
// Worlds where x IS an angle get unbounded x (keep swiping = keep circling).
const FULL_TURN = new Set(['slinky']);
const touchSteer = { x: 0, y: 0, lastX: 0, lastY: 0, active: false, lastT: 0 };
window.__touchSteer = touchSteer; // world switcher resets accumulated steer
canvas.addEventListener('touchstart', e => {
  if (!e.touches[0]) return;
  touchSteer.active = true;
  touchSteer.lastX = e.touches[0].clientX;
  touchSteer.lastY = e.touches[0].clientY;
}, { passive: true });
window.addEventListener('touchend', () => { touchSteer.active = false; });

// click/tap interaction — part of the world contract, works in both modes
let clickPulse = 0;
let pointerHeld = false;
// long-press is hold-to-nitro etc., never a context menu / magnifier
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('pointerup', () => pointerHeld = false);
window.addEventListener('pointercancel', () => pointerHeld = false);
// mobile: a tap outside the open panel just tucks the panel away.
// touchstart is the most reliable first event on iOS — catch it there and
// swallow the matching pointerdown so the tap doesn't leak into the world.
let sheetDismissedThisTap = false;
function sheetIsOpen() {
  return !panel.classList.contains('collapsed') && !panel.classList.contains('hidden');
}
canvas.addEventListener('touchstart', () => {
  if (sheetIsOpen()) {
    panel.classList.add('collapsed');
    sheetDismissedThisTap = true;
  }
}, { passive: true });

let tapResetTimer = 0;
canvas.addEventListener('pointerdown', e => {
  if (sheetDismissedThisTap) { sheetDismissedThisTap = false; return; }
  if (e.pointerType === 'touch' && sheetIsOpen()) {
    panel.classList.add('collapsed');
    return;
  }
  pointerHeld = true;
  clickPulse = 1; // global color surge: every click makes the whole frame answer
  spawnRipple(e.clientX, e.clientY);
  // broadcast the tap — everyone's world feels it, not just ours
  net.local.action = 'tap';
  clearTimeout(tapResetTimer);
  tapResetTimer = setTimeout(() => { if (net.local.action === 'tap') net.local.action = 'idle'; }, 250);
  if (!world || !world.onTap) return;
  world.onTap((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
});

// ── Scoring: worlds award points; your score rides the state blob ──
let score = 0;
function addScore(n, x, y) {
  if (settings.attract) return; // watching earns nothing
  score += n;
  net.local.score = score;
  const badge = $('score-badge');
  badge.classList.remove('hidden');
  $('score-val').textContent = score;
  badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
}

// points buy standing: a rank everyone in the room can see
export const RANKS = [0, 120, 350, 800, 1600];
export function rankOf(score) {
  let r = 0;
  for (let i = 1; i < RANKS.length; i++) if ((score || 0) >= RANKS[i]) r = i;
  return r;
}
const RANK_MARK = ['', '\u2022', '\u2022\u2022', '\u2666', '\u2666\u2666'];

// standings: always on screen, no keyboard needed — phones can see it too
function renderStandings() {
  const box = $('standings');
  const ranked = [...participants].sort((a, b) => (b.score || 0) - (a.score || 0));
  const anyScore = ranked.some(p => (p.score || 0) > 0);
  if (!anyScore && ranked.length < 2) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = '';
  for (const p of ranked.slice(0, 6)) {
    const row = document.createElement('div');
    row.className = 'st' + (p.local ? ' me' : '');
    const mark = RANK_MARK[rankOf(p.score)] || '';
    row.innerHTML = `<span class="rk">${mark}</span><span class="nm"></span><span class="pt">${p.score || 0}</span>`;
    row.querySelector('.nm').textContent = p.name || '—';
    box.appendChild(row);
  }
}
setInterval(renderStandings, 600);

// a world can name what's on its easel and how far along it is
window.__setFigure = (name, done, total) => {
  const el = $('figure-label');
  if (!name) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('fig-name').textContent = name;
  $('fig-progress').textContent = `${done} / ${total}`;
};

// ── World intro: name + the one line that explains the whole game ──
let introTimer = 0;
function showWorldIntro(key) {
  const w = WORLDS[key];
  if (!w) return;
  const el = $('world-intro');
  $('intro-name').textContent = w.label;
  $('intro-goal').textContent = w.goal || '';
  el.classList.toggle('long', (w.label || '').length > 10);
  el.classList.remove('gone');
  clearTimeout(introTimer);
  introTimer = setTimeout(() => el.classList.add('gone'), 4200);
}

// someone else tapped: their click lands in OUR world too, in their color
net.onRemoteTap = p => {
  clickPulse = Math.max(clickPulse, 0.6);
  const sx = ((p.x || 0) + 1) / 2 * window.innerWidth;
  const sy = (1 - ((p.y || 0) + 1) / 2) * window.innerHeight;
  spawnRipple(sx, sy, PALETTE[p.color % PALETTE.length]);
  if (world && world.onTap) world.onTap(p.x || 0, p.y || 0);
};

// ── Custom cursor: glowing reticle, lerps to the pointer, pulses with the beat ──
const cursorEl = $('cursor');
const cursor = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2, scale: 1 };
window.addEventListener('pointermove', e => {
  cursor.tx = e.clientX; cursor.ty = e.clientY;
  cursorEl.classList.add('live');
});
window.addEventListener('pointerleave', () => cursorEl.classList.remove('live'));

function spawnRipple(x, y, colorHex) {
  const r = document.createElement('div');
  r.className = 'cursor-ripple';
  r.style.transform = '';
  r.style.left = x + 'px'; r.style.top = y + 'px';
  if (colorHex != null) {
    const c = '#' + colorHex.toString(16).padStart(6, '0');
    r.style.borderColor = c;
    r.style.boxShadow = `0 0 18px ${c}`;
  }
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
  const t = e.touches[0];
  if (!t || !touchSteer.active) return;
  if (settings.attract || !world || !world.setInput) return;
  // one full-screen swipe ≈ the full steering range; keep swiping for more
  touchSteer.x += ((t.clientX - touchSteer.lastX) / window.innerWidth) * 2.4;
  touchSteer.y += (-(t.clientY - touchSteer.lastY) / window.innerHeight) * 2.4;
  touchSteer.y = Math.max(-1, Math.min(1, touchSteer.y));
  if (!FULL_TURN.has(currentWorldKey)) touchSteer.x = Math.max(-1, Math.min(1, touchSteer.x));
  touchSteer.lastX = t.clientX; touchSteer.lastY = t.clientY;
  touchSteer.lastT = performance.now();
  world.setInput(touchSteer.x, touchSteer.y);
}, { passive: true });

// tilt steering on mobile (interactive mode) — yields to active drag steering
window.addEventListener('deviceorientation', e => {
  if (settings.attract || !world || !world.setInput || e.gamma == null) return;
  if (touchSteer.active || performance.now() - touchSteer.lastT < 2500) return;
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
  showWorldIntro(currentWorldKey); // the greeting belongs AFTER the join card, not behind it
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
  $('room-badge').dataset.url = location.host.includes('localhost')
    ? '' : location.host + location.pathname.replace(/\/$/, '');
  $('room-badge').classList.remove('hidden');
  net.onReject = () => { tap.classList.remove('gone'); $('join-msg').textContent = 'pick another name'; };
  net.join(code, name, asOwner); // no host configured → runs solo, silently
  // guests ride the host's soundtrack — no track/transport controls for them
  document.body.classList.toggle('guest', !asOwner);
  dismissOverlay();
  updateURL();
}
$('join-name').value = localStorage.getItem('fp_name') || '';
$('join-room').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
$('join-room').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
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
  const ranked = [...participants].sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const p of ranked) {
    const row = document.createElement('div');
    row.className = 'plist-row' + (presence.hiddenNames.has(p.name) ? ' muted' : '');
    row.innerHTML = `<span>${p.name}${p.local ? ' ·you' : ''}</span><span>${p.score || 0}</span>`;
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
    holding: pointerHeld,
    time,
    addScore,
  });

  // the viewer's pinch/wheel trim, applied over whatever the world asked for,
  // plus a nudge wider in portrait so phones aren't looking through a straw
  {
    zoom += (zoomTarget - zoom) * Math.min(1, dt * 6);   // glide, never jump
    const portrait = camera.aspect < 1 ? 1 + (1 - camera.aspect) * 0.34 : 1;
    const want = Math.max(18, Math.min(125, camera.fov * zoom * portrait));
    if (Math.abs(want - camera.fov) > 0.01) {
      camera.fov = want;
      camera.updateProjectionMatrix();
    }
    // zooming in should approach what you're pointing at, not the centre
    if (zoom < 0.995) {
      const lean = (1 - zoom) * 26;
      camera.translateX(aim.x * lean);
      camera.translateY(aim.y * lean);
    }
    if (world && world.pannable && (pan.x || pan.y)) {
      camera.translateX(pan.x);
      camera.translateY(pan.y);
    }
  }

  updateDust(dt, a, time);

  // ghosts render through the same path in every world
  presence.update(dt, participants,
    world.placeGhost ? world.placeGhost.bind(world) : (p, i, out) => out.set(p.x, p.y, p.z),
    { beatIntensity: a.beatIntensity, time, camera });

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
