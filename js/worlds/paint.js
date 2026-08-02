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
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';

const N = 34;                 // plate is N x N cells
const CELL = 1.42;
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
    if (edge > 0.895) return ((Math.round((x + y) * 14) % 2) ? 11 : 18);
    if (edge > 0.87) return 17;

    if (kind === 0) {
      // ASTROLABE — a great dialled disc, sunburst, orbs and a star field
      const dx = x + 0.22, dy = y + 0.02;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);

      if (r < 0.62) {
        const spoke = Math.floor((a + Math.PI) / (Math.PI * 2) * 48);
        if (r > 0.55) return (spoke % 2) ? 10 : 18;          // tick ring
        if (r > 0.50) return 11;                              // numeral band
        if (r > 0.46) return 8;
        if (r > 0.30) {
          // the tympan: a web of meridians and almucantars
          const mer = Math.floor((a + Math.PI) / (Math.PI * 2) * 16) % 2;
          const alm = Math.floor(r * 26) % 2;
          return mer ^ alm ? 12 : 13;
        }
        if (r > 0.26) return 10;
        // the rete at the heart, with its pointer
        const petal = Math.cos(a * 4) * 0.09;
        if (r < 0.20 + petal) return (Math.floor(r * 22) % 2) ? 9 : 11;
        return 18;
      }
      // the alidade sweeping across the dial
      const arm = Math.abs(dy - dx * 0.42);
      if (arm < 0.022 && r < 0.86) return 16;

      // sunburst in the far corner
      const sx = x - 0.74, sy = y - 0.74;
      const sr = Math.hypot(sx, sy);
      if (sr < 0.34) {
        const ray = Math.floor((Math.atan2(sy, sx) + Math.PI) / (Math.PI * 2) * 30);
        if (sr > 0.17) return (ray % 2) ? 9 : 10;
        return (ray % 2) ? 10 : 11;
      }

      // ringed orbs
      const orbs = [[0.55, -0.55, 0.15], [0.30, 0.30, 0.10], [0.78, -0.05, 0.09]];
      for (const [ox, oy, orad] of orbs) {
        const ord = Math.hypot(x - ox, y - oy);
        if (ord < orad) return (Math.floor((y - oy) * 26) % 2) ? 7 : 8;
        if (Math.abs((y - oy) * 2.6) < 0.05 && ord < orad * 2.1) return 10; // its ring
      }

      // star field: four-pointed stars on a lattice
      const gx = x * 7, gy = y * 7;
      const cxg = Math.round(gx), cyg = Math.round(gy);
      const sd = Math.abs(gx - cxg) + Math.abs(gy - cyg);
      if (sd < 0.30 && ((cxg * 7 + cyg * 13) % 5 === 0)) return 11;
      if (sd < 0.5 && ((cxg * 5 + cyg * 11) % 9 === 0)) return 16;

      // the night itself, banded and swirled
      const swirl = Math.sin(x * 3.1 + Math.sin(y * 2.3) * 1.4) + Math.cos(y * 2.7);
      return swirl > 0.6 ? 2 : swirl > -0.2 ? 1 : 17;
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
        const band = Math.floor((r - 0.20) * 12) % 3;
        return [3, 4, 5][band] + (petal % 2 ? 0 : 0);
      }
      if (r < 0.58) return 18;
      if (r < 0.78) {
        const lobe = Math.floor((a + Math.PI) / (Math.PI * 2) * 24);
        if (Math.cos((a + Math.PI) * 24) < -0.3) return 18;
        return (lobe % 3 === 0) ? 14 : (lobe % 3 === 1) ? 13 : 15;
      }
      if (r < 0.83) return 10;
      const ray = Math.floor((a + Math.PI) / (Math.PI * 2) * 40);
      return (ray % 2) ? 1 : 2;
    }

    // kind 2 — MOTH & MOON: wings of banded scales over a lunar disc
    const mr = Math.hypot(x - 0.46, y - 0.5);
    if (mr < 0.26) {                                   // the moon behind
      const crater = Math.sin((x - 0.46) * 30) * Math.cos((y - 0.5) * 26);
      return crater > 0.4 ? 16 : 11;
    }
    const wx = Math.abs(x), wy = y + 0.05;
    // wing outline: two lobes either side of a body
    const upper = Math.hypot((wx - 0.34) / 0.34, (wy - 0.16) / 0.30);
    const lower = Math.hypot((wx - 0.28) / 0.28, (wy + 0.26) / 0.24);
    if (wx < 0.055 && Math.abs(wy) < 0.52) {           // body
      return (Math.floor(wy * 22) % 2) ? 18 : 8;
    }
    if (upper < 1 || lower < 1) {
      const t = upper < 1 ? upper : lower;
      const band = Math.floor(t * 7) % 4;
      const vein = Math.abs(Math.sin((Math.atan2(wy, wx - 0.1)) * 9)) < 0.12;
      if (vein) return 18;
      return [5, 6, 7, 9][band];
    }
    if (wx < 0.30 && wy > 0.5 && wy < 0.72) return 18;  // antennae
    const nb = Math.sin(x * 4 + y * 3) + Math.cos(y * 3.4);
    return nb > 0.7 ? 3 : nb > -0.3 ? 2 : 1;
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

