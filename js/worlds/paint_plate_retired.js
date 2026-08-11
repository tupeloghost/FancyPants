// PAINT BY NUMBERS — an intricate plate, a rack of paints, and a room to fill.
//
// The pictures are drawn to order rather than typed by hand: an engraver
// builds a numbered plate out of rings, rays, orbs and borders, so the plate
// carries the fine detail of a real colouring page. Every patch of one number
// that touches its neighbours is a region — load that colour and tap it once
// and the whole region floods.
//
// The room behind the plate answers the music, and paint that has been laid
// down joins in: each colour rides its own part of the mix and every beat
// sends a wave across the finished work.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=280';

const N = 44;                 // plate is N x N cells
const CELL = 1.12;
const MAXCELLS = N * N;
const SPARK = 300;
const SHAFTS = 30;

// paints — deep night through metals to bloom colours
const PAINTS = [
  { h: 0.62, s: 0.55, l: 0.30 },  // 1  midnight
  { h: 0.66, s: 0.60, l: 0.42 },  // 2  indigo
  { h: 0.72, s: 0.55, l: 0.52 },  // 3  violet
  { h: 0.80, s: 0.55, l: 0.55 },  // 4  amethyst
  { h: 0.88, s: 0.60, l: 0.58 },  // 5  orchid
  { h: 0.94, s: 0.62, l: 0.60 },  // 6  rose
  { h: 0.02, s: 0.70, l: 0.56 },  // 7  coral
  { h: 0.07, s: 0.75, l: 0.55 },  // 8  copper
  { h: 0.11, s: 0.80, l: 0.58 },  // 9  amber
  { h: 0.13, s: 0.75, l: 0.66 },  // 10 gold
  { h: 0.15, s: 0.40, l: 0.78 },  // 11 parchment
  { h: 0.45, s: 0.45, l: 0.60 },  // 12 verdigris
  { h: 0.50, s: 0.60, l: 0.52 },  // 13 teal
  { h: 0.54, s: 0.70, l: 0.58 },  // 14 aqua
  { h: 0.58, s: 0.65, l: 0.62 },  // 15 sky
  { h: 0.60, s: 0.30, l: 0.72 },  // 16 silver
  { h: 0.68, s: 0.35, l: 0.22 },  // 17 deep ink
  { h: 0.10, s: 0.30, l: 0.40 },  // 18 bronze shadow
];

