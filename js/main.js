// Shared shell: renderer, loop, audio engine, controls panel, world switcher.
// Single-player build — the net layer and participants list are stubbed so
// worlds already code against the final interface.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { AudioEngine } from './audio-engine.js?v=311';
import { drawQR } from './lib/qr.js?v=311';
import { WORLDS } from './worlds/registry.js?v=311';
import { Net, PALETTE } from './net.js?v=311';
import { Presence } from './lib/presence.js?v=311';
import { Pulses } from './lib/pulse.js?v=311';
import { BeatClock } from './lib/beatclock.js?v=311';
import { BeatCue } from './lib/beatcue.js?v=311';
import { analyseTrack, cachedChart } from './lib/analyse.js?v=311';
import { Race, placeOf, standings } from './lib/race.js?v=311';
import { Signals } from './lib/signals.js?v=311';
import { RouteMap } from './lib/map.js?v=311';
import * as sfx from './lib/sfx.js?v=311';
import { TUNE, saveTune, resetTune } from './lib/tune.js?v=311';
import { glowTexture } from './lib/glow.js?v=311';

// ── Renderer ──
const canvas = document.getElementById('canvas');
window.__booted = true;   // the watchdog stands down; the module runs
const IS_MOBILE = matchMedia('(pointer: coarse)').matches;
window.__LITE = IS_MOBILE;   // worlds thin their heaviest layers when set
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE, powerPreference: 'high-performance' });

renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000208);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

// post-processing: render → bloom → output
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// mobile renders bloom at half resolution — the pass is the single biggest
// GPU cost, and glow at half-res is visually indistinguishable on a phone
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth >> (IS_MOBILE ? 1 : 0), window.innerHeight >> (IS_MOBILE ? 1 : 0)),
  IS_MOBILE ? 0.5 : 0.7, 0.3, 0.5
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

// ── session signals: what this body did tonight, world-agnostic ──
const sig = new Signals(() => [net.local.x || 0, net.local.y || 0, net.local.z || 0, net.local.heading || 0]);
window.__sig = sig;
window.__declareSignals = o => sig.declare(o);   // worlds MAY volunteer extras
const participants = net.participants;
if (!net.local.name) net.local.name = 'you';
const presence = new Presence();
presence.init(scene);
const pulses = new Pulses();
pulses.init(scene);
const beatClock = new BeatClock(audio.analyser);
const beatCue = new BeatCue(document.getElementById('beatcue'));
const anchorV = new THREE.Vector3();
const race = new Race();
// every hit in every world plays a note that climbs with your streak; every
// cost is a soft thud. One wiring point, the whole game finds its voice.
let hitStop = 0;
let fovKick = 0;
race.onEvent = (type, d) => {
  if (type === 'hit') {
    sfx.hit(d.streak, d.strong);
    // strong hits stop the world; ordinary ones nick it
    hitStop = Math.max(hitStop, (d.strong ? 0.055 : 0.03) * TUNE.hitstop);
    fovKick = Math.max(fovKick, (d.strong ? 1 : 0.5) * TUNE.punch);
  } else {
    sfx.thud();
    hitStop = Math.max(hitStop, 0.04 * TUNE.hitstop);   // costs land too
  }
};
let seenMissed = 0;   // cue miss counter we have already fed to the race
net.onJoin = () => { if (settings.chime) audio.joinChime(); };
window.__net = net; window.__presence = presence; // debug handles
window.__cam = camera; window.__audio = audio;
window.__world = () => world;
window.__pulses = pulses; window.__scene = scene;
window.__beat = beatClock; window.__cue = beatCue; window.__race = race;

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

let worldShot = null;   // the world's own framing, handed back next frame

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
  chime: true,        // do arrivals announce themselves?
  balls: 4500,
};

// ── URL params: every knob is shareable ──
{
  const qp = new URLSearchParams(location.search);
  if (qp.get('colors')) settings.colorMode = qp.get('colors');
  if (qp.get('pattern')) settings.pattern = qp.get('pattern');
  if (qp.get('shape')) settings.shape = qp.get('shape');
  if (qp.get('hue')) settings.hue = +qp.get('hue') || 210;
  if (qp.get('dust') === 'off') settings.stardust = false;
  if (qp.get('chime') === 'off') settings.chime = false;
  if (qp.get('names') === 'off') window.__namesOff = true;
  // a shared link names a world and a song — the visitor lands inside both
  if (qp.get('world') && WORLDS[qp.get('world')]) window.__shareWorld = qp.get('world');
  if (qp.get('track')) window.__shareTrack = 'audio/' + qp.get('track');
  if (qp.get('suno')) window.__shareSuno = qp.get('suno');
}

function updateURL() {
  const qp = new URLSearchParams(location.search);
  qp.set('colors', settings.colorMode);
  qp.set('pattern', settings.pattern);
  qp.set('shape', settings.shape);
  qp.set('hue', settings.hue);
  settings.stardust ? qp.delete('dust') : qp.set('dust', 'off');
  settings.chime ? qp.delete('chime') : qp.set('chime', 'off');
  history.replaceState(null, '', '?' + qp.toString());
}

// ── World switcher ──
let world = null;
let currentWorldKey = 'tunnel';
// A world change passes through a breath of black. The dip is 200ms down,
// the swap happens in the dark, 200ms back up — and it swallows the new
// world's first-frame build hitch, which is exactly what a hard cut exposes.
let dipT = 0;
function switchWorld(key) {
  // boot must be synchronous — the frame loop cannot meet a null world
  if (!world) { _switchWorldNow(key); return; }
  const fade = $('scene-fade');
  fade.classList.add('dip');
  clearTimeout(dipT);
  dipT = setTimeout(() => {
    _switchWorldNow(key);
    // let one frame render in the dark before lifting
    requestAnimationFrame(() => requestAnimationFrame(() => fade.classList.remove('dip')));
  }, 200);
}

function _switchWorldNow(key) {
  if (world) world.dispose();
  currentWorldKey = key;
  window.__worldKey = key;   // read-only debug handle for tests
  if (window.__sig) window.__sig.enterWorld(key);
  toyRound = null;   // switching worlds mid-song cancels a toy round quietly
  if (window.__touchSteer) { window.__touchSteer.x = 0; window.__touchSteer.y = 0; }
  zoom = zoomTarget = 1;   // never carry a pinch into a new world
  pan.x = pan.y = 0;
  if (window.__setFigure) window.__setFigure(null); // cleared first; worlds opt back in during init
  world = WORLDS[key].create();
  pulses.setGain(WORLDS[key].pulse);   // how much ring this world can carry
  race.setScale(WORLDS[key].feetPerStep);
  race.setMode(WORLDS[key].mode, WORLDS[key].unit);
  // Two different questions, and they were sharing one answer:
  //   `round` — does this world run a round at all? (any rhythm world)
  //   `orb`   — is it played by pressing on the beat? (not CATCH, which is
  //             played with the basket; showing both would be two games at
  //             once, each contradicting the other about what a press does)
  // Conflating them meant a CATCH world silently had no round: the race was
  // reset on entry and never updated, so nothing reached the wire.
  const w = WORLDS[key];
  document.body.classList.toggle('round', !!w.rhythm);
  // `press`: taps are judged against the chart. `orb`: the shared ring canvas
  // is the cue. A world can be pressed without the orb — Slinky draws its cue
  // as light bars on its own staircase, where your eyes already are.
  const pressable = !!w.rhythm && w.mode !== 'CATCH' && w.mode !== 'DODGE';
  document.body.classList.toggle('press', pressable);
  document.body.classList.toggle('orb', pressable && w.cue !== 'world');
  if (!WORLDS[key].rhythm) {
    $('press-hint').classList.remove('show');
    document.body.classList.remove('vibe-card');
    if (!setList) { $('round-intro').classList.remove('show'); setPhase = 'idle'; hideResults(); }
  }
  beatCue.reset();
  startRaceIfReady();
  world.init(scene, camera);
  // only show controls this world actually implements — no dead buttons
  const caps = world.options || [];
  $('opt-pattern').style.display = caps.includes('pattern') ? '' : 'none';
  $('opt-shape').style.display = caps.includes('shape') ? '' : 'none';
  $('opt-balls').style.display = caps.includes('balls') ? '' : 'none';
  document.querySelectorAll('.wchip').forEach(b => b.classList.toggle('on', b.dataset.key === key));
  if (window.__applyWorldBloom) window.__applyWorldBloom(key); // world's bloom default (or your remembered tweak)
  $('guest-world').textContent = WORLDS[key] ? WORLDS[key].label : '';
  // the ball pit's faucet rides along only in the ball pit
  $('balls-quick').classList.toggle('hidden', key !== 'funhouse' || document.body.classList.contains('guest'));
  showWorldIntro(key); // nobody should ever wonder what this world wants
  if (!tap.classList.contains('gone')) { /* still at the front door — no autoplay yet */ }
  else playSignature(key);
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

// world select (hidden element keeps URL/param plumbing) + visible chip grid.
// The grid leads with the showcase pair and this week's guest; the other
// fourteen wait one click behind SEE ALL — a shorter menu reads faster.
window.__pickerInit = () => {
  const front = [...window.__FEATURED_KEYS, window.__WEEK_KEY].filter((k, i, a) => WORLDS[k] && a.indexOf(k) === i);
  const rest = Object.keys(WORLDS).filter(k => !front.includes(k));
  const chips = $('world-chips');
  const mk = (key, extra) => {
    const b = document.createElement('button');
    b.className = 'wchip' + (extra ? ' ' + extra : '');
    b.dataset.key = key;
    b.textContent = WORLDS[key].label + (key === window.__WEEK_KEY ? ' \u2605' : '');
    if (key === window.__WEEK_KEY) b.title = 'world of the week';
    b.addEventListener('click', () => { $('world-select').value = key; switchWorld(key); });
    chips.appendChild(b);
  };
  front.forEach(k => mk(k));
  const more = document.createElement('button');
  more.className = 'wchip'; more.id = 'wchip-more'; more.textContent = 'SEE ALL \u2026';
  more.addEventListener('click', () => {
    more.remove();
    rest.forEach(k => mk(k));
  }, { once: true });
  chips.appendChild(more);
};
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
      trackList.push('audio/' + f);
    }
    // if the room's already running and silent, start the music now
    if (autoWanted && !audio.el.src) playAuto(false);
    // ── today's song: one date-picked track, named at the front door ──
    if (trackList.length) {
      const d = new Date();
      const dayN = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
      const file = trackList[dayN % trackList.length];
      const wkey = Object.keys(WORLD_TRACKS).find(k => 'audio/' + WORLD_TRACKS[k] === file);
      const el = $('today');
      if (el) {
        el.textContent = "today\u2019s song: " + prettyTrack(file)
          + (wkey && WORLDS[wkey] ? ' \u2014 tap to play it in ' + WORLDS[wkey].label : ' \u2014 tap to play it');
        el.classList.remove('hidden');
        el.onclick = () => {
          window.__shareTrack = file;
          if (wkey) window.__shareWorld = wkey;
          $('btn-solo').click();
        };
      }
    }
  })
  .catch(() => {});
// Autoplay: nobody should have to go hunting for audio. When you start
// solo or hosting, a track begins on its own, and the set rolls on when one
// finishes. Any deliberate choice takes over immediately.
let trackList = [];
let autoOrder = [], autoAt = 0;
function shuffled(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
function playAuto(next) {
  if (!trackList.length || document.body.classList.contains('guest')) return;
  window.__sunoShare = null;
  if (!next) {
    const sig = signatureFor(currentWorldKey);
    if (sig && !audio.el.src) {
      audio.loadURL(sig);
      $('track-select').value = sig;
      audio.play().catch(() => {});
      updatePlayBtn();
      return;
    }
  }
  // a shared link's song plays first — the whole point of following the link
  if (window.__shareTrack) {
    const want = window.__shareTrack; window.__shareTrack = null;
    if (trackList.includes(want)) {
      audio.loadURL(want);
      $('track-select').value = want;
      audio.play().catch(() => {});
      updatePlayBtn();
      return;
    }
  }
  if (!autoOrder.length) { autoOrder = shuffled(trackList); autoAt = 0; }
  if (next) autoAt = (autoAt + 1) % autoOrder.length;
  const url = autoOrder[autoAt];
  audio.loadURL(url);
  $('track-select').value = url;
  audio.play().catch(() => {});
  updatePlayBtn();
}
// "back" means the track before this one — but a few seconds in, it means
// start this one again, which is what every music player does.
function playPrev() {
  if (!trackList.length || document.body.classList.contains('guest')) return;
  if (audio.currentTime > 3) { audio.el.currentTime = 0; return; }
  if (!autoOrder.length) { autoOrder = shuffled(trackList); autoAt = 0; }
  autoAt = (autoAt - 1 + autoOrder.length) % autoOrder.length;
  const url = autoOrder[autoAt];
  audio.loadURL(url);
  $('track-select').value = url;
  audio.play().catch(() => {});
  updatePlayBtn();
}
// a tempo lock is only meaningful for the track it was fitted to
// ── Charting ── every track is analysed once, up front, before it can be
// played as a rhythm world. Notes must be on screen ~2s before they are hit,
// which a realtime detector can never provide, and charting up front also
// means every player in a room plays a byte-identical chart.
let chartToken = 0;
let chartProgress = -1;      // -1 idle, 0..1 working
async function chartTrack(url) {
  const mine = ++chartToken;
  beatCue.setChart(null);
  chartProgress = -1;
  if (!url) return;
  const hit = cachedChart(url);
  if (hit) { beatCue.setChart(hit); beatCue.seek(audio.currentTime); startRaceIfReady(); return; }
  chartProgress = 0;
  try {
    const c = await analyseTrack(url, p => { if (mine === chartToken) chartProgress = p; });
    if (mine !== chartToken) return;            // a newer track won the race
    beatCue.setChart(c);
    beatCue.seek(audio.currentTime);
    startRaceIfReady();
  } catch (err) {
    // a source we cannot read (cross-origin stream, blob quirk) — the world
    // still plays, the lane just falls back to the realtime grid
    console.warn('chart failed for', url, err);
  } finally {
    if (mine === chartToken) chartProgress = -1;
  }
}
audio.el.addEventListener('loadstart', () => {
  beatClock.setAnalyser(audio.analyser);
  beatClock.reset();
  beatCue.reset();
  chartTrack(audio.el.currentSrc || audio.el.src);
});
// ── The demo on the round card ──
// A sentence cannot teach timing. This runs the real cue at a steady tempo so
// the player sees a ring arrive and the orb answer before they ever play a note.
const demoCv = $('ri-demo');
const demoCtx = demoCv.getContext('2d');
let demoT = 0, demoFlash = 0;
function drawDemo(dt, hue) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = demoCv.clientWidth, H = demoCv.clientHeight;
  if (!W || !H) return;
  if (demoCv.width !== Math.round(W * dpr)) {
    demoCv.width = Math.round(W * dpr); demoCv.height = Math.round(H * dpr);
  }
  demoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  demoCtx.clearRect(0, 0, W, H);

  const BEAT = 1.15;
  demoT += dt;
  const phase = (demoT % BEAT) / BEAT;        // 0 just after a press
  if (demoT % BEAT < dt) demoFlash = 1;
  demoFlash *= Math.pow(0.02, dt);

  const cx = W / 2, cy = H / 2;
  const rOrb = Math.min(W, H) * 0.19;
  const rFar = Math.min(W, H) * 0.46;

  // the ring closing in — the same linear approach the real cue uses
  const u = 1 - phase;
  const r = rOrb + u * (rFar - rOrb);
  demoCtx.strokeStyle = `hsla(${hue}, 85%, ${64 + phase * 24}%, ${(0.3 + phase * 0.6).toFixed(3)})`;
  demoCtx.lineWidth = 2 + phase * 2;
  demoCtx.beginPath(); demoCtx.arc(cx, cy, r, 0, Math.PI * 2); demoCtx.stroke();

  // the orb answering
  const g = demoCtx.createRadialGradient(cx, cy, 0, cx, cy, rOrb * (2 + demoFlash));
  g.addColorStop(0, `hsla(${hue}, 90%, 84%, ${(0.24 + demoFlash * 0.45).toFixed(3)})`);
  g.addColorStop(1, `hsla(${hue}, 90%, 80%, 0)`);
  demoCtx.fillStyle = g;
  demoCtx.beginPath(); demoCtx.arc(cx, cy, rOrb * (2 + demoFlash), 0, Math.PI * 2); demoCtx.fill();
  demoCtx.strokeStyle = `hsla(${hue}, 90%, ${82 + demoFlash * 16}%, ${(0.8 + demoFlash * 0.2).toFixed(3)})`;
  demoCtx.lineWidth = 2.4 + demoFlash * 2.5;
  demoCtx.beginPath(); demoCtx.arc(cx, cy, rOrb, 0, Math.PI * 2); demoCtx.stroke();

  // and the word, on the beat it lands
  if (demoFlash > 0.06) {
    demoCtx.globalAlpha = Math.min(1, demoFlash);
    demoCtx.font = "600 10px 'SF Mono', ui-monospace, Menlo, monospace";
    demoCtx.fillStyle = `hsl(${hue}, 60%, 94%)`;
    demoCtx.textAlign = 'center';
    demoCtx.fillText('T A P', cx, cy + 4);
    demoCtx.globalAlpha = 1;
  }
}

