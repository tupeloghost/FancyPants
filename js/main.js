// Shared shell: renderer, loop, audio engine, controls panel, world switcher.
// Single-player build — the net layer and participants list are stubbed so
// worlds already code against the final interface.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { AudioEngine } from './audio-engine.js?v=500';
import { drawQR } from './lib/qr.js?v=500';
import { WORLDS } from './worlds/registry.js?v=500';
import { Net, PALETTE } from './net.js?v=500';
import { Presence } from './lib/presence.js?v=500';
import { Pulses } from './lib/pulse.js?v=500';
import { BeatClock } from './lib/beatclock.js?v=500';
import { BeatCue } from './lib/beatcue.js?v=500';
import { analyseTrack, cachedChart } from './lib/analyse.js?v=500';
import { Race, placeOf, standings } from './lib/race.js?v=500';
import { Signals } from './lib/signals.js?v=500';
import { pickShareLine, loadLines } from './lib/lines.js?v=500';
import { RouteMap } from './lib/map.js?v=500';
import * as sfx from './lib/sfx.js?v=500';
import { TUNE, saveTune, resetTune } from './lib/tune.js?v=500';
import { glowTexture } from './lib/glow.js?v=500';

// ── Renderer ──
const canvas = document.getElementById('canvas');
window.__booted = true;   // the watchdog stands down; the module runs
const IS_MOBILE = matchMedia('(pointer: coarse)').matches;
window.__LITE = IS_MOBILE;   // worlds thin their heaviest layers when set
// preserveDrawingBuffer keeps the last frame readable — the clip reel and
// world previews draw from the canvas, and without it they read black
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE, powerPreference: 'high-performance', preserveDrawingBuffer: true });

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));   // aliased wireframes read as cheap; LITE worlds thin geometry instead
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
  window.__settings = settings; // same purpose
  if (window.__sig) window.__sig.enterWorld(key);
  armNudge(key);
  if (lookBefore) { applyPreset(lookBefore); lookBefore = null; }   // your look comes home with you
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
    if (key === window.__WEEK_KEY) b.title = 'this week\u2019s special';
    b.addEventListener('click', () => { $('world-select').value = key; switchWorld(key); });
    chips.appendChild(b);
  };
  front.forEach(k => mk(k));
  // the library: past specials, home for good. Absent in week one — an empty
  // shelf is a worse look than no shelf.
  (window.__GRADUATED || []).forEach(k => mk(k, 'alum'));
  const cap = document.createElement('div');
  cap.id = 'wchip-cap';
  cap.textContent = '\u2605 this week\u2019s special: a new world joins the library every monday';
  chips.parentElement.insertBefore(cap, chips.nextSibling);
};
for (const [key, w] of Object.entries(WORLDS)) {
  const opt = document.createElement('option');
  opt.value = key; opt.textContent = w.label;
  $('world-select').appendChild(opt);
}
$('world-select').addEventListener('change', e => switchWorld(e.target.value));