// ── the engraver: draws a numbered plate ──────────────────────────────────
// Each plate is a function of position, so the detail can be as fine as the
// grid allows without anyone typing out a thousand digits.
function engrave(kind) {
  const idx = new Uint8Array(N * N);
  const at = (x, y) => {                       // x,y in -1..1
    const ax = Math.abs(x), ay = Math.abs(y);
    const edge = Math.max(ax, ay);

    // ornate border: a double frame with a bead course between
    if (edge > 0.955) return 17;
    if (edge > 0.925) return 10;
    if (edge > 0.895) return ((Math.round((x + y) * 5) % 2) ? 11 : 18);
    if (edge > 0.87) return 17;

    if (kind === 0) {
      // ── CELESTIAL: an astrolabe, a telescope on its tripod, ringed worlds ──
      // drawn as actual objects rather than banded noise
      const rot = (cx, cy, a) => {
        const dx = x - cx, dy = y - cy, co = Math.cos(a), si = Math.sin(a);
        return [dx * co + dy * si, -dx * si + dy * co];
      };
      const rect = (cx, cy, w, h, a) => {
        const [u, v] = rot(cx, cy, a);
        return Math.abs(u) < w / 2 && Math.abs(v) < h / 2;
      };

      // ── the telescope, upper right ──
      const TA = -0.46, TX = 0.44, TY = 0.42;
      const [tu, tv] = rot(TX, TY, TA);
      if (Math.abs(tv) < 0.085 && tu > -0.42 && tu < 0.40) {
        if (Math.abs(tv) > 0.062) return 18;                 // tube shadow
        if (tu > 0.30) return 10;                            // objective collar
        if (tu < -0.34) return 10;                           // eyepiece collar
        return (Math.floor(tu * 7) % 2) ? 8 : 9;             // banded barrel
      }
      if (Math.abs(tv) < 0.115 && tu > 0.36 && tu < 0.46) return 18;   // lens hood
      // tripod: three legs from under the barrel
      const mx = TX - 0.03, my = TY - 0.14;
      for (const la of [-0.42, 0, 0.42]) {
        if (rect(mx + Math.sin(la) * 0.16, my - 0.20, 0.045, 0.42, la)) return 18;
      }
      if (rect(mx, my + 0.03, 0.13, 0.12, 0)) return 10;     // the mount head

      // ── the astrolabe, lower left ──
      const dx0 = x + 0.42, dy0 = y + 0.30;
      const r = Math.hypot(dx0, dy0);
      const a0 = Math.atan2(dy0, dx0);
      if (r < 0.50) {
        if (r > 0.455) return 18;                            // rim
        if (r > 0.40) {                                      // degree ring
          const tick = Math.floor((a0 + Math.PI) / (Math.PI * 2) * 18);
          return (tick % 2) ? 10 : 11;
        }
        if (r > 0.365) return 18;
        if (r > 0.16) {                                      // the tympan web
          const mer = Math.floor((a0 + Math.PI) / (Math.PI * 2) * 6) % 2;
          const alm = Math.floor((r - 0.16) * 7) % 2;
          return (mer ^ alm) ? 12 : 13;
        }
        if (r > 0.125) return 10;                            // the rete's collar
        const petal = 0.06 + Math.cos(a0 * 3) * 0.045;       // trefoil heart
        return r < petal + 0.055 ? 9 : 11;
      }
      if (r < 0.545) return 18;                              // the suspension ring
      // the alidade laid across the dial
      { const [au, av] = rot(-0.42, -0.30, 0.55);
        if (Math.abs(av) < 0.028 && Math.abs(au) < 0.53) return 16; }
      // the throne and hanging loop above it
      if (rect(-0.42, 0.24, 0.14, 0.09, 0)) return 10;
      if (Math.hypot(x + 0.42, y - 0.34) < 0.075 && Math.hypot(x + 0.42, y - 0.34) > 0.042) return 10;

      // ── ringed worlds ──
      for (const [ox, oy, rad, tilt] of [[0.60, -0.44, 0.115, 0.35], [-0.06, 0.60, 0.085, -0.25]]) {
        const [pu, pv] = rot(ox, oy, tilt);
        const pr = Math.hypot(pu, pv);
        if (pr < rad) return (pv > rad * 0.25) ? 7 : 8;      // lit above, shaded below
        const er = Math.hypot(pu / (rad * 2.3), pv / (rad * 0.42));
        if (er < 1.05 && er > 0.72) return 10;               // its ring
      }

      // ── a corner sun ──
      const sx = x - 0.80, sy = y + 0.78, sr = Math.hypot(sx, sy);
      if (sr < 0.30) {
        if (sr < 0.14) return 9;
        const ray = Math.floor((Math.atan2(sy, sx) + Math.PI) / (Math.PI * 2) * 12);
        return (ray % 2) ? 10 : 11;
      }

      // ── stars: proper four-pointed sparks, sparsely placed ──
      for (const [sxp, syp, ss] of [
        [0.05, 0.18, 0.075], [0.72, 0.14, 0.055], [-0.72, 0.62, 0.06],
        [0.30, -0.72, 0.055], [-0.14, -0.52, 0.045], [0.86, -0.10, 0.045],
      ]) {
        const ax2 = Math.abs(x - sxp), ay2 = Math.abs(y - syp);
        if (ax2 + ay2 < ss || (ax2 < ss * 0.24 && ay2 < ss * 1.7) || (ay2 < ss * 0.24 && ax2 < ss * 1.7)) return 11;
      }

      // ── the night: broad calm bands ──
      const swirl = Math.sin(x * 1.2 + Math.sin(y * 0.9) * 1.1) + Math.cos(y * 1.15);
      return swirl > 0.8 ? 2 : swirl > -0.5 ? 1 : 17;
    }

    if (kind === 1) {
      // ROSE WINDOW — petals, tracery and a jewelled centre
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      if (r < 0.14) return (Math.floor(r * 30) % 2) ? 10 : 9;
      if (r < 0.20) return 18;
      if (r < 0.52) {
        const petal = Math.floor((a + Math.PI) / (Math.PI * 2) * 12);
        const inPetal = Math.cos((a + Math.PI) * 12) > -0.2;
        if (!inPetal) return 18;                       // the lead between panes
        const band = Math.floor((r - 0.20) * 6) % 3;
        return [3, 4, 5][band] + (petal % 2 ? 0 : 0);
      }
      if (r < 0.58) return 18;
      if (r < 0.78) {
        const lobe = Math.floor((a + Math.PI) / (Math.PI * 2) * 12);
        if (Math.cos((a + Math.PI) * 12) < -0.45) return 18;
        return (lobe % 3 === 0) ? 14 : (lobe % 3 === 1) ? 13 : 15;
      }
      if (r < 0.83) return 10;
      const ray = Math.floor((a + Math.PI) / (Math.PI * 2) * 40);
      return (ray % 2) ? 1 : 2;
    }

    // kind 2 — MOTH & MOON: wings of banded scales over a lunar disc
    const mr = Math.hypot(x - 0.46, y - 0.5);
    if (mr < 0.26) {                                   // the moon behind
      const crater = Math.sin((x - 0.46) * 11) * Math.cos((y - 0.5) * 9);
      return crater > 0.4 ? 16 : 11;
    }
    const wx = Math.abs(x), wy = y + 0.05;
    // wing outline: two lobes either side of a body
    const upper = Math.hypot((wx - 0.34) / 0.34, (wy - 0.16) / 0.30);
    const lower = Math.hypot((wx - 0.28) / 0.28, (wy + 0.26) / 0.24);
    if (wx < 0.055 && Math.abs(wy) < 0.52) {           // body
      return (Math.floor(wy * 7) % 2) ? 18 : 8;
    }
    if (upper < 1 || lower < 1) {
      const t = upper < 1 ? upper : lower;
      const band = Math.floor(t * 4) % 4;
      const vein = Math.abs(Math.sin((Math.atan2(wy, wx - 0.1)) * 5)) < 0.10;
      if (vein) return 18;
      return [5, 6, 7, 9][band];
    }
    if (wx < 0.30 && wy > 0.5 && wy < 0.72) return 18;  // antennae
    const nb = Math.sin(x * 1.7 + y * 1.3) + Math.cos(y * 1.5);
    return nb > 0.8 ? 3 : nb > -0.4 ? 2 : 1;
  };

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x = (c / (N - 1)) * 2 - 1;
      const y = 1 - (r / (N - 1)) * 2;
      idx[r * N + c] = Math.max(1, Math.min(PAINTS.length, at(x, y) | 0));
    }
  }
  return idx;
}