window.__drawDemo = drawDemo;   // debug handle, same as the others

// ── Results ── the reveal. A round without one is just activity that stops.
// Shown when you reach the bottom, or when the music ends — the song's last
// note is the hard bell, and whoever is deepest at that moment wins.
const ORDINAL = ['', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH'];
let resultsShown = false;
let resultsTimer = 0;

function hideResults() {
  resultsShown = false;
  clearTimeout(resultsTimer);
  $('results').classList.remove('show');
}

// ── Personal bests ── the cheapest replay engine there is. "Again?" is weak;
// "I was 40 feet short" is irresistible. One number per world+track, and a
// golden moment the instant you beat it mid-run.
function bestKey() {
  return 'fp_best_' + $('world-select').value + '_' +
    ($('track-select').value || audio.el.currentSrc || '').split('/').pop();
}
function getBest() { return +(localStorage.getItem(bestKey()) || 0); }
let bestBeaten = false;   // reset each round; the golden flash fires once
function checkBest() {
  if (!race.active || bestBeaten) return;
  const b = getBest();
  if (b > 0 && race.feet > b) {
    bestBeaten = true;
    // the golden moment: the HUD flares gold and the room hears it
    const el = $('game-hud');
    el.classList.add('best');
    setTimeout(() => el.classList.remove('best'), 2600);
    sfx.fanfare();
    impact(0.8);
  }
}
function saveBest() {
  if (!race.active) return false;
  const b = getBest();
  if (race.feet > b) { localStorage.setItem(bestKey(), race.feet); return b > 0; }
  return false;
}

// ── The question at the end ── a round that just fades out tells you the
// session is over; a round that asks "again?" tells you it has barely begun.
// Free rounds ask PLAY AGAIN / NEXT WORLD; the set-final board asks RUN IT
// BACK / BACK TO VIBE. In the middle of a set nothing asks — the set runner
// owns the pacing there.
function replayRound() {
  hideResults();
  // A fresh thinned-notes array is the lever that resets every world's chart
  // read head (they key off the array's identity), so cherries fall and gates
  // spawn from the top instead of the heads sitting at end-of-song.
  const c = cachedChart(audio.el.currentSrc || audio.el.src);
  if (!c) return;
  beatCue.setChart(c);
  audio.el.currentTime = 0;
  beatCue.seek(0);
  race.start(beatCue.chart.duration, beatCue.chart.notes.length);
  clipBufStart();   // the reel rolls with the round
  armGhost();
  hostGo();
  seenMissed = beatCue.stats.missed;
  audio.play().catch(() => {});
}
$('rb-again').addEventListener('click', () => {
  if ($('rb-again').dataset.mode === 'set') { hideResults(); lastSetStart(); }
  else if (toyLast) { hideResults(); startToyRound(); }
  else replayRound();
});
$('rb-next').addEventListener('click', () => {
  hideResults();
  if ($('rb-next').dataset.mode === 'set') { endSet(); }
  else jumpGame(1);
});

// ── The finish deserves a moment ── a scoreboard fading in is a receipt, not
// an ending. Three beats: the score counts up under your eyes, the top three
// get their medals, and the room fills with light in the winner's colour.
let countTimer = 0, burstTimers = [];
function celebrate(winnerColorHex, big) {
  burstTimers.forEach(clearTimeout); burstTimers = [];
  const bursts = big ? 14 : 8;
  for (let i = 0; i < bursts; i++) {
    burstTimers.push(setTimeout(() => {
      pulses.spawn(camera,
        (Math.random() * 2 - 1) * 0.85,
        (Math.random() * 2 - 1) * 0.7,
        winnerColorHex, 0.8 + Math.random() * 0.7);
    }, 120 + i * (big ? 130 : 170) + Math.random() * 60));
  }
  impact(big ? 1.0 : 0.7);
  sfx.fanfare();
}

function countUp(el, target, ms = 900) {
  clearInterval(countTimer);
  const t0 = performance.now();
  countTimer = setInterval(() => {
    const u = Math.min(1, (performance.now() - t0) / ms);
    const e = 1 - Math.pow(1 - u, 3);
    el.textContent = Math.round(target * e).toLocaleString();
    if (u >= 1) clearInterval(countTimer);
  }, 33);
}

function showResults(reason) {
  toyLast = false;
  clipBufStop(true);   // freeze the reel on the run that just ended
  sig.endRun(runMeta('race', {
    feet: race.feet, accuracy: +race.accuracy.toFixed(2),
    bestStreak: race.bestStreak, finished: race.finished, mode: race.mode,
  }));
  statsRoundDone();
  ghostRoundDone();
  $('awards').innerHTML = '';   // honours belong to set finales only
  if (resultsShown || !race.active) return;
  resultsShown = true;

  const solo = participants.length <= 1;
  const board = standings(participants);
  const place = board.findIndex(e => e.i === 0) + 1;

  const collecting = race.mode === 'COLLECT';
  $('results-place').textContent = solo
    ? (collecting ? race.feet.toLocaleString() : (race.finished ? 'THE BOTTOM' : 'TIME'))
    : (ORDINAL[place] || place + 'TH');
  // The sub-line reads every single round, so it gets a pool too — and it is
  // the one place worth a joke at the player's expense, because by then the
  // result is already in and nobody can be misled by it.
  const pct = Math.round(race.fraction * 100);
  const subs = solo
    ? (collecting
        ? ['cherries shaken loose', "that's good pickin'", 'the tree will forgive you']
        : race.finished
          ? ['you made it to the bottom', 'the stairs are over. you won.', 'well, look at you']
          : pct > 80 ? ['so close you could taste it', pct + '% down when the music quit']
          : pct > 40 ? [pct + '% of the way down', 'a respectable amount of stairs', "middlin', but honest"]
                     : [pct + '% of the way down', 'the stairs won this one', 'bless it. we all start somewhere'])
    : (collecting
        ? ['biggest haul takes it', 'counted, weighed, and judged']
        : race.finished
          ? ['first to the bottom', 'you got there first, sugar']
          : ['when the music stopped', 'the song ran out before the stairs did']);
  $('results-sub').textContent = subs[Math.floor(Math.random() * subs.length)];

  const rows = board.slice(0, 8).map(e => {
    const p = e.p;
    const css = '#' + PALETTE[(p.color || 0) % PALETTE.length].toString(16).padStart(6, '0');
    // a race reads as a percentage of the way down; a haul is just a number,
    // and turning it into a percentage would hide what anybody actually caught
    const val = collecting
      ? Math.round(e.depth).toLocaleString()
      : (race.finish ? Math.min(100, Math.round(e.depth / race.finish * 100)) : 0) + '%';
    return `<div class="rrow${e.i === 0 ? ' me' : ''}">`
      + `<i style="background:${css};box-shadow:0 0 8px ${css}"></i>`
      + `<span>${(p.name || 'guest').replace(/[<>&]/g, '')}</span>`
      + `<b>${val}</b></div>`;
  }).join('');
  $('results-board').innerHTML = rows;
  // medals: the top three rows carry their metal
  [...$('results-board').children].slice(0, 3).forEach((row, k) =>
    row.classList.add('m' + (k + 1)));

  // the big number counts up rather than appearing — watching your own score
  // arrive is the fun part, and it costs nothing
  if (collecting && solo) countUp($('results-place'), race.feet);

  // and the room lights up in the winner's colour
  const winner = board[0];
  const winHex = PALETTE[((winner && winner.p.color) || 0) % PALETTE.length];
  const newBest = saveBest();
  if (newBest) $('results-sub').textContent = 'A NEW PERSONAL BEST, SUGAR';

  // the round pays: your result becomes session points, once, at the bell
  const payout = Math.max(5, Math.min(150,
      Math.round(race.feet * (race.mode === 'RACE' ? 0.1 : 0.5))))
    + (newBest ? 25 : 0)
    + (solo ? (race.finished ? 40 : 0) : ([40, 25, 15][place - 1] || 5));
  addScore(payout, undefined, undefined, true);
  $('rs-pts').textContent = '+' + payout;
  celebrate(winHex, (solo ? race.finished : place === 1) || newBest);

  $('rs-acc').textContent = Math.round(race.accuracy * 100) + '%';
  $('rs-streak').textContent = race.bestStreak;
  $('rs-notes').textContent = race.perfect + race.good;

  $('results').classList.add('show');
  impact(0.9);
  if (!setList) {
    // a free round ends on a question, and questions wait for answers
    $('rb-again').textContent = 'PLAY AGAIN';
    $('rb-next').textContent = 'NEXT WORLD';
    delete $('rb-again').dataset.mode;
    delete $('rb-next').dataset.mode;
    $('results-actions').classList.add('show');
    clearTimeout(resultsTimer);
  } else {
    $('results-actions').classList.remove('show');
    // mid-set it clears itself — the set runner owns the pacing
    resultsTimer = setTimeout(hideResults, 11000);
  }
}
audio.el.addEventListener('ended', () => {
  if (race.active) showResults('ended');
  if (setList && setPhase === 'racing') {
    setPhase = 'between';
    scoreRound();
    roundTimer = setTimeout(nextRound, 8000);   // let the reveal land first
  }
});

// A race belongs to one track in one rhythm world — one song, one round.
function startRaceIfReady() {
  if (!document.body.classList.contains('round') || !beatCue.chart) { race.reset(); return; }
  // Outside a set, the round does not just begin at you: the card comes up
  // with the rules and the demo, the music keeps playing underneath, and the
  // game starts when YOU press PLAY — however long the reading takes.
  if (!setList) {
    const key = $('world-select').value;
    race.reset();
    // One screen at a time. Arriving here with the previous round's results
    // (or its PLAY AGAIN question) still up layered two cards on top of each
    // other — title over stats over demo, all fighting. The intro owns the
    // frame now, so everything else leaves first.
    hideResults();
    $('pass-flash').classList.remove('show');
    document.body.classList.add('vibe-card');
    $('ri-world').textContent = WORLDS[key].label;
    $('ri-track').textContent = prettyTrack($('track-select').value || audio.el.currentSrc || '');
    $('ri-mode').textContent = WORLDS[key].mode || 'PLAY';
    $('ri-rules').textContent = rulesFor(key);
    // The tap demo shows a ring closing on an orb — which is a LIE for worlds
    // that draw their own cue (Slinky's stair bars) and for steered worlds
    // where nobody taps at all. It only appears where it teaches the truth.
    $('ri-demo').style.display =
      (WORLDS[key].mode === 'RACE' && WORLDS[key].cue !== 'world') ? '' : 'none';
    const pb = getBest();
    $('ri-state').textContent = pb > 0 ? "your best 'round here: " + pb.toLocaleString() : "fixin' to start";
    setPhase = 'intro';
    $('round-intro').classList.add('show');
    bestBeaten = false;
    if (document.body.classList.contains('guest')) {
      // A shared race needs ONE start line. Every client pressing its own
      // PLAY meant races starting seconds apart — or never, for a guest who
      // ignored the card — which is "multiplayer doesn't work right" in one
      // sentence. Guests read the rules while they wait; the round begins the
      // moment the host's progress appears on the wire (see the frame loop).
      $('ri-state').textContent = 'the host will get us started';
      $('ri-play').classList.remove('ready');
      playArm++;          // cancel any stale PLAY armer from a previous world
      guestArmed = true;
    } else {
      armPlayButton(() => beginFreeRound());
    }
    return;
  }
  race.start(beatCue.chart.duration, beatCue.chart.notes.length);
  clipBufStart();   // the reel rolls with the round
  armGhost();
  hostGo();
  seenMissed = beatCue.stats.missed;
  hideResults();
}
window.__startRace = startRaceIfReady;

// scrubbing must move the chart's read head too, or the lane and the audio
// quietly disagree for the rest of the track
audio.el.addEventListener('seeked', () => beatCue.seek(audio.currentTime));

// when a track runs out, roll straight into the next one — unless a toy
// round is on: those END, with a tally and a share moment, like a real round
audio.el.addEventListener('ended', () => {
  if (toyRound) { showToyResults(); return; }
  if (!setList) playAuto(true);
});

// ── toy rounds ── in the wandering worlds (no race chart) every song IS a
// round: it begins when the track does, and when the track ends the tally
// card comes up with share and clip right there. Untouched, it rolls on to
// the next song by itself — a party room never stalls on a card.
let toyRound = null, toyLast = false;
audio.el.addEventListener('playing', () => {
  const w = WORLDS[currentWorldKey];
  if (!w || w.rhythm || setList || document.body.classList.contains('guest')) return;
  const src = audio.el.currentSrc || audio.el.src;
  if (!toyRound || toyRound.src !== src) {
    toyRound = { score0: score, src };
    clipBufStart();
  }
});
function startToyRound() {
  if (document.body.classList.contains('guest')) return;
  hideResults();
  toyRound = { score0: score, src: audio.el.currentSrc || audio.el.src };
  audio.el.currentTime = 0;
  audio.play().catch(() => {});
  clipBufStart();
}
function showToyResults() {
  clipBufStop(true);
  const gained = Math.max(0, score - toyRound.score0);
  sig.endRun(runMeta('toy', { pointsGained: gained }));
  toyRound = null;
  toyLast = true;
  resultsShown = true;
  $('awards').innerHTML = '';
  $('results-place').textContent = gained > 0 ? '+' + gained.toLocaleString() : 'THAT\u2019S THE SONG';
  const subs = ["the song's done \u2014 look what you made", 'one song, well spent', 'that was a whole mood, sugar'];
  $('results-sub').textContent = subs[Math.floor(Math.random() * subs.length)];
  $('results-board').innerHTML = '';
  $('rs-acc').textContent = '\u2014'; $('rs-streak').textContent = '\u2014'; $('rs-notes').textContent = '\u2014';
  $('rs-pts').textContent = gained > 0 ? '+' + gained : '';
  $('rb-again').textContent = 'ONE MORE';
  $('rb-next').textContent = 'NEXT WORLD';
  delete $('rb-again').dataset.mode;
  delete $('rb-next').dataset.mode;
  $('results').classList.add('show');
  $('results-actions').classList.add('show');
  clearTimeout(resultsTimer);
  resultsTimer = setTimeout(() => { hideResults(); playAuto(true); }, 12000);
  impact(0.7);
}

$('track-select').addEventListener('change', e => {
  if (!e.target.value) return;
  audio.loadURL(e.target.value);
  audio.play().catch(() => {});
  updatePlayBtn();
});
$('file-input').addEventListener('change', () => {
  $('mode-card').classList.remove('show');
  $('pl-row').classList.add('hidden');
});
$('file-input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const fl = $('file-label'); if (fl) fl.textContent = '♪ ' + f.name;
  sunoSay('♪ ' + f.name + ' — loaded and yours', 'ok');
  $('mq-title').value = f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
  $('mq-artist').value = '';
  $('marquee-edit').classList.remove('hidden');
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
      $('mq-title').value = info.title || '';
      $('mq-artist').value = info.artist || '';
      $('marquee-edit').classList.remove('hidden');
      window.__sunoShare = path.startsWith('suno-s') ? 's_' + token : info.id;
      window.__sunoUrl = `${SUNO_PROXY}suno/${info.id}.mp3`;
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
  const q = $('qb-play');
  if (q) {
    q.querySelector('i').textContent = audio.playing ? '⏸' : '▶';
    q.querySelector('em').textContent = audio.playing ? 'pause' : 'play';
  }
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
  tapPlayBtn.textContent = '▶ come on in — tap to join the music';
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

// iOS frequently hands back a sleeping audio context even inside a gesture;
// nudge it awake on any interaction until it's genuinely running
['pointerdown', 'touchend'].forEach(ev =>
  window.addEventListener(ev, () => audio.ensureContext(), { passive: true }));
setInterval(() => {
  const el = $('audio-stamp');
  if (el) el.textContent = 'audio: ' + audio.status;
}, 700);

$('btn-mute').addEventListener('click', () => toggleMute());

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
$('balls').value = 4500;
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
function applyPreset(cfg) {
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
}
{
  const box = $('preset-chips');
  for (const [name, cfg] of PRESETS) {
    const c = document.createElement('div');
    c.className = 'chip chip-preset';
    c.textContent = name;
    c.style.background = `linear-gradient(120deg, hsla(${cfg.hue}, 70%, 30%, 0.9), hsla(${cfg.hue}, 80%, 14%, 0.9))`;
    c.addEventListener('click', () => applyPreset(cfg));
    box.appendChild(c);
  }
}

// ── Quick bar ── the handful of moves you make mid-song, one press each.
// Everything here is a shortcut to something the panel can already do; the
// panel stays for the deep settings nobody touches while a track is playing.
const WORLD_KEYS = Object.keys(WORLDS);

function stepWorld(dir = 1) {
  if (document.body.classList.contains('guest')) return; // the host drives the world
  const i = WORLD_KEYS.indexOf($('world-select').value);
  const next = WORLD_KEYS[(i + dir + WORLD_KEYS.length) % WORLD_KEYS.length];
  $('world-select').value = next;
  switchWorld(next);
}

let lookIdx = 0;
function stepLook(dir = 1) {
  lookIdx = (lookIdx + dir + PRESETS.length) % PRESETS.length;
  applyPreset(PRESETS[lookIdx][1]);
}

function toggleMute() {
  audio.setMuted(!audio.muted);
  sfx.setSfxMuted(audio.muted);
  $('btn-mute').classList.toggle('on', audio.muted);
  $('btn-mute').textContent = audio.muted ? 'muted' : 'mute';
  $('qb-mute').classList.toggle('on', audio.muted);
  $('qb-mute').querySelector('em').textContent = audio.muted ? 'muted' : 'mute';
}

function togglePlay() {
  if (document.body.classList.contains('guest')) return; // host drives the music
  audio.playing ? audio.pause() : audio.play().catch(() => {});
  updatePlayBtn();
}

$('qb-prev').addEventListener('click', playPrev);
$('qb-next').addEventListener('click', () => playAuto(true));
$('qb-play').addEventListener('click', togglePlay);
$('qb-world').addEventListener('click', () => stepWorld(1));
$('qb-look').addEventListener('click', () => stepLook(1));
$('qb-mute').addEventListener('click', toggleMute);

// the bar fades away when you leave it alone, and wakes on any input
{
  const bar = $('qbar');
  let idle = null;
  const wake = () => {
    bar.classList.remove('dim');
    clearTimeout(idle);
    idle = setTimeout(() => bar.classList.add('dim'), 3200);
  };
  ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(ev =>
    window.addEventListener(ev, wake, { passive: true })
  );
  wake();
}

// arrival chime toggle — the host's call for the whole room
$('btn-chime').classList.toggle('on', settings.chime);
$('btn-chime').addEventListener('click', () => {
  settings.chime = !settings.chime;
  $('btn-chime').classList.toggle('on', settings.chime);
  updateURL();
});

// stardust toggle
$('btn-stardust').classList.toggle('on', settings.stardust);
$('btn-stardust').addEventListener('click', () => {
  settings.stardust = !settings.stardust;
  $('btn-stardust').classList.toggle('on', settings.stardust);
  updateURL();
});

// ── Tempo strip: the last few seconds of song, predicted grid against the
// detector's raw onsets. If the marks sit on the rules, the grid is real. ──
const tempoEl = $('tempo');
const tempoCv = $('tempo-strip');
const tctx = tempoCv.getContext('2d');
const SPAN = 4.0;               // seconds of history shown
let onsetMarks = [];            // song-times of raw detections
let gridFlash = 0, onsetFlash = 0;

function drawTempo(gridBeat, rawOnset) {
  if (gridBeat) gridFlash = 1;
  if (rawOnset) { onsetFlash = 1; onsetMarks.push(audio.currentTime); }
  gridFlash *= 0.86; onsetFlash *= 0.86;
  if (tempoEl.classList.contains('hidden')) return;

  const now = audio.currentTime;
  while (onsetMarks.length && now - onsetMarks[0] > SPAN + 1) onsetMarks.shift();

  const W = tempoCv.width, H = tempoCv.height;
  const x = t => ((t - (now - SPAN)) / SPAN) * W;
  tctx.clearRect(0, 0, W, H);

  const hue = settings.hue;
  // predicted grid — full-height rules
  if (beatClock.locked) {
    const first = Math.ceil((now - SPAN - beatClock.anchor) / beatClock.period);
    const last = Math.floor((now - beatClock.anchor) / beatClock.period);
    for (let k = first; k <= last; k++) {
      const t = beatClock.anchor + k * beatClock.period;
      const px = x(t);
      const age = 1 - (now - t) / SPAN;
      tctx.strokeStyle = `hsla(${hue}, 80%, 72%, ${(0.20 + age * 0.5).toFixed(3)})`;
      tctx.lineWidth = 2;
      tctx.beginPath(); tctx.moveTo(px, 6); tctx.lineTo(px, H - 6); tctx.stroke();
    }
    // where the NEXT beat lands — the anticipation the detector cannot give
    const nb = beatClock.nextBeat(now);
    if (nb != null && nb < now + 0.35) {
      tctx.strokeStyle = `hsla(${hue}, 90%, 80%, 0.28)`;
      tctx.setLineDash([3, 3]);
      const px = x(nb);
      tctx.beginPath(); tctx.moveTo(px, 6); tctx.lineTo(px, H - 6); tctx.stroke();
      tctx.setLineDash([]);
    }
  }

  // raw onsets — dots on the centre line
  for (const t of onsetMarks) {
    const px = x(t);
    if (px < 0 || px > W) continue;
    const age = 1 - (now - t) / SPAN;
    tctx.fillStyle = `hsla(${(hue + 40) % 360}, 90%, 74%, ${(0.25 + age * 0.7).toFixed(3)})`;
    tctx.beginPath(); tctx.arc(px, H / 2, 3.4, 0, Math.PI * 2); tctx.fill();
  }

  // the playhead
  tctx.strokeStyle = `hsla(0, 0%, 100%, ${0.35 + gridFlash * 0.55})`;
  tctx.lineWidth = 1;
  tctx.beginPath(); tctx.moveTo(W - 1, 0); tctx.lineTo(W - 1, H); tctx.stroke();

  $('tempo-bpm').innerHTML = (beatClock.bpm ? beatClock.bpm.toFixed(1) : '--') + '<small>BPM</small>';
  const st = $('tempo-state');
  if (chartProgress >= 0) {
    st.textContent = 'charting ' + Math.round(chartProgress * 100) + '%';
    st.classList.remove('lock');
  } else if (beatCue.chart) {
    st.textContent = 'charted \u00b7 ' + beatCue.chart.notes.length + ' notes';
    st.classList.add('lock');
  } else {
    st.textContent = beatClock.locked ? 'locked' : 'searching';
    st.classList.toggle('lock', beatClock.locked);
  }
  $('tempo-conf').firstElementChild.style.width = Math.round(beatClock.confidence * 100) + '%';
}

// ── Overtakes ── the one moment in a race worth announcing by name. A silent
// position swap is just scenery moving; "PASSED BEX" is why you were pushing.
// Deadpan, and a POOL of them — the joke is not the line, it is that the road
// keeps commenting on your driving and never quite repeats itself. One fixed
// phrase stops being funny on its second appearance, which in a race is about
// nine seconds in.
const PASS_THEM = [
  'BYE NOW, %', "'SCUSE ME, %", 'SEE YOU, %', '% WHO?', 'SORRY, %',
  'NOT TODAY, %', 'LATER, %', '% IN THE MIRROR', 'NOTHING PERSONAL, %',
  'KEEP UP, HON', 'WAVE GOODBYE, %', 'BLESS YOUR HEART, %', 'IN A HURRY, %?',
];
const PASS_YOU = [
  '% SAYS HI', 'RUDE, %', '% HAS SOMEWHERE TO BE', 'THAT WAS %',
  "% DIDN'T EVEN WAVE", 'OUCH. %.', '% IS SHOWING OFF', 'WELL, I NEVER. %.',
  'REALLY, %?', '% JUST WALTZED BY', 'NICE MOVES, %',
];
// avoid saying the same thing twice in a row, which is when a pool stops
// feeling like a pool
let lastPass = '';
function pickPass(pool, who) {
  for (let i = 0; i < 6; i++) {
    const line = pool[Math.floor(Math.random() * pool.length)];
    if (line !== lastPass) { lastPass = line; return line.replace('%', who); }
  }
  return pool[0].replace('%', who);
}

let passT = 0;
function flashPass(p, youWent) {
  if (youWent) myStats.passes++; else myStats.passed++;
  statsPush();
  const el = $('pass-flash');
  const who = (p.name || 'them').toUpperCase();
  el.textContent = pickPass(youWent ? PASS_THEM : PASS_YOU, who);
  el.classList.toggle('bad', !youWent);
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(passT);
  passT = setTimeout(() => el.classList.remove('show'), 1500);
  sfx.pass(youWent);
  if (youWent) impact(0.5);
}

// ── The HUD ── one big number, whatever the mode. Gains pulse it bright,
// losses pulse it red and breathe the vignette — the game answers every event
// where your eyes already are, instead of in a corner readout.
let hudLast = null, hudTimer = 0, hurtTimer = 0;
function updateHUD() {
  const on = race.active;
  document.body.classList.toggle('playing-round', on);
  if (!on) { hudLast = null; return; }
  const v = race.feet;
  if (hudLast !== null && v !== hudLast) {
    const el = $('game-hud');
    el.classList.remove('gain', 'loss');
    void el.offsetWidth;                       // restart the transition
    el.classList.add(v > hudLast ? 'gain' : 'loss');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => el.classList.remove('gain', 'loss'), 320);
    if (v < hudLast) {
      $('hurt-vignette').classList.add('on');
      clearTimeout(hurtTimer);
      hurtTimer = setTimeout(() => $('hurt-vignette').classList.remove('on'), 300);
    }
  }
  hudLast = v;
  $('hud-value').textContent = v.toLocaleString();
  $('hud-unit').textContent = race.unit || 'FT';
  const bits = [];
  if (race.streak >= 3) bits.push(race.streak + ' streak');
  if (race.multiplier > 1) bits.push('\u00d7' + race.multiplier.toFixed(2).replace(/0$/, ''));
  if (race.mode === 'RACE') bits.push(race.feetLeft.toLocaleString() + ' to go');
  $('hud-sub').textContent = bits.join('  \u00b7  ');
}

// ── Steering by keyboard ──
// Worlds that are steered rather than pressed need a keyboard axis on desktop;
// a mouse is not always the natural hand for a dodge.
let keySteer = 0, keySteerAt = 0, keyAim = 0;
let throttleKey = false;   // space / up-arrow holds the gas
function steeredRound() {
  return race.active && (race.mode === 'DODGE' || race.mode === 'CATCH');
}
window.addEventListener('keyup', e => {
  if (e.key === 'ArrowRight' && keySteer > 0) keySteer = 0;
  if (e.key === 'ArrowLeft' && keySteer < 0) keySteer = 0;
  if (e.key === ' ' || e.key === 'ArrowUp') throttleKey = false;
});

// Step to the next playable world, or the next round of a set if one is running.
function jumpGame(dir) {
  if (setList && setList.length) {
    // inside a set: settle this round and move the set on
    clearTimeout(roundTimer);
    hideResults();
    if (dir > 0) { scoreRound(); nextRound(); }
    else { setAt = Math.max(-1, setAt - 2); nextRound(); }
    return;
  }
  if (!RHYTHM_WORLDS.length) return;
  const cur = $('world-select').value;
  const at = RHYTHM_WORLDS.indexOf(cur);
  const next = RHYTHM_WORLDS[((at < 0 ? 0 : at + dir) + RHYTHM_WORLDS.length) % RHYTHM_WORLDS.length];
  $('world-select').value = next;
  switchWorld(next);
  flashWorldName(WORLDS[next].label + '  \u00b7  ' + (WORLDS[next].mode || 'PLAY'));
}
window.__jumpGame = jumpGame;

// a brief name card, so you know which game you just landed in
let jumpFlashT = 0;
function flashWorldName(text) {
  const el = $('jump-flash');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(jumpFlashT);
  jumpFlashT = setTimeout(() => el.classList.remove('show'), 1600);
}

// ── The tuning panel ── press ` and the game's feel becomes eight sliders
// you drag WHILE PLAYING. This replaces the loop where feel was guessed at by
// proxy: find the numbers at the controls, press COPY, send them over.
const TUNE_SPEC = [
  { k: 'speed',   label: 'game speed' },
  { k: 'density', label: 'how often things come' },
  { k: 'hitstop', label: 'freeze on hit' },
  { k: 'punch',   label: 'screen punch' },
  { k: 'sfx',     label: 'action sounds' },
  { k: 'rubber',  label: 'comeback help' },
  { k: 'hunger',  label: 'gray hunger (paint)' },
  { k: 'heat',    label: 'song escalation' },
];
let tuneBuilt = false;
function buildTunePanel() {
  if (tuneBuilt) return;
  tuneBuilt = true;
  const box = $('tune-rows');
  for (const spec of TUNE_SPEC) {
    const row = document.createElement('label');
    row.className = 'tune-row';
    const val = document.createElement('b');
    val.textContent = TUNE[spec.k].toFixed(2);
    const input = document.createElement('input');
    input.type = 'range'; input.min = 0; input.max = 2; input.step = 0.05;
    input.value = TUNE[spec.k];
    input.addEventListener('input', () => {
      TUNE[spec.k] = +input.value;
      val.textContent = TUNE[spec.k].toFixed(2);
      if (spec.k === 'sfx') sfx.setSfxLevel(TUNE.sfx);
      saveTune();
    });
    const name = document.createElement('span');
    name.textContent = spec.label;
    row.append(name, input, val);
    box.appendChild(row);
  }
  $('tune-copy').addEventListener('click', () => {
    const out = JSON.stringify(TUNE);
    navigator.clipboard && navigator.clipboard.writeText(out).catch(() => {});
    $('tune-copy').textContent = 'copied';
    setTimeout(() => $('tune-copy').textContent = 'copy values', 1200);
  });
  $('tune-reset').addEventListener('click', () => {
    resetTune();
    box.innerHTML = ''; tuneBuilt = false; buildTunePanel();
  });
}
sfx.setSfxLevel(TUNE.sfx);   // saved level applies from boot

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

  // clean capture — nothing on screen but the world
  if (e.key === 'f' || e.key === 'F') document.body.classList.toggle('clean');

  // ── ] and [ : jump between GAMES ──
  // Testing meant playing a whole round to reach the next one, which is minutes
  // per look. These step straight to the next playable world and start its
  // round there — inside a set they advance the set, outside one they cycle the
  // rhythm worlds. Charts are cached per track, so a revisit is instant.
  if (e.key === ']' || e.key === '[') {
    e.preventDefault();
    jumpGame(e.key === ']' ? 1 : -1);
  }
  if (e.key === 't' || e.key === 'T') tempoEl.classList.toggle('hidden');
  if (e.key === '`') { buildTunePanel(); $('tune-panel').classList.toggle('show'); }

  // the mid-song moves, so a host never has to reach for the panel
  if (e.key === 'w') stepWorld(1);
  if (e.key === 'W') stepWorld(-1);
  if (e.key === 'l') stepLook(1);
  if (e.key === 'L') stepLook(-1);
  if (e.key === 'm' || e.key === 'M') toggleMute();
  // In a steered round the arrows are the controls, not the transport — a
  // player reaching for them to dodge should not skip the track they are
  // playing. They only move the music when nothing is being steered.
  if ((e.key === ' ' || e.key === 'ArrowUp') && steeredRound()) {
    e.preventDefault();
    throttleKey = true;
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    if (steeredRound()) { keySteer = dir; keySteerAt = performance.now(); }
    else if (dir > 0) { if (!document.body.classList.contains('guest')) playAuto(true); }
    else playPrev();
  }

  // 1–9, 0 jump straight to a world — a Stream Deck is just a keyboard
  if (e.key >= '0' && e.key <= '9') {
    const i = e.key === '0' ? 9 : +e.key - 1;
    if (i < WORLD_KEYS.length && !document.body.classList.contains('guest')) {
      $('world-select').value = WORLD_KEYS[i];
      switchWorld(WORLD_KEYS[i]);
    }
  }

  if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
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
const touchSteer = { x: 0, y: 0, lastX: 0, lastY: 0, active: false, lastT: 0, moved: 0 };
window.__touchSteer = touchSteer; // world switcher resets accumulated steer
canvas.addEventListener('touchstart', e => {
  if (!e.touches[0]) return;
  touchSteer.active = true;
  touchSteer.moved = 0;   // a hold is a throttle, not a steer, until it MOVES
  touchSteer.lastX = e.touches[0].clientX;
  touchSteer.lastY = e.touches[0].clientY;
}, { passive: true });
window.addEventListener('touchend', () => { touchSteer.active = false; });

// click/tap interaction — part of the world contract, works in both modes
let clickPulse = 0;
let pointerHeld = false;
let lastJudge = null;   // {rank, q, late} from the most recent judged tap
let lastJudgeAt = 0;
window.__judge = () => lastJudge;
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
  // in a rhythm world, the tap is judged against the predicted grid
  if (document.body.classList.contains('press')) {
    lastJudge = beatCue.press(audio.currentTime);
    lastJudgeAt = performance.now();
    if (lastJudge) {
      if (lastJudge.rank === 'miss') {
        race.miss();
      } else {
        race.hit(lastJudge.rank);
        // In a COLLECT round the strike happens at the orb, not under your
        // finger — so tell the world to answer at the centre and it pops a
        // cherry with all its existing juice, no new world code needed.
        if (race.mode === 'COLLECT' && world && world.onTap) world.onTap(0, 0.1);
      }
      seenMissed = beatCue.stats.missed;   // a wild press is its own miss
    }
  }
  clickPulse = 1; // global color surge: every click makes the whole frame answer
  impact(0.42);   // and it lands as light, not as a jolt
  spawnRipple(e.clientX, e.clientY);
  pulses.spawn(camera,
    (e.clientX / window.innerWidth) * 2 - 1,
    -((e.clientY / window.innerHeight) * 2 - 1),
    PALETTE[(net.local.color || 0) % PALETTE.length], 1);
  // broadcast the tap — everyone's world feels it, not just ours
  net.local.action = 'tap';
  clearTimeout(tapResetTimer);
  tapResetTimer = setTimeout(() => { if (net.local.action === 'tap') net.local.action = 'idle'; }, 250);
  if (!world || !world.onTap) return;
  world.onTap((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
});

// ── Impact: one physical punch every world shares ──
// A tap should be FELT, not just seen. Strength 0..1+: a light tap is ~0.4,
// a milestone is ~1. Applied over the world's own camera each frame and
// handed back, so nothing accumulates into world state.
// A hit answers in light, never in camera movement. Jittering the camera
// reads as a glitch against worlds this clean — the frame is meant to be
// still and the *world* is meant to respond.
let bloomKick = 0;
function impact(strength = 0.5) {
  bloomKick = Math.min(1.6, bloomKick + strength);
  clickPulse = Math.min(1.5, clickPulse + strength * 0.7);
  // phones can feel it. (Android honours this; iOS Safari has no web haptics.)
  if (IS_MOBILE && navigator.vibrate) {
    try { navigator.vibrate(Math.round(6 + strength * 26)); } catch { /* blocked */ }
  }
}
window.__impact = impact;

// ── Scoring: worlds award points; your score rides the state blob ──
let score = 0;
function addScore(n, x, y, force = false) {
  if (settings.attract) return; // watching earns nothing
  // the ladder remembers: points persist per name across visits
  clearTimeout(addScore._saveT);
  addScore._saveT = setTimeout(() => {
    try { localStorage.setItem('fp_score_' + (net.local.name || 'you'), String(score)); } catch (e) { }
  }, 400);
  // ONE currency per world. During a round the tally on the HUD is the score,
  // and the old pts ticking beside it decided nothing — worthless, as charged.
  // Worlds' incidental scoring is ignored while a race runs; the round itself
  // pays points at the finish (see showResults), so pts become the session
  // currency that rounds FEED rather than noise beside them.
  if (race.active && !force) return;
  score += n;
  net.local.score = score;
  impact(Math.min(1.3, 0.2 + n / 260));   // the bigger the moment, the harder it lands
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

// ── The rivals bar: the emoji arsenal, finally on the game screen ──
let rivalsTarget = null;   // whose picker is open
function renderRivals() {
  const bar = $('rivals-bar');
  const rivals = participants.filter(p => !p.local && p.name);
  if (!rivals.length || settings.attract) { bar.classList.add('hidden'); rivalsTarget = null; return; }
  bar.classList.remove('hidden');
  const row = $('rivals-row');
  const sig = rivals.map(p => p.name + ':' + (p.color || 0)).join('|');
  if (row.dataset.sig !== sig) {
    row.dataset.sig = sig;
    row.innerHTML = '';
    for (const p of rivals.slice(0, 8)) {
      const chip = document.createElement('div');
      chip.className = 'rival-chip';
      const css = '#' + PALETTE[(p.color || 0) % PALETTE.length].toString(16).padStart(6, '0');
      chip.innerHTML = `<i style="background:${css};box-shadow:0 0 8px ${css}"></i>`;
      chip.appendChild(document.createTextNode(p.name));
      chip.addEventListener('click', () => {
        rivalsTarget = rivalsTarget === p.name ? null : p.name;
        openRivalsPick();
      });
      chip.dataset.name = p.name;
      row.appendChild(chip);
    }
  }
  row.querySelectorAll('.rival-chip').forEach(c =>
    c.classList.toggle('armed', c.dataset.name === rivalsTarget));
  if (rivalsTarget && !rivals.some(p => p.name === rivalsTarget)) {
    rivalsTarget = null; openRivalsPick();
  }
}
function openRivalsPick() {
  const pick = $('rivals-pick');
  pick.classList.toggle('open', !!rivalsTarget);
  if (!rivalsTarget) return;
  const name = rivalsTarget;
  pick.innerHTML = '';
  EMOJIS.forEach((e2, k) => {
    const b = document.createElement('button');
    b.textContent = e2;
    b.style.opacity = score >= BOMB_COST ? '1' : '0.35';
    b.addEventListener('click', () => { sendBomb(name, k); rivalsTarget = null; openRivalsPick(); renderRivals(); });
    pick.appendChild(b);
  });
  const sep = document.createElement('span'); sep.className = 'sep'; pick.appendChild(sep);
  TRICKS.forEach(t => {
    const b = document.createElement('button');
    b.textContent = t.e; b.title = t.name;
    b.style.opacity = score >= t.cost ? '1' : '0.35';
    b.addEventListener('click', () => {
      if (score < t.cost) {
        sfx.thud();
        const el = $('pass-flash');
        el.textContent = "YOU'LL NEED " + t.cost + ' PTS FOR THAT, SUGAR';
        el.classList.add('bad'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
        clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 1600);
        return;
      }
      addScore(-t.cost, undefined, undefined, true);
      myStats.bombs++; statsPush();
      net.sendEmote(t.i, name, t.e);
      const el = $('pass-flash');
      el.textContent = t.e + ' \u2192 ' + name.toUpperCase();
      el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
      clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 1600);
      rivalsTarget = null; openRivalsPick(); renderRivals();
    });
    pick.appendChild(b);
  });
  const em = document.createElement('em');
  em.textContent = '\u2192 ' + name + ' \u00b7 ' + BOMB_COST + '/' + TRICKS[0].cost + ' pts';
  pick.appendChild(em);
}
setInterval(renderRivals, 600);

// a world can name what's on its easel and how far along it is
window.__setFigure = (name, done, total) => {
  const el = $('figure-label');
  if (!name) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('fig-name').textContent = name;
  $('fig-progress').textContent = total ? `${done} / ${total}` : '';
};

// ── World intro: name + the one line that explains the whole game ──
let introTimer = 0;
function showWorldIntro(key) {
  const w = WORLDS[key];
  if (!w) return;
  // Two screens must never talk at once. Mid-set the round card already
  // names the world — the floating greeting on top of it was the overlap.
  if ($('round-intro').classList.contains('show') ||
      $('mode-card').classList.contains('show') ||
      $('results').classList.contains('show')) return;
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
  impact(0.22);   // a friend's hit lands softly in your frame too
  pulses.spawn(camera, p.x || 0, p.y || 0, PALETTE[p.color % PALETTE.length], 0.8);
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
  // a stationary throttle hold must not hijack the wheel from tilt: the
  // finger has to genuinely travel before it counts as drag steering
  touchSteer.moved += Math.abs(t.clientX - touchSteer.lastX) + Math.abs(t.clientY - touchSteer.lastY);
  if (touchSteer.moved < 14) {
    touchSteer.lastX = t.clientX; touchSteer.lastY = t.clientY;
    return;
  }
  // one full-screen swipe ≈ the full steering range; keep swiping for more
  touchSteer.x += ((t.clientX - touchSteer.lastX) / window.innerWidth) * 2.4;
  touchSteer.y += (-(t.clientY - touchSteer.lastY) / window.innerHeight) * 2.4;
  touchSteer.y = Math.max(-1, Math.min(1, touchSteer.y));
  if (!FULL_TURN.has(currentWorldKey)) touchSteer.x = Math.max(-1, Math.min(1, touchSteer.x));
  touchSteer.lastX = t.clientX; touchSteer.lastY = t.clientY;
  touchSteer.lastT = performance.now();
  world.setInput(touchSteer.x, touchSteer.y);
}, { passive: true });