const PLATES = [
  { name: 'ASTROLABE', kind: 0 },
  { name: 'ROSE WINDOW', kind: 1 },
  { name: 'MOTH & MOON', kind: 2 },
];

export function createPaint() {
  let scene, camera, group, sky, motes, plate, fillGlow, sparkPts, keyLight, shafts;
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
  const paint = n => PAINTS[n - 1] || PAINTS[0];

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

  function loadPlate(index) {
    const p = PLATES[index % PLATES.length];
    cellNum = engrave(p.kind);
    cellDone = new Uint8Array(N * N);
    cellPop = new Float32Array(N * N);
    cellWave = new Float32Array(N * N);
    findRegions();
    needCount = N * N;
    doneCount = 0;
    completion = 0;
    const seen = new Set();
    for (let i = 0; i < N * N; i++) seen.add(cellNum[i]);
    used = [...seen].sort((a, b) => a - b);
    held = used[0];
    numDirty = true;
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
        new THREE.PlaneGeometry(CELL * 0.94, CELL * 0.94),
        new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true }),
        MAXCELLS
      );
      plate.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      plate.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXCELLS * 3), 3);
      plate.frustumCulled = false;
      group.add(plate);

      fillGlow = mkPts(MAXCELLS, CELL * 1.9, 0.32);
      sparkPts = mkPts(SPARK, 1.4, 0.95);
      for (let i = 0; i < SPARK; i++) sLife[i] = 0;

      numPts.length = 0;
      for (let n = 1; n <= PAINTS.length; n++) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXCELLS * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXCELLS * 3), 3).setUsage(THREE.DynamicDrawUsage));
        const p = new THREE.Points(g, new THREE.PointsMaterial({
          size: CELL * 0.88, map: digitTexture(n), transparent: true, vertexColors: true,
          depthWrite: false, depthTest: false, toneMapped: false,
        }));
        p.frustumCulled = false;
        group.add(p);
        numPts.push(p);
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

    placeGhost(p, i, out) {
      const a = i * 1.6 + (this._t || 0) * 0.1;
      out.set(Math.cos(a) * 34, Math.sin(a * 0.7) * 20, 12 + Math.sin(a) * 6);
    },

    // tap a pot to load the brush; tap the plate to flood a whole region
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
            held = used[k];
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
      if (cellDone[i]) return;
      if (cellNum[i] !== held) { denyFlash = 1; return; }

      // flood the whole region this cell belongs to
      const id = cellRegion[i];
      const hue = paint(held).h;
      let filled = 0;
      for (let k = 0; k < N * N; k++) {
        if (cellRegion[k] === id && !cellDone[k]) {
          cellDone[k] = 1;
          // paint spreads outward from where you touched
          const kr = (k / N) | 0, kc = k % N;
          cellPop[k] = 1.7 + Math.hypot(kr - r, kc - c) * 0.06;
          filled++;
        }
      }
      if (!filled) return;
      numDirty = true;
      doneCount += filled;
      scoreQueue += 2 * filled;
      spark(cellX(c), cellY(r), hue, Math.min(26, 8 + filled), 0.7);
      if (window.__setFigure) window.__setFigure(PLATES[plateIndex % PLATES.length].name, doneCount, needCount);

      if (doneCount >= needCount) {
        finale = 1;
        scoreQueue += 400;
        for (let k = 0; k < 8; k++) {
          spark((Math.random() - 0.5) * N * CELL, (Math.random() - 0.5) * N * CELL,
            paint(used[k % used.length]).h, 30, 1.4);
        }
      }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, attract, time, hue } = opts;
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

      if (audio.beat) { waveT = 0; waveDiag = !waveDiag; }
      waveT += dt * (26 + audio.energy * 22);
      const voice = [audio.bass, audio.lowMid, audio.mid, audio.high, audio.treble, audio.volume];

      const px2 = attract ? Math.sin(time * 0.12) * 0.4 : pointer.x;
      const py2 = attract ? Math.cos(time * 0.1) * 0.3 : pointer.y;
      camera.position.set(px2 * 7, py2 * 5, 40 - completion * 3 - audio.bass * 0.6);
      camera.lookAt(px2 * 2, py2 * 1.6, 0);

      // ── the plate ──
      if (held !== lastHeld) { lastHeld = held; numDirty = true; }
      const numA = numPts.map(p => p.geometry.attributes);
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
            dummy.position.set(x, y, (cellPop[i] - 1) * 2.2 + cellWave[i] * 1.1);
            dummy.scale.setScalar(0.98 + (cellPop[i] - 1) * 0.35 + v * 0.05 + cellWave[i] * 0.1);
            dummy.updateMatrix();
            plate.setMatrixAt(i, dummy.matrix);
            const lum = P.l * (0.72 + v * 0.4 + cellWave[i] * 0.5 + audio.beatIntensity * 0.1);
            color.setHSL(P.h, P.s, Math.min(0.8, lum * Math.min(1, cellPop[i])));
            if (finale > 0) color.multiplyScalar(1 + finale);
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
            const paper = 0.80 + (ready ? 0.06 + 0.03 * Math.sin(time * 4 + i * 0.2) : 0);
            color.setHSL(ready ? P.h : 0.10, ready ? 0.35 : 0.10, paper - denyFlash * 0.06);
            plate.setColorAt(i, color);

            if (numDirty) {
              const a = numN[n - 1];
              numA[n - 1].position.setXYZ(a, x, y, 0.5);
              // ink, darker still on the cells you can fill right now
              const ink = ready ? 0.08 : 0.17;
              color.setHSL(ready ? P.h : 0.08, ready ? 0.85 : 0.15, ink);
              numA[n - 1].color.setXYZ(a, color.r, color.g, color.b);
              numN[n - 1]++;
            }
          }
        }
      }
      // point size in three.js ignores the field of view, so a numeral would
      // stay the same pixel size while the cell under it grew — keep them
      // locked to the cell by compensating for the current framing
      {
        const k = Math.tan(THREE.MathUtils.degToRad(60) / 2)
                / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        const want = CELL * 0.88 * k;
        for (const p of numPts) if (Math.abs(p.material.size - want) > 0.01) p.material.size = want;
      }
      if (numDirty) {
        for (let n = 0; n < PAINTS.length; n++) {
          for (let k = numN[n]; k < MAXCELLS; k++) numA[n].position.setXYZ(k, 0, -999, 0);
          numA[n].position.needsUpdate = true;
          numA[n].color.needsUpdate = true;
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
        for (let k = 0; k < PAINTS.length; k++) {
          const s = rackPots[k], lab = rackNums[k];
          if (k >= used.length) { s.material.opacity = 0; lab.visible = false; continue; }
          const n = used[k], P = paint(n);
          const rx = k * CELL * 1.7 - span / 2;
          const on = held === n;
          s.position.set(rx, rackY + (on ? 0.4 : 0), 0);
          s.scale.setScalar(2.9 * (on ? 1.4 : 1) * (1 + audio.beatIntensity * 0.1));
          color.setHSL(P.h, P.s, on ? P.l + 0.16 : P.l * 0.8);
          s.material.color.copy(color);
          s.material.opacity = on ? 1 : 0.6;
          lab.visible = true;
          lab.position.set(rx, rackY + (on ? 0.4 : 0), 0.8);
          lab.scale.setScalar(on ? 2.0 : 1.5);
          lab.material.color.setHex(on ? 0x08090d : 0x1a1d26);
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