// Which drawn thing owns this point. 0 = page furniture (ground, border,
// stars) which stays put; everything else can be finished and lift away.
function subjectAt(kind, x, y) {
  if (Math.max(Math.abs(x), Math.abs(y)) > 0.87) return 0;   // the border
  if (kind === 0) {
    const rot = (cx, cy, a) => {
      const dx = x - cx, dy = y - cy, co = Math.cos(a), si = Math.sin(a);
      return [dx * co + dy * si, -dx * si + dy * co];
    };
    const [tu, tv] = rot(0.44, 0.42, -0.46);
    if (Math.abs(tv) < 0.115 && tu > -0.42 && tu < 0.46) return 1;      // telescope
    const mx = 0.41, my = 0.28;
    for (const la of [-0.42, 0, 0.42]) {
      const [lu, lv] = rot(mx + Math.sin(la) * 0.16, my - 0.20, la);
      if (Math.abs(lu) < 0.03 && Math.abs(lv) < 0.21) return 1;         // its tripod
    }
    if (Math.abs(x - mx) < 0.07 && Math.abs(y - (my + 0.03)) < 0.06) return 1;
    if (Math.hypot(x + 0.42, y + 0.30) < 0.55) return 2;               // astrolabe
    if (Math.hypot(x + 0.42, y - 0.34) < 0.08) return 2;
    for (let k = 0; k < 2; k++) {
      const [ox, oy, rad, tilt] = [[0.60, -0.44, 0.115, 0.35], [-0.06, 0.60, 0.085, -0.25]][k];
      const [pu, pv] = rot(ox, oy, tilt);
      if (Math.hypot(pu / (rad * 2.3), pv / (rad * 0.42)) < 1.05) return 3 + k;
    }
    if (Math.hypot(x - 0.80, y + 0.78) < 0.30) return 5;               // the sun
    return 0;
  }
  if (kind === 1) return Math.hypot(x, y) < 0.83 ? 1 : 0;              // the window
  const mr = Math.hypot(x - 0.46, y - 0.5);
  if (mr < 0.26) return 2;                                             // the moon
  const wx = Math.abs(x), wy = y + 0.05;
  if (wx < 0.06 && Math.abs(wy) < 0.55) return 1;
  if (Math.hypot((wx - 0.34) / 0.34, (wy - 0.16) / 0.30) < 1) return 1;
  if (Math.hypot((wx - 0.28) / 0.28, (wy + 0.26) / 0.24) < 1) return 1;
  return 0;
}

const PLATES = [
  { name: 'CELESTIAL', kind: 0 },
  { name: 'ROSE WINDOW', kind: 1 },
  { name: 'MOTH & MOON', kind: 2 },
];