// tilt steering on mobile — yields only to a REAL drag, never to a
// stationary throttle hold (the regression: hold-to-burn was silencing
// tilt for the whole burn)
window.addEventListener('deviceorientation', e => {
  if (settings.attract || !world || !world.setInput || e.gamma == null) return;
  if ((touchSteer.active && touchSteer.moved >= 14) || performance.now() - touchSteer.lastT < 1200) return;
  world.setInput(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - 45) / -30)));
});

// ── Join flow ──
const tap = $('tap-to-start');
const ROOM_CHARS = 'ACDEFGHJKMNPQRTUVWXYZ2346789'; // no O/0, I/1, ambiguous glyphs
const genCode = () => Array.from({ length: 4 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('');
const validName = n => /^[a-zA-Z0-9_]{3,14}$/.test(n);

$('join-name').value = net.local.name === 'you' ? '' : net.local.name;


// The same rule, phrased for the device in hand: a phone player has no
// mouse, no arrows, and no space bar — their finger is all three.
function rulesFor(key) {
  const r = WORLDS[key].rules || '';
  return IS_MOBILE
    ? r.replace('Steer with the mouse or arrows.', 'Slide your finger to steer.')
       .replace('Steer in and out with the mouse or arrows.', 'Slide your finger to steer in and out.')
    : r;
}
let autoWanted = false;
function dismissOverlay() {
  audio.ensureContext();
  if (window.__shareWorld) { switchWorld(window.__shareWorld); window.__shareWorld = null; }
  // a shared suno link: reconstruct the paste and load it like a hand did
  if (window.__shareSuno) {
    document.body.classList.add('suno-live');   // an invited song unlocks the slot
    const t = window.__shareSuno; window.__shareSuno = null;
    $('suno-input').value = t.startsWith('s_')
      ? 'https://suno.com/s/' + t.slice(2)
      : 'https://suno.com/song/' + t;
    setTimeout(() => loadSuno(), 300);
    // the song has ONE home world at a time; if it moved since this link was
    // sent, follow it there
    fetch(`${SUNO_PROXY}share-home?song=${encodeURIComponent(t)}`)
      .then(r => r.json())
      .then(h => {
        if (h && h.world && WORLDS[h.world] && h.world !== currentWorldKey) switchWorld(h.world);
      })
      .catch(() => {});
    autoWanted = false;   // their song is the show; don't start ours under it
  }
  // start the music by itself — unless we're a guest, who follows the host
  if (!document.body.classList.contains('guest')) {
    autoWanted = true;
    if (!audio.el.src) setTimeout(() => playAuto(false), 200);
  }
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
  // signals: was this a return trip? (same room seen before on this device)
  try {
    const hist = JSON.parse(localStorage.getItem('fp_room_hist') || '[]');
    const back = hist.includes(code);
    if (!back) { hist.push(code); localStorage.setItem('fp_room_hist', JSON.stringify(hist.slice(-20))); }
    // room size settles once presence syncs — read it after the dust
    setTimeout(() => sig.room(net.participants.length, back), 4000);
  } catch (e) { /* private mode: signals lose nothing vital */ }
  net.local.name = name;
  localStorage.setItem('fp_name', name);
  $('room-badge').textContent = code;
  $('room-badge').dataset.url = location.host.includes('localhost')
    ? '' : location.host + location.pathname.replace(/\/$/, '');
  $('room-badge').classList.remove('hidden');
  // The stream card — the host's join lockup for a broadcast. Guests never
  // see it; their phone IS the controller. It opens with the room and can be
  // tucked away (click the room code to bring it back).
  document.body.classList.toggle('hosting', !!asOwner);
  if (asOwner) {
    const joinURL = location.origin + location.pathname.replace(/index\.html$/, '') + '?room=' + code;
    $('sc-url').textContent = joinURL.replace(/^https?:\/\//, '');
    $('sc-code').textContent = code;
    $('sc-qr').classList.toggle('gone', !drawQR($('sc-qr'), joinURL, 4));
    $('stream-card').classList.remove('hidden');
  }
  net.onReject = () => { tap.classList.remove('gone'); $('join-msg').textContent = "that name's spoken for, hon"; };
  // a refreshed host who joined by code gets their room back mid-air
  net.onPromoted = () => {
    document.body.classList.remove('guest');
    document.body.classList.add('hosting');
    const code = net.room || '';
    if (code) {
      const joinURL = location.origin + location.pathname.replace(/index\.html$/, '') + '?room=' + code;
      $('sc-url').textContent = joinURL.replace(/^https?:\/\//, '');
      $('sc-code').textContent = code;
      $('sc-qr').classList.toggle('gone', !drawQR($('sc-qr'), joinURL, 4));
      $('stream-card').classList.remove('hidden');
    }
  };
  net.join(code, name, asOwner); // no host configured → runs solo, silently
  // guests ride the host's soundtrack — no track/transport controls for them
  document.body.classList.toggle('guest', !asOwner);
  if (!asOwner) {
    // the worlds tab is gone for them; don't strand them on a blank page
    const cur = document.querySelector('#tabs .tab.on');
    if (cur && cur.dataset.tab === 'worlds') {
      document.querySelector('#tabs .tab[data-tab="looks"]').click();
    }
  }
  dismissOverlay();
  if (score < 30) addScore(30 - score, undefined, undefined, true);
  updateURL();
}
// ── Sets ── PLAY is a run of rounds: one song, one world, one race each.
// VIBE is everything as it was. The choice comes AFTER hosting, never on the
// entrance — the join card is not the place to ask a question.
//
// Only worlds with a race can hold a round, so a set is drawn from those. With
// one rhythm world today a set is four different tracks; as more worlds get a
// race the same code gives real variety without changing.
const RHYTHM_WORLDS = Object.keys(WORLDS).filter(k => WORLDS[k].rhythm);

// Every world has a signature song — matched by name and nature, so entering
// a world means hearing the track it was born for. chasing the comets IS
// Comets; liquid light IS the lava lamp. The pairing is the product.
const WORLD_TRACKS = {
  tunnel: 'holographic.mp3',
  surfer: 'running.mp3',
  orbit: 'planet_synthetica.mp3',
  bloom: 'garden_of_color.mp3',
  trail: 'paint_trail.mp3',
  signal: 'glitch_in_the_matrix.mp3',
  river: 'wasting_time.mp3',
  funhouse: 'candy_lady.mp3',
  lava: 'liquid_light.mp3',
  plasma: 'black_light_special.mp3',
  cherry: 'purple_cherries.mp3',
  slinky: 'let_em_look.mp3',
  blacktop: 'fly_by_night.mp3',
  comets: 'chasing_the_comets.mp3',
  slide: 'zoomin.mp3',
  paint: 'paint_me_by_numbers.mp3',
  garden: 'magic_number.mp3',
};
function signatureFor(key) {
  const f = WORLD_TRACKS[key];
  return f && trackList.includes('audio/' + f) ? 'audio/' + f : null;
}
// entering a world brings its song along — unless the artist's own song is
// playing: PLAYING your music is free everywhere, so their track follows
// them into every world untouched. The gate lives on SHARING, not playing.
function playSignature(key) {
  if (document.body.classList.contains('guest')) return;
  if (setList || window.__sunoShare) return;
  const sig = signatureFor(key);
  if (!sig) return;
  if ((audio.el.currentSrc || '').endsWith(sig.split('/').pop())) return;
  audio.loadURL(sig);
  $('track-select').value = sig;
  audio.play().catch(() => {});
  updatePlayBtn();
}
const SET_POINTS = [0, 5, 3, 2, 1];     // by placement
let setList = null, setAt = -1, setPhase = 'idle';
const routeMap = new RouteMap(document.getElementById('map-canvas'));
window.__map = routeMap;
let setScores = new Map();
let roundTimer = 0;

// The card asks ONE question now: whose music tonight? The house set is the
// default wander; a suno playlist becomes a playset — one round per song,
// each song dealt its own racing world.
function askMode() {
  if (!trackList.length) {
    // manifest still in flight (slow network): ask again when it lands
    clearTimeout(askMode._t);
    askMode._t = setTimeout(askMode, 500);
    return;
  }
  $('mode-card').classList.add('show');
}
$('opt-vibe').addEventListener('click', () => {
  $('mode-card').classList.remove('show');
  $('pl-row').classList.add('hidden');
  endSet();
});
$('opt-play').addEventListener('click', () => {
  $('pl-row').classList.remove('hidden');
  $('pl-input').focus();
});
$('pl-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('pl-go').click(); });
$('pl-go').addEventListener('click', () => {
  const raw = $('pl-input').value.trim();
  if (/spotify\.com|spotify:|youtube\.com|youtu\.be/i.test(raw)) {
    $('pl-msg').textContent = 'we can only play suno links or mp3s for now';
    return;
  }
  const pl = raw.match(/playlist\/([0-9a-fA-F-]{36})/);
  if (!pl) {
    // one song: they pick its world, then it plays there
    if (/suno\.com\/(song|s)\//.test(raw)) {
      const wsel = $('pl-world');
      if (!wsel.options.length) {
        for (const k of Object.keys(WORLDS)) {
          const o = document.createElement('option');
          o.value = k; o.textContent = WORLDS[k].label;
          wsel.appendChild(o);
        }
      }
      $('pl-pick').classList.remove('hidden');
      $('pl-msg').textContent = 'one song \u2014 now where\u2019s it playin\u2019?';
      return;
    }
    $('pl-msg').textContent = 'we can only play suno links or mp3s for now';
    return;
  }
  $('pl-msg').textContent = 'reading the playlist\u2026';
  fetch(`${SUNO_PROXY}suno-list/${pl[1]}`)
    .then(r => r.json())
    .then(info => {
      if (!info.songs || !info.songs.length) { $('pl-msg').textContent = 'no songs found on that playlist'; return; }
      $('mode-card').classList.remove('show');
      $('pl-row').classList.add('hidden');
      $('pl-msg').textContent = '';
      // the night is exactly as long as the playlist: one world per song
      startPlaylistSet(info.songs);
    })
    .catch(() => { $('pl-msg').textContent = 'could not reach that playlist \u2014 try again in a spell'; });
});
$('pl-world-go').addEventListener('click', () => {
  const raw = $('pl-input').value.trim();
  const key = $('pl-world').value;
  $('mode-card').classList.remove('show');
  $('pl-pick').classList.add('hidden');
  $('pl-row').classList.add('hidden');
  $('pl-msg').textContent = '';
  document.body.classList.add('suno-live');
  panel.classList.remove('hidden', 'collapsed');
  document.querySelector('#tabs .tab[data-tab="music"]')?.click();
  $('suno-input').value = raw;
  loadSuno();
  if (WORLDS[key]) { switchWorld(key); $('world-select').value = key; }
});

// a playlist becomes a route: one round per song, worlds dealt from the
// racing deck, the route map named by the songs (the thing that varies)
function startPlaylistSet(songs) {
  statsReset();
  const deck = shuffled(RHYTHM_WORLDS);
  setList = songs.map((s, i) => ({
    world: deck[i % deck.length],
    track: `${SUNO_PROXY}suno/${s.id}.mp3`,
    label: (s.title || 'track ' + (i + 1)).toUpperCase(),
  }));
  routeMap.setRoute(setList.map(r => ({ label: r.label })));
  setAt = -1;
  setScores = new Map();
  nodeReached.clear();
  document.body.classList.add('play');
  lastSetStart = () => startPlaylistSet(songs);
  nextRound();
}
let lastSetStart = () => startSet(4);

function startSet(rounds) {
  lastSetStart = () => startSet(rounds);
  statsReset();
  const worldsPick = shuffled(RHYTHM_WORLDS).slice(0, Math.max(1, rounds));
  const spare = shuffled(trackList);
  setList = worldsPick.map((w, i) => ({
    world: w,
    track: signatureFor(w) || spare[i % spare.length],
  }));
  // Name each stop by whatever actually varies along the route. With one
  // rhythm world every medallion would otherwise read SLINKY, which tells the
  // room nothing; the track is the thing that changes.
  const distinctWorlds = new Set(setList.map(r => r.world)).size;
  routeMap.setRoute(setList.map(r => ({
    label: distinctWorlds > 1 ? WORLDS[r.world].label : prettyTrack(r.track).toUpperCase(),
  })));
  setAt = -1;
  setScores = new Map();
  nodeReached.clear();
  document.body.classList.add('play');
  nextRound();
}

function endSet() {
  clearTimeout(roundTimer);
  setList = null; setAt = -1; setPhase = 'idle';
  document.body.classList.remove('play');
  $('round-intro').classList.remove('show');
}

function nextRound() {
  clearTimeout(roundTimer);
  hideResults();
  setAt++;
  if (!setList || setAt >= setList.length) { showSetResults(); return; }
  const r = setList[setAt];
  setPhase = 'intro';

  routeMap.at = setAt;
  $('ri-round').textContent = `round ${setAt + 1} of ${setList.length}`;
  $('ri-world').textContent = WORLDS[r.world].label;
  $('ri-mode').textContent = WORLDS[r.world].mode || 'PLAY';
  $('ri-rules').textContent = rulesFor(r.world);
  // same truth-in-teaching gate as the free-round intro: the tap demo only
  // appears where tapping is actually the verb
  $('ri-demo').style.display =
    (WORLDS[r.world].mode === 'RACE' && WORLDS[r.world].cue !== 'world') ? '' : 'none';
  $('ri-track').textContent = r.label || prettyTrack(r.track);
  $('ri-state').textContent = "fixin' to start";
  $('round-intro').classList.add('show');

  switchWorld(r.world);
  $('world-select').value = r.world;
  // The track starts NOW, under the intro card — charting happens beneath the
  // song, never beneath silence. Ten silent seconds before a round was the
  // most attention-hostile moment in the product, and it was the FIRST thing
  // every round served.
  audio.loadURL(r.track);
  audio.play().catch(() => {});
  $('track-select').value = r.track;

  // The card holds until the player presses PLAY. A timer decided how long
  // people were allowed to read; the button lets them take as long as they
  // need — and the round starting is then THEIR act, which matters.
  armPlayButton(() => {
    if (!setList || setPhase !== 'intro') return;
    setPhase = 'racing';
    $('round-intro').classList.remove('show');
    audio.play().catch(() => {});
    updatePlayBtn();
    startRaceIfReady();
  });
}

// one place that actually starts a free round, for host click AND guest sync
// ── Set-stats: the raw material of the end-of-set awards. Mine ride the
// state blobs (net.local.st); everyone else's arrive the same way.
const myStats = { bombs: 0, passes: 0, passed: 0, streak: 0, accSum: 0, accN: 0 };
function statsReset() {
  myStats.bombs = 0; myStats.passes = 0; myStats.passed = 0;
  myStats.streak = 0; myStats.accSum = 0; myStats.accN = 0;
  statsPush();
}
function statsPush() {
  const acc = myStats.accN ? Math.round(myStats.accSum / myStats.accN * 100) : 0;
  net.local.st = [myStats.bombs, myStats.passes, myStats.passed, myStats.streak, acc];
}
function statsRoundDone() {
  myStats.streak = Math.max(myStats.streak, race.bestStreak);
  myStats.accSum += race.accuracy; myStats.accN++;
  statsPush();
}

// ── The ghost: your best run on this song+world, back to race you. Solo's
// missing rival. Recorded as a progress curve, replayed as a phantom peer —
// the whole rival pipeline (placeGhost, standings, pass flashes) treats it
// as just another player called "your ghost".
let ghostRec = [], ghostKey = null, ghostData = null;
// the host's PLAY is the room's PLAY: broadcast the gun the instant a
// round starts, instead of making guests wait for score to cross the wire
function hostGo() {
  if (net.owner && net.connected) net.sendGo(audio.currentTime);
}
const GHOST_DT = 0.5;
function soloNow() {
  return !net.participants.some(p => !p.local && p.id !== 'ghost');
}
function armGhost() {
  ghostRec = [];
  const file = ($('track-select').value || audio.el.currentSrc || '').split('/').pop();
  ghostKey = file ? 'fp_ghost_' + currentWorldKey + '_' + file : null;
  ghostData = null;
  net.participants = net.participants.filter(p => p.id !== 'ghost');
  if (!ghostKey || !soloNow()) return;
  try { ghostData = JSON.parse(localStorage.getItem(ghostKey) || 'null'); } catch (e) { ghostData = null; }
  if (ghostData && Array.isArray(ghostData.v) && ghostData.v.length) {
    net.participants.push({
      id: 'ghost', name: 'your ghost', local: false, color: 7,
      x: 0, y: 0, z: 0, heading: 0, action: 'idle', joinedAt: performance.now(),
    });
  } else ghostData = null;
}
function ghostTick() {
  if (!race.active) return;
  const t = audio.currentTime;
  const idx = Math.floor(t / GHOST_DT);
  while (ghostRec.length <= idx) ghostRec.push(+race.progress.toFixed(1));
  ghostRec[idx] = +race.progress.toFixed(1);
  const g = net.participants.find(p => p.id === 'ghost');
  if (g && ghostData) {
    const f = t / GHOST_DT;
    const i0 = Math.min(ghostData.v.length - 1, Math.floor(f));
    const i1 = Math.min(ghostData.v.length - 1, i0 + 1);
    g.z = ghostData.v[i0] + (ghostData.v[i1] - ghostData.v[i0]) * (f - i0);
  }
}
function ghostRoundDone() {
  const wasGhostRun = !!ghostKey && soloNow() && ghostRec.length > 4;
  if (wasGhostRun && (!ghostData || race.progress > (ghostData.final || 0))) {
    try {
      localStorage.setItem(ghostKey, JSON.stringify({ dt: GHOST_DT, final: +race.progress.toFixed(1), v: ghostRec.slice(0, 700) }));
    } catch (e) { }
  }
  net.participants = net.participants.filter(p => p.id !== 'ghost');
  ghostKey = null; ghostData = null;
}

let guestArmed = false;
let goPending = false;   // the gun fired before our chart was ready
net.onGo = () => {
  if (!document.body.classList.contains('guest')) return;
  if (guestArmed && beatCue.chart && chartProgress < 0 && !race.active) {
    beginFreeRound();
  } else if (guestArmed) {
    goPending = true;    // start the moment the chart lands
  }
};
function beginFreeRound() {
  goPending = false;
  guestArmed = false;
  document.body.classList.remove('vibe-card');
  $('round-intro').classList.remove('show');
  setPhase = 'idle';
  race.start(beatCue.chart.duration, beatCue.chart.notes.length);
  clipBufStart();   // the reel rolls with the round
  armGhost();
  hostGo();
  seenMissed = beatCue.stats.missed;
  hideResults();
}

// show PLAY once the chart is ready; fire `go` on the click
let playArm = 0;
function armPlayButton(go) {
  const mine = ++playArm;
  $('ri-play').classList.remove('ready');
  (function waitReady() {
    if (mine !== playArm) return;
    if (!(chartProgress < 0 && beatCue.chart)) { setTimeout(waitReady, 200); return; }
    const pbNow = getBest();
    $('ri-state').textContent = 'ready when you are'
      + (pbNow > 0 ? "  \u00b7  your best 'round here: " + pbNow.toLocaleString() : '');
    $('ri-play').classList.add('ready');
    $('ri-play').onclick = () => {
      if (mine !== playArm) return;
      $('ri-play').classList.remove('ready');
      go();
    };
  })();
}

// Where a player stands on the route. Everyone advances together after each
// round — no turn order, because a room of twenty cannot watch one person move.
const nodeReached = new Map();
function setNodeOf(p, i) {
  const key = p.name || ('p' + i);
  return nodeReached.has(key) ? nodeReached.get(key) : setAt;
}

// ── Share — the marketing loop: this song, this world, one link ──
const SITE = location.host.includes('localhost')
  ? location.origin + location.pathname
  : 'https://' + location.host + location.pathname.replace(/index\.html$/, '');
function shareThis() {
  const file = ($('track-select').value || audio.el.currentSrc || '').split('/').pop();
  const w = WORLDS[currentWorldKey];
  let url, text;
  if (window.__sunoShare && shareableFree(currentWorldKey)) {
    // an artist's own song in a showcase world: the link carries THEIR track.
    // One home at a time — this share claims it, and every link ever sent
    // follows the song here (visitors look the home up on arrival).
    url = SITE + '?world=' + currentWorldKey + '&suno=' + encodeURIComponent(window.__sunoShare);
    text = "come play '" + (sunoTrack || 'my song') + "' in " + (w ? w.label : '') + ' \u2014 on Fancy Britches';
    fetch(`${SUNO_PROXY}share-home`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song: window.__sunoShare, world: currentWorldKey }),
    }).catch(() => {});
    shareThis._home = (w ? w.label : 'THIS WORLD');
  } else if (window.__sunoShare) {
    // their song outside the trio: the rope, once as the full card, then a
    // flash — and no link goes out, so the choice stays theirs
    if (!ropeShown) {
      ropeShown = true;
      $('taste-card').classList.remove('hidden');
    } else {
      const el = $('pass-flash');
      el.textContent = 'YOUR SONG SHARES FROM TUNNEL \u00b7 SURFER \u00b7 ' + WORLDS[WEEK_WORLD].label
        + ' THIS WEEK \u2014 ARTIST ACCESS OPENS ALL SEVENTEEN';
      el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
      clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 2800);
    }
    return;
  } else {
    url = SITE + '?world=' + currentWorldKey + (file ? '&track=' + encodeURIComponent(file) : '');
    text = file
      ? "come play '" + prettyTrack(file) + "' in " + (w ? w.label : '') + ' \u2014 Fancy Britches, by Tupelo Ghost'
      : 'come play Fancy Britches, by Tupelo Ghost';
  }
  if (navigator.share) {
    navigator.share({ title: 'Fancy Britches', text, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text + '\n' + url).then(() => {
      const el = $('pass-flash');
      el.textContent = shareThis._home
        ? 'LINK COPIED \u2014 ' + shareThis._home + ' IS YOUR SONG\u2019S HOME NOW'
        : 'LINK COPIED, SUGAR';
      shareThis._home = null;
      el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
      clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 1600);
    }).catch(() => {});
  }
}
$('rb-share').addEventListener('click', shareThis);

// ── CLIP: fifteen seconds of the run with the song's name and a scannable
// QR baked into the frame — the post IS the ad, the link rides inside it.
// Clips follow the share rule: house songs clip anywhere; an artist's song
// clips only where its share link works (the trio + the world of the week).
let clipDraw = false, clipRecs = [], clipRot = 0, clipStag = 0, clipSaved = null, clipMime = '';
function clipURL() {
  if (window.__sunoShare) return SITE + '?world=' + currentWorldKey + '&suno=' + encodeURIComponent(window.__sunoShare);
  const file = ($('track-select').value || audio.el.currentSrc || '').split('/').pop();
  return SITE + '?world=' + currentWorldKey + (file ? '&track=' + encodeURIComponent(file) : '');
}
// ── the rolling reel: while a round runs, two staggered recorders keep the
// last 7.5–15 seconds of the actual run — title and QR baked into every
// frame. When the results card appears the reel freezes; CLIP hands over
// the footage of what just happened, not the scoreboard.
function clipBufStart() {
  clipBufStop(false);
  clipSaved = null;
  if (!window.MediaRecorder) return;
  const game = document.getElementById('canvas');
  if (!game || !game.width) return;
  const W = 1280, H = Math.round(1280 * game.height / Math.max(1, game.width));
  const comp = document.createElement('canvas');
  comp.width = W; comp.height = H;
  const ctx2 = comp.getContext('2d');
  const qrc = document.createElement('canvas');
  const hasQR = drawQR(qrc, clipURL(), 3);
  const title = (window.__sunoShare ? (sunoTrack || 'my song')
    : prettyTrack(($('track-select').value || audio.el.currentSrc || 'this song'))).toUpperCase();
  const wlabel = WORLDS[currentWorldKey] ? WORLDS[currentWorldKey].label : '';
  clipDraw = true;
  (function frame() {
    if (!clipDraw) return;
    ctx2.drawImage(game, 0, 0, W, H);
    const bh = Math.round(H * 0.09);
    ctx2.fillStyle = 'rgba(4,4,10,0.62)';
    ctx2.fillRect(0, H - bh, W, bh);
    ctx2.fillStyle = 'rgba(240,238,255,0.92)';
    ctx2.font = '400 ' + Math.round(bh * 0.42) + 'px Didot, "Bodoni 72", Georgia, serif';
    ctx2.textBaseline = 'middle';
    ctx2.fillText(title + '  \u00b7  ' + wlabel + '  \u2014  FANCY BRITCHES', Math.round(bh * 0.5), H - bh / 2);
    if (hasQR) {
      const q = bh * 1.6, m = Math.round(bh * 0.25);
      ctx2.drawImage(qrc, W - q - m, H - q - m, q, q);
    }
    requestAnimationFrame(frame);
  })();
  const stream = comp.captureStream(30);
  try {
    audio.ensureContext();
    if (audio.ctx && audio.analyser) {
      if (!audio._recDest) { audio._recDest = audio.ctx.createMediaStreamDestination(); audio.analyser.connect(audio._recDest); }
      audio._recDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    }
  } catch (e) { /* silent clip beats no clip */ }
  clipMime = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';
  const mk = () => {
    let r;
    try {
      r = new MediaRecorder(stream, clipMime ? { mimeType: clipMime, videoBitsPerSecond: 5_000_000 } : undefined);
    } catch (e) { return null; }
    r._chunks = [];
    r._born = Date.now();
    r.ondataavailable = e => { if (e.data && e.data.size) r._chunks.push(e.data); };
    r.start(1000);
    return r;
  };
  const first = mk();
  if (!first) { clipDraw = false; return; }
  clipRecs = [first];
  clipStag = setTimeout(() => { if (clipDraw) { const r = mk(); if (r) clipRecs.push(r); } }, 7500);
  // rotation: any recorder past 15s starts over — between the pair there is
  // always one holding at least the last 7.5 seconds
  clipRot = setInterval(() => {
    clipRecs.forEach((r, i) => {
      if (r && r.state === 'recording' && Date.now() - r._born >= 15000) {
        try { r.onstop = null; r.stop(); } catch (e) {}
        const fresh = mk();
        if (fresh) clipRecs[i] = fresh;
      }
    });
  }, 1000);
}
function clipBufStop(keep) {
  clearTimeout(clipStag); clearInterval(clipRot);
  clipDraw = false;
  const recs = clipRecs; clipRecs = [];
  if (!recs.length) return;
  // the elder of the pair holds the most footage — that's the take
  const best = keep ? recs.slice().sort((x, y) => (y ? Date.now() - y._born : 0) - (x ? Date.now() - x._born : 0))[0] : null;
  recs.forEach(r => {
    if (!r) return;
    if (keep && r === best) {
      r.onstop = () => {
        const type = clipMime || 'video/webm';
        clipSaved = { blob: new Blob(r._chunks, { type }), type };
      };
    } else r.onstop = null;
    try { if (r.state !== 'inactive') r.stop(); } catch (e) {}
  });
}
function deliverClip() {
  const { blob, type } = clipSaved;
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  const fname = 'fancy-britches-clip.' + ext;
  const file = new File([blob], fname, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: 'Fancy Britches' }).catch(() => {});
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  const el = $('pass-flash');
  el.textContent = 'CLIP SAVED \u2014 POST IT, SUGAR';
  el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 2200);
}
$('rb-clip').addEventListener('click', () => {
  if (window.__sunoShare && !shareableFree(currentWorldKey)) {
    if (!ropeShown) { ropeShown = true; $('taste-card').classList.remove('hidden'); }
    else {
      const el = $('pass-flash');
      el.textContent = 'CLIPS RIDE TUNNEL \u00b7 SURFER \u00b7 ' + WORLDS[WEEK_WORLD].label + ' THIS WEEK \u2014 ARTIST ACCESS OPENS ALL SEVENTEEN';
      el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
      clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 2600);
    }
    return;
  }
  if (!clipSaved) {
    const el = $('pass-flash');
    el.textContent = 'NOTHING ON THE REEL YET \u2014 PLAY A ROUND FIRST';
    el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 2200);
    return;
  }
  deliverClip();
});

