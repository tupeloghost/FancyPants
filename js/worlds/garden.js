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
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

// Figures are drawn in three depths: 1 outline, 2 body, 3 heart.
const FIGURES = [
  {
    name: 'BLOOM',
    hues: [0.72, 0.86, 0.06],
    rows: [
      '....333....',
      '...32223...',
      '..3211123..',
      '..3211123..',
      '...32223...',
      '....333....',
      '.....2.....',
      '....2.2....',
      '...22.22...',
      '....2.2....',
      '.....2.....',
      '.....1.....',
      '...11111...',
    ],
  },
  {
    name: 'AGAVE',
    hues: [0.42, 0.34, 0.14],
    rows: [
      '....3.3....',
      '.....2.....',
      '.....2.....',
      '...2.2.2...',
      '...2.2.2...',
      '...22222...',
      '.....2.....',
      '.....2.....',
      '.....2.....',
      '...11111...',
      '...11111...',
    ],
  },
  {
    name: 'LANTERN',
    hues: [0.55, 0.5, 0.13],
    rows: [
      '...33333...',
      '..3333333..',
      '.333333333.',
      '.333333333.',
      '..3333333..',
      '...22222...',
      '....222....',
      '....222....',
      '...22222...',
      '...11111...',
      '....111....',
    ],
  },
];

const CELL = 2.5;
const RUNES = 26;        // floating harvestables alive at once
const TRAY_MAX = 6;
const SPARK = 260;       // celebration sparks

export function createGarden() {
  let scene, camera, group, sky, motes;
  let cellMesh, pipPts, runePts, runeGlow, trayPts, sparkPts, keyLight;
  const tp = [0, 0, 0];
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  const pointer = { x: 0, y: 0, active: false };
  const _v = new THREE.Vector3();

  // ── lattice ──
  let fig = null, cols = 0, rows = 0;
  let cellTier = null, cellFilled = null, cellLight = null, cellCount = 0;
  let filledCount = 0, needCount = 0;
  let figIndex = 0;
  let completion = 0;      // 0..1 eased, drives how lit the room is
  let finale = 0;          // burst after the last cell lands

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
        new THREE.PlaneGeometry(CELL * 0.82, CELL * 0.82),
        new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 1 }),
        rows * cols
      );
      cellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      cellMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(rows * cols * 3), 3);
      cellMesh.frustumCulled = false;
      group.add(cellMesh);

      pipPts = mkPts(rows * cols * 3, 0.9, 0.85);   // depth marks on empty cells
      runePts = mkPts(RUNES, 3.4, 1);
      runeGlow = mkPts(RUNES, 9, 0.4);
      trayPts = mkPts(TRAY_MAX, 4.2, 1);
      sparkPts = mkPts(SPARK, 1.5, 0.95);
      for (let i = 0; i < SPARK; i++) sLife[i] = 0;

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

      camera.position.set(0, 0, 46);
      camera.lookAt(0, 0, 0);
      camera.fov = 62;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    placeGhost(p, i, out) {
      // fellow gardeners drift at the edges of the room
      const a = i * 1.7 + (this._t || 0) * 0.15;
      out.set(Math.cos(a) * 34, Math.sin(a * 0.8) * 20, 6 + Math.sin(a) * 8);
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

      const want = needCount ? filledCount / needCount : 0;
      completion += (want - completion) * Math.min(1, dt * 1.6);
      const lit = completion * (1 + finale * 1.4);

      // camera: a slow, considered drift — you're standing in a dark room
      const px2 = attract ? Math.sin(time * 0.13) * 0.5 : pointer.x;
      const py2 = attract ? Math.cos(time * 0.11) * 0.4 : pointer.y;
      camera.position.set(
        px2 * 7 + Math.sin(time * 0.09) * 1.5,
        py2 * 5 + Math.cos(time * 0.07) * 1.2,
        46 - completion * 4 - audio.bass * 0.8
      );
      camera.lookAt(px2 * 1.5, py2 * 1.2, 0);
      camera.rotation.z += Math.sin(time * 0.05) * 0.008;

      // ── lattice ──
      const pipA = pipPts.geometry.attributes;
      let pip = 0;
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
            dummy.position.set(x, y, (pop - 1) * 3);
            dummy.scale.setScalar(0.9 + wob + (pop - 1) * 0.5 + beat * 0.06);
            dummy.rotation.z = wob * 0.3;
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
            const lum = (0.17 + t * 0.12) * Math.min(1.4, tp[2]) + audio.beatIntensity * 0.05 * t;
            color.setHSL((h + 1) % 1, 0.78, Math.min(0.62, lum * cellLight[i]));
            if (finale > 0) color.multiplyScalar(1 + finale * 1.2);
          } else {
            // waiting cells: a faint plate of the figure's own color, and it
            // warms whenever you're carrying the rune it wants
            const ready = tray.includes(t);
            const idle = (ready ? 0.055 : 0.022)
              + 0.014 * Math.sin(time * 1.3 + i * 0.35)
              + denyFlash * 0.05;
            color.setHSL(tierHue(t), ready ? 0.6 : 0.35, idle);
          }
          cellMesh.setColorAt(i, color);

          // depth marks: 1, 2, or 3 pips telling you what the cell will accept
          if (t && !cellFilled[i]) {
            for (let k = 0; k < t; k++) {
              const off = (k - (t - 1) / 2) * 0.42;
              pipA.position.setXYZ(pip, x + off, y, 0.4);
              const held = tray.includes(t);
              const g = held ? 0.5 + 0.18 * Math.sin(time * 4 + i) : 0.19;
              color.setHSL(tierHue(t), 0.8, g);
              pipA.color.setXYZ(pip, color.r, color.g, color.b);
              pip++;
            }
          }
        }
      }
      for (; pip < rows * cols * 3; pip++) pipA.position.setXYZ(pip, 0, -999, 0);
      cellMesh.instanceMatrix.needsUpdate = true;
      cellMesh.instanceColor.needsUpdate = true;
      pipA.position.needsUpdate = true;
      pipA.color.needsUpdate = true;

      // ── runes rise out of the dark; the music decides how generously ──
      spawnT -= dt;
      if ((audio.beat && Math.random() < 0.5) || spawnT <= 0) {
        for (let i = 0; i < RUNES; i++) {
          if (rAlive[i]) continue;
          rAlive[i] = 1;
          rTier[i] = Math.random() < 0.82 ? 1 : 2;   // deeper runes are rare gifts
          rx[i] = (Math.random() - 0.5) * 54;
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
              .addScaledVector(camDir, 20)
              .add(new THREE.Vector3(off, -11.5 + Math.sin(time * 2.4 + k) * 0.25, 0));
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

      // ── the room answers what you've built ──
      keyLight.material.color.setHSL(tierHue(2), 0.7, 0.5);
      keyLight.material.opacity = 0.03 + lit * 0.16 + placeFlash * 0.05;
      keyLight.scale.setScalar(90 * (1 + lit * 0.4 + finale * 0.5));

      motes.material.color.setHSL(tierHue(1), 0.6, 0.12 + lit * 0.3 + audio.high * 0.15);
      motes.material.size = 0.55 + lit * 0.5 + audio.high * 0.4;
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
