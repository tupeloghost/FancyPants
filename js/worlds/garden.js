// LUMEN — a dark room, a hidden lattice, and a picture that has to be earned.
//
// Runes rise out of the black. Catch three and they fuse into a deeper rune;
// three of those fuse again. The lattice in front of you is a botanical
// figure drawn in three depths — outline, body, heart — and each cell will
// only accept a rune of its own depth. Set them and the figure comes up out
// of the dark, one gem at a time, until the whole room is lit by what you built.
//
// Multiplayer: everyone's placements land in the same lattice, and a crowded
// room draws a larger figure.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=117';
import { themePaint } from '../lib/themes.js?v=117';

// Figures are drawn in three depths: 1 outline, 2 body, 3 heart.
const FIGURES = [
  {
    name: 'LOTUS',
    hues: [0.92, 0.78, 0.13],   // rose · violet · gold
    rows: [
      '......333......',
      '.....32223.....',
      '....3211123....',
      '...321111123...',
      '..32111111123..',
      '.3211111111123.',
      '..32111111123..',
      '...321111123...',
      '....3211123....',
      '.....32223.....',
      '......333......',
    ],
  },
  {
    name: 'FERN',
    hues: [0.45, 0.35, 0.16],   // teal · green · amber
    rows: [
      '.......3.......',
      '......232......',
      '.....2.3.2.....',
      '....2..3..2....',
      '...2...3...2...',
      '..2....3....2..',
      '.......3.......',
      '..2....3....2..',
      '...2...3...2...',
      '....2..3..2....',
      '.....2.3.2.....',
      '......232......',
      '.......1.......',
      '.......1.......',
    ],
  },
  {
    name: 'ORCHID',
    hues: [0.75, 0.88, 0.09],   // indigo · magenta · peach
    rows: [
      '......333......',
      '.....32123.....',
      '....3211123....',
      '....3211123....',
      '.....32123.....',
      '...3..222..3...',
      '..32..222..23..',
      '...3...2...3...',
      '.......2.......',
      '.......2.......',
      '......111......',
      '.....11111.....',
    ],
  },
  {
    name: 'MOTH',
    hues: [0.08, 0.72, 0.14],   // rust · plum · candlelight
    rows: [
      '..3.........3..',
      '.333.......333.',
      '33323.....32333',
      '.3322.222.2233.',
      '..322.212.223..',
      '...32.212.23...',
      '....3.111.3....',
      '......111......',
      '.......1.......',
    ],
  },
  {
    name: 'JELLYFISH',
    hues: [0.52, 0.62, 0.86],   // aqua · cobalt · orchid
    rows: [
      '.....33333.....',
      '...333333333...',
      '..33322222333..',
      '..33222222233..',
      '..32222222223..',
      '...3.2.2.2.3...',
      '....1.1.1.1....',
      '...1.1...1.1...',
      '..1..1...1..1..',
      '..1..1...1..1..',
      '.1...1...1...1.',
    ],
  },
  {
    name: 'CRESCENT',
    hues: [0.62, 0.13, 0.16],   // midnight · brass · moonlight
    rows: [
      '.....33333.....',
      '...332222233...',
      '..33211111333..',
      '.3321111....33.',
      '.332111......3.',
      '.332111........',
      '.332111......3.',
      '.3321111....33.',
      '..33211111333..',
      '...332222233...',
      '.....33333.....',
    ],
  },
  {
    name: 'TOADSTOOL',
    hues: [0.02, 0.11, 0.95],   // scarlet · cream · blush
    rows: [
      '....3333333....',
      '..33333333333..',
      '.3332333233333.',
      '.3333333333333.',
      '..33333333333..',
      '....2222222....',
      '.....22222.....',
      '.....21112.....',
      '.....21112.....',
      '.....22222.....',
      '....2222222....',
    ],
  },
  {
    name: 'FROST',
    hues: [0.55, 0.48, 0.6],    // ice · glacier · pale blue
    rows: [
      '.......3.......',
      '...3...2...3...',
      '....3..2..3....',
      '.....3.2.3.....',
      '......232......',
      '.3222221222223.',
      '......232......',
      '.....3.2.3.....',
      '....3..2..3....',
      '...3...2...3...',
      '.......3.......',
    ],
  },
  {
    name: 'LANTERN',
    hues: [0.09, 0.13, 0.16],   // copper · amber · flame
    rows: [
      '.......1.......',
      '.......1.......',
      '.....32223.....',
      '...332222233...',
      '..33222122233..',
      '..33221112233..',
      '..33222122233..',
      '...332222233...',
      '.....32223.....',
      '......333......',
      '.......3.......',
    ],
  },
  {
    name: 'KOI',
    hues: [0.06, 0.02, 0.12],   // persimmon · vermilion · gold
    rows: [
      '.......33......',
      '......3333.....',
      '...3333222233..',
      '.33322111122333',
      '.33222111112233',
      '.33322111122333',
      '...3333222233..',
      '......3333.....',
      '.......33......',
    ],
  },
];