function prettyTrack(url) {
  return decodeURIComponent(url.split('/').pop().replace(/\.mp3$/i, '')).replace(/_/g, ' ');
}

// award the round, then roll on
function scoreRound() {
  const board = standings(participants);
  board.forEach((e, idx) => {
    const key = e.p.name || ('p' + e.i);
    setScores.set(key, (setScores.get(key) || 0) + (SET_POINTS[idx + 1] || 1));
    // everyone moves on, the leaders a medallion further — the map is where a
    // bad round stops being fatal
    nodeReached.set(key, Math.min((setList ? setList.length - 1 : 0), setAt + 1));
  });
}

function showSetResults() {
  clipBufStop(true);
  sig.endRun(runMeta('set', { rounds: setList ? setList.length : 0 }));
  document.body.classList.remove('play');
  setPhase = 'idle';
  const rows = [...setScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!rows.length) { endSet(); return; }
  $('results-place').textContent = rows[0][0] === (net.local.name || 'you') ? 'YOU WIN' : 'FULL TIME';
  const overs = ["that's the whole show", "y'all come back now", 'no more songs, no more stairs'];
  $('results-sub').textContent = overs[Math.floor(Math.random() * overs.length)];
  $('results-board').innerHTML = rows.map(([name, pts]) =>
    `<div class="rrow${name === net.local.name ? ' me' : ''}">`
    + `<i style="background:hsl(var(--accent-h),80%,70%)"></i>`
    + `<span>${name.replace(/[<>&]/g, '')}</span><b>${pts}</b></div>`).join('');
  $('rs-acc').textContent = Math.round(race.accuracy * 100) + '%';
  $('rs-streak').textContent = race.bestStreak;
  $('rs-notes').textContent = race.perfect + race.good;
  [...$('results-board').children].slice(0, 3).forEach((row, k) =>
    row.classList.add('m' + (k + 1)));
  celebrate(PALETTE[(net.local.color || 0) % PALETTE.length], rows[0][0] === (net.local.name || 'you'));
  $('rb-again').textContent = 'RUN IT BACK';
  $('rb-next').textContent = 'BACK TO VIBE';
  $('rb-again').dataset.mode = 'set';
  $('rb-next').dataset.mode = 'set';
  $('results-actions').classList.add('show');
  resultsShown = true;
  $('results').classList.add('show');
  clearTimeout(resultsTimer);
  setList = null;   // the set is settled; the buttons decide what happens next

  // ── the awards: the set's last word, one honour at a time ──
  // Everyone computes the same winners from the same shared stats, so every
  // screen agrees; you bank the bonus only for awards YOU won.
  const entrants = [
    { name: net.local.name || 'you', st: net.local.st || [0, 0, 0, 0, 0] },
    ...net.participants.filter(p => !p.local && p.id !== 'ghost' && p.st)
      .map(p => ({ name: p.name, st: p.st })),
  ];
  const CATS = [
    { i: 0, title: 'MOST TROUBLE', why: 'bombs thrown' },
    { i: 1, title: "'SCUSE ME", why: 'most passes made' },
    { i: 2, title: 'BLESS YOUR HEART', why: 'most passed-by' },
    { i: 3, title: 'STEADIEST HAND', why: 'longest streak' },
    { i: 4, title: 'CLEANEST RUN', why: 'best accuracy' },
  ];
  const box = $('awards');
  box.innerHTML = '';
  let shown = 0;
  for (const cat of CATS) {
    const ranked = entrants.filter(e => (e.st[cat.i] || 0) > 0)
      .sort((a, b) => (b.st[cat.i] - a.st[cat.i]) || a.name.localeCompare(b.name));
    if (!ranked.length) continue;
    const win = ranked[0];
    const mine = win.name === (net.local.name || 'you');
    const row = document.createElement('div');
    row.className = 'award';
    row.innerHTML = `<b>${cat.title}</b><span>${win.name.replace(/[<>&]/g, '')} \u00b7 ${cat.why}</span><em>+15</em>`;
    setTimeout(() => {
      box.appendChild(row);
      sfx.pass(true);
      impact(0.5);
      if (mine) addScore(15, undefined, undefined, true);
    }, 1200 + shown * 1400);
    shown++;
  }
  if (shown) setTimeout(() => sfx.fanfare(), 1200 + shown * 1400);
}