// The house catalogue comes in two flavours and the player picks: the songs
// with vocals, or the instrumentals. Instrumental leads, because a voice
// competes with a game for the same attention and these worlds are the show.
// Each pool is a plain manifest, so adding music is a file drop and a line.
fetch('audio/manifest.json?t=' + Date.now())
  .then(r => (r.ok ? r.json() : []))
  .then(list => {
    vocalPool = list.map(f => 'audio/' + f);
    return fetch('audio/instrumentals.json?t=' + Date.now())
      .then(r => (r.ok ? r.json() : [])).catch(() => []);
  })
  .then(inst => {
    instrPool = (inst || []).map(f => 'audio/' + f);
    // never leave the room silent: with no instrumentals, the voices sing
    if (!instrPool.length) wantVocals = true;
    rebuildTrackPool();
    syncAudioModeUI();
    // if the room's already running and silent, start the music now
    if (autoWanted && !audio.el.src) playAuto(false);
    // ── today's song: one date-picked track, named at the front door ──
    if (trackList.length) {
      const d = new Date();
      const dayN = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
      // a name ending in a bare numeral reads as a version number on the
      // front door ("hello goodbye 2"), so today's pick prefers a clean title
      const clean = trackList.filter(f => !/_\d+\.mp3$/i.test(f));
      const pickFrom = clean.length ? clean : trackList;
      const file = pickFrom[dayN % pickFrom.length];
      const wkey = Object.keys(WORLD_TRACKS).find(k => 'audio/' + WORLD_TRACKS[k] === file);
      const el = $('today');
      if (el) {
        el.textContent = "today\u2019s song: " + prettyTrack(file)
          + '. tap to play it in this week\u2019s special, ' + WORLDS[window.__WEEK_KEY].label;
        el.classList.remove('hidden');
        el.onclick = () => {
          window.__shareTrack = file;
          window.__shareWorld = window.__WEEK_KEY;
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

// ── test audio (dev only): a private playlist so testing doesn't wear out
// the real songs. Files sit in /audio but never in manifest.json — visitors
// can't see them; this switch is the only way in. Sticky per device.
let vocalPool = [], instrPool = [];
// instrumental is the default: nobody has opted into vocals until they say so
let wantVocals = localStorage.getItem('fp_vocals') === '1';

function rebuildTrackPool() {
  const pool = (wantVocals ? vocalPool : instrPool);
  trackList = pool.slice();
  const sel = $('track-select');
  [...sel.options].filter(o => o.value.startsWith('audio/')).forEach(o => o.remove());
  for (const t of pool) {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = prettyTrack(t);
    sel.appendChild(opt);
  }
  autoOrder = []; autoAt = 0;            // reshuffle from the new pool
}

function setVocals(on) {
  if (wantVocals === !!on) return;
  wantVocals = !!on;
  localStorage.setItem('fp_vocals', on ? '1' : '');
  rebuildTrackPool();
  syncAudioModeUI();
  if (!document.body.classList.contains('guest')) playAuto(true);   // hear it now
}

// every control that shows the choice stays in step with the setting
function syncAudioModeUI() {
  for (const id of ['am-instr', 'mc-instr']) {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('on', !wantVocals);
  }
  for (const id of ['am-vocals', 'mc-vocals']) {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('on', wantVocals);
  }
}
function shuffled(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
function playAuto(next) {
  if (!trackList.length || document.body.classList.contains('guest')) return;
  window.__sunoShare = null;
  if (!next && wantVocals) {   // a world's signature song is a vocal cut
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
  race.start(c.duration, c.notes.length);
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
  recordRun(runMeta('race', {
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

  $('results-stats').style.display = '';
  $('results-rule').style.display = '';
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
    $('rb-recap').classList.add('hidden');
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
    // Some worlds explain themselves: dodging a solar flare needs no rules
    // card. autoRound worlds skip the intro — the round starts by itself the
    // moment the chart is ready (guests still start on the host's gun).
    if (WORLDS[key].autoRound) {
      hideResults();
      $('pass-flash').classList.remove('show');
      setPhase = 'intro';
      if (document.body.classList.contains('guest')) {
        playArm++;
        guestArmed = true;
        return;
      }
      const mine = ++playArm;
      (function waitAuto() {
        if (mine !== playArm) return;
        if (!(chartProgress < 0 && beatCue.chart)) { setTimeout(waitAuto, 200); return; }
        beginFreeRound();
      })();
      return;
    }
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
  if (!beatCue.chart) return;   // the chart left before the gun — no round
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
  if (toyRound) {
    if (chillRoll && !setList && !document.body.classList.contains('guest')) {
      // lean-back: the run still goes in the ledger, but no card interrupts —
      // the next song starts itself, in the next world if the drift is on
      const gained = Math.max(0, score - toyRound.score0);
      recordRun(runMeta('toy', { pointsGained: gained }));
      toyRound = null;
      clipBufStop(true);
      if (chillWander) driftWorld();
      playAuto(true);
      return;
    }
    showToyResults(); return;
  }
  // a free round's results card is a question, and questions wait — rolling
  // to the next song here buried the card under the next round's intro
  if (!setList && !resultsShown) playAuto(true);
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
  recordRun(runMeta('toy', { pointsGained: gained }));
  const quiet = WORLDS[currentWorldKey] && WORLDS[currentWorldKey].quietPoints;
  toyRound = null;
  toyLast = true;
  resultsShown = true;
  $('awards').innerHTML = '';
  $('results-place').textContent = 'THAT\u2019S THE SONG';
  const subs = ["the song's done. look what you made", 'one song, well spent', 'that was a whole mood, sugar'];
  $('results-sub').textContent = subs[Math.floor(Math.random() * subs.length)];
  $('results-board').innerHTML = '';
  // a toy world has no accuracy or streak \u2014 empty dashes just look broken
  $('results-stats').style.display = 'none';
  $('results-rule').style.display = 'none';   // nothing between the hairlines but void
  $('rs-pts').textContent = '';
  $('rb-again').textContent = 'PLAY AGAIN';
  $('rb-next').textContent = 'NEXT WORLD';
  delete $('rb-again').dataset.mode;
  delete $('rb-next').dataset.mode;
  $('rb-recap').classList.add('hidden');
  $('results').classList.add('show');
  $('results-actions').classList.add('show');
  clearTimeout(resultsTimer);   // the card waits — leaving is the player's call
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
  $('promote-form').classList.add('hidden');
  if (promoteWorld && WORLDS[promoteWorld]) {
    dismissOverlay();
    switchWorld(promoteWorld);
    $('world-select').value = promoteWorld;
    document.body.classList.add('suno-live');
    promoteWorld = null;
  }
});
$('file-input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const fl = $('file-label'); if (fl) fl.textContent = '♪ ' + f.name;
  sunoSay('♪ ' + f.name + ' is loaded and yours', 'ok');
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
// A link we cannot play is still worth having. Spotify, YouTube and the rest
// run their audio inside a cross-origin frame, so no page on earth can read a
// sample of it and no world could dance to it. Rather than refuse the paste,
// the link becomes the room's shout-out: a pill anybody can tap to go listen
// where the artist already gets paid. Play stays with the house music, and
// the message says exactly that, so nobody waits for a song that isn't coming.
function promoteLink(raw) {
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) {
    sunoSay("that doesn't look like a link", 'err');
    return false;
  }
  sunoSay('looking it up\u2026');
  fetch(`${SUNO_PROXY}link-meta?url=` + encodeURIComponent(url))
    .then(r => (r.ok ? r.json() : { ok: false }))
    .catch(() => ({ ok: false }))
    .then(m => {
      const provider = (m && m.provider) || 'the link';
      const title = (m && m.title) || '';
      const label = (title ? '\u266a ' + title + '  \u00b7  ' : '') + 'listen on ' + provider;
      showPromo({ label, url });
      if (net.sendPromo) net.sendPromo(label, url);
      window.__promoLink = { label, url };
      sunoSay('up for the room. we can\u2019t read ' + provider + '\u2019s audio, so the worlds keep their own music', 'ok');
    });
  return true;
}

function loadSuno() {
  const el = $('suno-input');
  if (!el.value.trim()) return;
  const path = sunoPathFrom(el.value);
  if (!path || !SUNO_PROXY) {
    // not a playable source: hand it to the room as a link instead of refusing
    if (SUNO_PROXY && promoteLink(el.value)) return;
    el.classList.add('bad');
    setTimeout(() => el.classList.remove('bad'), 1400);
    sunoSay("that doesn't look like a link", 'err');
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
      sunoTrack = [info.title, info.artist].filter(Boolean).join(' \u00b7 ') || 'their song';
      $('mq-title').value = info.title || '';
      $('mq-artist').value = info.artist || '';
      $('marquee-edit').classList.remove('hidden');
      // pre-mint the permanent address while they're still listening — the
      // first share button they press already knows /w/{artist}/{song}
      if (shareableFree(currentWorldKey)) setTimeout(claimHome, 400);
      window.__sunoShare = path.startsWith('suno-s') ? 's_' + token : info.id;
      window.__sunoUrl = `${SUNO_PROXY}suno/${info.id}.mp3`;
      setLyrics(info.lyrics || '');
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
      sunoSay("couldn't find that song. use its share link, not the page url", 'err');
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

// during a set, watch the whole room's motion and keep the wildest frame —
// that's the recap card's backdrop
const peakFrame = document.createElement('canvas');
peakFrame.width = 1280; peakFrame.height = 720;
let peakEnergy = -1, peakPrev = null;
setInterval(() => {
  if (!setList || setPhase !== 'racing') { peakPrev = null; return; }
  const now = {};
  let energy = 0;
  for (const pl of net.participants) {
    const k = pl.id || pl.name;
    now[k] = [pl.x || 0, pl.y || 0, pl.z || 0];
    const q = peakPrev && peakPrev[k];
    if (q) energy += Math.abs(now[k][0] - q[0]) + Math.abs(now[k][1] - q[1]) + Math.abs(now[k][2] - q[2]);
  }
  const me = [net.local.x || 0, net.local.y || 0, net.local.z || 0];
  if (peakPrev && peakPrev.__me) energy += Math.abs(me[0] - peakPrev.__me[0]) + Math.abs(me[1] - peakPrev.__me[1]) + Math.abs(me[2] - peakPrev.__me[2]);
  now.__me = me;
  peakPrev = now;
  if (energy > peakEnergy) {
    peakEnergy = energy;
    const g = document.getElementById('canvas');
    const x = peakFrame.getContext('2d');
    const sc = Math.max(1280 / g.width, 720 / g.height);
    x.drawImage(g, (1280 - g.width * sc) / 2, (720 - g.height * sc) / 2, g.width * sc, g.height * sc);
  }
}, 2000);
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
    ? (s.title ? `${s.title}, picked by the host` : 'a song, picked by the host')
    : decodeURIComponent(s.url.split('/').pop()).replace(/\.\w+$/, '').replace(/_/g, ' ') + ', picked by the host';
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
  tapPlayBtn.textContent = '▶ come on in. tap to join the music';
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
  ['rainbow', 'rainbow \u00b7 full spectrum', 'linear-gradient(90deg,#f43,#fa0,#fe5,#3e6,#2cf,#55f,#c4f)'],
  ['duotone', 'duotone \u00b7 your hue & its complement', `linear-gradient(90deg,${A},${A2})`],
  ['cycle', 'cycle \u00b7 colors rotate over time', 'conic-gradient(#f43,#fe5,#3e6,#2cf,#55f,#c4f,#f43)'],
  ['mono', 'mono \u00b7 one hue', A],
  ['duo', 'duo \u00b7 hue + complement, hard split', `linear-gradient(90deg,${A} 50%,${A2} 50%)`],
  ['triad', 'triad \u00b7 three hues', `linear-gradient(90deg,${A} 33%,${A3} 33% 66%,${A2} 66%)`],
  ['pastel', 'pastel \u00b7 soft & dreamy', 'linear-gradient(90deg,#fbc,#cfe,#dfc,#fec)'],
  ['neon', 'neon \u00b7 maximum glow', 'linear-gradient(90deg,#f0f,#0ff,#ff0)'],
  ['glitter', 'glitter \u00b7 sparkles in your hue', `radial-gradient(circle at 30% 40%,#fff 5%,transparent 8%),radial-gradient(circle at 75% 60%,#fff 4%,transparent 7%),linear-gradient(120deg,hsl(var(--accent-h),60%,14%),hsl(var(--accent-h),50%,26%))`],
  ['cosmos', 'cosmos \u00b7 starfield, nebula in your hue', 'radial-gradient(circle at 25% 30%,#fff 4%,transparent 6%),radial-gradient(circle at 70% 65%,#fff 3%,transparent 5%),linear-gradient(120deg,#103,#527,#215)'],
  ['__group', 'THEMES WITH THEIR OWN COLORS'],
  ['fire', 'fire \u00b7 flickering flames', 'linear-gradient(0deg,#310,#d30,#fa0,#ff7)'],
  ['ocean', 'ocean \u00b7 rolling teal swells', 'linear-gradient(90deg,#036,#0af,#0fd,#08c)'],
  ['sunset', 'sunset \u00b7 orange below, violet above', 'linear-gradient(0deg,#f70,#f36,#a3c)'],
  ['aurora', 'aurora \u00b7 green curtains, violet night', 'linear-gradient(75deg,#0e5,#3fa,#65f,#0e5)'],
  ['forest', 'forest \u00b7 canopy & dappled light', 'linear-gradient(90deg,#031,#0a4,#fd6 65%,#0a4)'],
  ['gold', 'gold \u00b7 polished metal shine', 'linear-gradient(105deg,#640,#fc3,#fff,#fc3,#640)'],
  ['candy', 'candy \u00b7 glossy cane stripes', 'repeating-linear-gradient(45deg,#f6a 0 5px,#fff 5px 9px,#4de 9px 14px,#fd4 14px 18px)'],
  ['vapor', 'vapor \u00b7 pink & cyan haze', 'linear-gradient(90deg,#f9c,#8df,#caf,#fac)'],
  ['midnight', 'midnight \u00b7 deep blues', 'linear-gradient(90deg,#124,#36c,#89b,#236)'],
  ['coral', 'coral \u00b7 warm reef tones', 'linear-gradient(90deg,#f75,#fa8,#4cb,#f86)'],
  ['random', 'random \u00b7 confetti', 'conic-gradient(#f43 0 14%,#2cf 0 32%,#fe5 0 47%,#c4f 0 66%,#3e6 0 82%,#f70 0)'],
];
const PATTERNS = [
  ['spiral', 'spiral', 'conic-gradient(from 0deg,#69f,#123 25%,#69f 50%,#123 75%,#69f)'],
  ['checker', 'checker', 'repeating-conic-gradient(#69f 0 25%,#123 0 50%)'],
  ['stripes', 'stripes', 'repeating-linear-gradient(90deg,#69f 0 4px,#123 4px 8px)'],
  ['plaid', 'plaid', 'repeating-linear-gradient(90deg,#69f 0 4px,transparent 4px 9px),repeating-linear-gradient(0deg,#4ad 0 4px,#123 4px 9px)'],
  ['paisley', 'paisley swirl', 'radial-gradient(circle at 30% 60%,#69f 15%,transparent 40%),radial-gradient(circle at 70% 30%,#4ad 15%,transparent 45%),#123'],
  ['polka', 'polka dot', 'radial-gradient(circle at 25% 30%,#69f 22%,transparent 26%),radial-gradient(circle at 75% 70%,#69f 22%,transparent 26%),#123'],
  ['waves', 'waves', 'repeating-radial-gradient(circle at 0% 50%,#69f 0 3px,#123 3px 9px)'],
  ['kaleido', 'kaleido \u00b7 counter-rotating', 'conic-gradient(#69f 0 12%,#123 0 25%,#4ad 0 37%,#123 0 50%,#69f 0 62%,#123 0 75%,#4ad 0 87%,#123 0)'],
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
      if (nameId) $(nameId).textContent = label.split(' \u00b7 ')[0];
      apply(id);
    });
    box.appendChild(c);
    if (nameId && id === initial) $(nameId).textContent = label.split(' \u00b7 ')[0];
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

// the walkable circuit: the featured pair + this week's guest. The other
// fourteen are reachable on purpose (SEE ALL), never by accident.
function openWorlds() { return [...FEATURED, WEEK_WORLD, ...GRADUATED].filter((k, i, a) => WORLDS[k] && a.indexOf(k) === i); }
function stepWorld(dir = 1) {
  if (document.body.classList.contains('guest')) return; // the host drives the world
  const ring = openWorlds();
  const i = ring.indexOf($('world-select').value);
  const next = ring[((i < 0 ? 0 : i + dir) + ring.length) % ring.length];
  $('world-select').value = next;
  switchWorld(next);
}

let lookIdx = 0;
function stepLook(dir = 1) {
  lookIdx = (lookIdx + dir + PRESETS.length) % PRESETS.length;
  applyPreset(PRESETS[lookIdx][1]);
}

// The world runs live behind the front door — which meant it played its own
// catch sounds at a visitor who had not come in yet. Nothing the GAME does
// makes a sound until the door is open; the audition buttons in dev mode ask
// directly and are exempt.
let entered = false;
function syncSfxMute() { sfx.setSfxMuted(audio.muted || !entered); }
window.__enterSfx = () => { entered = true; syncSfxMute(); };
syncSfxMute();

function toggleMute() {
  audio.setMuted(!audio.muted);
  syncSfxMute();
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
let peakFast = 0, peakSlow = 0, peakLevel = 0, peakUntil = 0, peakCooldown = 0;
// opt-in only: full visuals by default, the toggle is there for whoever
// needs it (auto-enabling dimmed the show for folks with reduce-motion set)
let gentleLights = localStorage.getItem('fp_gentle') === '1';
document.body.classList.toggle('gentle', gentleLights);
function setGentle(on) {
  gentleLights = on;
  localStorage.setItem('fp_gentle', on ? '1' : '0');
  document.body.classList.toggle('gentle', on);
  const b = $('gentle-btn');
  if (b) b.textContent = 'GENTLE LIGHTS: ' + (on ? 'ON' : 'OFF');
}
function updatePeak(dt, a) {
  const e = (a && a.volume) || 0;
  peakFast += (e - peakFast) * Math.min(1, dt * 2.5);
  peakSlow += (e - peakSlow) * Math.min(1, dt * 0.18);
  const now = performance.now();
  const active = now < peakUntil;
  if (!active && now > peakCooldown && audio.currentTime > 12
      && peakSlow > 0.05 && peakFast > peakSlow * 1.35 && peakFast > 0.22
      && audio.playing) {
    // the drop is FELT, never announced: no card, no sound, no filter —
    // the song made the announcement. Worlds lean in (surfer rains sparks),
    // the pay quietly doubles, and that's the whole ceremony.
    peakUntil = now + 9000;
    peakCooldown = now + 32000;
  }
  if (active) {
    peakLevel = Math.min(1, peakLevel + dt * 3);
    // the surge ends early if the song cools right off
    if (peakFast < peakSlow * 0.95) peakUntil = Math.min(peakUntil, now + 1200);
  } else if (peakLevel > 0) {
    peakLevel = Math.max(0, peakLevel - dt * 1.2);
  }
  window.__peakLevel = peakLevel;
  window.__peakDbg = { fast: +peakFast.toFixed(3), slow: +peakSlow.toFixed(3), ratio: peakSlow > 0 ? +(peakFast / peakSlow).toFixed(3) : 0 };
}
// a caught look-spark repaints the whole world — as a two-beat ceremony:
// first the flash and the announcement, THEN the new look sweeps in, so
// the change reads as earned, never random
let lookBefore = null;   // the player's own look, saved before the first rainbow
document.addEventListener('fp-lookspark', () => {
  if (!lookBefore) lookBefore = { colorMode: settings.colorMode, pattern: settings.pattern, shape: settings.shape, hue: settings.hue };
  preDarkLook = null;   // the door is the rescue: whatever it deals, the dark is over
  const cur = settings.colorMode;
  const pool = PRESETS.filter(([, cfg]) => cfg.colorMode !== cur && cfg.colorMode !== 'midnight');
  const [name, cfg] = pool[(Math.random() * pool.length) | 0];
  // no banner: the world repainting itself IS the announcement, and saying so
  // out loud only got in front of the thing worth looking at
  document.body.classList.remove('lookflash'); void document.body.offsetWidth;
  document.body.classList.add('lookflash');
  const ring = $('look-ring');
  ring.classList.remove('go'); void ring.offsetWidth;
  ring.classList.add('go');
  // the swap lands at the DRAINED point of the breath, so the new palette
  // arrives as the colour floods back — a reveal, never a stutter
  setTimeout(() => {
    applyPreset(cfg);
    setTimeout(() => { document.body.classList.remove('lookflash'); ring.classList.remove('go'); }, 1200);
  }, 480);
});
// The black hole takes the LIGHT: the world falls into its darkest look and
// stays there. The next wonder door is the rescue — it already deals a fresh
// bright look — so the flume plays fall and salvation off each other.
let preDarkLook = null;
document.addEventListener('fp-swallowed', e => {
  const n = (e.detail && e.detail.n) || 2;
  announce('BLACK HOLE', n + ' rings, gone', 2400, 'ember');
  document.body.classList.remove('swallowed'); void document.body.offsetWidth;
  document.body.classList.add('swallowed');
  setTimeout(() => document.body.classList.remove('swallowed'), 750);
  if (settings.colorMode !== 'midnight') {
    if (!preDarkLook) preDarkLook = { colorMode: settings.colorMode, pattern: settings.pattern, shape: settings.shape, hue: settings.hue };
    // the fall lands as the shake ends: colours collapse into midnight
    setTimeout(() => applyPreset({ colorMode: 'midnight', pattern: settings.pattern, shape: settings.shape, hue: 250 }), 600);
  }
});
// the first-minute nudge: a wandering world never ASKS anything of a new
// player — twenty quiet seconds in, once ever per world, a whisper invites
// the first tap. Touching the world first counts as already knowing.
let nudgeT = null;
function armNudge(key) {
  clearTimeout(nudgeT);
  const w = WORLDS[key];
  if (!w || w.rhythm) return;                              // rounds explain themselves
  if (localStorage.getItem('fp_nudged_' + key)) return;
  nudgeT = setTimeout(function fire() {
    // a covered whisper is a wasted whisper — if any card owns the screen
    // (landing included), hold the thought and try again shortly
    const busy = document.hidden
      || $('round-intro').classList.contains('show')
      || $('mode-card').classList.contains('show')
      || $('results').classList.contains('show')
      || !$('tap-to-start').classList.contains('gone')
      // an open panel means their hands are on the controls, not lost —
      // and it covers the spot where the whisper lands
      || !$('panel').classList.contains('collapsed');
    if (busy) { nudgeT = setTimeout(fire, 12000); return; }
    localStorage.setItem('fp_nudged_' + key, '1');
    announce('', 'tap anywhere', 3800, 'quiet');
  }, 20000);
}
document.getElementById('canvas').addEventListener('pointerdown', () => {
  if (!nudgeT) return;
  clearTimeout(nudgeT); nudgeT = null;                     // they found it on their own
  if (currentWorldKey) localStorage.setItem('fp_nudged_' + currentWorldKey, '1');
});

// the annunciator: ceremonies get a title card — hairlines drawing outward,
// a tracked serif title, an italic subline — never the corner popup.
// tone 'ember' dresses bad news.
let anncT = null, anncT2 = null;
function announce(title, sub = '', ms = 2600, tone = '') {
  const el = $('annc');
  clearTimeout(anncT); clearTimeout(anncT2);
  el.classList.remove('show', 'leave', 'ember', 'quiet');
  void el.offsetWidth;
  $('annc-title').textContent = title;
  $('annc-sub').textContent = sub;
  if (tone) el.classList.add(tone);
  el.classList.add('show');
  anncT = setTimeout(() => { el.classList.remove('show'); el.classList.add('leave'); }, ms);
  anncT2 = setTimeout(() => el.classList.remove('leave', 'ember', 'quiet'), ms + 900);
}

// one flash pipe for every quick note — good news plain, bad news red
function flash(msg, ms = 2200, bad = false) {
  const el = $('pass-flash');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(passT); passT = setTimeout(() => el.classList.remove('show', 'bad'), ms);
}
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
  const u = race.unit || 'FT';
  $('hud-unit').textContent = (v === 1 && /S$/.test(u)) ? u.slice(0, -1) : u;
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
  // any steerable world owns the arrows — mid-race or just cruising
  return (world && world.setInput) || (race.active && (race.mode === 'DODGE' || race.mode === 'CATCH'));
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
  const ring = openWorlds();
  const cur = $('world-select').value;
  const at = ring.indexOf(cur);
  const next = ring[((at < 0 ? 0 : at + dir) + ring.length) % ring.length];
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
syncSfxMute();               // ...and silence still holds until entry

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
    // arrows never skip songs — that surprise cost people their steering.
    // next/prev live on the quick bar and , / . for keyboard folks
  }
  if (e.key === '.' && !document.body.classList.contains('guest')) playAuto(true);
  if (e.key === ',' && !document.body.classList.contains('guest')) playPrev();

  // 1–9, 0 jump straight to a world — a Stream Deck is just a keyboard
  if (e.key >= '0' && e.key <= '9') {
    const i = e.key === '0' ? 9 : +e.key - 1;
    const ring = openWorlds();
    if (i < ring.length && !document.body.classList.contains('guest')) {
      $('world-select').value = ring[i];
      switchWorld(ring[i]);
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
window.addEventListener('touchend', () => {
  touchSteer.active = false;
  if (!FULL_TURN.has(currentWorldKey)) {
    const home = () => {
      if (touchSteer.active) return;              // a new finger takes over
      touchSteer.x *= 0.86;
      if (Math.abs(touchSteer.x) < 0.02) touchSteer.x = 0;
      if (world && world.setInput) world.setInput(touchSteer.x, touchSteer.y);
      if (touchSteer.x !== 0) requestAnimationFrame(home);
    };
    requestAnimationFrame(home);
  }
});

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
  if (n > 0 && peakLevel > 0.5) n *= 2;   // the drop pays double
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
    row.querySelector('.nm').textContent = (p.name || '\u2026') + (p.local ? ' (you)' : '');
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
    b.addEventListener('click', () => { sendBomb(name, k); rivalsTarget = null; openRivalsPick(); renderRivals(); });
    pick.appendChild(b);
  });
  const sep = document.createElement('span'); sep.className = 'sep'; pick.appendChild(sep);
  TRICKS.forEach(t => {
    const b = document.createElement('button');
    b.textContent = t.e; b.title = t.name;
    b.addEventListener('click', () => {
      if (!rateOk(trickLog, 30000, 2)) return;
      myStats.bombs++; statsPush();
      net.sendEmote(t.i, name, t.e);
      flash(t.e + ' \u2192 ' + name.toUpperCase(), 1600);
      rivalsTarget = null; openRivalsPick(); renderRivals();
    });
    pick.appendChild(b);
  });
  const em = document.createElement('em');
  em.textContent = '\u2192 ' + name;
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
// ── the tutor ── eight seconds of the ghost hand playing the world: it
// sweeps like a finger steering and squeezes on its taps, driving the real
// inputs, so what the player sees is exactly what their own hand would do.
let demoRunning = false, demoTapIv = null;
function runWorldDemo() {
  if (demoRunning || !world) return;
  demoRunning = true;
  const hand = $('demo-hand');
  hand.classList.remove('hidden');
  $('show-me').classList.add('hidden');
  const t0 = performance.now(), D = 8000;
  let demoX = 0;
  const steerWord = IS_MOBILE ? 'slide your finger to steer' : 'move the mouse to steer';
  const tapWord = IS_MOBILE ? 'tap to jump' : 'click to jump';
  announce('', steerWord, 3600, 'quiet');
  if (world.onTap) setTimeout(() => { if (demoRunning) announce('', tapWord, 3400, 'quiet'); }, 4200);
  const land = () => {
    demoRunning = false;
    hand.classList.add('hidden');
    clearInterval(demoTapIv);
    if (world && world.setInput) world.setInput(0);
    offerShowMe(false);
    announce('', 'your turn', 2600, 'quiet');
  };
  (function frame(now) {
    if (!demoRunning) { land(); return; }
    const t = (now - t0) / 1000;
    if (now - t0 > D) { land(); return; }
    // a world that knows where its treats are steers the lesson at them, so
    // the demo visibly SUCCEEDS; otherwise an easy figure of steering
    const tgt = world && world.demoTarget ? world.demoTarget() : null;
    const wanted = (tgt !== null && tgt !== undefined) ? tgt : Math.sin(t * 0.85) * 0.72;
    demoX += (wanted - demoX) * 0.07;
    const x = demoX;
    const px = innerWidth * (0.5 + x * 0.33);
    const py = innerHeight * 0.60 + Math.sin(t * 1.6) * innerHeight * 0.05;
    hand.style.transform = `translate(${px}px, ${py}px)`;
    if (world && world.setInput) world.setInput(x);
    requestAnimationFrame(frame);
  })(t0);
  setTimeout(() => {
    demoTapIv = setInterval(() => {
      if (!demoRunning) { clearInterval(demoTapIv); return; }
      const hand2 = $('demo-hand');
      hand2.classList.remove('tapping'); void hand2.offsetWidth;
      hand2.classList.add('tapping');
      if (world && world.onTap) world.onTap();
    }, 1400);
  }, 4200);
  // a real touch takes the wheel back instantly — the tutor never wrestles
  setTimeout(() => {
    if (demoRunning) window.addEventListener('pointerdown', () => { demoRunning = false; }, { once: true });
  }, 400);
}
let showMeT = null;
function offerShowMe(on) {
  const sm = $('show-me');
  clearTimeout(showMeT);
  if (!on) { sm.classList.add('hidden'); sm.classList.remove('on'); return; }
  sm.classList.remove('hidden');
  requestAnimationFrame(() => sm.classList.add('on'));
  showMeT = setTimeout(() => { sm.classList.remove('on'); setTimeout(() => sm.classList.add('hidden'), 600); }, 40000);
}
$('show-me').addEventListener('click', e => { e.stopPropagation(); runWorldDemo(); });

function showWorldIntro(key) {
  const w = WORLDS[key];
  if (!w) return;
  // Two screens must never talk at once. Mid-set the round card already
  // names the world — the floating greeting on top of it was the overlap.
  if ($('round-intro').classList.contains('show') ||
      $('mode-card').classList.contains('show') ||
      $('results').classList.contains('show')) return;
  // the landing screen owns its moment — the greeting waits for entry
  if (!$('tap-to-start').classList.contains('gone')) return;
  const el = $('world-intro');
  $('intro-name').textContent = w.label;
  $('intro-goal').textContent = w.goal || '';
  el.classList.toggle('long', (w.label || '').length > 10);
  // "show me how" appears where showing helps: a world you steer or tap,
  // watched by somebody actually playing (never lean-back, never a guest).
  // It waits on its own clock instead of dying with this greeting: a first
  // visit deserves longer than three seconds to notice the offer.
  const teachable = (world && (world.setInput || world.onTap)) && !w.rhythm
    && !chillRoll && !document.body.classList.contains('guest');
  offerShowMe(teachable);
  el.classList.remove('gone');
  clearTimeout(introTimer);
  // hold time scales with how much there is to read (~65ms a character,
  // never less than 5s, never past 10)
  const hold = Math.min(10000, Math.max(5000, 2600 + (w.goal || '').length * 65));
  introTimer = setTimeout(() => el.classList.add('gone'), hold);
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

// (no prefill — the blank field lets the placeholder sell the dice)


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
  window.__enterSfx();   // now the game may speak
  showWorldIntro(currentWorldKey); // the greeting belongs AFTER the join card, not behind it
  // iOS: tilt controls need explicit permission, and the request must come
  // from a user gesture — this tap is our one chance
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
  // phones: start with the panel collapsed — the world is the point
  // Everybody gets the phone's model now: the world is the screen, and the
  // controls wait in a slim bar until asked. A settings sheet sitting open
  // over a visualizer was the desktop reading as a control room.
  panel.classList.remove('hidden');
  panel.classList.add('collapsed');
  document.body.classList.add('inside');
}
panel.classList.add('hidden'); // no controls before the door opens, any device
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
  slinky: 'heavy_silver.mp3',
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
// ── lyrics ── suno songs carry their words; they drift low across the
// world, stanza-paced to the song's progress. Not syllable-karaoke (suno
// keeps no timestamps) — a slow, pretty read-along. Tap the line to hide;
// LYRICS: ON/OFF in the music tab brings it back.
let lyrLines = [], lyrAt = -1;
function setLyrics(raw) {
  lyrLines = String(raw || '').split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^\[.*\]$/.test(l));
  lyrAt = -1;
  $('lyr-now').textContent = '';
  $('lyr-next').textContent = '';
  updateLyricLayer();
}
function lyricsWanted() {
  return lyrLines.length > 0
    && window.__sunoShare
    && localStorage.getItem('fp_lyrics_off') !== '1'
    && (audio.el.src || '').startsWith(SUNO_PROXY);
}
function updateLyricLayer() {
  $('lyric-layer').classList.toggle('hidden', !lyricsWanted());
}
function lyrBtnPaint() {
  $('lyr-btn').textContent = 'LYRICS: ' + (localStorage.getItem('fp_lyrics_off') === '1' ? 'OFF' : 'ON');
}
audio.el.addEventListener('timeupdate', () => {
  if (!lyricsWanted()) { $('lyric-layer').classList.add('hidden'); return; }
  $('lyric-layer').classList.remove('hidden');
  if (!audio.el.duration) return;
  const frac = Math.min(0.999, audio.el.currentTime / audio.el.duration);
  const idx = Math.min(lyrLines.length - 1, Math.floor(frac * lyrLines.length));
  if (idx === lyrAt) return;
  lyrAt = idx;
  const layer = $('lyric-layer');
  layer.classList.add('turning');
  setTimeout(() => {
    $('lyr-now').textContent = lyrLines[idx];
    $('lyr-next').textContent = lyrLines[idx + 1] || '';
    layer.classList.remove('turning');
  }, 220);
});
$('lyric-layer').addEventListener('click', () => {
  localStorage.setItem('fp_lyrics_off', '1');
  lyrBtnPaint();
  updateLyricLayer();
  flash('LYRICS OFF. TURN THEM BACK ON IN THE MUSIC TAB', 2200);
});
// ── the creator page editor ── slug + bio + links + what's-next; promoted
// songs land on the page by themselves. Creating returns the private edit
// link (the magic link, kept in this browser and copyable).
const ccSlugify = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
function ccParseLink(v) {
  const parts = String(v || '').split('|').map(x => x.trim());
  if (parts.length === 2 && /^https?:\/\//.test(parts[1])) return { label: parts[0], url: parts[1] };
  if (parts.length === 1 && /^https?:\/\//.test(parts[0])) {
    try { return { label: new URL(parts[0]).hostname.replace(/^www\./, ''), url: parts[0] }; } catch (e) { return null; }
  }
  return null;
}
function ccKey(slug) { return localStorage.getItem('fp_ck_' + slug) || ''; }
async function openCreatorCard() {
  const slug = ccSlugify($('cc-slug').value || $('mq-artist').value || sunoTrack.split(' \u00b7 ')[1] || '');
  $('cc-slug').value = slug;
  if (!$('cc-name').value) $('cc-name').value = $('mq-artist').value || '';
  $('creator-card').classList.remove('hidden');
  $('cc-msg').textContent = '';
  // if this browser owns the page, load it for editing + show private plays
  if (slug && ccKey(slug)) {
    try {
      const d = await fetch(`${SUNO_PROXY}c-get?slug=${slug}&key=${ccKey(slug)}`).then(r => r.json());
      if (d.canEdit) {
        $('cc-name').value = d.name || '';
        $('cc-bio').value = d.bio || '';
        $('cc-next').value = d.next || '';
        $('cc-tip').value = d.tip || '';
        (d.links || []).forEach((l, i) => { const f = $('cc-l' + (i + 1)); if (f) f.value = l.label + ' | ' + l.url; });
        $('cc-save').textContent = 'SAVE CHANGES';
        $('cc-out').classList.remove('hidden');
        const plays = Object.entries(d.plays || {});
        if (plays.length) {
          $('cc-plays').innerHTML = '<b>your plays (only you see this)</b><br>'
            + plays.map(([k, n]) => '\u266a ' + k.split('/')[1].replace(/-/g, ' ') + ': ' + n + ' visit' + (n === 1 ? '' : 's')).join('<br>');
          $('cc-plays').classList.remove('hidden');
        }
      }
    } catch (e) { /* offline: the form still works */ }
  }
}
$('mq-page').addEventListener('click', openCreatorCard);
$('cc-close').addEventListener('click', () => $('creator-card').classList.add('hidden'));
$('cc-save').addEventListener('click', async () => {
  const slug = ccSlugify($('cc-slug').value);
  if (slug.length < 3) { $('cc-msg').textContent = 'that address needs at least 3 letters'; return; }
  $('cc-slug').value = slug;
  const links = ['cc-l1', 'cc-l2', 'cc-l3'].map(id => ccParseLink($(id).value)).filter(Boolean);
  const body = {
    slug, name: $('cc-name').value.trim() || slug,
    bio: $('cc-bio').value.trim(), next: $('cc-next').value.trim(), tip: $('cc-tip').value.trim(), links,
  };
  const key = ccKey(slug);
  $('cc-msg').textContent = 'savin\u2019\u2026';
  try {
    const path = key ? 'c-update' : 'c-create';
    if (key) body.editKey = key;
    const r = await fetch(`${SUNO_PROXY}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 409) { $('cc-msg').textContent = 'that address is taken'; return; }
    if (!r.ok) { $('cc-msg').textContent = 'that didn\u2019t send. try again'; return; }
    if (d.editKey) localStorage.setItem('fp_ck_' + slug, d.editKey);
    $('cc-save').textContent = 'SAVE CHANGES';
    $('cc-out').classList.remove('hidden');
    $('cc-msg').textContent = 'live at fancy-pants.tupeloghost.workers.dev/c/' + slug;
  } catch (e) { $('cc-msg').textContent = 'no connection. try again'; }
});
$('cc-copy').addEventListener('click', () => {
  const slug = ccSlugify($('cc-slug').value);
  navigator.clipboard.writeText('https://fancy-pants.tupeloghost.workers.dev/c/' + slug)
    .then(() => flash('LINK COPIED. PUT IT IN YOUR BIO', 2200)).catch(() => {});
});
$('cc-copyedit').addEventListener('click', () => {
  const slug = ccSlugify($('cc-slug').value);
  navigator.clipboard.writeText('https://fancy-pants.tupeloghost.workers.dev/c/' + slug + '  edit key (KEEP PRIVATE): ' + ccKey(slug))
    .then(() => flash('EDIT KEY COPIED. KEEP IT SAFE', 2400)).catch(() => {});
});

$('gentle-btn').addEventListener('click', () => setGentle(!gentleLights));
setGentle(gentleLights);   // paint the button to the saved state
$('lyr-btn').addEventListener('click', () => {
  localStorage.setItem('fp_lyrics_off', localStorage.getItem('fp_lyrics_off') === '1' ? '0' : '1');
  lyrBtnPaint();
  updateLyricLayer();
});
lyrBtnPaint();

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
    // manifest still in flight (slow network): ask again when it lands —
    // but never forever. If the music can't load, say so and open the door
    // anyway rather than stranding a first-timer at a silent screen.
    askMode._tries = (askMode._tries || 0) + 1;
    if (askMode._tries < 14) {
      clearTimeout(askMode._t);
      askMode._t = setTimeout(askMode, 500);
      return;
    }
    flash('MUSIC DIDN\u2019T LOAD. CHECK YOUR CONNECTION', 4000, true);
  }
  askMode._tries = 0;
  $('mode-card').classList.add('show');
}
// ── lean back ── two switches for the watchers: NONSTOP keeps the songs
// rolling with no card asking anything between them, and DRIFT walks to the
// next wandering world each time a song ends. Off, everything works the way
// a player expects. Both stick per device.
let chillRoll = localStorage.getItem('fp_roll') === '1';
let chillWander = localStorage.getItem('fp_wander') === '1';
function syncChillUI() {
  const r = document.getElementById('mc-roll'), w = document.getElementById('mc-wander');
  if (r) r.classList.toggle('on', chillRoll);
  if (w) w.classList.toggle('on', chillWander);
}
document.getElementById('mc-roll').addEventListener('click', e => {
  e.stopPropagation();
  chillRoll = !chillRoll;
  localStorage.setItem('fp_roll', chillRoll ? '1' : '');
  syncChillUI();
});
document.getElementById('mc-wander').addEventListener('click', e => {
  e.stopPropagation();
  chillWander = !chillWander;
  // drifting implies rolling: you cannot wander if every song ends on a question
  if (chillWander && !chillRoll) { chillRoll = true; localStorage.setItem('fp_roll', '1'); }
  localStorage.setItem('fp_wander', chillWander ? '1' : '');
  syncChillUI();
});
syncChillUI();

// the next wandering world in the ring: rounds ask things of you, so the
// drift only visits worlds that don't
function driftWorld() {
  const ring = openWorlds().filter(k => !WORLDS[k].rhythm);
  if (ring.length < 2) return;
  const i = ring.indexOf(currentWorldKey);
  switchWorld(ring[(i + 1 + ring.length) % ring.length]);
}

// the flavour choice, wherever it appears
for (const [id, on] of [['am-instr', false], ['am-vocals', true], ['mc-instr', false], ['mc-vocals', true]]) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', e => { e.stopPropagation(); setVocals(on); });
}
syncAudioModeUI();

$('opt-promote').addEventListener('click', () => {
  $('pl-row').classList.add('hidden');
  togglePromote();
});
// ── hosting: now, or a date ──
// Going live now is one tap and unchanged. Scheduling writes the date onto
// the host's own creator page, so the announcement is a real URL that works
// when this tab is closed. Private to whoever they send it to: a public
// what's-on list with three entries reads as abandoned.
$('mc-host').addEventListener('click', () => {
  $('pl-row').classList.add('hidden');
  $('promote-form').classList.add('hidden');
  $('host-when').classList.toggle('hidden');
});
$('hw-now').addEventListener('click', () => {
  $('mode-card').classList.remove('show');
  startRoom(genCode(), ensureName(), true);
});
$('hw-later').addEventListener('click', () => {
  $('host-when').classList.add('hidden');
  $('sched-form').classList.remove('hidden');
  if (!$('sc-name').value) $('sc-name').value = $('join-name').value || '';
  $('sc-when').focus();
});
$('sc-go').addEventListener('click', async () => {
  const when = $('sc-when').value, where = $('sc-where').value.trim();
  const who = $('sc-name').value.trim() || $('join-name').value.trim();
  if (!when) { $('sc-msg').textContent = 'pick a date and time'; return; }
  if (!who) { $('sc-msg').textContent = 'what should we call you?'; return; }
  const slug = ccSlugify(who);
  if (slug.length < 3) { $('sc-msg').textContent = 'that name is a touch short'; return; }
  // a friendly sentence, not a timestamp: this is read by fans, not machines
  const d = new Date(when);
  // labelled with the host's zone so it is never ambiguous, and the UTC
  // instant rides along so the page can re-say it in the VIEWER's zone
  const nice = d.toLocaleString(undefined,
    { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const next = 'going live ' + nice;
  $('sc-msg').textContent = 'saving\u2026';
  try {
    const body = { slug, name: who, next, nextAt: d.toISOString(),
      links: where ? [{ label: 'watch the stream', url: where }] : [] };
    let r = await fetch(`${SUNO_PROXY}c-create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.status === 409) {
      // the page is already theirs, or the name is taken by somebody else
      const key = ccKey(slug);
      if (!key) { $('sc-msg').textContent = 'that name is taken. try another'; return; }
      r = await fetch(`${SUNO_PROXY}c-update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, editKey: key }),
      });
    } else if (r.ok) {
      const j = await r.json().catch(() => ({}));
      if (j.editKey) localStorage.setItem('fp_ck_' + slug, j.editKey);
    }
    if (!r.ok) { $('sc-msg').textContent = 'that didn\u2019t save. try again'; return; }
    window.__schedLink = `${SUNO_PROXY}c/${slug}`;
    $('sc-msg').textContent = 'set for ' + nice + '. your link is ready';
    $('sc-done').classList.remove('hidden');
  } catch (e) { $('sc-msg').textContent = 'no connection. try again'; }
});
$('sc-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(window.__schedLink || '')
    .then(() => flash('LINK COPIED. POST IT WHEREVER YOUR PEOPLE ARE', 2400)).catch(() => {});
});
$('sc-set').addEventListener('click', () => {
  $('sched-form').classList.add('hidden');
  $('opt-play').click();          // straight into building the set list
});
$('opt-vibe').addEventListener('click', () => {
  $('mode-card').classList.remove('show');
  $('pl-row').classList.add('hidden');
  endSet();
});
$('opt-play').addEventListener('click', () => {
  $('promote-form').classList.add('hidden');
  $('pl-row').classList.remove('hidden');
  $('pl-input').focus();
});
$('pl-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('pl-go').click(); });
$('pl-go').addEventListener('click', () => {
  const raw = $('pl-input').value.trim();
  if (/spotify\.com|spotify:|youtube\.com|youtu\.be/i.test(raw)) {
    $('pl-msg').textContent = 'that one won\u2019t play here. suno links and mp3 files work';
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
      $('pl-msg').textContent = 'one song. where\u2019s it playin\u2019?';
      return;
    }
    $('pl-msg').textContent = 'that one won\u2019t play here. suno links and mp3 files work';
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
    .catch(() => { $('pl-msg').textContent = 'couldn\u2019t reach that playlist. try again'; });
});
// the artist door, one doorway: open the paste slot (optionally pre-filled
// and pre-loaded), used by the landing button, the set-list card, and links
function openArtistDoor(raw) {
  document.body.classList.add('suno-live');
  panel.classList.remove('hidden', 'collapsed');
  document.querySelector('#tabs .tab[data-tab="music"]')?.click();
  if (raw) { $('suno-input').value = raw; loadSuno(); }
}
$('pl-world-go').addEventListener('click', () => {
  const raw = $('pl-input').value.trim();
  const key = $('pl-world').value;
  $('mode-card').classList.remove('show');
  $('pl-pick').classList.add('hidden');
  $('pl-row').classList.add('hidden');
  $('pl-msg').textContent = '';
  openArtistDoor(raw);
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
  if (!beatCue.chart) return;   // ditto: a go signal can outlive its chart
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
    text = "'" + (sunoTrack || 'my song') + "' is a place now. get in it, no app needed" + socialTag();
    claimHome();
    shareThis._home = (w ? w.label : 'THIS WORLD');
  } else if (window.__sunoShare) {
    // their song outside the free three: the rope — and no link goes out
    ropeGate('YOUR SONG SHARES FROM TUNNEL \u00b7 SURFER \u00b7 ' + WORLDS[WEEK_WORLD].label
      + ' (THIS WEEK\u2019S SPECIAL). ARTIST ACCESS OPENS EVERY WORLD');
    return;
  } else {
    url = SITE + '?world=' + currentWorldKey + (file ? '&track=' + encodeURIComponent(file) : '');
    text = file
      ? "i was just inside '" + prettyTrack(file) + "'. songs are places here, no app needed"
      : 'songs are places you can get into here. no app needed';
  }
  if (navigator.share) {
    navigator.share({ title: 'Fancy Britches', text, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text + '\n' + url).then(() => {
      flash(shareThis._home
        ? 'LINK COPIED. ' + shareThis._home + ' IS YOUR SONG\u2019S HOME NOW'
        : 'LINK COPIED, SUGAR', 1600);
      shareThis._home = null;
    }).catch(() => {});
  }
}
$('rb-share').addEventListener('click', () => {
  if (window.__sunoShare && !shareableFree(currentWorldKey)) {
    ropeGate('YOUR SONG SHARES FROM TUNNEL \u00b7 SURFER \u00b7 ' + WORLDS[WEEK_WORLD].label
      + ' (THIS WEEK\u2019S SPECIAL). ARTIST ACCESS OPENS EVERY WORLD');
    return;
  }
  openShareCard();
});

// ── the player share card ── pre-built from the run that just ended: the
// archetype's verdict big, their own clip beneath it, the CTA extending the
// joke, and the song + QR small below. NEW LINE rerolls the verdict.
// ── the artist's socials ── typed once beside the song title, remembered on
// this device, and appended to every share their song rides out on. The song
// is the ad; this is the address on the back of it.
$('mq-social').value = localStorage.getItem('fp_social') || '';
$('mq-social').addEventListener('input', () => {
  localStorage.setItem('fp_social', $('mq-social').value.trim().slice(0, 80));
});
function socialTag() {
  const v = ($('mq-social').value || localStorage.getItem('fp_social') || '').trim();
  if (!v || !window.__sunoShare) return '';
  return '\n' + (/^https?:\/\//i.test(v) ? v : v);
}

function shareStill(words) {
  // a burned-credit still of the world, matching the clip's framing
  const g = document.getElementById('canvas');
  const W = 1280, H = Math.round(1280 * g.height / Math.max(1, g.width));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.drawImage(g, 0, 0, W, H);
  const bh = Math.round(Math.min(W, H) * 0.09);
  x.fillStyle = 'rgba(4,4,10,0.62)';
  x.fillRect(0, H - bh, W, bh);
  x.fillStyle = 'rgba(240,238,255,0.92)';
  x.textBaseline = 'middle';
  const run = sig.lastRun || {};
  const barText = ((run.songTitle || 'this song') + '  \u00b7  '
    + (run.worldId && WORLDS[run.worldId] ? WORLDS[run.worldId].label : '')
    + '  \u00b7  STEP INSIDE IT, NO APP').toUpperCase();
  let fs = Math.round(bh * 0.42);
  x.font = '400 ' + fs + 'px Didot, "Bodoni 72", Georgia, serif';
  while (fs > 9 && x.measureText(barText).width > W - bh) {
    fs -= 1;
    x.font = '400 ' + fs + 'px Didot, "Bodoni 72", Georgia, serif';
  }
  x.fillText(barText, Math.round(bh * 0.5), H - bh / 2);
  const qrc = document.createElement('canvas');
  if (drawQR(qrc, clipURL(), 2)) {
    const q = bh * 1.5, m = Math.round(bh * 0.25);
    x.fillStyle = '#fff';
    x.fillRect(W - q - m - 4, H - bh - q - m - 4, q + 8, q + 8);
    x.drawImage(qrc, W - q - m, H - bh - q - m, q, q);
  }
  drawWords(x, W, H, words);
  return c;
}
let shareStillBlob = null;
let cardHushed = false;
function hushForCard() {
  if (!audio.el.paused) { audio.el.pause(); cardHushed = true; }
}
function unhushAfterCard() {
  // resume only a song that was mid-flight; an ended one stays ended (the
  // tally owns that silence — PLAY AGAIN / NEXT WORLD restart the music)
  if (cardHushed && !audio.el.ended) audio.play().catch(() => {});
  cardHushed = false;
}
function playCardVideo(v) {
  v.muted = false;
  v.volume = 1;
  v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
}
// draws the typed words onto a frame the same way the live overlay shows
// them: italic Didot near the top, wrapped, with a soft shadow for legibility
function drawWords(x, W, H, words) {
  if (!words) return;
  const fs = Math.round(Math.min(W, H) * 0.055);
  x.save();
  x.font = 'italic 400 ' + fs + 'px Didot, "Bodoni 72", Georgia, serif';
  x.textAlign = 'center';
  x.textBaseline = 'top';
  x.shadowColor = 'rgba(0,0,0,0.85)';
  x.shadowBlur = fs * 0.8;
  x.fillStyle = '#fff';
  // wrap to the frame
  const maxW = W * 0.88;
  const lines = [];
  let line = '';
  for (const word of String(words).split(/\s+/)) {
    const t = line ? line + ' ' + word : word;
    if (x.measureText(t).width > maxW && line) { lines.push(line); line = word; }
    else line = t;
  }
  if (line) lines.push(line);
  let y = H * 0.09;
  for (const l of lines.slice(0, 4)) { x.fillText(l, W / 2, y); y += fs * 1.35; }
  x.restore();
}

// re-press the film: play the recorded clip once, draw every frame plus the
// words to a canvas, and record THAT. The playback is the preview and the
// wait at the same time; when it ends, the burned copy is ready.
function burnWords(videoEl, srcBlob, words, mimeType) {
  return new Promise((resolve, reject) => {
    const W2 = videoEl.videoWidth || 1280, H2 = videoEl.videoHeight || 720;
    const c = document.createElement('canvas');
    c.width = W2; c.height = H2;
    const x = c.getContext('2d');
    const out = c.captureStream(30);
    const elStream = videoEl.captureStream ? videoEl.captureStream() : null;
    if (elStream) elStream.getAudioTracks().forEach(t => out.addTrack(t));
    const mime = mimeType && MediaRecorder.isTypeSupported(mimeType) ? mimeType : undefined;
    const rec = new MediaRecorder(out, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : { videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }));
    rec.onerror = reject;
    let raf;
    const draw = () => {
      x.drawImage(videoEl, 0, 0, W2, H2);
      drawWords(x, W2, H2, words);
      raf = requestAnimationFrame(draw);
    };
    videoEl.onended = () => { cancelAnimationFrame(raf); try { rec.stop(); } catch (e) { reject(e); } };
    videoEl.loop = false;
    videoEl.currentTime = 0;
    videoEl.play().then(() => { rec.start(250); draw(); }).catch(reject);
  });
}

function openShareCard() {
  $('shc-say').value = 'y\u2019all have to try this';
  $('shc-words').textContent = $('shc-say').value;
  $('shc-words').classList.remove('hidden');
  $('shc-share').disabled = false;
  $('shc-share').textContent = 'SHARE THIS POST';
  const v = $('shc-video');
  const im = $('shc-still');
  shareStillBlob = null;
  if (v.dataset.url) { URL.revokeObjectURL(v.dataset.url); delete v.dataset.url; }
  if (clipSaved) {
    v.dataset.url = URL.createObjectURL(clipSaved.blob);
    v.src = v.dataset.url;
    v.classList.remove('hidden');
    im.classList.add('hidden');
    hushForCard();
    playCardVideo(v);
  } else {
    v.classList.add('hidden');
    const still = shareStill($('shc-say').value.trim());
    im.src = still.toDataURL('image/jpeg', 0.85);
    im.classList.remove('hidden');
    still.toBlob(b => { shareStillBlob = b; }, 'image/jpeg', 0.88);
  }
  $('share-card').classList.remove('hidden');
}
// the emoji tray: tap to drop one at the cursor. Canvas text renders colour
// emoji, so they burn onto the film like any other character.
{
  const TRAY = ['\u2728','\u2764\uFE0F','\ud83d\udd25','\ud83c\udf08','\ud83c\udfb6','\ud83c\udfa7','\ud83e\udea9','\ud83d\udc7b','\ud83c\udf19','\ud83c\udf52','\u2b50','\ud83d\udc8e','\ud83c\udf0a','\u26a1','\ud83d\ude08','\ud83d\ude2d','\ud83d\udc80','\ud83d\ude4c','\ud83d\udcab','\ud83c\udf88','\ud83e\udd29','\ud83d\udc83','\ud83d\udd7a','\ud83c\udf83','\ud83d\ude80','\ud83d\udc51','\ud83e\udd18','\ud83d\udca5'];
  const tray = $('shc-emoji');
  for (const e of TRAY) {
    const b = document.createElement('button');
    b.textContent = e;
    b.addEventListener('click', () => {
      const say = $('shc-say');
      const at = say.selectionStart ?? say.value.length;
      say.value = say.value.slice(0, at) + e + say.value.slice(say.selectionEnd ?? at);
      say.selectionStart = say.selectionEnd = at + e.length;
      say.focus();
      say.dispatchEvent(new Event('input'));
    });
    tray.appendChild(b);
  }
}

// typing paints the frame live: overlay for the eye, and the still is
// actually re-burned so what you see is literally the file
let sayT = null;
$('shc-say').addEventListener('input', () => {
  const words = $('shc-say').value.trim();
  $('shc-words').textContent = words;
  $('shc-words').classList.toggle('hidden', !words);
  clearTimeout(sayT);
  if (!clipSaved) {
    sayT = setTimeout(() => {
      const still = shareStill(words);
      $('shc-still').src = still.toDataURL('image/jpeg', 0.85);
      still.toBlob(b => { shareStillBlob = b; }, 'image/jpeg', 0.88);
    }, 250);
  }
});

$('shc-close').addEventListener('click', () => {
  $('share-card').classList.add('hidden');
  $('shc-video').pause();
  unhushAfterCard();
});
$('shc-share').addEventListener('click', async () => {
  const words = $('shc-say').value.trim();
  const caption = (words ? words + '\n' : 'step inside \u2192\n') + clipURL() + socialTag() + '\n#FancyBritches';
  // a clip with words on it gets pressed first: the playback IS the preview,
  // and the burned copy is ready when the song stops
  if (clipSaved && words) {
    const btn = $('shc-share');
    btn.disabled = true;
    btn.textContent = 'PRESSING YOUR WORDS IN\u2026';
    try {
      const burned = await burnWords($('shc-video'), clipSaved.blob, words, clipSaved.type);
      clipSaved = { blob: burned, type: burned.type };
    } catch (e) { /* the unburned clip still shares; their words ride the text */ }
    btn.disabled = false;
    btn.textContent = 'SHARE THIS POST';
  }
  // the artist's song claims its home world when a link goes out from here
  if (window.__sunoShare && shareableFree(currentWorldKey)) {
    claimHome();
  }
  const media = clipSaved
    ? { blob: clipSaved.blob, name: 'fancy-britches-clip.' + (clipSaved.type.includes('mp4') ? 'mp4' : 'webm'), type: clipSaved.type }
    : (shareStillBlob ? { blob: shareStillBlob, name: 'fancy-britches.jpg', type: 'image/jpeg' } : null);
  if (media) {
    const file = new File([media.blob], media.name, { type: media.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], text: caption }).catch(() => {});
      return;
    }
    // no share sheet: the media downloads, the caption rides the clipboard
    const a = document.createElement('a');
    a.href = URL.createObjectURL(media.blob); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    navigator.clipboard.writeText(caption).then(() => flash('SAVED. CAPTION COPIED TOO', 2600)).catch(() => {});
    return;
  }
  if (navigator.share) { navigator.share({ text: caption }).catch(() => {}); return; }
  navigator.clipboard.writeText(caption).then(() => flash('CAPTION + LINK COPIED, SUGAR', 2000)).catch(() => {});
});

// ── CLIP: fifteen seconds of the run with the song's name and a scannable
// QR baked into the frame — the post IS the ad, the link rides inside it.
// Clips follow the share rule: house songs clip anywhere; an artist's song
// clips only where its share link works (the trio + the world of the week).
let clipDraw = false, clipRecs = [], clipRot = 0, clipStag = 0, clipSaved = null, clipMime = '';
// one claim function for every share surface: stores the home world AND
// mints the permanent /w/{artist}/{song} address (same names, same link)
function claimHome() {
  fetch(`${SUNO_PROXY}share-home`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      song: window.__sunoShare, world: currentWorldKey,
      artist: $('mq-artist').value.trim(), title: $('mq-title').value.trim(),
    }),
  }).then(r => r.json()).then(r => { if (r.url) window.__permUrl = r.url; }).catch(() => {});
}
function clipURL() {
  if (window.__sunoShare && window.__permUrl) return window.__permUrl;
  if (window.__sunoShare) return SITE + '?world=' + currentWorldKey + '&suno=' + encodeURIComponent(window.__sunoShare);
  const file = ($('track-select').value || audio.el.currentSrc || '').split('/').pop();
  // house songs ride the short door too — a clean link that unfurls with
  // the song's name beats a query-string tail in any feed
  if (SUNO_PROXY && file && /^[A-Za-z0-9_.-]{1,60}\.mp3$/.test(file)) {
    return SUNO_PROXY + 'p/' + currentWorldKey + '/' + file;
  }
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
    const bh = Math.round(Math.min(W, H) * 0.09);
    ctx2.fillStyle = 'rgba(4,4,10,0.62)';
    ctx2.fillRect(0, H - bh, W, bh);
    ctx2.fillStyle = 'rgba(240,238,255,0.92)';
    ctx2.textBaseline = 'middle';
    // the QR floats ABOVE the bar; the words size themselves to fit the bar
    const q = bh * 1.5, m = Math.round(bh * 0.25);
    const barText = title + '  \u00b7  ' + wlabel + '  \u00b7  STEP INSIDE IT, NO APP';
    let fs = Math.round(bh * 0.42);
    ctx2.font = '400 ' + fs + 'px Didot, "Bodoni 72", Georgia, serif';
    while (fs > 9 && ctx2.measureText(barText).width > W - bh) {
      fs -= 1;
      ctx2.font = '400 ' + fs + 'px Didot, "Bodoni 72", Georgia, serif';
    }
    ctx2.fillText(barText, Math.round(bh * 0.5), H - bh / 2);
    if (hasQR) {
      ctx2.fillStyle = '#fff';
      ctx2.fillRect(W - q - m - 4, H - bh - q - m - 4, q + 8, q + 8);
      ctx2.drawImage(qrc, W - q - m, H - bh - q - m, q, q);
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
  flash('CLIP SAVED. POST IT, SUGAR', 2200);
}
$('rb-clip').addEventListener('click', () => {
  if (window.__sunoShare && !shareableFree(currentWorldKey)) {
    ropeGate('CLIPS RIDE TUNNEL \u00b7 SURFER \u00b7 ' + WORLDS[WEEK_WORLD].label + ' (THIS WEEK\u2019S SPECIAL). ARTIST ACCESS OPENS EVERY WORLD');
    return;
  }
  if (!clipSaved) {
    flash('NOTHING TO CLIP YET. PLAY A ROUND FIRST', 2200);
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

// ── the streamer recap ── data, drawing, and text — the card is about the
// HOST: their handle headlines, the room's superlatives carry real names
// and real numbers, everyone who joined appears, the peak frame sits behind
function recapEntrants() {
  if (window.__fakeRoom) return window.__fakeRoom;   // dev: preview with a fake room
  return [
    { name: net.local.name || 'you', st: net.local.st || [0, 0, 0, 0, 0] },
    ...net.participants.filter(p => !p.local && p.id !== 'ghost')
      .map(p => ({ name: p.name || 'guest', st: p.st || [0, 0, 0, 0, 0] })),
  ];
}
const RECAP_CATS = [
  { i: 0, label: 'most trouble', unit: 'bombs thrown' },
  { i: 1, label: "'scuse me", unit: 'passes made' },
  { i: 2, label: 'bless your heart', unit: 'times passed' },
  { i: 3, label: 'steadiest hand', unit: 'note streak' },
  { i: 4, label: 'cleanest run', unit: '% on the beat' },
];
function buildRecapData() {
  const entrants = recapEntrants();
  const board = [...setScores.entries()].sort((a, b) => b[1] - a[1]);
  const sups = [];
  for (const cat of RECAP_CATS) {
    const ranked = entrants.filter(e => (e.st[cat.i] || 0) > 0)
      .sort((a, b) => (b.st[cat.i] - a.st[cat.i]) || a.name.localeCompare(b.name));
    if (ranked.length) sups.push({ label: cat.label, name: ranked[0].name, num: ranked[0].st[cat.i], unit: cat.unit });
  }
  const everyone = entrants.map(e => e.name);
  const winner = board.length ? board[0][0] : (everyone[0] || 'somebody');
  return { sups, everyone, winner, board };
}
function drawRecap(data, handle) {
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 720;
  const x = c.getContext('2d');
  // backdrop: the room's wildest moment, vignetted so the type owns the frame
  if (peakEnergy >= 0) x.drawImage(peakFrame, 0, 0);
  else { x.fillStyle = '#0a0716'; x.fillRect(0, 0, 1280, 720); }
  const vg = x.createRadialGradient(640, 300, 200, 640, 360, 900);
  vg.addColorStop(0, 'rgba(4,3,12,0.6)');
  vg.addColorStop(1, 'rgba(3,2,10,0.95)');
  x.fillStyle = vg; x.fillRect(0, 0, 1280, 720);
  const GOLD = 'rgba(238,206,120,1)', GOLD_DIM = 'rgba(238,206,120,0.55)';
  x.textBaseline = 'top';
  x.font = '600 17px "SF Mono", Menlo, monospace';
  x.fillStyle = 'rgba(200,196,225,0.65)';
  x.fillText('F A N C Y   B R I T C H E S   \u00b7   R O O M   R E C A P', 64, 42);
  x.fillStyle = 'rgba(248,246,255,0.98)';
  x.font = '400 88px Didot, "Bodoni 72", Georgia, serif';
  x.fillText(handle || 'tonight\u2019s room', 60, 70);
  x.fillStyle = GOLD_DIM;
  x.fillRect(64, 178, 420, 2);
  x.font = 'italic 400 27px Didot, "Bodoni 72", Georgia, serif';
  x.fillStyle = 'rgba(215,211,240,0.85)';
  x.fillText('hosted a room on fancy britches: ' + data.everyone.length + ' player' + (data.everyone.length === 1 ? '' : 's')
    + ' \u00b7 ' + (lastSetLen || '?') + ' round' + (lastSetLen === 1 ? '' : 's'), 64, 188);
  if (data.nextStream) {
    x.font = '400 22px Didot, "Bodoni 72", Georgia, serif';
    x.fillStyle = GOLD;
    x.fillText(data.nextStream, 64, 620);
  }
  // winner, said plainly, dressed in gold
  const wtxt = '\u2605  WINNER: ' + data.winner.toUpperCase();
  x.font = '400 36px Didot, "Bodoni 72", Georgia, serif';
  const ww = x.measureText(wtxt).width;
  x.save();
  x.shadowColor = 'rgba(238,206,120,0.5)'; x.shadowBlur = 24;
  x.fillStyle = 'rgba(56,44,16,0.85)';
  x.beginPath(); x.roundRect(64, 240, ww + 56, 62, 31); x.fill();
  x.restore();
  x.strokeStyle = GOLD_DIM; x.lineWidth = 1.5;
  x.beginPath(); x.roundRect(64, 240, ww + 56, 62, 31); x.stroke();
  x.fillStyle = GOLD;
  x.fillText(wtxt, 92, 252);
  // stat tiles: label carries the charm, the line is plain fact
  const tiles = data.sups.slice(0, 5);
  const tw = 258, th = 136, gap = 14;
  tiles.forEach((sv, i) => {
    const col = i % 3, row = (i / 3) | 0;
    const tx = 64 + col * (tw + gap), ty = 340 + row * (th + gap);
    x.fillStyle = 'rgba(255,255,255,0.055)';
    x.beginPath(); x.roundRect(tx, ty, tw, th, 14); x.fill();
    x.strokeStyle = 'rgba(190,180,230,0.22)'; x.lineWidth = 1;
    x.beginPath(); x.roundRect(tx, ty, tw, th, 14); x.stroke();
    x.font = '600 14px "SF Mono", Menlo, monospace';
    x.fillStyle = GOLD_DIM;
    x.fillText(sv.label.toUpperCase(), tx + 18, ty + 14);
    x.font = '400 52px Didot, "Bodoni 72", Georgia, serif';
    x.fillStyle = GOLD;
    x.fillText(String(sv.num), tx + 18, ty + 34);
    const nw = x.measureText(String(sv.num)).width;
    x.font = '15px "SF Mono", Menlo, monospace';
    x.fillStyle = 'rgba(210,206,235,0.75)';
    x.fillText(sv.unit, tx + 26 + nw, ty + 64);
    x.font = '400 25px Didot, "Bodoni 72", Georgia, serif';
    x.fillStyle = 'rgba(246,244,255,0.95)';
    x.fillText(sv.name, tx + 18, ty + 96);
  });
  // the roster, colored dots, winner starred
  const rx = 940;
  x.font = '600 15px "SF Mono", Menlo, monospace';
  x.fillStyle = 'rgba(200,196,225,0.65)';
  x.fillText('T H E   R O O M', rx, 246);
  let ry = 278;
  const dots = ['#7cc4ff', '#ffb86b', '#8affc1', '#ff9de2', '#fff59b', '#c6a8ff', '#7dfff4', '#ff8f8f'];
  data.everyone.slice(0, 8).forEach((nm, i) => {
    x.fillStyle = dots[i % dots.length];
    x.beginPath(); x.arc(rx + 8, ry + 12, 6, 0, 7); x.fill();
    x.font = '400 26px Didot, "Bodoni 72", Georgia, serif';
    x.fillStyle = nm === data.winner ? GOLD : 'rgba(232,229,250,0.92)';
    x.fillText(nm + (nm === data.winner ? ' \u2605' : ''), rx + 28, ry);
    ry += 40;
  });
  if (data.everyone.length > 8) {
    x.font = 'italic 400 19px Didot, "Bodoni 72", Georgia, serif';
    x.fillStyle = 'rgba(200,196,225,0.6)';
    x.fillText('\u2026and ' + (data.everyone.length - 8) + ' more', rx + 26, ry);
  }
  // footer
  x.fillStyle = 'rgba(238,206,120,0.35)';
  x.fillRect(64, 640, 1152, 1);
  const run = sig.lastRun || {};
  x.font = '400 24px Didot, "Bodoni 72", Georgia, serif';
  x.fillStyle = 'rgba(220,216,245,0.92)';
  x.fillText((run.songTitle ? '\u266a  ' + run.songTitle + (run.artistName ? ' \u00b7 ' + run.artistName : '') + '     ' : '')
    + 'scan and step inside. no app, just a browser', 64, 656);
  const qrc = document.createElement('canvas');
  if (drawQR(qrc, SITE, 3)) {
    x.fillStyle = '#fff';
    x.beginPath(); x.roundRect(1280 - qrc.width - 44, 720 - qrc.height - 44, qrc.width + 16, qrc.height + 16, 10); x.fill();
    x.drawImage(qrc, 1280 - qrc.width - 36, 720 - qrc.height - 36);
  }
  return c;
}
function recapText(data, handle) {
  const lines = [(handle || 'tonight\u2019s room') + ' hosted a room on fancy britches: '
    + data.everyone.length + ' players, ' + (lastSetLen || '?') + ' rounds'];
  lines.push('\u2605 winner: ' + data.winner);
  for (const sv of data.sups) lines.push(sv.label + ': ' + sv.name + ' (' + sv.num + ' ' + sv.unit + ')');
  lines.push('in the room: ' + data.everyone.join(', '));
  if (data.nextStream) lines.push(data.nextStream);
  lines.push('step inside one yourself, no app needed: ' + SITE);
  return lines.join('\n');
}
let lastSetLen = 0;
function openRecapCard() {
  const data = buildRecapData();
  const handle = $('rc-handle').value.trim() || localStorage.getItem('fp_handle') || '';
  $('rc-handle').value = handle;
  const next = $('rc-next').value.trim() || localStorage.getItem('fp_next_stream') || '';
  $('rc-next').value = next;
  data.nextStream = next;
  const img = drawRecap(data, handle);
  const prev = $('rc-preview');
  prev.width = img.width; prev.height = img.height;
  prev.getContext('2d').drawImage(img, 0, 0);
  $('recap-card')._data = data;
  $('recap-card').classList.remove('hidden');
}
$('rb-recap').addEventListener('click', openRecapCard);
window.__openRecap = openRecapCard;   // dev: preview the recap without a set
function recapRedraw() {
  const d = $('recap-card')._data;
  if (!d) return;
  d.nextStream = $('rc-next').value.trim();
  const img = drawRecap(d, $('rc-handle').value.trim());
  $('rc-preview').getContext('2d').drawImage(img, 0, 0);
}
$('rc-handle').addEventListener('input', () => {
  localStorage.setItem('fp_handle', $('rc-handle').value.trim());
  recapRedraw();
});
$('rc-next').addEventListener('input', () => {
  localStorage.setItem('fp_next_stream', $('rc-next').value.trim());
  recapRedraw();
});
$('rc-close').addEventListener('click', () => $('recap-card').classList.add('hidden'));
$('rc-copy').addEventListener('click', () => {
  const d = $('recap-card')._data;
  navigator.clipboard.writeText(recapText(d, $('rc-handle').value.trim()))
    .then(() => flash('RECAP COPIED. PASTE IN CHAT', 2200)).catch(() => {});
});
$('rc-share').addEventListener('click', () => {
  const d = $('recap-card')._data;
  const handle = $('rc-handle').value.trim();
  drawRecap(d, handle).toBlob(blob => {
    const file = new File([blob], 'fancy-britches-recap.jpg', { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], text: recapText(d, handle) }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      navigator.clipboard.writeText(recapText(d, handle)).catch(() => {});
      flash('RECAP SAVED. TEXT COPIED TOO', 2200);
    }
  }, 'image/jpeg', 0.85);
});

function showSetResults() {
  clipBufStop(true);
  lastSetLen = setList ? setList.length : 0;
  recordRun(runMeta('set', { rounds: setList ? setList.length : 0 }));
  document.body.classList.remove('play');
  setPhase = 'idle';
  const rows = [...setScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!rows.length) { endSet(); return; }
  $('results-place').textContent = rows[0][0] === (net.local.name || 'you') ? 'YOU WIN' : 'FULL TIME';
  const overs = ["that's the whole show", "y'all come back now", 'no more songs, no more stairs'];
  $('results-sub').textContent = overs[Math.floor(Math.random() * overs.length)];
  $('results-board').innerHTML = rows.map(([name], k) =>
    `<div class="rrow${name === net.local.name ? ' me' : ''}">`
    + `<i style="background:hsl(var(--accent-h),80%,70%)"></i>`
    + `<span>${name.replace(/[<>&]/g, '')}</span><b>${['1st', '2nd', '3rd'][k] || (k + 1) + 'th'}</b></div>`).join('');
  $('results-stats').style.display = '';
  $('results-rule').style.display = '';
  $('rs-acc').textContent = Math.round(race.accuracy * 100) + '%';
  $('rs-streak').textContent = race.bestStreak;
  $('rs-notes').textContent = race.perfect + race.good;
  [...$('results-board').children].slice(0, 3).forEach((row, k) =>
    row.classList.add('m' + (k + 1)));
  celebrate(PALETTE[(net.local.color || 0) % PALETTE.length], rows[0][0] === (net.local.name || 'you'));
  $('rb-again').textContent = 'PLAY THE SET AGAIN';
  $('rb-next').textContent = 'FREE PLAY';
  $('rb-recap').classList.toggle('hidden', document.body.classList.contains('guest'));
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
    row.innerHTML = `<b>${cat.title}</b><span>${win.name.replace(/[<>&]/g, '')} \u00b7 ${cat.why}</span><em>\u2605</em>`;
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

// the field starts BLANK on purpose — the placeholder sells the dice.
// A returning player's saved name still comes back if they join empty
// (ensureName falls back to fp_name before rolling fresh).
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
  sunoTrack = [t, a].filter(Boolean).join(' \u00b7 ') || sunoTrack;
  hostSong();   // push the new words to the room now, not in 4 seconds
}
$('mq-title').addEventListener('input', marqueeApply);
$('mq-artist').addEventListener('input', marqueeApply);

// ── the artist card ── the quiet one, in motion: twelve seconds of the
// world wearing the artist's look, song + name in serif, QR burned into
// every frame. No stats — the world moving IS the ad.
const AC_DIMS = { v: [540, 960], s: [720, 720], l: [960, 540] };
let acFmt = 'v', acRec = null, acSaved = null, acStop = 0, acTick = 0, acDraw = false;
function drawArtistType(x, W, H, fmt) {
  // cinematic grade: a soft vignette all around, deeper at the foot where
  // the billing block sits
  const vg = x.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(3,3,10,0)');
  vg.addColorStop(1, 'rgba(3,3,10,0.55)');
  x.fillStyle = vg; x.fillRect(0, 0, W, H);
  const grad = x.createLinearGradient(0, H * 0.5, 0, H);
  grad.addColorStop(0, 'rgba(3,3,10,0)');
  grad.addColorStop(1, 'rgba(3,3,10,0.92)');
  x.fillStyle = grad; x.fillRect(0, 0, W, H);
  const title = ($('mq-title').value.trim() || sunoTrack.split(' \u00b7 ')[0] || 'a song');
  const artist = ($('mq-artist').value.trim() || sunoTrack.split(' \u00b7 ')[1] || '');
  const hue = getComputedStyle(document.documentElement).getPropertyValue('--accent-h').trim() || '210';
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  const base = fmt === 'l' ? H - 120 : H - 210;
  // the billing block: eyebrow / TITLE / hairline / artist / invitation
  x.font = '500 ' + Math.round(W * 0.016) + 'px "SF Mono", Menlo, monospace';
  x.fillStyle = 'hsla(' + hue + ', 60%, 80%, 0.75)';
  x.fillText('A   P L A Y A B L E   W O R L D', W / 2, base - Math.round(W * (fmt === 'l' ? 0.062 : 0.098)));
  x.fillStyle = 'rgba(252,250,255,0.98)';
  x.save();
  x.shadowColor = 'rgba(0,0,0,0.65)'; x.shadowBlur = Math.round(W * 0.02);
  x.font = '400 ' + Math.round(W * (fmt === 'l' ? 0.052 : 0.082)) + 'px Didot, "Bodoni 72", Georgia, serif';
  x.fillText(title, W / 2, base, W - Math.round(W * 0.14));
  x.restore();
  // a fine accent hairline under the title
  const lw = Math.min(x.measureText(title).width, W - Math.round(W * 0.2));
  x.fillStyle = 'hsla(' + hue + ', 75%, 72%, 0.65)';
  x.fillRect(W / 2 - lw / 2, base + Math.round(W * 0.018), lw, Math.max(1, Math.round(W * 0.0022)));
  if (artist) {
    x.font = 'italic 400 ' + Math.round(W * (fmt === 'l' ? 0.026 : 0.04)) + 'px Didot, "Bodoni 72", Georgia, serif';
    x.fillStyle = 'rgba(232,228,250,0.92)';
    x.fillText(artist, W / 2, base + Math.round(W * (fmt === 'l' ? 0.056 : 0.082)), W - Math.round(W * 0.2));
  }
  x.font = Math.round(W * 0.018) + 'px "SF Mono", Menlo, monospace';
  x.fillStyle = 'rgba(210,206,235,0.72)';
  x.fillText('step inside it. no app, just a browser', W / 2, base + Math.round(W * (fmt === 'l' ? 0.095 : 0.135)));
  x.textAlign = 'left';
}
function acQR(fmt) {
  const qrc = document.createElement('canvas');
  return drawQR(qrc, clipURL(), 2) ? qrc : null;
}
function stopArtistRec() {
  clearTimeout(acStop); clearInterval(acTick);
  acDraw = false;
  if (acRec && acRec.state !== 'inactive') { try { acRec.stop(); } catch (e) {} }
}
function startArtistRec(fmt) {
  stopArtistRec();
  acSaved = null;
  $('ac-video').classList.add('hidden');
  const [W, H] = AC_DIMS[fmt];
  const comp = document.createElement('canvas');
  comp.width = W; comp.height = H;
  const x = comp.getContext('2d');
  const g = document.getElementById('canvas');
  const qrc = acQR(fmt);
  acDraw = true;
  (function frame() {
    if (!acDraw) return;
    const sc = Math.max(W / g.width, H / g.height);
    x.drawImage(g, (W - g.width * sc) / 2, (H - g.height * sc) / 2, g.width * sc, g.height * sc);
    drawArtistType(x, W, H, fmt);
    if (qrc) {
      const q = Math.round(W * 0.11), m = Math.round(W * 0.04);
      x.fillStyle = '#fff';
      x.beginPath(); x.roundRect(W - q - m - 6, H - q - m - 6, q + 12, q + 12, 8); x.fill();
      x.drawImage(qrc, W - q - m, H - q - m, q, q);
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
  } catch (e) { /* silent card beats no card */ }
  const mime = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  let chunks = [];
  try {
    acRec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  } catch (e) {
    $('ac-status').textContent = 'this browser can\u2019t record video. try chrome or safari';
    acDraw = false;
    return;
  }
  acRec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  acRec.onstop = () => {
    acDraw = false;
    const type = mime || 'video/webm';
    acSaved = { blob: new Blob(chunks, { type }), type };
    const v = $('ac-video');
    if (v.dataset.url) URL.revokeObjectURL(v.dataset.url);
    v.dataset.url = URL.createObjectURL(acSaved.blob);
    v.src = v.dataset.url;
    v.classList.remove('hidden');
    hushForCard();
    playCardVideo(v);
    $('ac-status').textContent = 'twelve seconds of your world, ready to post';
  };
  acRec.start(500);
  let left = 12;
  $('ac-status').textContent = 'recording your world \u2026 0:12';
  acTick = setInterval(() => { left--; $('ac-status').textContent = 'recording your world \u2026 0:' + String(Math.max(0, left)).padStart(2, '0'); }, 1000);
  acStop = setTimeout(stopArtistRec, 12000);
}
$('mq-card').addEventListener('click', () => {
  panel.classList.add('collapsed');
  $('artist-card').classList.remove('hidden');
  startArtistRec(acFmt);
});
document.querySelectorAll('.ac-fmt').forEach(b => b.addEventListener('click', () => {
  acFmt = b.dataset.fmt;
  document.querySelectorAll('.ac-fmt').forEach(o => o.classList.toggle('on', o === b));
  startArtistRec(acFmt);
}));
$('ac-close').addEventListener('click', () => {
  stopArtistRec();
  $('artist-card').classList.add('hidden');
  $('ac-video').pause();
  unhushAfterCard();
});
$('ac-share').addEventListener('click', () => {
  if (!acSaved) { flash('STILL RECORDING, HANG ON', 1800); return; }
  if (window.__sunoShare && shareableFree(currentWorldKey)) {
    claimHome();
  }
  const ext = acSaved.type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([acSaved.blob], 'fancy-britches-artist-card.' + ext, { type: acSaved.type });
  const caption = ($('mq-title').value.trim() || 'my song') + ', from the inside: ' + clipURL() + socialTag() + '\n#FancyBritches';
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], text: caption }).catch(() => {});
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(acSaved.blob); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    navigator.clipboard.writeText(caption).catch(() => {});
    flash('CARD SAVED. CAPTION COPIED TOO', 2200);
  }
});

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
    songTitle: window.__sunoShare ? (sunoTrack.split(' \u00b7 ')[0] || 'their song') : prettyTrack($('track-select').value || audio.el.currentSrc || ''),
    artistName: window.__sunoShare ? (sunoTrack.split(' \u00b7 ')[1] || '') : 'Tupelo Ghost',
    lookId: settings.colorMode + '/' + settings.pattern + '/' + settings.shape,
    ...extra,
  };
}
window.__lastRun = () => sig.lastRun || null;
window.__forceArchetype = null;   // dev: pin an archetype id to preview its pool
function recordRun(meta) {
  const run = sig.endRun(meta);
  pickShareLine(run, '', window.__forceArchetype)
    .then(l => {
      window.__shareLine = l;
      console.debug('[line]', JSON.stringify(l));
      // the card's sub-line becomes this world's verdict on this run
      if (resultsShown) $('results-sub').textContent = l.text;
    })
    .catch(() => {});
  return run;
}
window.__previewLine = force => pickShareLine(sig.lastRun || {}, '', force || null);
window.__signals = () => sig.snapshot({
  worldId: currentWorldKey,
  lookId: settings.colorMode + '/' + settings.pattern + '/' + settings.shape,
  songTitle: window.__sunoShare ? (sunoTrack.split(' \u00b7 ')[0] || 'their song') : prettyTrack($('track-select').value || audio.el.currentSrc || ''),
  artistName: window.__sunoShare ? (sunoTrack.split(' \u00b7 ')[1] || '') : 'Tupelo Ghost',
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
    $('cw-msg').textContent = r.ok ? "got it. we'll be in touch" : 'that didn\u2019t send. try again';
    if (r.ok) setTimeout(() => $('custom-form').classList.add('hidden'), 2600);
  }).catch(() => { $('cw-msg').textContent = 'no connection. try again in a spell'; });
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
    $('wl-msg').textContent = r.ok ? "you're on the list" : 'that did not take. try again?';
    if (r.ok) { $('wl-email').value = ''; setTimeout(() => $('waitlist-form').classList.add('hidden'), 2200); }
  }).catch(() => { $('wl-msg').textContent = 'no connection. try again in a spell'; });
});
$('room-badge').addEventListener('click', () => {
  if (document.body.classList.contains('hosting')) $('stream-card').classList.toggle('hidden');
});
$('join-room').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
$('join-room').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
let nameDeck = [];
$('name-dice').addEventListener('click', () => {
  // a shuffled deck, dealt one at a time — no repeats till the well runs dry
  if (!nameDeck.length) nameDeck = shuffled(NAME_POOL);
  const pick = nameDeck.pop();
  $('join-name').value = pick;
  localStorage.setItem('fp_name', pick);
});
$('btn-join').addEventListener('click', () => {
  const code = $('join-room').value.trim().toUpperCase();
  if (code.length < 4) { $('join-msg').textContent = "we'll need that room code, sugar"; return; }
  startRoom(code, $('join-name').value.trim(), false);
});

// a name nobody had to type — southern, friendly, never blocking the door
// the name well — deep enough that the dice stay fun. Southern nouns,
// porch critters, diner food, and things your memaw would holler.
const NAME_POOL = [
  // critters
  'junebug', 'firefly', 'possum', 'catfish', 'crawdad', 'skeeter', 'tadpole',
  'bullfrog', 'mudbug', 'goober', 'critter', 'varmint', 'gator', 'catbird',
  'bluejay', 'whippoorwill', 'mockingbird', 'ladybird', 'doodlebug', 'rooster',
  'banty', 'heifer', 'cooter', 'nightcrawler', 'bobcat', 'armadillo',
  'chickadee', 'bobwhite', 'killdeer', 'dragonfly', 'lightninbug', 'polecat',
  'groundhog', 'chipmunk', 'bream', 'crappie', 'mudcat', 'hounddog',
  'bluetick', 'redbone', 'beagle', 'tomcat', 'barncat', 'billygoat',
  'nannygoat', 'muskrat', 'terrapin', 'wasper', 'dirtdauber', 'katydid',
  'cicada', 'cricket', 'peeper', 'minnow', 'shiner', 'whistlepig',
  'grasshopper', 'inchworm', 'bollweevil', 'honeybee', 'bumblebee',
  'wiggleworm', 'ringtail', 'wildcat', 'muleskin',
  // vittles
  'biscuit', 'peaches', 'dumplin', 'hushpuppy', 'cornbread', 'sweettea',
  'moonpie', 'okra', 'pecan', 'gumbo', 'grits', 'chicory', 'cobbler',
  'julep', 'praline', 'beignet', 'boudin', 'etouffee', 'fritter', 'flapjack',
  'shortcake', 'puddin', 'sugarplum', 'cayenne', 'jambalaya', 'succotash',
  'chowchow', 'gherkin', 'sorghum', 'molasses', 'honeybun', 'sweetpea',
  'snapbean', 'butterbean', 'collard', 'turnip', 'rutabaga', 'kumquat',
  'mayhaw', 'muscadine', 'peanut', 'buttermilk', 'clabber', 'gravyboat',
  'hominy', 'hoecake', 'johnnycake', 'cracklin', 'chitlin', 'fatback',
  // flora
  'magnolia', 'clover', 'sassafras', 'persimmon', 'honeysuckle', 'bluebell',
  'hollyhock', 'wisteria', 'sawgrass', 'cattail', 'catalpa', 'kudzu',
  'brambleberry', 'dogwood', 'redbud', 'sweetgum', 'sycamore', 'loblolly',
  'palmetto', 'cottonwood', 'tumbleweed', 'zinnia', 'marigold', 'petunia',
  'camellia', 'azalea', 'gardenia', 'tigerlily', 'blackberry', 'dewberry',
  'mulberry', 'pawpaw', 'hickory', 'buckeye', 'chinaberry', 'gourd',
  // the porch
  'porchlight', 'smokehouse', 'tacklebox', 'bobber', 'clothesline',
  'screendoor', 'porchswing', 'washboard', 'moonshine', 'masonjar',
  'strawhat', 'overalls', 'washtub', 'woodstove', 'cellardoor', 'stovepipe',
  'fiddle', 'washpot', 'dinnerbell', 'johnboat', 'airboat', 'skiff',
  'pontoon', 'flatbed', 'tailgate', 'mudflap', 'backroad', 'buckboard',
  'haywagon', 'hotrod', 'jalopy', 'sparkplug', 'crankshaft',
  // the land
  'yonder', 'sundog', 'redclay', 'bayou', 'thicket', 'brierpatch',
  'creekbed', 'sandbar', 'levee', 'delta', 'holler', 'gullywasher',
  // the dance
  'banjo', 'hoedown', 'shindig', 'sockhop', 'twostep', 'dosido',
  'hootenanny', 'jamboree', 'dulcimer', 'jugband', 'harmonica', 'zydeco',
  'cakewalk', 'clogger', 'flatfoot', 'yodel', 'dixie',
  // kinfolk & mischief
  'meemaw', 'bubba', 'darlin', 'sugarbritches', 'fancybritches', 'britches',
  'youngin', 'rapscallion', 'sassypants', 'lambchop', 'snickerdoodle',
  'whippersnapper', 'ragamuffin', 'knucklehead', 'stinker', 'scamp',
  'galoot', 'cattywampus', 'lollygag', 'skedaddle', 'hornswoggle',
  'doohickey', 'thingamajig', 'whatnot', 'dagnabbit', 'dadgum', 'hogwash',
  'malarkey', 'tomfoolery', 'shenanigan', 'caboodle', 'humdinger', 'dilly',
  'stemwinder', 'pistol', 'spitfire', 'firecracker', 'sugarfoot',
  'buttercup', 'scalawag', 'rascal', 'hollerin', 'sweetroll',
];
function ensureName() {
  let n = $('join-name').value.trim();
  if (!validName(n)) n = localStorage.getItem('fp_name') || '';
  if (!validName(n)) {
    n = NAME_POOL[(Math.random() * NAME_POOL.length) | 0] + (10 + (Math.random() * 90 | 0));
  }
  $('join-name').value = n;
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
        flash('DAY ' + streak + ' IN A ROW \u00b7 +' + bonus + ', SUGAR', 2600);
      }, 2500);
    }
  }
  return n;
}
// PLAY asks nothing: the house music starts and the visitor is already in.
// Only the second door, for people who came with their own music or a room
// to run, gets the question about whose music it is.
$('btn-solo').addEventListener('click', () => {
  if (window.__joinIntent) {
    const code = window.__joinIntent; window.__joinIntent = null;
    startRoom(code, ensureName(), false);
    return;
  }
  ensureName();
  dismissOverlay();
});
$('btn-host-promote').addEventListener('click', () => {
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
// The schedule starts the week of Monday, Aug 17 2026, with SLIDE. Every
// world that has finished its week GRADUATES: it joins the library for good,
// so the menu grows by one world every Monday until all seventeen are home.
// Weeks turn on MONDAYS (epoch shifted 4 days — raw epoch weeks flip on
// thursdays, which is nobody's menu day).
const WEEK_POOL = (() => {
  const pool = Object.keys(WORLDS).filter(k => !FEATURED.includes(k)).sort();
  const i = pool.indexOf('slide');           // slide leads the parade
  return [...pool.slice(i), ...pool.slice(0, i)];
})();
const LAUNCH_WEEK = Math.floor((Date.UTC(2026, 7, 17) - 4 * 86400000) / 604800000);
const WEEKS_IN = Math.max(0, Math.floor((Date.now() - 4 * 86400000) / 604800000) - LAUNCH_WEEK);
const WEEK_WORLD = WEEK_POOL[WEEKS_IN % WEEK_POOL.length];
// the alumni: every special whose week is over, permanent residents now
const GRADUATED = WEEK_POOL.slice(0, Math.min(WEEKS_IN, WEEK_POOL.length))
  .filter(k => k !== WEEK_WORLD);
// free share worlds = the showcase pair + this week's guest — exactly the
// three the picker leads with. Artist access opens the other fourteen.
const shareableFree = k => window.__devPaid || FEATURED.includes(k) || k === WEEK_WORLD;
window.__FEATURED_KEYS = FEATURED;
window.__WEEK_KEY = WEEK_WORLD;
window.__GRADUATED = GRADUATED;
window.__pickerInit();
let ropeShown = false;   // the explainer card appears once per session
// the rope: the full card once per session, a quick flash after
function ropeGate(msg) {
  if (!ropeShown) { ropeShown = true; $('taste-card').classList.remove('hidden'); }
  else flash(msg, 2800);
}
// ── PROMOTE A SONG ── the artist path in one small form: pick the world
// (the three a free song can share from), hand over the song, go. The
// player path shares too; this one exists to make the SONG the point.
let promoteWorld = null;   // remembered for the mp3 route
// each open world gets one honest sentence, so an artist knows what
// they're putting their song inside before they commit
const WORLD_BLURBS = {
  tunnel: 'drift through a tunnel of light. click to send shockwaves',
  surfer: 'catch sparks and jump. air time pays',
  slide: 'fly a neon waterslide. steer through the rings',
};
let prWorldPick = null;
// ── the two side doors ── The front door is one button. Everything else a
// visitor might want is a quiet link that opens what it promises: most people
// came to play, and the ones joining friends or promoting a song went looking
// on purpose. Both fold the other away, so only one thing is ever open.
$('open-party').addEventListener('click', e => {
  e.preventDefault();
  const party = $('party-block');
  const opening = party.classList.contains('folded');
  party.classList.toggle('folded', !opening);
  $('open-party').textContent = opening ? 'never mind' : 'got a room code?';
  if (opening) {
    $('promote-form').classList.add('hidden');
    $('custom-form').classList.add('hidden');
    setTimeout(() => $('join-room').focus({ preventScroll: true }), 260);
  }
});
function togglePromote() {
  $('custom-form').classList.add('hidden');
  const f = $('promote-form');
  f.classList.toggle('hidden');
  if (f.classList.contains('hidden')) return;
  const box = $('pr-worlds');
  if (!box.children.length) {
    for (const k of [...FEATURED, WEEK_WORLD]) {
      const b = document.createElement('button');
      b.className = 'pr-opt';
      b.dataset.key = k;
      b.innerHTML = '<img class="pr-thumb" src="previews/' + k + '.jpg" alt="">'
        + '<span><b>' + WORLDS[k].label + (k === WEEK_WORLD ? ' \u2605 THIS WEEK\u2019S SPECIAL' : '') + '</b>'
        + '<em>' + (WORLD_BLURBS[k] || WORLDS[k].goal || '') + '</em></span>';
      b.addEventListener('click', () => {
        prWorldPick = k;
        [...box.children].forEach(x => x.classList.toggle('on', x === b));
      });
      box.appendChild(b);
    }
    box.firstElementChild.click();   // tunnel pre-picked, never un-picked
  }
  $('pr-url').focus();
}
$('pr-url').addEventListener('keydown', e => { if (e.key === 'Enter') $('pr-go').click(); });
$('pr-go').addEventListener('click', () => {
  const raw = $('pr-url').value.trim();
  if (!/suno\.com\/(song|s|playlist)\//.test(raw)) {
    // a link we cannot play still gets a home: it goes in the world as the
    // room's shout-out and the house music carries the dancing
    if (/^https?:\/\//i.test(raw)) {
      const key = prWorldPick;
      ensureName();
      dismissOverlay();
      if (WORLDS[key]) { switchWorld(key); $('world-select').value = key; }
      promoteLink(raw);
      $('promote-form').classList.add('hidden');
      $('mode-card').classList.remove('show');   // the card's job is done
      return;
    }
    $('pr-msg').textContent = 'paste your song link, or load an mp3';
    return;
  }
  const key = prWorldPick;
  ensureName();
  dismissOverlay();
  if (WORLDS[key]) { switchWorld(key); $('world-select').value = key; }
  openArtistDoor(raw);
  $('promote-form').classList.add('hidden');
  $('suno-rights').textContent = 'play it in every world, on the house. share from TUNNEL, SURFER, or this week\u2019s special: ' + WORLDS[WEEK_WORLD].label;
});
// the mp3 route remembers the chosen world and rides the same file input
$('pr-file').addEventListener('click', () => {
  promoteWorld = prWorldPick;
  ensureName();
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
    $('taste-msg').textContent = r.ok ? "you're on the list, sugar. we'll holler" : 'that did not take. try again?';
    if (r.ok) setTimeout(() => { $('taste-card').classList.add('hidden'); }, 2000);
  }).catch(() => { $('taste-msg').textContent = 'no connection. try again in a spell'; });
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

// ── DEV MODE (?dev=1) ── audition the whole share system without grinding
// rounds: force archetypes, preview lines, open all three cards on fake
// signals, skip to the end of a run, toggle the paid gate.
if (params.get('dev') === '1') document.body.classList.add('devmode');
if (params.get('dev') === '1') (function devPanel() {
  // friendly names for the numbers behind a joke
  const FIELD_WORDS = {
    movementRatio: 'movement', runSeconds: 'seconds in the world', tweakCount: 'look changes',
    worldsVisited: 'worlds visited', songsPlayed: 'songs played', roomSize: 'people in the room',
    wasAlone: 'was alone', rejoined: 'came back', bailedEarly: 'left early',
    sessionSeconds: 'seconds this session', pointsGained: 'points', feet: 'feet',
    accuracy: 'accuracy', bestStreak: 'streak', finished: 'finished the song',
  };
  const plainWhy = why => {
    if (!why || typeof why !== 'object') return '';
    return Object.entries(why).map(([f, [op, v]]) =>
      (FIELD_WORDS[f] || f) + ' ' + op + ' ' + v).join(', ');
  };
  const el = document.createElement('div');
  el.id = 'dev-panel';
  el.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:400;width:270px;'
    + 'max-height:calc(100vh - 20px);max-height:calc(100dvh - 20px);overflow-y:auto;'
    + '-webkit-overflow-scrolling:touch;overscroll-behavior:contain;'
    + 'background:rgba(8,8,18,0.95);border:1px solid rgba(255,80,80,0.4);border-radius:12px;'
    + 'padding:12px;font:11px "SF Mono",Menlo,monospace;color:#cfc9ee;display:flex;'
    + 'flex-direction:column;gap:8px;';
  const mk = (tag, css, text) => {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text) n.textContent = text;
    return n;
  };
  // each zone gets its own colour + emoji anchor, so the eye can jump
  // straight to the right block without reading
  let curColor = '#ff8f8f';
  const H = (t, c) => {
    curColor = c || curColor;
    const h = mk('div', 'color:' + curColor + ';letter-spacing:1.4px;margin-top:10px;font-weight:700;'
      + 'padding:8px 10px;border-radius:9px;background:' + curColor + '1e;'
      + 'border:1px solid ' + curColor + '4d;cursor:pointer;display:flex;justify-content:space-between;', '');
    h.dataset.hdr = t;
    const lab = mk('span', '', t);
    const arrow = mk('span', 'opacity:0.7;', '\u25be');
    h.appendChild(lab); h.appendChild(arrow);
    h._arrow = arrow;
    return h;
  };
  const NOTE = t => mk('div', 'color:#8d87b5;line-height:1.45;padding:0 2px;', t);
  const BTN = (label, fn) => {
    const b = mk('button', 'padding:9px 10px;border-radius:10px;'
      + 'border:1px solid rgba(255,255,255,0.14);border-left:3px solid ' + curColor + ';'
      + 'background:linear-gradient(90deg,' + curColor + '14, rgba(255,255,255,0.05));'
      + 'color:#eeeafc;cursor:pointer;font:10.5px "SF Mono",Menlo,monospace;text-align:left;', label);
    b.addEventListener('click', fn);
    return b;
  };

  const headRow = mk('div', 'display:flex;justify-content:space-between;align-items:center;gap:6px;');
  const head = mk('div', 'color:#ff8f8f;letter-spacing:1px;cursor:pointer;flex:1;', 'TESTING PANEL. tap to hide');
  // drag the right edge to size the panel however you like (remembered)
  const applySize = () => { el.style.width = (parseInt(localStorage.getItem('fp_dev_width') || '280', 10)) + 'px'; };
  const sizeBtn = mk('div', 'color:#8d87b5;font-size:9.5px;', '\u21d4 drag edge');
  const grip = mk('div', 'position:absolute;top:0;right:-4px;width:14px;height:100%;cursor:ew-resize;'
    + 'touch-action:none;');
  const gripBar = mk('div', 'position:absolute;top:50%;right:5px;transform:translateY(-50%);width:4px;height:56px;'
    + 'border-radius:3px;background:rgba(255,143,143,0.5);');
  grip.appendChild(gripBar);
  el.style.position = 'fixed';
  el.appendChild(grip);
  let dragW = null;
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    dragW = { x: e.clientX, w: el.offsetWidth };
  });
  grip.addEventListener('pointermove', e => {
    if (!dragW) return;
    const w = Math.max(190, Math.min(560, dragW.w + (e.clientX - dragW.x)));
    el.style.width = w + 'px';
  });
  grip.addEventListener('pointerup', () => {
    if (!dragW) return;
    localStorage.setItem('fp_dev_width', String(el.offsetWidth));
    dragW = null;
  });
  const body = mk('div', 'display:flex;flex-direction:column;gap:8px;');
  head.addEventListener('click', () => { body.style.display = body.style.display === 'none' ? '' : 'none'; });
  headRow.appendChild(head);
  headRow.appendChild(sizeBtn);
  el.appendChild(headRow);
  el.appendChild(body);
  applySize();
  body.appendChild(NOTE('only you see this (the ?dev=1 in the address turns it on)'));

  // ── the jokes: walk each pool in order, thumb down the misses ──
  body.appendChild(H('\ud83d\ude06 REVIEW THE JOKES', '#eece78'));
  body.appendChild(NOTE('pick a player type. jokes appear one by one, in order. \ud83d\udc4e saves a joke to your cut list.'));
  const sel = mk('select', 'padding:7px;border-radius:8px;background:rgba(255,255,255,0.06);color:#e8e4fa;border:1px solid rgba(255,255,255,0.18);font:10.5px "SF Mono",Menlo,monospace;');
  body.appendChild(sel);
  let pool = [], poolAt = -1, poolArch = '';
  const jokeOut = mk('div', 'min-height:44px;color:#e8e4fa;line-height:1.45;background:rgba(255,255,255,0.04);border-radius:8px;padding:8px;cursor:pointer;');
  const jokeMeta = mk('div', 'color:#7f79a8;');
  const rarity = w => (w >= 8 ? 'common' : w >= 3 ? 'uncommon' : 'RARE');
  function showJoke(step) {
    if (!pool.length) { jokeOut.textContent = 'no lines for this type yet'; jokeMeta.textContent = ''; return; }
    poolAt = (poolAt + step + pool.length) % pool.length;
    const l = pool[poolAt];
    jokeOut.textContent = l.t + '  ' + (l.c || '');
    jokeMeta.textContent = 'joke ' + (poolAt + 1) + ' of ' + pool.length + ' \u00b7 ' + rarity(l.w || 1) + ' \u00b7 tap the joke for the next one';
  }
  async function loadPool() {
    const spec = await loadLines(currentWorldKey);
    const id = sel.value;
    poolArch = id || 'fallback';
    pool = [];
    if (spec) {
      const arch = id ? spec.archetypes.find(x => x.id === id) : null;
      pool = arch ? arch.lines : (spec.fallback || []);
    }
    poolAt = -1;
    showJoke(1);
    window.__forceArchetype = id || null;
  }
  async function fillArchetypes() {
    sel.innerHTML = '<option value="">backup jokes, for runs that match no type</option>';
    const spec = await loadLines(currentWorldKey);
    if (spec && spec.archetypes) for (const a2 of spec.archetypes) {
      const o = document.createElement('option');
      o.value = a2.id;
      o.textContent = 'player type: ' + a2.id.replace(/-/g, ' ');
      sel.appendChild(o);
    }
    loadPool();
  }
  fillArchetypes();
  sel.addEventListener('change', loadPool);
  jokeOut.addEventListener('click', () => showJoke(1));
  body.appendChild(jokeOut);
  body.appendChild(jokeMeta);
  const cutRow = mk('div', 'display:flex;gap:6px;');
  const cutBtn = BTN('\ud83d\udc4e cut it', () => {
    if (poolAt < 0 || !pool.length) return;
    const cuts = JSON.parse(localStorage.getItem('fp_cutlist') || '[]');
    const entry = currentWorldKey + ' / ' + poolArch + ': ' + pool[poolAt].t;
    if (!cuts.includes(entry)) cuts.push(entry);
    localStorage.setItem('fp_cutlist', JSON.stringify(cuts));
    copyBtn.textContent = '\ud83d\udccb copy cut list (' + cuts.length + ')';
    showJoke(1);
  });
  const copyBtn = BTN('\ud83d\udccb copy cut list (' + JSON.parse(localStorage.getItem('fp_cutlist') || '[]').length + ')', () => {
    const cuts = JSON.parse(localStorage.getItem('fp_cutlist') || '[]');
    navigator.clipboard.writeText('cut these lines:\n' + cuts.join('\n'))
      .then(() => flash('CUT LIST COPIED', 2200)).catch(() => {});
  });
  cutBtn.style.flex = '1'; copyBtn.style.flex = '1.4';
  cutRow.appendChild(cutBtn); cutRow.appendChild(copyBtn);
  body.appendChild(cutRow);

  // ── the cards ──
  body.appendChild(H('\ud83c\udfac TEST THE SHARE CARDS', '#7cc4ff'));
  body.appendChild(NOTE('opens each card filled with pretend data. nothing is posted anywhere.'));
  body.appendChild(BTN('\u25b6 player card (joke + clip)', async () => {
    if (!sig.lastRun) sig.endRun(runMeta('toy', { pointsGained: 230 }));
    window.__shareLine = await pickShareLine(sig.lastRun, '', window.__forceArchetype);
    openShareCard();
  }));
  body.appendChild(BTN('\u25b6 streamer recap (fake room of 4)', () => {
    window.__fakeRoom = [
      { name: 'possum49', st: [7, 12, 3, 23, 94] }, { name: 'meemaw', st: [2, 4, 9, 11, 71] },
      { name: 'crawdad', st: [0, 2, 12, 8, 55] }, { name: 'doodlebug', st: [4, 9, 5, 31, 88] },
    ];
    window.__openRecap();
  }));
  body.appendChild(BTN('\u25b6 artist video (records 12s)', () => {
    if (!$('mq-title').value) { $('mq-title').value = 'holographic'; $('mq-artist').value = 'tupelo ghost'; }
    $('mq-card').click();
  }));

  // ── shortcuts ──
  body.appendChild(H('\u26a1 SHORTCUTS', '#8affc1'));
  // jump to ANY world without SEE ALL clicking
  const wsel = mk('select', 'padding:7px;border-radius:8px;background:rgba(255,255,255,0.06);color:#e8e4fa;border:1px solid rgba(255,255,255,0.18);font:10.5px "SF Mono",Menlo,monospace;');
  const wo0 = document.createElement('option');
  wo0.value = ''; wo0.textContent = 'jump to any world\u2026';
  wsel.appendChild(wo0);
  for (const k of Object.keys(WORLDS)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = WORLDS[k].label + (k === WEEK_WORLD ? ' \u2605' : '');
    wsel.appendChild(o);
  }
  wsel.addEventListener('change', () => {
    if (!wsel.value) return;
    $('world-select').value = wsel.value;
    switchWorld(wsel.value);
    wsel.value = '';
  });
  body.appendChild(wsel);
  body.appendChild(BTN('\u23e9 skip to the end of this song', () => {
    if (audio.el.duration) { audio.el.currentTime = Math.max(0, audio.el.duration - 1.2); audio.play().catch(() => {}); }
  }));
  const paid = BTN('\u2b50 pretend i paid for artist access: NO', () => {
    window.__devPaid = !window.__devPaid;
    paid.textContent = '\u2b50 pretend i paid for artist access: ' + (window.__devPaid ? 'YES' : 'NO');
  });
  body.appendChild(paid);

  // ── hear the sounds ── judging audio by playing a whole song is slow;
  // these fire each voice on demand so a verdict takes two seconds
  body.appendChild(H('\ud83d\udd0a HEAR THE SOUNDS', '#8affc1'));
  body.appendChild(NOTE('tap to hear each one on its own. nothing else happens.'));
  const SOUNDS = [
    ['catch a spark (small)', () => sfx.swoosh('soft')],
    ['catch a spark (bigger)', () => sfx.swoosh('air')],
    ['rainbow spark', () => sfx.swoosh('bloom')],
    ['hit on the beat', () => sfx.hit(6, true)],
    ['a miss', () => sfx.thud()],
    ['a clear', () => sfx.clear(3)],
    ['someone passes you', () => sfx.pass(false)],
    ['the finish', () => sfx.fanfare()],
  ];
  // asking to hear a sound counts as asking — the front-door gate steps aside
  // for the length of the sound, then closes again
  const audition = play => () => {
    sfx.setSfxMuted(false);
    play();
    setTimeout(syncSfxMute, 7000);
  };
  for (const [label, play] of SOUNDS) body.appendChild(BTN('\u25b6 ' + label, audition(play)));


  // ── the notebook: anything she notices becomes a note that knows where
  // it happened; one button copies the whole session's feedback for claude ──
  body.appendChild(H('\ud83d\udcdd NOTES FOR CLAUDE', '#ff9de2'));
  body.appendChild(NOTE('type what you noticed. the note remembers the world, song & version by itself.'));
  const noteIn = mk('input', 'padding:8px;border-radius:8px;background:rgba(255,255,255,0.06);color:#e8e4fa;border:1px solid rgba(255,255,255,0.18);font:10.5px "SF Mono",Menlo,monospace;');
  noteIn.placeholder = 'e.g. the hoops feel too fast here';
  body.appendChild(noteIn);
  const devErrors = [];
  window.addEventListener('error', e => { devErrors.push(String(e.message).slice(0, 120)); if (devErrors.length > 3) devErrors.shift(); });
  const noteCtx = () => {
    const run = sig.lastRun;
    return '[' + (document.querySelector('script[src*="main.js"]')?.src.match(/v=(\d+)/)?.[1] || '?')
      + ' \u00b7 ' + currentWorldKey
      + ' \u00b7 ' + prettyTrack($('track-select').value || audio.el.currentSrc || 'no song')
      + (run ? ' \u00b7 last run: ' + run.kind : '') + ']';
  };
  const savedNotes = () => JSON.parse(localStorage.getItem('fp_notes') || '[]');
  let pendingShot = null;
  const saveBtn = BTN('\u2795 save note (0)', () => {
    const t = noteIn.value.trim();
    if (!t && !pendingShot) { noteIn.focus(); return; }
    const notes = savedNotes();
    const shotTag = pendingShot ? ' \ud83d\udcf8 ' + pendingShot : '';
    pendingShot = null;
    noteIn.placeholder = 'e.g. the hoops feel too fast here';
    notes.push(noteCtx() + shotTag + (t ? ' ' + t : '') + (devErrors.length ? '  \u26a0 errors: ' + devErrors.join(' | ') : ''));
    localStorage.setItem('fp_notes', JSON.stringify(notes));
    noteIn.value = '';
    saveBtn.textContent = '\u2795 save note (' + notes.length + ')';
    flash('NOTED', 1600);
  });
  saveBtn.textContent = '\u2795 save note (' + savedNotes().length + ')';
  noteIn.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
  body.appendChild(saveBtn);
  // screenshot + note in one tap: the picture uploads itself and its link
  // rides the note — copy EVERYTHING hands claude the images too
  let screenVideo = null;
  async function grabFrame() {
    // full-tab capture where supported (one-time permission, stream reused);
    // game-canvas-only everywhere else
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      try {
        if (!screenVideo || !screenVideo.srcObject || !screenVideo.srcObject.active) {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true,
          });
          screenVideo = document.createElement('video');
          screenVideo.srcObject = stream;
          screenVideo.muted = true;
          await screenVideo.play();
          await new Promise(r => setTimeout(r, 250));   // let the first frame land
        }
        const sc2 = document.createElement('canvas');
        const vw = screenVideo.videoWidth, vh = screenVideo.videoHeight;
        const w = Math.min(1100, vw), h = Math.round(w * vh / vw);
        sc2.width = w; sc2.height = h;
        sc2.getContext('2d').drawImage(screenVideo, 0, 0, w, h);
        return sc2;
      } catch (e) { /* declined or unsupported — fall through to the canvas */ }
    }
    const g = document.getElementById('canvas');
    if (!g || !g.width) return null;
    const sc2 = document.createElement('canvas');
    const w = 900, h = Math.round(900 * g.height / g.width);
    sc2.width = w; sc2.height = h;
    sc2.getContext('2d').drawImage(g, 0, 0, w, h);
    return sc2;
  }
  body.appendChild(BTN('\ud83d\udcf8 screenshot + note', async () => {
    const sc2 = await grabFrame();
    if (!sc2) return;
    // squeeze under the storage ceiling — context beats fidelity here
    let q = 0.62, b64 = '';
    do { b64 = sc2.toDataURL('image/jpeg', q).split(',')[1]; q -= 0.12; } while (b64.length > 250000 && q > 0.2);
    const text = noteIn.value.trim();
    flash('\ud83d\udcf8 UPLOADIN\u2019 THE SHOT\u2026', 1400);
    fetch(`${SUNO_PROXY}shot`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ img: b64, note: text }),
    }).then(r => r.json()).then(r => {
      // the shot is up — now ask what it's ABOUT, and tie the two together
      pendingShot = r.url;
      noteIn.value = '';
      noteIn.placeholder = 'what should this screenshot say?';
      noteIn.focus();
      flash('SHOT UPLOADED. ADD A NOTE', 2400);
    }).catch(() => flash('UPLOAD FAILED. TRY AGAIN', 2000, true));
  }));
  body.appendChild(NOTE('\ud83d\udcf8 first tap asks to share this tab. say yes and every shot captures EVERYTHING on screen, cards and menus included. (if the ask never appears, shots cover the game world only.)'));
  const copyAll = BTN('\ud83d\udce4 copy EVERYTHING for claude', () => {
    const notes = savedNotes();
    const cuts = JSON.parse(localStorage.getItem('fp_cutlist') || '[]');
    const out = [];
    if (notes.length) out.push('NOTES:\n' + notes.join('\n'));
    if (cuts.length) out.push('CUT THESE LINES:\n' + cuts.join('\n'));
    if (!out.length) { flash('NOTHING SAVED YET', 1600); return; }
    navigator.clipboard.writeText(out.join('\n\n'))
      .then(() => flash('COPIED', 2400)).catch(() => {});
  });
  body.appendChild(copyAll);
  const notesView = mk('div', 'display:none;color:#c9c3ec;line-height:1.5;background:rgba(255,255,255,0.04);border-radius:8px;padding:8px;max-height:160px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;');
  body.appendChild(BTN('\ud83d\udc40 view saved notes', () => {
    const notes = savedNotes();
    notesView.textContent = notes.length ? notes.map((n, i) => (i + 1) + '. ' + n).join('\n\n') : 'nothing saved yet';
    notesView.style.display = notesView.style.display === 'none' ? '' : 'none';
  }));
  body.appendChild(notesView);
  body.appendChild(BTN('\ud83d\uddd1 clear notes & cut list', () => {
    localStorage.removeItem('fp_notes'); localStorage.removeItem('fp_cutlist');
    saveBtn.textContent = '\u2795 save note (0)';
    flash('CLEARED. FRESH PAGE', 1600);
  }));

  // ── status: the facts you keep asking the console for ──
  const status = mk('div', 'color:#8d87b5;line-height:1.5;border-top:1px solid rgba(255,255,255,0.1);padding-top:7px;');
  const ver = document.querySelector('script[src*="main.js"]')?.src.match(/v=(\d+)/)?.[1] || '?';
  setInterval(() => {
    status.textContent = 'v' + ver + ' \u00b7 this week\u2019s special: ' + WORLDS[WEEK_WORLD].label
      + (devErrors.length ? '\n\u26a0 ' + devErrors[devErrors.length - 1] : '');
  }, 2000);
  body.appendChild(status);

  // ── what fired ──
  const fired = mk('div', 'color:#9d97c2;line-height:1.45;border-top:1px solid rgba(255,255,255,0.1);padding-top:7px;');
  fired.textContent = 'last joke came from: none yet';
  body.appendChild(fired);
  setInterval(() => {
    const l = window.__shareLine;
    if (l) {
      const w = plainWhy(l.why);
      fired.textContent = 'last joke came from: ' + l.archetype.replace(/-/g, ' ') + (w ? ' (' + w + ')' : '');
    }
  }, 1500);
  let lastW = currentWorldKey;
  setInterval(() => { if (currentWorldKey !== lastW) { lastW = currentWorldKey; fillArchetypes(); } }, 1500);
  // fold-up drawers: each colored header tucks its own section away —
  // open what you need, the rest stays out of the way (remembered)
  {
    const kids = [...body.children];
    let cur = null, sections = [];
    for (const k of kids) {
      if (k.dataset && k.dataset.hdr) { cur = { hdr: k, items: [] }; sections.push(cur); }
      else if (cur) cur.items.push(k);
    }
    for (const sec of sections) {
      const key2 = 'fp_dev_open_' + sec.hdr.dataset.hdr.slice(0, 12);
      const setOpen = open => {
        sec.items.forEach(it => { it.style.display = open ? '' : 'none'; });
        sec.hdr._arrow.textContent = open ? '\u25be' : '\u25b8';
        localStorage.setItem(key2, open ? '1' : '0');
      };
      setOpen(localStorage.getItem(key2) !== '0');
      sec.hdr.addEventListener('click', () => setOpen(sec.items[0] && sec.items[0].style.display === 'none'));
    }
  }
  document.body.appendChild(el);
})();
const startWorld = WORLDS[params.get('world')] ? params.get('world') : 'tunnel';
$('world-select').value = startWorld;
switchWorld(startWorld);

// participants overlay: click a name to kill just that name (they keep playing)
// ── Emoji bombs ── click a player, pick an emoji, and it rains all over
// THEIR screen. Costs points, which completes the economy: rounds pay you at
// the bell, and this is what the money is FOR — mischief.
const EMOJIS = ['\u2764\uFE0F', '\u{1F47B}', '\u{1F319}', '\u{1F352}', '\u2728', '\u{1F4A9}', '\u{1F61B}', '\u{1F618}'];  // heart, ghost, moon, cherry, stars, poop, tongue, kiss — her list, verbatim
const BOMB_COST = 15;   // (legacy name; emojis are free now)
// free to throw, limited by breath: emojis 6 per 20s, tricks 2 per 30s —
// enough to be rowdy, never enough to wallpaper somebody's screen
const emoteLog = [], trickLog = [];
function rateOk(log, windowMs, max) {
  const now = performance.now();
  while (log.length && now - log[0] > windowMs) log.shift();
  if (log.length >= max) {
    sfx.thud();
    flash('EASY, SUGAR. ONE SEC', 1600, true);
    return false;
  }
  log.push(now);
  return true;
}
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
    flash(fromName.toUpperCase() + ' SENT ' + char, 2200);
  }
  sfx.fanfare();
  impact(0.5);
}

function sendBomb(toName, idx) {
  if (!rateOk(emoteLog, 20000, 6)) return;
  myStats.bombs++; statsPush();
  net.sendEmote(idx, toName, EMOJIS[idx]);
  flash(EMOJIS[idx] + ' \u2192 ' + toName.toUpperCase(), 1600);
  sfx.hit(6, true);
}

net.onEmote = (p, i, to, e) => {
  if (to && to === net.local.name && i >= 100) {
    // a trick landed ON YOU — four seconds of somebody's hand on your wheel
    const now = performance.now();
    if (i === 100) debuff.fogUntil = now + 4000;
    if (i === 101) debuff.swayUntil = now + 4000;
    debuff.from = p.name || '?';
    flash(debuff.from.toUpperCase() + ' ' + (i === 100 ? '\u{1F32B}\uFE0F FOGGED YOU' : '\u{1F4AB} SWAYED YOU'), 2000, true);
    sfx.thud();
    return;
  }
  if (to && to === net.local.name) emojiRain(e || EMOJIS[i] || EMOJIS[0], p.name);
  else if (to) {
    flash((p.name || '?').toUpperCase() + ' ' + (EMOJIS[i] || '') + ' ' + to.toUpperCase(), 1400);
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
      // the tricks row — the ones with a hand on the wheel
      const trickRow = document.createElement('div');
      trickRow.className = 'bomb-picker tricks';
      TRICKS.forEach(t => {
        const b = document.createElement('button');
        b.textContent = t.e;
        b.title = t.name;
        b.addEventListener('click', ev => {
          ev.stopPropagation();
          if (!rateOk(trickLog, 30000, 2)) { flash('EASY, SUGAR. GIVE IT A BREATH', 1600, true); return; }
          myStats.bombs++; statsPush();
          net.sendEmote(t.i, p.name, t.e);
          flash(t.e + ' \u2192 ' + p.name.toUpperCase(), 1600);
          sfx.hit(9, true);
          pick.remove(); trickRow.remove();
        });
        trickRow.appendChild(b);
      });
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

  if (gentleLights) a.beatIntensity = Math.min(a.beatIntensity, 0.3);
  world.update(dt, a, participants, {
    reactivity: settings.reactivity,
    hue: hueEff,
    attract: settings.attract,
    colorMode: settings.colorMode,
    pattern: settings.pattern,
    shape: settings.shape,
    hdr: settings.hdr,
    stardust: settings.stardust,
    peak: peakLevel,
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

  updatePeak(dt, a);
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
    { beatIntensity: a.beatIntensity, time, camera, beat: a.beat, gentle: gentleLights });

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