const CELL = 2.5;
const MAXCELLS = 256;   // any figure fits; unused slots park offscreen
const RUNES = 26;        // floating harvestables alive at once
const TRAY_MAX = 6;
const SPARK = 260;       // celebration sparks

// fine serif numerals — the cell tells you its depth in plain figures
function digitTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '300 84px "Didot", "Bodoni 72", "Playfair Display", Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,255,255,0.75)';
  g.shadowBlur = 12;
  g.fillStyle = '#ffffff';
  g.fillText(String(n), 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export function createGarden() {
  let scene, camera, group, sky, motes;
  let cellMesh, runePts, runeGlow, trayPts, sparkPts, keyLight, fillGlow;
  let shafts, halo;                    // the reactive room behind the work
  const ripples = [];
  const SHAFTS = 34;
  const numPts = [];   // one Points layer per depth, each drawn with its numeral
  const tp = [0, 0, 0];
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  const pointer = { x: 0, y: 0, active: false };
  const _v = new THREE.Vector3();

  // ── lattice ──
  let fig = null, cols = 0, rows = 0;
  let cellTier = null, cellFilled = null, cellLight = null, cellWave = null, cellCount = 0;
  let filledCount = 0, needCount = 0;
  let figIndex = 0;
  let completion = 0;      // 0..1 eased, drives how lit the room is
  let finale = 0;          // burst after the last cell lands
  let waveT = 999;         // beat wave travelling out through the set gems
  let waveDiag = false;    // alternates radial / diagonal so it never tires

  // ── runes ──
  const rx = new Float32Array(RUNES), ry = new Float32Array(RUNES), rz = new Float32Array(RUNES);
  const rTier = new Uint8Array(RUNES), rAlive = new Uint8Array(RUNES), rSpin = new Float32Array(RUNES);
  let spawnT = 0;

  // ── tray ──
  const tray = [];         // tiers you're holding
  let fuseFlash = 0, denyFlash = 0, placeFlash = 0;
  let scoreQueue = 0;

  // ── sparks ──
  const sVel = new Float32Array(SPARK * 3);
  const sLife = new Float32Array(SPARK);
  const sHue = new Float32Array(SPARK);
  let sNext = 0;

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

  function spark(x, y, z, hue01, count, power = 1) {
    const pos = sparkPts.geometry.attributes.position;
    for (let k = 0; k < count; k++) {
      const i = sNext++ % SPARK;
      pos.setXYZ(i, x, y, z);
      const a = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 9) * power;
      sVel[i * 3] = Math.cos(a) * sp;
      sVel[i * 3 + 1] = Math.sin(a) * sp + 3 * power;
      sVel[i * 3 + 2] = (Math.random() - 0.5) * 5;
      sLife[i] = 0.7 + Math.random() * 0.8;
      sHue[i] = (hue01 + (Math.random() - 0.5) * 0.06 + 1) % 1;
    }
  }

  function loadFigure(index, crowd) {
    fig = FIGURES[index % FIGURES.length];
    const src = fig.rows;
    rows = src.length; cols = src[0].length;
    cellCount = rows * cols;
    cellTier = new Uint8Array(cellCount);
    cellFilled = new Uint8Array(cellCount);
    cellLight = new Float32Array(cellCount);
    cellWave = new Float32Array(cellCount);
    needCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = src[r][c];
        const t = ch === '.' ? 0 : +ch;
        cellTier[r * cols + c] = t;
        if (t) needCount++;
      }
    }
    filledCount = 0;
    completion = 0;
    if (window.__setFigure) window.__setFigure(fig.name, 0, needCount);
    // a crowded room gets a bigger canvas: the figure is drawn larger
    scaleUp = crowd >= 3 ? 1.25 : 1;
  }

  let scaleUp = 1;
  const cellX = c => (c - (cols - 1) / 2) * CELL * scaleUp;
  const cellY = r => ((rows - 1) / 2 - r) * CELL * scaleUp;

  function tierHue(t) { return fig.hues[Math.max(0, t - 1)]; }

  // fuse three alike into one deeper rune — the heart of the thing
  function tryFuse() {
    for (let t = 1; t <= 2; t++) {
      let n = 0;
      for (const q of tray) if (q === t) n++;
      if (n >= 3) {
        let removed = 0;
        for (let i = tray.length - 1; i >= 0 && removed < 3; i--) {
          if (tray[i] === t) { tray.splice(i, 1); removed++; }
        }
        tray.push(t + 1);
        fuseFlash = 1;
        scoreQueue += 10 * t;
        spark(0, -13, 16, tierHue(t + 1), 26, 0.8);
        return true;
      }
    }
    return false;
  }

  return {
    name: 'LUMEN',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;

      loadFigure(0, 1);

      // lattice cells — one instanced quad per cell, dark until earned
      cellMesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(CELL * 0.8, CELL * 0.8),
        new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 1 }),
        MAXCELLS
      );
      cellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      cellMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXCELLS * 3), 3);
      cellMesh.frustumCulled = false;
      group.add(cellMesh);

      // set gems get a soft bloom behind them so they read as jewels
      fillGlow = mkPts(MAXCELLS, CELL * 2.1, 0.5);

      // numerals: a Points layer per depth, each with its own figure drawn fine
      numPts.length = 0;
      for (let n = 1; n <= 3; n++) {
        // instanced planes, not points: real geometry keeps its size against
        // the cell no matter how the framing moves
        const m = new THREE.InstancedMesh(
          new THREE.PlaneGeometry(CELL * 0.8, CELL * 0.8),
          new THREE.MeshBasicMaterial({
            map: digitTexture(n), transparent: true, blending: THREE.AdditiveBlending,
            depthWrite: false, toneMapped: false,
          }),
          MAXCELLS
        );
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXCELLS * 3), 3);
        m.frustumCulled = false;
        m.renderOrder = 2;
        group.add(m);
        numPts.push(m);
      }

      runePts = mkPts(RUNES, 3.4, 1);
      runeGlow = mkPts(RUNES, 9, 0.4);
      trayPts = mkPts(TRAY_MAX, 4.2, 1);
      sparkPts = mkPts(SPARK, 1.5, 0.95);
      for (let i = 0; i < SPARK; i++) sLife[i] = 0;

      // ── the room behind the work: light shafts that answer the spectrum ──
      {
        const g = new THREE.PlaneGeometry(2.6, 1, 6, 8);
        g.translate(0, 0.5, 0);           // grow upward from the floor
        const pa = g.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const up = pa.getY(i);                     // 0 at base, 1 at tip
          const side = Math.abs(pa.getX(i)) / 1.3;   // 0 at spine, 1 at edge
          // soft on every axis: no rectangle edges anywhere
          const f = Math.pow(1 - up, 1.7) * Math.pow(1 - side, 1.6);
          vc[i * 3] = f; vc[i * 3 + 1] = f; vc[i * 3 + 2] = f;
        }
        g.setAttribute('color', new THREE.BufferAttribute(vc, 3));
        shafts = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({
          vertexColors: true, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }), SHAFTS);
        shafts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        shafts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SHAFTS * 3), 3);
        shafts.frustumCulled = false;
        group.add(shafts);
      }

      // a low halo behind the lattice, breathing on the bass
      halo = glowSprite(120);
      halo.position.set(0, 0, -46);
      halo.material.opacity = 0;
      group.add(halo);

      // rings that leave on the beat and travel out past the lattice
      for (let i = 0; i < 4; i++) {
        const r = new THREE.Mesh(
          new THREE.RingGeometry(1, 1.06, 96),
          new THREE.MeshBasicMaterial({
            transparent: true, opacity: 0, toneMapped: false,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
          })
        );
        r.position.z = -22;
        r.userData.r = 0;
        group.add(r);
        ripples.push(r);
      }

      // ambient dust so the dark isn't empty
      const mp = new Float32Array(300 * 3);
      for (let i = 0; i < 300; i++) {
        mp[i * 3] = (Math.random() - 0.5) * 120;
        mp[i * 3 + 1] = (Math.random() - 0.5) * 80;
        mp[i * 3 + 2] = -40 + Math.random() * 80;
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      motes = new THREE.Points(mg, glowPoints(0.55, 0.35));
      motes.frustumCulled = false;
      group.add(motes);

      keyLight = glowSprite(90);
      keyLight.position.set(0, 0, -18);
      keyLight.material.opacity = 0;
      group.add(keyLight);

      sky = skyDome(300);
      group.add(sky);

      tray.length = 0;
      for (let i = 0; i < RUNES; i++) rAlive[i] = 0;
      spawnT = 0; figIndex = 0; finale = 0;
      fuseFlash = 0; denyFlash = 0; placeFlash = 0;

      camera.position.set(0, 0, 34);
      camera.lookAt(0, 0, 0);
      camera.fov = 62;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    placeGhost(p, i, out) {
      // hug the lattice edge — a fixed radius fell outside the frame once the
      // board started fitting itself to the screen, so nobody could see anyone
      const a = i * 1.7 + (this._t || 0) * 0.15;
      const rx = cols * CELL * scaleUp / 2 + 1.4;
      const ry = rows * CELL * scaleUp / 2 + 1.4;
      out.set(Math.cos(a) * rx, Math.sin(a) * ry, 7 + Math.sin(a * 1.3) * 5);
    },

    // one gesture, two meanings: catch a rune, or set one into the lattice
    onTap(x, y) {
      // 1) is a floating rune under the tap?
      let best = -1, bestD = 1e9;
      for (let i = 0; i < RUNES; i++) {
        if (!rAlive[i]) continue;
        _v.set(rx[i], ry[i], rz[i]).project(camera);
        const d = Math.hypot(_v.x - x, _v.y - y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && bestD < 0.09) {
        if (tray.length < TRAY_MAX) {
          tray.push(rTier[best]);
          spark(rx[best], ry[best], rz[best], tierHue(rTier[best]), 12, 0.7);
          scoreQueue += 2;
          rAlive[best] = 0;
          tryFuse();
        } else {
          denyFlash = 1;
        }
        return;
      }

      // 2) otherwise: which lattice cell did the ray cross?
      _v.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      const t = -camera.position.z / _v.z;
      const wx = camera.position.x + _v.x * t;
      const wy = camera.position.y + _v.y * t;
      const c = Math.round(wx / (CELL * scaleUp) + (cols - 1) / 2);
      const r = Math.round((rows - 1) / 2 - wy / (CELL * scaleUp));
      if (c < 0 || c >= cols || r < 0 || r >= rows) return;
      const idx = r * cols + c;
      const need = cellTier[idx];
      if (!need || cellFilled[idx]) return;

      const have = tray.indexOf(need);
      if (have === -1) { denyFlash = 1; return; }

      tray.splice(have, 1);
      cellFilled[idx] = 1;
      cellLight[idx] = 1.6;         // lands bright, settles into its color
      filledCount++;
      placeFlash = 1;
      if (window.__setFigure) window.__setFigure(fig.name, filledCount, needCount);
      scoreQueue += need === 1 ? 5 : need === 2 ? 20 : 60;
      spark(cellX(c), cellY(r), 1, tierHue(need), 14 + need * 8, 0.6 + need * 0.2);

      if (filledCount >= needCount) {
        finale = 1;
        scoreQueue += 300;
        for (let k = 0; k < 5; k++) {
          spark((Math.random() - 0.5) * cols * CELL, (Math.random() - 0.5) * rows * CELL, 2, tierHue(3), 40, 1.6);
        }
      }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      this._t = time;

      if (scoreQueue && opts.addScore) { opts.addScore(scoreQueue); scoreQueue = 0; }

      fuseFlash = Math.max(0, fuseFlash - dt * 1.6);
      denyFlash = Math.max(0, denyFlash - dt * 2.4);
      placeFlash = Math.max(0, placeFlash - dt * 1.8);

      // the figure completes, holds, then the room resets with a new one
      if (finale > 0) {
        finale -= dt * 0.22;
        if (finale <= 0) {
          finale = 0;
          figIndex++;
          loadFigure(figIndex, participants ? participants.length : 1);
        }
      }

      // set gems come alive: each depth answers its own part of the music,
      // and every beat sends a wave out through the whole picture
      if (audio.beat) { waveT = 0; waveDiag = !waveDiag; }
      waveT += dt * (26 + audio.energy * 22);
      const voice = [
        audio.bass * reactivity,
        audio.mid * reactivity,
        audio.treble * reactivity,
      ];

      const want = needCount ? filledCount / needCount : 0;
      completion += (want - completion) * Math.min(1, dt * 1.6);
      const lit = completion * (1 + finale * 1.4);

      // camera: a slow, considered drift — you're standing in a dark room
      const px2 = attract ? Math.sin(time * 0.13) * 0.5 : pointer.x;
      const py2 = attract ? Math.cos(time * 0.11) * 0.4 : pointer.y;
      // stand back far enough that the whole lattice fits the screen — on a
      // phone in portrait the board was wider than the view, so most of it
      // (and most of the runes) sat off the edges where you couldn't reach
      const halfW = cols * CELL * scaleUp / 2 + 3;
      const halfH = rows * CELL * scaleUp / 2 + 3;
      const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
      const fit = Math.max(halfH / Math.tan(vf), halfW / (Math.tan(vf) * camera.aspect)) * 1.06;
      camera.position.set(
        px2 * 6 + Math.sin(time * 0.09) * 1.3,
        py2 * 4 + Math.cos(time * 0.07) * 1.1,
        fit - completion * 3 - audio.bass * 0.7
      );
      camera.lookAt(px2 * 1.5, py2 * 1.2, 0);
      camera.rotation.z += Math.sin(time * 0.05) * 0.008;

      // ── lattice ──
      const numN = [0, 0, 0];
      const glowA = fillGlow.geometry.attributes;
      let glowN = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const t = cellTier[i];
          const x = cellX(c), y = cellY(r);
          const beat = audio.beatIntensity * reactivity;

          if (!t) {
            dummy.position.set(0, 0, -999); dummy.scale.setScalar(0.001);
          } else if (cellFilled[i]) {
            cellLight[i] += (1 - cellLight[i]) * Math.min(1, dt * 2.2);
            const wob = Math.sin(time * 1.6 + i * 0.7) * 0.04;
            const pop = cellLight[i];
            // the wave front: radial one beat, diagonal the next
            const reach = waveDiag ? (x + y) * 0.7 + 26 : Math.hypot(x, y);
            cellWave[i] = Math.max(0, 1 - Math.abs(reach - waveT) * 0.4);
            const v = voice[t - 1];
            dummy.position.set(x, y, (pop - 1) * 3 + cellWave[i] * 1.4);
            dummy.scale.setScalar(0.9 + wob + (pop - 1) * 0.5 + beat * 0.06
              + v * 0.09 + cellWave[i] * 0.14);
            dummy.rotation.z = wob * 0.3 + cellWave[i] * 0.08;
          } else {
            // unearned: a bare dark plate, barely there
            dummy.position.set(x, y, 0);
            dummy.scale.setScalar(0.9);
            dummy.rotation.z = 0;
          }
          dummy.updateMatrix();
          cellMesh.setMatrixAt(i, dummy.matrix);

          if (!t) {
            color.setRGB(0, 0, 0);
          } else if (cellFilled[i]) {
            // the figure keeps its own palette — a picture should look like
            // itself. The theme only breathes a little life across it.
            themePaint(colorMode, tierHue(t), c / cols, r / rows, time, audio.energy, (i * 7.3) % 1, tp);
            const h = tierHue(t) + (tp[0] - tierHue(t)) * 0.18;
            // three voices: outline rides the bass, body the mids, heart the
            // treble — so a finished picture sings in parts
            const lum = (0.17 + t * 0.12) * Math.min(1.4, tp[2])
              + audio.beatIntensity * 0.05 * t
              + voice[t - 1] * 0.2
              + cellWave[i] * 0.3;
            color.setHSL((h + 1) % 1, 0.78, Math.min(0.72, lum * cellLight[i]));
            if (finale > 0) color.multiplyScalar(1 + finale * 1.2);
          } else {
            // waiting cells: a faint plate of the figure's own color, and it
            // warms whenever you're carrying the rune it wants
            const ready = tray.includes(t);
            const idle = (ready ? 0.115 : 0.05)
              + 0.02 * Math.sin(time * 1.3 + i * 0.35)
              + denyFlash * 0.06;
            color.setHSL(tierHue(t), ready ? 0.55 : 0.3, idle);
          }
          cellMesh.setColorAt(i, color);

          if (t && cellFilled[i]) {
            // a set gem blooms softly into the room
            glowA.position.setXYZ(glowN, x, y, -0.6);
            color.multiplyScalar(0.75 + cellWave[i] * 0.9 + voice[t - 1] * 0.5);
            glowA.color.setXYZ(glowN, color.r, color.g, color.b);
            glowN++;
          } else if (t) {
            // the cell states its depth in a fine numeral, and brightens the
            // moment you're carrying the rune it will accept
            const ready = tray.includes(t);
            const g = ready ? 0.72 + 0.16 * Math.sin(time * 3.4 + i) : 0.4;
            const a = numN[t - 1];
            dummy.position.set(x, y, 0.5);
            dummy.scale.setScalar(1);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            numPts[t - 1].setMatrixAt(a, dummy.matrix);
            color.setHSL(tierHue(t), ready ? 0.45 : 0.22, g);
            numPts[t - 1].setColorAt(a, color);
            numN[t - 1]++;
          }
        }
      }
      for (let n = 0; n < 3; n++) {
        const m = numPts[n];
        m.count = numN[n];
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      for (let k = glowN; k < MAXCELLS; k++) glowA.position.setXYZ(k, 0, -999, 0);
      glowA.position.needsUpdate = true;
      glowA.color.needsUpdate = true;
      cellMesh.instanceMatrix.needsUpdate = true;
      cellMesh.instanceColor.needsUpdate = true;

      // ── runes rise out of the dark; the music decides how generously ──
      spawnT -= dt;
      if ((audio.beat && Math.random() < 0.5) || spawnT <= 0) {
        for (let i = 0; i < RUNES; i++) {
          if (rAlive[i]) continue;
          rAlive[i] = 1;
          rTier[i] = Math.random() < 0.82 ? 1 : 2;   // deeper runes are rare gifts
          rx[i] = (Math.random() - 0.5) * Math.min(54, cols * CELL * scaleUp * 1.5);
          ry[i] = -30;
          rz[i] = 10 + Math.random() * 12;
          rSpin[i] = Math.random() * 6;
          break;
        }
        spawnT = 0.85 - Math.min(0.5, audio.energy * 0.6);
      }
      const rp = runePts.geometry.attributes, rg = runeGlow.geometry.attributes;
      for (let i = 0; i < RUNES; i++) {
        if (!rAlive[i]) { rp.position.setXYZ(i, 0, -999, 0); rg.position.setXYZ(i, 0, -999, 0); continue; }
        ry[i] += dt * (5 + audio.volume * 4);
        rx[i] += Math.sin(time * 0.9 + rSpin[i]) * dt * 1.6;
        if (ry[i] > 32) { rAlive[i] = 0; continue; }
        rp.position.setXYZ(i, rx[i], ry[i], rz[i]);
        rg.position.setXYZ(i, rx[i], ry[i], rz[i]);
        const shimmer = 0.5 + 0.5 * Math.sin(time * 3 + rSpin[i] * 2);
        color.setHSL(tierHue(rTier[i]), 0.9, 0.42 + shimmer * 0.16 + rTier[i] * 0.05)
          .multiplyScalar(1.1 + audio.beatIntensity * 0.4);
        rp.color.setXYZ(i, color.r, color.g, color.b);
        color.multiplyScalar(0.42);
        rg.color.setXYZ(i, color.r, color.g, color.b);
      }
      rp.position.needsUpdate = true; rp.color.needsUpdate = true;
      rg.position.needsUpdate = true; rg.color.needsUpdate = true;

      // ── tray: what you're carrying, laid out along the bottom of the room ──
      {
        const ta = trayPts.geometry.attributes;
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        for (let k = 0; k < TRAY_MAX; k++) {
          if (k < tray.length) {
            const off = (k - (tray.length - 1) / 2) * 3.4;
            _v.copy(camera.position)
              .addScaledVector(camDir, 16)
              .add(new THREE.Vector3(off, -9 + Math.sin(time * 2.4 + k) * 0.22, 0));
            ta.position.setXYZ(k, _v.x, _v.y, _v.z);
            const t = tray[k];
            color.setHSL(tierHue(t), 0.95, 0.4 + t * 0.08 + fuseFlash * 0.25)
              .multiplyScalar(1.2 + audio.beatIntensity * 0.3 + fuseFlash);
            ta.color.setXYZ(k, color.r, color.g, color.b);
          } else {
            ta.position.setXYZ(k, 0, -999, 0);
          }
        }
        ta.position.needsUpdate = true; ta.color.needsUpdate = true;
        trayPts.material.size = 4.2 * (1 + fuseFlash * 0.5);
      }

      // ── sparks ──
      {
        const sp = sparkPts.geometry.attributes.position;
        const sc = sparkPts.geometry.attributes.color;
        for (let i = 0; i < SPARK; i++) {
          if (sLife[i] <= 0) { sp.setXYZ(i, 0, -999, 0); continue; }
          sLife[i] -= dt;
          sVel[i * 3 + 1] -= 7 * dt;
          sp.setXYZ(i, sp.getX(i) + sVel[i * 3] * dt, sp.getY(i) + sVel[i * 3 + 1] * dt, sp.getZ(i) + sVel[i * 3 + 2] * dt);
          const l = Math.max(0, Math.min(1, sLife[i]));
          color.setHSL(sHue[i], 0.9, 0.5).multiplyScalar(l * 1.5);
          sc.setXYZ(i, color.r, color.g, color.b);
        }
        sp.needsUpdate = true; sc.needsUpdate = true;
      }

      // ── the reactive room: this is what makes it worth watching ──
      {
        const spec = audio.spectrum;
        for (let i = 0; i < SHAFTS; i++) {
          const bin = Math.floor((i / SHAFTS) * spec.length * 0.72);
          const v = spec[bin] || 0;
          // wide and overlapping, so the band reads as one aurora curtain
          // rather than a row of bars — and it drifts as it breathes
          const x = (i / (SHAFTS - 1) - 0.5) * 196 + Math.sin(time * 0.19 + i * 0.7) * 4;
          const h = 14 + v * 66 * reactivity + audio.volume * 12;
          dummy.position.set(x, -52, -86);
          dummy.scale.set(6.2, h, 1);
          dummy.rotation.set(0, 0, Math.sin(time * 0.12 + i) * 0.03);
          dummy.updateMatrix();
          shafts.setMatrixAt(i, dummy.matrix);
          // the curtain wears the figure's own colors, so every level has a
          // different night behind it
          const h01 = tierHue(1 + (i % 3));
          color.setHSL(h01, 0.72, (0.07 + v * 0.26) * (0.85 + lit * 0.35));
          shafts.setColorAt(i, color);
        }
        shafts.instanceMatrix.needsUpdate = true;
        shafts.instanceColor.needsUpdate = true;
        shafts.material.opacity = 0.42 + lit * 0.18;
      }

      halo.material.color.setHSL(tierHue(2), 0.6, 0.5);
      halo.material.opacity = 0.02 + audio.bass * 0.05 * reactivity + lit * 0.03;
      halo.scale.setScalar(120 * (1 + audio.bass * 0.22 + lit * 0.15));

      if (audio.beat) {
        const r = ripples.find(q => q.material.opacity <= 0.02);
        if (r) {
          r.userData.r = 6;
          r.material.opacity = 0.16 + audio.beatIntensity * 0.2;
          r.material.color.setHSL(tierHue(3), 0.8, 0.6);
        }
      }
      for (const r of ripples) {
        if (r.material.opacity <= 0.02) continue;
        r.userData.r += dt * (26 + audio.energy * 30);
        r.scale.setScalar(r.userData.r);
        r.material.opacity *= Math.pow(0.28, dt);
      }

      // ── the room answers what you've built ──
      keyLight.material.color.setHSL(tierHue(2), 0.7, 0.5);
      keyLight.material.opacity = 0.03 + lit * 0.16 + placeFlash * 0.05;
      keyLight.scale.setScalar(90 * (1 + lit * 0.4 + finale * 0.5));

      motes.material.color.setHSL(tierHue(1), 0.6, 0.12 + lit * 0.3 + audio.high * 0.15);
      motes.material.size = 0.55 + lit * 0.5 + audio.high * 0.4 + audio.beatIntensity * 0.5;
      motes.rotation.y += dt * 0.012;
      motes.rotation.z += dt * 0.004;

      sky.position.copy(camera.position);
      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.energy, 0.5, tp);
      sky.material.color.setHSL(tp[0], tp[1] * 0.55, 0.012 + lit * 0.09 + finale * 0.06);

      const fovT = 62 - lit * 2 + audio.volume * 2 * reactivity;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();

      if (participants && participants[0]) {
        participants[0].x = pointer.x;
        participants[0].y = pointer.y;
      }
    },

    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