$('join-name').value = localStorage.getItem('fp_name') || '';
$('sc-hide').addEventListener('click', () => $('stream-card').classList.add('hidden'));

// ── promo: the host's shout-out, shown to the whole room ──
function showPromo(promo) {
  const pill = $('promo-pill');
  if (!promo || !promo.label || !/^https?:\/\//.test(promo.url || '')) {
    pill.classList.add('hidden');
    pill.onclick = null;
    return;
  }
  $('promo-pill-text').textContent = promo.label;
  pill.classList.remove('hidden');
  pill.onclick = () => window.open(promo.url, '_blank', 'noopener');
}
net.onPromo = showPromo;
// (the promo sender retired: the marquee announces the song automatically —
// guests still render a pill if a promo ever arrives on the wire)
// The marquee is theirs to word — for THEIR songs. The house catalog's names
// are not editable; this row only ever appears for suno links and mp3s.
function marqueeApply() {
  const t = $('mq-title').value.trim(), a = $('mq-artist').value.trim();
  sunoTrack = [t, a].filter(Boolean).join(' — ') || sunoTrack;
  hostSong();   // push the new words to the room now, not in 4 seconds
}
$('mq-title').addEventListener('input', marqueeApply);
$('mq-artist').addEventListener('input', marqueeApply);