export function createPaint() {
  let scene, camera, group, sky, motes, plate, fillGlow, sparkPts, keyLight, shafts;
  // flow: how long the current stroke has stayed clean. It widens the brush,
  // which is what makes a good stroke FEEL like a good stroke.
  let flow = 0, strokeAcc = 0;
  // ── the call ── the plate names a region and you chase it. Painting with no
  // clock is colouring-in; painting against a fading glow is a game.
  let hot = { region: -1, until: 0, cells: null, mid: [0, 0] };
  let hotCelebrate = 0;
  const numPts = [];
  const rackPots = [];
  let rackNums = [];
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  const pointer = { x: 0, y: 0, active: false };
  const _v = new THREE.Vector3();

  let cellNum = null, cellDone = null, cellPop = null, cellWave = null, cellRegion = null;
  let regionOfSize = null;
  let doneCount = 0, needCount = 0, plateIndex = 0;
  let remaining = {};        // cells still owed, per paint number
  let used = [];                       // which paint numbers this plate uses
  let held = 1;
  let completion = 0, finale = 0, denyFlash = 0;
  let waveT = 999, waveDiag = false;
  let scoreQueue = 0;
  let numDirty = true, lastHeld = -1;

  const sVel = new Float32Array(SPARK * 3);
  const sLife = new Float32Array(SPARK);
  const sHue = new Float32Array(SPARK);
  let sNext = 0;

  const cellX = c => (c - (N - 1) / 2) * CELL;
  const cellY = r => ((N - 1) / 2 - r) * CELL;
  let edges = null, frame = null;            // region outlines and the mount
  let cellSubj = null;                       // which drawn thing owns each cell
  let subjLeft = {}, subjCells = {}, subjMid = {};
  const lifts = [];                          // things that have left the page
  let charge = 0, chargeReady = 0, lastFillT = 0, floodFlash = 0;
  let hint = 0;                              // beats point at what's left
  const MAXEDGE = N * (N + 1) * 2;
  let palIndex = [];                        // display number -> palette slot
  const paint = n => PAINTS[palIndex[n - 1]] || PAINTS[0];

  function digitTexture(n) {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    g.font = '600 64px "Didot", "Bodoni 72", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';   // white glyph, tinted per-cell by vertex colour
    g.fillText(String(n), 48, 51);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  const mkPts = (n, size, op) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const p = new THREE.Points(g, glowPoints(size, op));
    p.material.vertexColors = true;
    p.frustumCulled = false;
    group.add(p);
    return p;
  };

  function spark(x, y, hue01, count, power = 1) {
    const pos = sparkPts.geometry.attributes.position;
    for (let k = 0; k < count; k++) {
      const i = sNext++ % SPARK;
      pos.setXYZ(i, x, y, 1);
      const a = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 7) * power;
      sVel[i * 3] = Math.cos(a) * sp;
      sVel[i * 3 + 1] = Math.sin(a) * sp + 2 * power;
      sVel[i * 3 + 2] = Math.random() * 4;
      sLife[i] = 0.5 + Math.random() * 0.7;
      sHue[i] = (hue01 + (Math.random() - 0.5) * 0.05 + 1) % 1;
    }
  }

  // every run of one number that touches itself is a region you fill in one tap
  function findRegions() {
    cellRegion = new Int16Array(N * N).fill(-1);
    regionOfSize = [];
    const stack = [];
    let next = 0;
    for (let s = 0; s < N * N; s++) {
      if (cellRegion[s] !== -1) continue;
      const want = cellNum[s];
      const id = next++;
      let size = 0;
      stack.length = 0;
      stack.push(s);
      cellRegion[s] = id;
      while (stack.length) {
        const i = stack.pop();
        size++;
        const r = (i / N) | 0, c = i % N;
        if (c > 0 && cellRegion[i - 1] === -1 && cellNum[i - 1] === want) { cellRegion[i - 1] = id; stack.push(i - 1); }
        if (c < N - 1 && cellRegion[i + 1] === -1 && cellNum[i + 1] === want) { cellRegion[i + 1] = id; stack.push(i + 1); }
        if (r > 0 && cellRegion[i - N] === -1 && cellNum[i - N] === want) { cellRegion[i - N] = id; stack.push(i - N); }
        if (r < N - 1 && cellRegion[i + N] === -1 && cellNum[i + N] === want) { cellRegion[i + N] = id; stack.push(i + N); }
      }
      regionOfSize[id] = size;
    }
  }

  // ink every boundary between two different numbers, and the plate's rim
  function layEdges() {
    if (!edges) return;
    const T = 0.085, d = new THREE.Object3D();
    let e = 0;
    const put = (x, y, w, h) => {
      if (e >= MAXEDGE) return;
      d.position.set(x, y, 0.22);
      d.scale.set(w, h, 1);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      edges.setMatrixAt(e++, d.matrix);
    };
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        if (c === N - 1 || cellNum[i] !== cellNum[i + 1]) {
          put(cellX(c) + CELL / 2, cellY(r), T, CELL + T);
        }
        if (c === 0) put(cellX(c) - CELL / 2, cellY(r), T, CELL + T);
        if (r === N - 1 || cellNum[i] !== cellNum[i + N]) {
          put(cellX(c), cellY(r) - CELL / 2, CELL + T, T);
        }
        if (r === 0) put(cellX(c), cellY(r) + CELL / 2, CELL + T, T);
      }
    }
    edges.count = e;
    edges.instanceMatrix.needsUpdate = true;
  }

  // always hand back the colour with the most work left — landing on one
  // with a single cell hiding somewhere is how you get stuck
  function advanceBrush() {
    let best = 0, bestN = -1;
    for (const n of used) if ((remaining[n] || 0) > best) { best = remaining[n]; bestN = n; }
    if (bestN > 0) held = bestN;
  }

  function loadPlate(index) {
    const p = PLATES[index % PLATES.length];
    const raw = engrave(p.kind);

    // the engraver reaches into the palette wherever it likes, which leaves
    // holes in the numbering. Renumber the plate 1..K, in palette order, and
    // remember which paint each number now means.
    const slots = [...new Set(raw)].sort((a, b) => a - b);
    palIndex = slots.map(v => v - 1);
    const remap = new Uint8Array(PAINTS.length + 1);
    slots.forEach((v, k) => { remap[v] = k + 1; });
    cellNum = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) cellNum[i] = remap[raw[i]];
    cellDone = new Uint8Array(N * N);
    cellPop = new Float32Array(N * N);
    cellWave = new Float32Array(N * N);
    findRegions();
    needCount = N * N;
    doneCount = 0;
    completion = 0;
    remaining = {};
    cellSubj = new Uint8Array(N * N);
    subjLeft = {}; subjCells = {}; subjMid = {};
    lifts.length = 0; charge = 0; chargeReady = 0;
    const seen = new Set();
    for (let i = 0; i < N * N; i++) {
      seen.add(cellNum[i]);
      remaining[cellNum[i]] = (remaining[cellNum[i]] || 0) + 1;
      const r = (i / N) | 0, c = i % N;
      const sx = (c / (N - 1)) * 2 - 1, sy = 1 - (r / (N - 1)) * 2;
      const sj = subjectAt(p.kind, sx, sy);
      cellSubj[i] = sj;
      if (sj) {
        subjLeft[sj] = (subjLeft[sj] || 0) + 1;
        (subjCells[sj] || (subjCells[sj] = [])).push(i);
      }
    }
    for (const sj of Object.keys(subjCells)) {
      let mx = 0, my = 0;
      for (const i of subjCells[sj]) { mx += cellX(i % N); my += cellY((i / N) | 0); }
      subjMid[sj] = [mx / subjCells[sj].length, my / subjCells[sj].length];
    }
    used = [...seen].sort((a, b) => a - b);
    held = used[0];
    numDirty = true;
    layEdges();
    if (window.__setFigure) window.__setFigure(p.name, 0, needCount);
  }

  return {
    name: 'PAINT BY NUMBERS',
    pannable: true,   // the plate is a page you can shove about

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;

      loadPlate(0);

      plate = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(CELL, CELL),
        new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true }),
        MAXCELLS
      );
      plate.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      plate.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXCELLS * 3), 3);
      plate.frustumCulled = false;
      group.add(plate);

      // region outlines — drawn where the numbers change, the way a printed
      // plate is inked, instead of a gap around every single cell
      edges = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0x14151b, toneMapped: false }),
        MAXEDGE
      );
      edges.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      edges.frustumCulled = false;
      edges.renderOrder = 1;
      group.add(edges);

      // the mount: a deep card border with a fine gilt fillet inside it
      frame = new THREE.Group();
      {
        const span = N * CELL, mat = new THREE.MeshBasicMaterial({ color: 0x0d0e13, toneMapped: false });
        const gilt = new THREE.MeshBasicMaterial({ color: 0x8a6a2f, toneMapped: false });
        const w = 3.4, f = 0.16, half = span / 2;
        for (const [sx, sy, px, py] of [
          [span + w * 2, w, 0, half + w / 2], [span + w * 2, w, 0, -half - w / 2],
          [w, span, -half - w / 2, 0], [w, span, half + w / 2, 0],
        ]) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), mat);
          m.position.set(px, py, -0.4);
          frame.add(m);
        }
        for (const [sx, sy, px, py] of [
          [span + f * 2, f, 0, half + f], [span + f * 2, f, 0, -half - f],
          [f, span, -half - f, 0], [f, span, half + f, 0],
        ]) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), gilt);
          m.position.set(px, py, 0.3);
          frame.add(m);
        }
      }
      group.add(frame);

      fillGlow = mkPts(MAXCELLS, CELL * 1.9, 0.32);
      sparkPts = mkPts(SPARK, 1.4, 0.95);
      for (let i = 0; i < SPARK; i++) sLife[i] = 0;

      numPts.length = 0;
      for (let n = 1; n <= PAINTS.length; n++) {
        const m = new THREE.InstancedMesh(
          new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92),
          new THREE.MeshBasicMaterial({
            map: digitTexture(n), transparent: true, depthWrite: false,
            depthTest: false, toneMapped: false,
          }),
          MAXCELLS
        );
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXCELLS * 3), 3);
        m.frustumCulled = false;
        m.renderOrder = 2;              // always over the plate
        group.add(m);
        numPts.push(m);
      }

      rackPots.length = 0;
      for (let n = 0; n < PAINTS.length; n++) {
        const s = glowSprite(2.6);
        s.material.opacity = 0;
        group.add(s);
        rackPots.push(s);
      }
      // each pot wears its number, in ink, so the rack is readable
      rackNums = [];
      for (let n = 1; n <= PAINTS.length; n++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: digitTexture(n), transparent: true, depthWrite: false, depthTest: false,
          toneMapped: false, color: 0x0b0d12,
        }));
        sp.scale.set(1.5, 1.5, 1);
        sp.visible = false;
        group.add(sp);
        rackNums.push(sp);
      }

      // the reactive room behind the easel
      {
        const g = new THREE.PlaneGeometry(2.6, 1, 5, 7);
        g.translate(0, 0.5, 0);
        const pa = g.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const up = pa.getY(i), side = Math.abs(pa.getX(i)) / 1.3;
          const f = Math.pow(1 - up, 1.7) * Math.pow(1 - side, 1.6);
          vc[i * 3] = f; vc[i * 3 + 1] = f; vc[i * 3 + 2] = f;
        }
        g.setAttribute('color', new THREE.BufferAttribute(vc, 3));
        shafts = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({
          vertexColors: true, transparent: true, opacity: 0.4,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }), SHAFTS);
        shafts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        shafts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SHAFTS * 3), 3);
        shafts.frustumCulled = false;
        group.add(shafts);
      }

      const mp = new Float32Array(260 * 3);
      for (let i = 0; i < 260; i++) {
        mp[i * 3] = (Math.random() - 0.5) * 150;
        mp[i * 3 + 1] = (Math.random() - 0.5) * 100;
        mp[i * 3 + 2] = -60 + Math.random() * 45;
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      motes = new THREE.Points(mg, glowPoints(0.6, 0.4));
      motes.frustumCulled = false;
      group.add(motes);

      keyLight = glowSprite(130);
      keyLight.position.set(0, 0, -34);
      keyLight.material.opacity = 0;
      group.add(keyLight);

      sky = skyDome(300);
      group.add(sky);

      plateIndex = 0; finale = 0; denyFlash = 0; waveT = 999;
      camera.position.set(0, 0, 40);
      camera.lookAt(0, 0, 0);
      camera.fov = 60;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    _debug() {
      const live = {};
      for (let i = 0; i < N * N; i++) if (!cellDone[i]) live[cellNum[i]] = (live[cellNum[i]] || 0) + 1;
      return { held, used: used.slice(), remaining: { ...remaining }, actuallyLeft: live, charge, chargeReady };
    },

    placeGhost(p, i, out) {
      const a = i * 1.6 + (this._t || 0) * 0.1;
      out.set(Math.cos(a) * 34, Math.sin(a * 0.7) * 20, 12 + Math.sin(a) * 6);
    },

    // tap a pot to load the brush; tap the plate to flood a whole region
    // ── the brush stamp ──
    // One place that fills cells so the tap and the stroke cannot drift apart.
    // Fills every un-done cell of the held colour within `rad` of (c, r) and
    // does all the bookkeeping the old region-flood did inline.
    _stamp(c, r, rad) {
      let filled = 0;
      const r0 = Math.max(0, Math.floor(r - rad)), r1 = Math.min(N - 1, Math.ceil(r + rad));
      const c0 = Math.max(0, Math.floor(c - rad)), c1 = Math.min(N - 1, Math.ceil(c + rad));
      for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
        if (Math.hypot(rr - r, cc - c) > rad) continue;
        const k = rr * N + cc;
        if (cellDone[k] || cellNum[k] !== held) continue;
        cellDone[k] = 1;
        cellPop[k] = 1.5;
        remaining[held]--;
        doneCount++;
        filled++;
      }
      if (!filled) return 0;
      numDirty = true;
      scoreQueue += filled;
      for (const sj of Object.keys(subjCells)) {
        const left = subjCells[sj].filter(k => !cellDone[k]).length;
        subjLeft[sj] = left;
        if (left === 0 && !lifts.some(l => l.sj === +sj)) {
          lifts.push({ sj: +sj, t: 0, spin: (lifts.length % 2 ? 1 : -1) * 0.4,
                       lane: lifts.length, mid: subjMid[sj] });
          scoreQueue += 150;
        }
      }
      if (window.__setFigure) window.__setFigure(PLATES[plateIndex % PLATES.length].name, doneCount, needCount);
      if (doneCount >= needCount) { finale = 1; scoreQueue += 400; }
      return filled;
    },

    onTap(x, y) {
      _v.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      const t = -camera.position.z / _v.z;
      const wx = camera.position.x + _v.x * t;
      const wy = camera.position.y + _v.y * t;

      const rackY = cellY(N - 1) - CELL * 2.6;
      if (wy < rackY + CELL * 1.4) {
        const span = (used.length - 1) * CELL * 1.7;
        for (let k = 0; k < used.length; k++) {
          const rx = k * CELL * 1.7 - span / 2;
          if (Math.abs(wx - rx) < CELL * 0.85) {
            const n = used[k];
            if (remaining[n] === 0) { denyFlash = 1; return; }  // nothing left to paint
            held = n;
            spark(rx, rackY, paint(held).h, 10, 0.5);
            return;
          }
        }
        return;
      }

      const c = Math.round(wx / CELL + (N - 1) / 2);
      const r = Math.round((N - 1) / 2 - wy / CELL);
      if (c < 0 || c >= N || r < 0 || r >= N) return;
      const i = r * N + c;

      // a charged brush doesn't fill a region — it floods the whole colour
      if (chargeReady && !cellDone[i] && cellNum[i] === held) {
        chargeReady = 0;
        floodFlash = 1;
        let n2 = 0;
        for (let k = 0; k < N * N; k++) {
          if (!cellDone[k] && cellNum[k] === held) {
            cellDone[k] = 1;
            cellPop[k] = 1.7 + Math.hypot(((k / N) | 0) - r, (k % N) - c) * 0.05;
            n2++;
          }
        }
        remaining[held] = 0;
        doneCount += n2;
        scoreQueue += 4 * n2;
        numDirty = true;
        for (const sj of Object.keys(subjCells)) {
          const left = subjCells[sj].filter(k => !cellDone[k]).length;
          subjLeft[sj] = left;
          if (left === 0 && !lifts.some(l => l.sj === +sj)) {
            lifts.push({ sj: +sj, t: 0, spin: (lifts.length % 2 ? 1 : -1) * 0.4,
                         lane: lifts.length, mid: subjMid[sj] });
            scoreQueue += 150;
          }
        }
        for (let q = 0; q < 6; q++) {
          spark((Math.random() - 0.5) * N * CELL, (Math.random() - 0.5) * N * CELL, paint(held).h, 26, 1.6);
        }
        advanceBrush();
        if (window.__setFigure) window.__setFigure(PLATES[plateIndex % PLATES.length].name, doneCount, needCount);
        if (doneCount >= needCount) { finale = 1; scoreQueue += 400; }
        return;
      }

      if (cellDone[i]) return;
      if (cellNum[i] !== held) {
        // pick up the colour the cell is asking for — a tap always paints
        held = cellNum[i];
        numDirty = true;
        spark(cellX(c), cellY(r), paint(held).h, 8, 0.5);
      }

      // A tap is a dab now, not a region. The overhaul in one line: regions
      // stopped filling themselves, so painting became a STROKE — you hold
      // and sweep, paint pours under the brush, and a long clean stroke
      // widens it. The one-tap flood survives as the charged move, which is
      // what makes charging worth wanting.
      const hue = paint(held).h;
      const filled = this._stamp(c, r, 1.15 + flow * 1.3);
      if (filled) { flow = Math.min(1, flow + 0.1); spark(cellX(c), cellY(r), hue, 6, 0.5); }
      if (!filled) return;

      // Painting steadily charges the brush; a full brush floods a whole
      // colour in one gesture — the flood the ordinary tap used to give away
      // for free is now the thing you earn.
      const nowT = performance.now();
      charge = Math.min(1, charge + (nowT - lastFillT < 3500 ? 0.16 : 0.07));
      lastFillT = nowT;
      if (charge >= 1) { charge = 0; chargeReady = 1; }
      if (remaining[held] === 0) advanceBrush();   // that colour is done — step on
    },

    update(dt, audio, participants, opts) {
      const { reactivity, attract, time, hue } = opts;

      // ── the call ── every so often the plate lights one region and loads
      // your brush with its colour. Clear it before the glow fades: sparks,
      // a chunk of score, and half a charge. Miss it: the light just moves
      // on — urgency without punishment, which is the party-game register.
      hotCelebrate = Math.max(0, hotCelebrate - dt);
      if (cellRegion && doneCount < needCount) {
        const hotDone = hot.region >= 0 && hot.cells && hot.cells.every(k => cellDone[k]);
        if (hotDone && hot.until > 0) {
          scoreQueue += 60;
          charge = Math.min(1, charge + 0.5);
          if (charge >= 1) { charge = 0; chargeReady = 1; }
          flow = 1;
          hotCelebrate = 1;
          for (let q = 0; q < 5; q++) spark(hot.mid[0], hot.mid[1], paint(held).h, 22, 1.3);
          hot.region = -1; hot.until = time + 1.2;   // a breath before the next call
        }
        if (hot.region < 0 && time > hot.until) {
          // pick a region with real work left, weighted toward bigger ones
          let bestR = -1, bestN = 3;
          for (let tries = 0; tries < 40; tries++) {
            const k = (Math.random() * N * N) | 0;
            const rId = cellRegion[k];
            if (rId < 0 || cellDone[k]) continue;
            const cells = [];
            for (let j = 0; j < N * N; j++) if (cellRegion[j] === rId && !cellDone[j]) cells.push(j);
            if (cells.length > bestN) {
              bestR = rId; bestN = cells.length;
              hot.cells = cells;
              if (cells.length > 14) break;        // big enough — take it
            }
          }
          if (bestR >= 0) {
            hot.region = bestR;
            hot.until = time + 9;                   // nine seconds of glow
            let sx = 0, sy = 0;
            for (const k of hot.cells) { sx += cellX(k % N); sy += cellY((k / N) | 0); }
            hot.mid = [sx / hot.cells.length, sy / hot.cells.length];
            // the brush loads itself — the call IS the colour choice
            held = cellNum[hot.cells[0]];
            numDirty = true;
            spark(hot.mid[0], hot.mid[1], paint(held).h, 16, 0.9);
          } else {
            hot.until = time + 2;                   // nothing worth calling yet
          }
        }
        if (hot.region >= 0 && time > hot.until) { hot.region = -1; hot.until = time + 0.8; }
      }

      // ── the stroke ── hold and sweep, and paint pours under the brush.
      // Throttled to ~30 stamps a second so a fast frame rate does not paint
      // faster than a slow one.
      flow = Math.max(0, flow - dt * 0.35);
      if (opts.holding && pointer.active && held != null && !attract) {
        strokeAcc += dt;
        if (strokeAcc >= 1 / 30) {
          strokeAcc = 0;
          _v.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
          const t = -camera.position.z / _v.z;
          const wx = camera.position.x + _v.x * t;
          const wy = camera.position.y + _v.y * t;
          const rackY = cellY(N - 1) - CELL * 2.6;
          if (wy >= rackY + CELL * 1.4) {                  // never paint the rack
            const c = Math.round(wx / CELL + (N - 1) / 2);
            const r = Math.round((N - 1) / 2 - wy / CELL);
            if (c >= 0 && c < N && r >= 0 && r < N) {
              const filled = this._stamp(c, r, 0.9 + flow * 1.5);
              if (filled) {
                flow = Math.min(1, flow + filled * 0.05 + 0.04);
                if (Math.random() < 0.4) spark(cellX(c), cellY(r), paint(held).h, 4 + flow * 8, 0.4 + flow * 0.5);
                const nowT = performance.now();
                charge = Math.min(1, charge + filled * 0.008);
                lastFillT = nowT;
                if (charge >= 1) { charge = 0; chargeReady = 1; }
                if (remaining[held] === 0) advanceBrush();
              }
            }
          }
        }
      }
      this._t = time;

      if (scoreQueue && opts.addScore) { opts.addScore(scoreQueue); scoreQueue = 0; }
      denyFlash = Math.max(0, denyFlash - dt * 2.2);

      if (finale > 0) {
        finale -= dt * 0.18;
        if (finale <= 0) { finale = 0; plateIndex++; loadPlate(plateIndex); }
      }

      const want = needCount ? doneCount / needCount : 0;
      completion += (want - completion) * Math.min(1, dt * 1.6);
      const lit = completion * (1 + finale * 1.3);

      if (audio.beat) { waveT = 0; waveDiag = !waveDiag; hint = 1; }
      hint = Math.max(0, hint - dt * 1.8);
      floodFlash = Math.max(0, floodFlash - dt * 0.9);
      for (const l of lifts) l.t = Math.min(1, l.t + dt * 0.7);
      waveT += dt * (26 + audio.energy * 22);
      const voice = [audio.bass, audio.lowMid, audio.mid, audio.high, audio.treble, audio.volume];

      const px2 = attract ? Math.sin(time * 0.12) * 0.4 : pointer.x;
      const py2 = attract ? Math.cos(time * 0.1) * 0.3 : pointer.y;
      // frame the plate AND the rack — on a wide screen, fitting the plate
      // alone pushed the pots off the bottom edge and left you unable to pick
      // up a colour at all
      const halfW = N * CELL / 2 + 4;
      const top = N * CELL / 2 + 4;
      const bottom = cellY(N - 1) - CELL * 2.6 - 3.2;      // under the pots
      const midY = (top + bottom) / 2;
      const halfH = (top - bottom) / 2;
      const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
      const fit = Math.max(halfH / Math.tan(vf), halfW / (Math.tan(vf) * camera.aspect)) * 1.04;
      camera.position.set(px2 * 6, midY + py2 * 4, fit - completion * 3 - audio.bass * 0.6);
      camera.lookAt(px2 * 1.6, midY + py2 * 1.3, 0);

      // ── the plate ──
      if (held !== lastHeld) { lastHeld = held; numDirty = true; }
      const numN = new Array(PAINTS.length).fill(0);
      const glowA = fillGlow.geometry.attributes;
      let glowN = 0;

      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const i = r * N + c;
          const n = cellNum[i];
          const x = cellX(c), y = cellY(r);
          const P = paint(n);

          if (cellDone[i]) {
            cellPop[i] += (1 - cellPop[i]) * Math.min(1, dt * 3.4);
            const reach = waveDiag ? (x + y) * 0.7 + 24 : Math.hypot(x, y);
            cellWave[i] = Math.max(0, 1 - Math.abs(reach - waveT) * 0.34);
            const v = voice[(n - 1) % voice.length] * reactivity;
            const lift = cellSubj[i] ? lifts.find(l => l.sj === cellSubj[i]) : null;
            if (lift) {
              // peel away from the page: rise, turn, and hang there breathing
              const e = lift.t * lift.t * (3 - 2 * lift.t);
              const [mx2, my2] = lift.mid;
              const ang = e * lift.spin + Math.sin(time * 0.4 + lift.lane) * 0.16 * e;
              const co = Math.cos(ang), si = Math.sin(ang);
              const rx2 = x - mx2, ry2 = y - my2;
              const hoverY = my2 + e * (6 + lift.lane * 3) + Math.sin(time * 0.8 + lift.lane * 2) * 1.4 * e;
              const hoverX = mx2 + e * Math.sin(time * 0.3 + lift.lane * 1.7) * 2.2;
              dummy.position.set(
                hoverX + (rx2 * co - ry2 * si) * (1 + e * 0.15),
                hoverY + (rx2 * si + ry2 * co) * (1 + e * 0.15),
                e * (16 + lift.lane * 4) + Math.sin(time * 1.1 + i * 0.2) * e * 0.8
              );
              dummy.scale.setScalar((0.98 + v * 0.06 + cellWave[i] * 0.1) * (1 + e * 0.12));
              dummy.rotation.set(0, 0, ang);
            } else {
              dummy.position.set(x, y, (cellPop[i] - 1) * 2.2 + cellWave[i] * 1.1);
              dummy.scale.setScalar(0.98 + (cellPop[i] - 1) * 0.35 + v * 0.05 + cellWave[i] * 0.1);
              dummy.rotation.set(0, 0, 0);
            }
            dummy.updateMatrix();
            plate.setMatrixAt(i, dummy.matrix);
            const liftGlow = lift ? 0.35 + lift.t * 0.45 + audio.beatIntensity * 0.25 : 0;
            const lum = P.l * (0.72 + v * 0.4 + cellWave[i] * 0.5 + audio.beatIntensity * 0.1 + liftGlow);
            color.setHSL(P.h, P.s, Math.min(0.85, lum * Math.min(1, cellPop[i])));
            if (finale > 0) color.multiplyScalar(1 + finale);
            if (floodFlash > 0) color.multiplyScalar(1 + floodFlash * 0.8);
            plate.setColorAt(i, color);

            // only the livelier cells carry a bloom, or the plate goes to soup
            if (cellWave[i] > 0.12 || v > 0.35) {
              glowA.position.setXYZ(glowN, x, y, -0.7);
              color.multiplyScalar(0.5 + cellWave[i] * 0.7);
              glowA.color.setXYZ(glowN, color.r, color.g, color.b);
              glowN++;
            }
          } else {
            dummy.position.set(x, y, 0);
            dummy.scale.setScalar(0.98);
            dummy.updateMatrix();
            plate.setMatrixAt(i, dummy.matrix);
            // bare plate is warm paper; the cells wanting the loaded paint
            // blush toward that colour so the next move is obvious
            const ready = held === n;
            const grain = ((i * 2654435761) % 1000) / 1000 * 0.022;   // laid paper
            // every beat lights up what the loaded colour still owes
            const called = hot.region >= 0 && cellRegion[i] === hot.region;
            // the called region burns brighter as its window closes
            const urgency = called ? Math.max(0, Math.min(1, 1 - (hot.until - time) / 9)) : 0;
            const paper = 0.80 - grain
              + (ready ? 0.07 + 0.03 * Math.sin(time * 4 + i * 0.2) + hint * 0.14 : 0)
              + (called ? 0.10 + 0.08 * Math.sin(time * (5 + urgency * 6)) : 0);
            color.setHSL(ready ? P.h : 0.10,
              called ? 0.55 : (ready ? 0.35 : 0.09), paper - denyFlash * 0.06);
            plate.setColorAt(i, color);

            if (numDirty) {
              const a = numN[n - 1];
              dummy.position.set(x, y, 0.5);
              dummy.scale.setScalar(1);
              dummy.rotation.set(0, 0, 0);
              dummy.updateMatrix();
              numPts[n - 1].setMatrixAt(a, dummy.matrix);
              // ink, darker still on the cells you can fill right now
              const ink = ready ? 0.06 : 0.20;
              color.setHSL(0.08, ready ? 0.5 : 0.12, ink);
              numPts[n - 1].setColorAt(a, color);
              numN[n - 1]++;
            }
          }
        }
      }
      if (numDirty) {
        for (let n = 0; n < PAINTS.length; n++) {
          const m = numPts[n];
          m.count = numN[n];            // draw only the cells still owing
          m.instanceMatrix.needsUpdate = true;
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
        }
        numDirty = false;
      }
      for (let k = glowN; k < MAXCELLS; k++) glowA.position.setXYZ(k, 0, -999, 0);
      glowA.position.needsUpdate = true;
      glowA.color.needsUpdate = true;
      plate.instanceMatrix.needsUpdate = true;
      plate.instanceColor.needsUpdate = true;

      // ── the rack ──
      {
        const rackY = cellY(N - 1) - CELL * 2.6;
        const span = (used.length - 1) * CELL * 1.7;
        for (const lab of rackNums) lab.visible = false;
        for (let k = 0; k < PAINTS.length; k++) {
          const s = rackPots[k];
          if (k >= used.length) { s.material.opacity = 0; continue; }
          const n = used[k], P = paint(n);
          const lab = rackNums[n - 1];       // the pot's OWN numeral, not its slot's
          const rx = k * CELL * 1.7 - span / 2;
          const on = held === n;
          const spent = remaining[n] === 0;  // this colour is finished
          s.position.set(rx, rackY + (on ? 0.4 : 0), 0);
          s.scale.setScalar(2.9 * (on ? 1.4 : 1) * (1 + (spent ? 0 : audio.beatIntensity * 0.1)));
          if (spent) color.setHSL(P.h, 0.05, 0.16);          // used up: greyed out
          else color.setHSL(P.h, P.s, on ? P.l + 0.16 : P.l * 0.8);
          s.material.color.copy(color);
          s.material.opacity = spent ? 0.22 : (on ? 1 : 0.6);
          lab.visible = true;
          lab.position.set(rx, rackY + (on ? 0.4 : 0), 0.8);
          lab.scale.setScalar(on ? 2.0 : 1.5);
          lab.material.color.setHex(spent ? 0x3a3f4a : (on ? 0x08090d : 0x1a1d26));
          lab.material.opacity = spent ? 0.5 : 1;
        }
      }

      // ── sparks ──
      {
        const sp = sparkPts.geometry.attributes.position;
        const sc = sparkPts.geometry.attributes.color;
        for (let i = 0; i < SPARK; i++) {
          if (sLife[i] <= 0) { sp.setXYZ(i, 0, -999, 0); continue; }
          sLife[i] -= dt;
          sVel[i * 3 + 1] -= 6 * dt;
          sp.setXYZ(i, sp.getX(i) + sVel[i * 3] * dt, sp.getY(i) + sVel[i * 3 + 1] * dt, sp.getZ(i) + sVel[i * 3 + 2] * dt);
          const l = Math.max(0, Math.min(1, sLife[i]));
          color.setHSL(sHue[i], 0.9, 0.55).multiplyScalar(l * 1.5);
          sc.setXYZ(i, color.r, color.g, color.b);
        }
        sp.needsUpdate = true; sc.needsUpdate = true;
      }

      // ── the room answers the music ──
      {
        const spec = audio.spectrum;
        for (let i = 0; i < SHAFTS; i++) {
          const bin = Math.floor((i / SHAFTS) * spec.length * 0.72);
          const v = spec[bin] || 0;
          const x = (i / (SHAFTS - 1) - 0.5) * 210 + Math.sin(time * 0.17 + i * 0.7) * 4;
          const h = 14 + v * 74 * reactivity + audio.volume * 12;
          dummy.position.set(x, -58, -92);
          dummy.scale.set(6.6, h, 1);
          dummy.rotation.set(0, 0, Math.sin(time * 0.11 + i) * 0.03);
          dummy.updateMatrix();
          shafts.setMatrixAt(i, dummy.matrix);
          const P = paint(used[i % used.length] || 1);
          color.setHSL(P.h, 0.7, (0.07 + v * 0.26) * (0.85 + lit * 0.35));
          shafts.setColorAt(i, color);
        }
        shafts.instanceMatrix.needsUpdate = true;
        shafts.instanceColor.needsUpdate = true;
        shafts.material.opacity = 0.4 + lit * 0.2;
      }

      keyLight.material.color.setHSL(paint(used[Math.floor(time * 0.2) % used.length] || 1).h, 0.6, 0.5);
      keyLight.material.opacity = 0.03 + lit * 0.13;
      keyLight.scale.setScalar(130 * (1 + lit * 0.3 + finale * 0.4));

      motes.material.color.setHSL((hue / 360 + 0.4) % 1, 0.5, 0.1 + lit * 0.22 + audio.high * 0.12);
      motes.material.size = 0.6 + lit * 0.4 + audio.high * 0.4 + audio.beatIntensity * 0.3;
      motes.rotation.y += dt * 0.01;

      sky.position.copy(camera.position);
      sky.material.color.setHSL((hue / 360 + 0.55) % 1, 0.35, 0.015 + lit * 0.06 + finale * 0.05);

      const fovT = 60 + audio.volume * 2 * reactivity;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();

      if (participants && participants[0]) {
        participants[0].x = pointer.x;
        participants[0].y = pointer.y;
      }
    },

    dispose() {
      if (window.__setFigure) window.__setFigure(null);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