$('balls-quick-range').addEventListener('input', e => {
  const v = +e.target.value;
  settings.balls = v;
  $('balls-quick-val').textContent = v;
  $('balls').value = v;
  const bv = $('balls-val'); if (bv) bv.textContent = v;
});

// ── signals wiring: songs, tweaks, room, snapshot ──
audio.el.addEventListener('playing', () => {
  const src = audio.el.currentSrc || audio.el.src || '';
  if (src) sig.songStarted(decodeURIComponent(src.split('/').pop()));
});
{
  const looks = document.getElementById('page-looks');
  if (looks) {
    looks.addEventListener('click', e => { if (e.target.closest('button, .chip, .wchip, .qb, select, [role="button"]')) sig.tweak(); });
    looks.addEventListener('input', () => sig.tweak());
  }
}
function runMeta(kind, extra = {}) {
  return {
    kind,
    songTitle: window.__sunoShare ? (sunoTrack.split(' — ')[0] || 'their song') : prettyTrack($('track-select').value || audio.el.currentSrc || ''),
    artistName: window.__sunoShare ? (sunoTrack.split(' — ')[1] || '') : 'Tupelo Ghost',
    lookId: settings.colorMode + '/' + settings.pattern + '/' + settings.shape,
    ...extra,
  };
}
window.__lastRun = () => sig.lastRun || null;
window.__signals = () => sig.snapshot({
  worldId: currentWorldKey,
  lookId: settings.colorMode + '/' + settings.pattern + '/' + settings.shape,
  songTitle: window.__sunoShare ? (sunoTrack.split(' \u2014 ')[0] || 'their song') : prettyTrack($('track-select').value || audio.el.currentSrc || ''),
  artistName: window.__sunoShare ? (sunoTrack.split(' \u2014 ')[1] || '') : 'Tupelo Ghost',
});

$('custom-open').addEventListener('click', e => {
  e.preventDefault();
  $('waitlist-form').classList.add('hidden');
  $('custom-form').classList.toggle('hidden');
});
$('cw-send').addEventListener('click', () => {
  const email = $('cw-email').value.trim();
  const occasion = $('cw-occasion').value;
  const vision = $('cw-vision').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('cw-msg').textContent = "that email doesn't look right, hon"; return; }
  if (!occasion && !vision) { $('cw-msg').textContent = 'tell us a little something first'; return; }
  $('cw-msg').textContent = 'sending\u2026';
  fetch('https://' + window.FANCYPANTS_HOST + '/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, occasion, vision,
      timeline: $('cw-timeline').value.trim(), budget: $('cw-budget').value }),
  }).then(r => {
    $('cw-msg').textContent = r.ok ? "got it, sugar \u2014 we'll be in touch soon" : 'that did not take \u2014 try again?';
    if (r.ok) setTimeout(() => $('custom-form').classList.add('hidden'), 2600);
  }).catch(() => { $('cw-msg').textContent = 'no connection \u2014 try again in a spell'; });
});
$('wl-join').addEventListener('click', () => {
  const email = $('wl-email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('wl-msg').textContent = "that email doesn't look right, hon"; return; }
  $('wl-msg').textContent = 'signing you up\u2026';
  fetch('https://' + window.FANCYPANTS_HOST + '/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, note: 'artist waitlist' }),
  }).then(r => {
    $('wl-msg').textContent = r.ok ? "you're on the list, sugar \u2014 we'll holler" : 'that did not take \u2014 try again?';
    if (r.ok) { $('wl-email').value = ''; setTimeout(() => $('waitlist-form').classList.add('hidden'), 2200); }
  }).catch(() => { $('wl-msg').textContent = 'no connection \u2014 try again in a spell'; });
});
$('room-badge').addEventListener('click', () => {
  if (document.body.classList.contains('hosting')) $('stream-card').classList.toggle('hidden');
});
$('join-room').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
$('join-room').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
$('btn-join').addEventListener('click', () => {
  const code = $('join-room').value.trim().toUpperCase();
  if (code.length < 4) { $('join-msg').textContent = "we'll need that room code, sugar"; return; }
  startRoom(code, $('join-name').value.trim(), false);
});
$('btn-host').addEventListener('click', () => {
  startRoom(genCode(), ensureName(), true);
  setTimeout(askMode, 400);
});
// a name nobody had to type — southern, friendly, never blocking the door
const NAME_POOL = ['junebug', 'firefly', 'possum', 'magnolia', 'catfish',
                   'sugarplum', 'clover', 'biscuit', 'dixie', 'banjo'];
function ensureName() {
  let n = $('join-name').value.trim();
  if (!validName(n)) {
    n = NAME_POOL[(Math.random() * NAME_POOL.length) | 0] + (10 + (Math.random() * 90 | 0));
    $('join-name').value = n;
  }
  net.local.name = n;
  localStorage.setItem('fp_name', n);
  // the ladder remembers this name's points from every visit before
  const kept = parseInt(localStorage.getItem('fp_score_' + n) || '0', 10);
  if (kept > score) { score = kept; net.local.score = score; $('score-val').textContent = score; $('score-badge').classList.remove('hidden'); }

  // ── the visit streak: coming back is worth something ──
  const today = new Date(); const stamp = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  const last = localStorage.getItem('fp_lastVisit');
  if (last !== stamp) {
    const y = new Date(Date.now() - 86400000); const yesterday = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
    const streak = last === yesterday ? (parseInt(localStorage.getItem('fp_streak') || '0', 10) + 1) : 1;
    localStorage.setItem('fp_streak', String(streak));
    localStorage.setItem('fp_lastVisit', stamp);
    if (streak > 1) {
      const bonus = Math.min(50, streak * 5);
      setTimeout(() => {
        addScore(bonus, undefined, undefined, true);
        const el = $('pass-flash');
        el.textContent = 'DAY ' + streak + ' IN A ROW \u00b7 +' + bonus + ', SUGAR';
        el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
        clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 2600);
      }, 2500);
    }
  }
  return n;
}
$('btn-solo').addEventListener('click', () => {
  if (window.__joinIntent) {
    const code = window.__joinIntent; window.__joinIntent = null;
    startRoom(code, ensureName(), false);
    return;
  }
  ensureName();
  dismissOverlay();
  setTimeout(askMode, 400);
});
// the artist's door feeds the waiting list for now — self-serve pasting
// returns when artist features launch (?suno= demo links still work)
// ── the artist door: paste and share all you want. Your song rides
// three worlds free; the other fourteen play the house catalog — the
// demo IS her music, and every share is marketing ──
// ── the showcase pair and the world of the week ──
// FEATURED: the front-porch worlds, always up top in the picker.
// The week world rotates through everything EXCEPT the featured pair
// (they're always around — the guest spot belongs to the others), anchored
// so week 2953 = SLIDE and it advances every Monday from there.
const FEATURED = ['tunnel', 'surfer'];
const WEEK_WORLD = (() => {
  const pool = Object.keys(WORLDS).filter(k => !FEATURED.includes(k)).sort();
  const week = Math.floor(Date.now() / 604800000);
  const anchor = pool.indexOf('slide') - 2953;
  return pool[((week + anchor) % pool.length + pool.length) % pool.length];
})();
// free share worlds = the showcase pair + this week's guest — exactly the
// three the picker leads with. Artist access opens the other fourteen.
const shareableFree = k => FEATURED.includes(k) || k === WEEK_WORLD;
window.__FEATURED_KEYS = FEATURED;
window.__WEEK_KEY = WEEK_WORLD;
window.__pickerInit();
let ropeShown = false;   // the explainer card appears once per session
$('btn-own').addEventListener('click', () => {
  $('custom-form').classList.add('hidden');
  document.body.classList.add('suno-live');
  ensureName();
  dismissOverlay();
  panel.classList.remove('hidden', 'collapsed');
  document.querySelector('#tabs .tab[data-tab="music"]')?.click();
  setTimeout(() => { $('suno-input').focus(); $('suno-input').scrollIntoView({ block: 'center' }); }, 350);
  $('suno-rights').textContent = 'play your song in every world, free \u2014 share from TUNNEL, SURFER, or this week\u2019s ' + WORLDS[WEEK_WORLD].label;
});
$('taste-join').addEventListener('click', () => {
  const email = $('taste-email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('taste-msg').textContent = "that email doesn't look right, hon"; return; }
  $('taste-msg').textContent = 'signing you up\u2026';
  fetch('https://' + window.FANCYPANTS_HOST + '/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, note: 'artist-access' }),
  }).then(r => {
    $('taste-msg').textContent = r.ok ? "you're on the list, sugar \u2014 we'll holler" : 'that did not take \u2014 try again?';
    if (r.ok) setTimeout(() => { $('taste-card').classList.add('hidden'); }, 2000);
  }).catch(() => { $('taste-msg').textContent = 'no connection \u2014 try again in a spell'; });
});
// the rope card's dynamic line: this week's guest world, by name
const tw = document.getElementById('taste-week');
if (tw) tw.textContent = WORLDS[WEEK_WORLD].label;
$('taste-close').addEventListener('click', () => {
  $('taste-card').classList.add('hidden');
});
// The door only opens when a button is pressed. The old click-anywhere
// fallback predates the real buttons and turned every stray tap into an
// accidental game.

// URL params (?world=tunnel supported now; room/names reserved for later phases)
const params = new URLSearchParams(location.search);
const startWorld = WORLDS[params.get('world')] ? params.get('world') : 'tunnel';
$('world-select').value = startWorld;
switchWorld(startWorld);

// participants overlay: click a name to kill just that name (they keep playing)
// ── Emoji bombs ── click a player, pick an emoji, and it rains all over
// THEIR screen. Costs points, which completes the economy: rounds pay you at
// the bell, and this is what the money is FOR — mischief.
const EMOJIS = ['\u2764\uFE0F', '\u{1F47B}', '\u{1F319}', '\u{1F352}', '\u2728', '\u{1F4A9}', '\u{1F61B}', '\u{1F618}'];  // heart, ghost, moon, cherry, stars, poop, tongue, kiss — her list, verbatim
const BOMB_COST = 15;
// Tricks are the Mario Kart layer: not decoration on a rival's screen but a
// hand on their wheel. Dearer than a bomb because they change the race.
const TRICKS = [
  { i: 100, e: '\u{1F32B}\uFE0F', name: 'fog',  cost: 30 },   // a veil of light over their view
  { i: 101, e: '\u{1F4AB}', name: 'sway', cost: 30 },          // their camera goes drunk
];
// what's currently being done TO you
const debuff = { fogUntil: 0, swayUntil: 0, from: '' };

// each emoji lands like ITSELF: hearts rise, ghosts drift, the moon arcs,
// sparkles twinkle in place, poop splats and sits there (the funniest part),
// the tongue bounces, kisses fly to the middle and smack
const RAIN_STYLE = {
  '\u2764\uFE0F': { cls: 'rain-rise', n: 26 },
  '\u{1F47B}': { cls: 'rain-spook', n: 22 },
  '\u{1F319}': { cls: 'rain-arc', n: 12 },
  '\u{1F352}': { cls: 'rain-bounce', n: 26 },
  '\u2728': { cls: 'rain-twinkle', n: 44 },
  '\u{1F4A9}': { cls: 'rain-splat', n: 22 },
  '\u{1F61B}': { cls: 'rain-boing', n: 16 },
  '\u{1F618}': { cls: 'rain-smooch', n: 8 },
};
function emojiRain(char, fromName) {
  const box = $('emoji-rain');
  const style = RAIN_STYLE[char] || { cls: '', n: 34 };
  for (let i = 0; i < style.n; i++) {
    const sp = document.createElement('span');
    sp.textContent = char;
    if (style.cls) sp.className = style.cls;
    sp.style.left = (Math.random() * 100) + 'vw';
    sp.style.top = style.cls === 'rain-twinkle' ? (Math.random() * 90) + 'vh' : '';
    sp.style.fontSize = (style.cls === 'rain-smooch' ? 44 + Math.random() * 30 : 18 + Math.random() * 30) + 'px';
    sp.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
    sp.style.animationDelay = (Math.random() * 1.2) + 's';
    sp.addEventListener('animationend', () => sp.remove());
    box.appendChild(sp);
  }
  if (fromName) {
    const el = $('pass-flash');
    el.textContent = fromName.toUpperCase() + ' SENT ' + char;
    el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 2200);
  }
  sfx.fanfare();
  impact(0.5);
}

function sendBomb(toName, idx) {
  if (score < BOMB_COST) {
    const b = $('score-badge');
    b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    sfx.thud();
    const el = $('pass-flash');
    el.textContent = "YOU'LL NEED " + BOMB_COST + ' PTS FOR THAT, SUGAR';
    el.classList.add('bad'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 1600);
    return;
  }
  addScore(-BOMB_COST, undefined, undefined, true);
  myStats.bombs++; statsPush();
  net.sendEmote(idx, toName, EMOJIS[idx]);
  const el = $('pass-flash');
  el.textContent = EMOJIS[idx] + ' \u2192 ' + toName.toUpperCase();
  el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 1600);
  sfx.hit(6, true);
}

net.onEmote = (p, i, to, e) => {
  if (to && to === net.local.name && i >= 100) {
    // a trick landed ON YOU — four seconds of somebody's hand on your wheel
    const now = performance.now();
    if (i === 100) debuff.fogUntil = now + 4000;
    if (i === 101) debuff.swayUntil = now + 4000;
    debuff.from = p.name || '?';
    const el = $('pass-flash');
    el.textContent = debuff.from.toUpperCase() + ' ' + (i === 100 ? '\u{1F32B}\uFE0F FOGGED YOU' : '\u{1F4AB} SWAYED YOU');
    el.classList.add('bad'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 2000);
    sfx.thud();
    return;
  }
  if (to && to === net.local.name) emojiRain(e || EMOJIS[i] || EMOJIS[0], p.name);
  else if (to) {
    const el = $('pass-flash');
    el.textContent = (p.name || '?').toUpperCase() + ' ' + (EMOJIS[i] || '') + ' ' + to.toUpperCase();
    el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 1400);
  }
};

function renderPlist() {
  const box = $('plist-rows');
  box.innerHTML = '';
  const ranked = [...participants].sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const p of ranked) {
    const row = document.createElement('div');
    row.className = 'plist-row' + (presence.hiddenNames.has(p.name) ? ' muted' : '');
    row.innerHTML = `<span>${p.name}${p.local ? ' ·you' : ''}</span><span>${p.score || 0}</span>`;
    if (p.local) { box.appendChild(row); continue; }
    // click a rival: the emoji picker unfolds under their name
    row.addEventListener('click', () => {
      const open = row.nextElementSibling && row.nextElementSibling.classList.contains('bomb-picker');
      box.querySelectorAll('.bomb-picker').forEach(x => x.remove());
      if (open) return;
      const pick = document.createElement('div');
      pick.className = 'bomb-picker';
      EMOJIS.forEach((e2, k) => {
        const b = document.createElement('button');
        b.textContent = e2;
        b.addEventListener('click', ev => { ev.stopPropagation(); sendBomb(p.name, k); pick.remove(); });
        pick.appendChild(b);
      });
      const price = document.createElement('em');
      price.textContent = BOMB_COST + ' pts';
      pick.appendChild(price);
      // the tricks row — the ones with a hand on the wheel
      const trickRow = document.createElement('div');
      trickRow.className = 'bomb-picker tricks';
      TRICKS.forEach(t => {
        const b = document.createElement('button');
        b.textContent = t.e;
        b.title = t.name;
        b.addEventListener('click', ev => {
          ev.stopPropagation();
          if (score < t.cost) { sfx.thud(); return; }
          addScore(-t.cost, undefined, undefined, true);
          myStats.bombs++; statsPush();
          net.sendEmote(t.i, p.name, t.e);
          const el = $('pass-flash');
          el.textContent = t.e + ' \u2192 ' + p.name.toUpperCase();
          el.classList.remove('bad', 'show'); void el.offsetWidth; el.classList.add('show');
          clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show'), 1600);
          sfx.hit(9, true);
          pick.remove(); trickRow.remove();
        });
        trickRow.appendChild(b);
      });
      const tp2 = document.createElement('em');
      tp2.textContent = 'tricks \u00b7 30 pts';
      trickRow.appendChild(tp2);
      row.after(trickRow);
      row.after(pick);
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
  if (room) {
    // a scanned QR carries maximum intent: the big button becomes the door
    // to THAT room, name auto-picked — one tap from camera to the game
    $('join-room').value = room.toUpperCase();
    window.__joinIntent = room.toUpperCase();
    $('btn-solo').textContent = 'JOIN ROOM ' + room.toUpperCase();
  }
}
settings.broadcast = false;

// ── Loop ──
let last = performance.now();
let fpsFrames = 0, fpsTime = 0, time = 0, lowFpsStreak = 0;
let screenshotQueued = false;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);

  // ── hit-stop ── the world freezes for a breath on every strong hit. This is
  // Nintendo's oldest trick and the whole difference between contact and
  // passing-through: 55ms of near-stillness makes a hit something that
  // HAPPENED to the world, not a number that changed. It applies to the verb
  // itself, in every world, solo included — which is where all the recent
  // multiplayer-facing juice was silent.
  if (hitStop > 0) {
    hitStop -= dt;
    dt *= 0.06;
  }
  last = now;
  time += dt;

  const a = audio.update(dt);
  net.update(dt, time);
  updateCursor(dt, a);

  // click color-pulse: hue kicks sideways, saturation and bloom surge, then settle
  clickPulse *= Math.pow(0.03, dt);
  // the hit lands as light — a bloom swell that blooms slower than the colour
  // surge, so a tap opens the frame up rather than jolting it
  bloomKick *= Math.pow(0.06, dt);
  const hueEff = (settings.hue + clickPulse * 40) % 360;
  gradePass.uniforms.saturation.value = 1.45 + clickPulse * 0.55;
  gradePass.uniforms.contrast.value = 1.12 + clickPulse * 0.08;
  if (bloomPass.enabled) bloomPass.strength = bloomBase * (1 + clickPulse * 0.5 + bloomKick * 0.42);

  // give the world back the camera it set last frame, before it moves it again
  if (worldShot) {
    if (camera.fov !== worldShot.fov) { camera.fov = worldShot.fov; camera.updateProjectionMatrix(); }
    camera.position.set(worldShot.x, worldShot.y, worldShot.z);
    worldShot = null;
  }

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
    holding: pointerHeld || throttleKey,
    time,
    addScore,
    impact,
    race,          // worlds read progress/momentum; the rules live in lib/race.js
    chart: beatCue.chart ? beatCue.chart.notes : null,  // a CATCH world writes
    songTime: audio.currentTime,                        // its own round from these
    songDur: beatCue.chart ? beatCue.chart.duration : 0, // for late-song heat
    judge: lastJudge,                                   // in-world cues answer
    judgeAge: (performance.now() - lastJudgeAt) / 1000, // the last press
    onPass: flashPass,                                  // you went by, or they did
  });

  // The viewer's framing sits ON TOP of whatever the world asked for — and is
  // handed straight back afterwards. Applying it in place would feed into the
  // world's own easing next frame and compound away (which it did: the
  // portrait nudge alone drove every world to the 125-degree ceiling).
  const shot = { fov: camera.fov, x: camera.position.x, y: camera.position.y, z: camera.position.z };
  {
    // ── tricks land here, in viewer space, so every world feels them ──
    const nowMs = performance.now();
    const swayLeft = (debuff.swayUntil - nowMs) / 1000;
    if (swayLeft > 0) {
      const fall = Math.min(1, swayLeft / 1.2);          // eases off at the end
      camera.rotation.z += Math.sin(nowMs * 0.006) * 0.3 * fall;
      camera.fov *= 1 + Math.sin(nowMs * 0.004) * 0.06 * fall;
    }
    const fogLeft = (debuff.fogUntil - nowMs) / 1000;
    $('fog-veil').style.opacity = fogLeft > 0 ? Math.min(0.86, fogLeft / 1.4) : 0;

    // the boost punch: a strong hit widens the lens for a heartbeat — speed
    // you can SEE, decaying on the spring
    fovKick *= Math.pow(0.0005, dt);
    camera.fov *= 1 + fovKick * 0.055;

    zoom += (zoomTarget - zoom) * Math.min(1, dt * 6);   // glide, never jump
    const portrait = camera.aspect < 1 ? 1 + (1 - camera.aspect) * 0.34 : 1;
    camera.fov = Math.max(18, Math.min(125, shot.fov * zoom * portrait));
    camera.updateProjectionMatrix();
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
  // predicted beat grid — fires through the gaps the onset detector misses
  // the audio graph is built lazily on first play — adopt the analyser
  // whenever it appears or is replaced
  if (beatClock.analyser !== audio.analyser) beatClock.setAnalyser(audio.analyser);
  const gridBeat = beatClock.update(audio.currentTime);
  drawTempo(gridBeat, beatClock.onsetAt != null);
  if (setPhase === 'intro') {
    drawDemo(dt, settings.hue);
    routeMap.setTokens(participants.map((p, i) => ({
      name: p.name || ('p' + i),
      color: PALETTE[(p.color || 0) % PALETTE.length],
      at: setNodeOf(p, i),
      me: i === 0,
    })));
    routeMap.draw(dt, settings.hue);
    $('ri-state').textContent = chartProgress >= 0
      ? 'charting ' + Math.round(chartProgress * 100) + '%'
      : (beatCue.chart
          ? 'ready when you are'
            + (getBest() > 0 ? "  \u00b7  your best 'round here: " + getBest().toLocaleString() : '')
          : "fixin' to start");
  }
  // a held arrow steers; releasing eases back to centre rather than snapping
  if (steeredRound() && world && world.setInput) {
    if (keySteer !== 0) {
      keyAim += (keySteer - keyAim) * Math.min(1, dt * 6);
      world.setInput(keyAim, 0);
    } else if (Math.abs(keyAim) > 0.001) {
      keyAim += (0 - keyAim) * Math.min(1, dt * 4);
      world.setInput(keyAim, 0);
    }
  }

  updateHUD();
  checkBest();

  // rubber-band: how far ahead is the best rival? Behind, your hits pay more.
  if (race.active && race.mode === 'RACE') {
    let lead = 0;
    for (let i = 1; i < participants.length; i++) lead = Math.max(lead, participants[i].z || 0);
    const gap = lead - race.progress;
    race.rubber = (gap > 0 ? Math.min(0.5, gap / 60) : 0) * TUNE.rubber;
  }

  // a guest's round starts when the host's does — their progress arriving on
  // the wire IS the starting gun
  if (guestArmed && beatCue.chart && chartProgress < 0 && !race.active &&
      (goPending || participants.some(p => !p.local && (p.z || 0) > 0.5))) {
    beginFreeRound();
  }

  if (document.body.classList.contains('round')) {
    // The one instruction, retired as soon as the player is clearly landing
    // notes — or after twelve seconds, whichever comes first. Three good
    // presses is proof enough that it has been understood.
    const onOrb = document.body.classList.contains('orb');
    const landed = beatCue.stats.perfect + beatCue.stats.good;
    $('press-hint').classList.toggle('show',
      onOrb && race.active && landed < 3 && audio.currentTime < 14);
    beatCue.update(beatClock, audio.currentTime);
    // Cue misses only exist in PRESS rounds. In a steered round (river,
    // blacktop, slide, cherry) nobody is tapping, so every chart note times
    // out unplayed — and feeding those into the race buried a clean run under
    // ~450 phantom misses. Hit every ramp, get told 7%. The world scores its
    // own misses there via drop(); the cue's opinion is irrelevant.
    if (document.body.classList.contains('press')) {
      while (seenMissed < beatCue.stats.missed) { race.miss(); seenMissed++; }
    } else {
      seenMissed = beatCue.stats.missed;   // keep the counter aligned, feed nothing
    }
    const wasFinished = race.finished;
    race.update(dt, audio.currentTime);
    ghostTick();
    // the edge glow answers the same hold the worlds feel
    const burnable = race.active && race.mode === 'DODGE';
    document.body.classList.toggle('burning', burnable && (pointerHeld || throttleKey));
    if (race.finished && !wasFinished) showResults('finished');
    // progress rides on z, which is already on the wire and already
    // interpolated — the field on screen is everyone's real position
    net.local.z = race.progress;
    // If the world names its subject, the rings close on IT — so keeping time
    // and watching the world are the same act, not competing ones.
    let anchor = null;
    if (world && world.cueAnchor) {
      world.cueAnchor(anchorV);
      anchorV.project(camera);
      if (anchorV.z < 1) {
        anchor = {
          x: Math.max(0.22, Math.min(0.78, anchorV.x * 0.5 + 0.5)) * window.innerWidth,
          y: Math.max(0.2, Math.min(0.72, -anchorV.y * 0.5 + 0.5)) * window.innerHeight,
        };
      }
    }
    if (onOrb) beatCue.draw(beatClock, audio.currentTime, settings.hue, anchor, race.active ? {
      fraction: race.fractionShown,
      feet: race.feet,
      feetLeft: race.feetLeft,
      unit: race.unit,
      collect: race.mode === 'COLLECT',
      mult: race.multiplier,
      place: placeOf(participants),
      rivals: participants.slice(1, 12).map(p => ({
        f: race.finish ? (p.z || 0) / race.finish : 0,
        color: PALETTE[(p.color || 0) % PALETTE.length],
      })),
    } : null);
  }

  pulses.update(dt, a.beatIntensity);

  presence.update(dt, participants,
    world.placeGhost ? world.placeGhost.bind(world) : (p, i, out) => out.set(p.x, p.y, p.z),
    { beatIntensity: a.beatIntensity, time, camera });

  if (settings.broadcast) {
    // widen to frame the crowd, not the local player
    camera.fov = Math.min(118, camera.fov + 9);
    camera.updateProjectionMatrix();
  }

  composer.render();

  // NOTE: the camera deliberately keeps the viewer's framing until the next
  // frame begins. Taps happen between frames, and they must hit-test against
  // the camera actually on screen — restoring here made every tap on a phone
  // land on the wrong cell, because portrait widens the view.
  worldShot = shot;

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
