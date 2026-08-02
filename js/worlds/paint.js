// PAINT BY NUMBERS — a numbered canvas and a rack of paints.
//
// Pick a colour off the rack, then tap every cell wearing that number and it
// floods with paint. Wrong number and the cell just shrugs. Fill the canvas
// and the picture stands up out of the outline, alive with the music.
//
// Multiplayer: one canvas, everyone painting — a friend's tap lands on your
// canvas too, so a room finishes a picture together.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';

const CELL = 2.35;
const MAXCELLS = 400;
const SPARK = 240;

// Pictures are painted from a numbered palette — 1..6, '.' is bare canvas.
const PICTURES = [
  {
    name: 'BUTTERFLY',
    // deep violet · magenta · coral · gold · cream
    hues: [0.74, 0.90, 0.04, 0.12, 0.10],
    sats: [0.85, 0.90, 0.95, 0.90, 0.35],
    rows: [
      '...1.......1...',
      '..11.......11..',
      '.1112.....2111.',
      '.1223.5.5.3221.',
      '.2334.555.4332.',
      '.2344.555.4432.',
      '..344.555.443..',
      '...44.555.44...',
      '....4.555.4....',
      '......555......',
      '.......5.......',
    ],
  },
  {
    name: 'TULIPS',
    // scarlet · rose · leaf · deep green · sky
    hues: [0.99, 0.93, 0.28, 0.35, 0.55],
    sats: [0.9, 0.75, 0.7, 0.8, 0.45],
    rows: [
      '..5..5...5..5..',
      '.5.1.5.2.5.1.5.',
      '..111.222.111..',
      '.11111222211111',
      '.11111222211111',
      '..111.222.111..',
      '...3...3...3...',
      '..43...3...34..',
      '...3..43...3...',
      '...3...3..43...',
      '...3...3...3...',
      '..4443443444...',
    ],
  },
  {
    name: 'HOT AIR',
    // crimson · amber · cream · teal · slate basket
    hues: [0.01, 0.11, 0.14, 0.48, 0.08],
    sats: [0.9, 0.95, 0.3, 0.7, 0.6],
    rows: [
      '.....11111.....',
      '...1113111311..',
      '..111311131113.',
      '.1113111311131.',
      '.2223222322232.',
      '.2223222322232.',
      '..222322232223.',
      '...2223222322..',
      '....22222222...',
      '......3.3......',
      '......3.3......',
      '.....55555.....',
      '.....55555.....',
    ],
  },
];

export function createPaint() {
  let scene, camera, group, sky, motes, canvasMesh, fillGlow, sparkPts, keyLight;
  const numPts = [];        // one Points layer per palette number
  const rackPts = [];       // the paint rack: a blob per colour
  let rackGlow;
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  const pointer = { x: 0, y: 0, active: false };
  const _v = new THREE.Vector3();

  let pic = null, cols = 0, rows = 0, nColors = 0;
  let cellNum = null, cellDone = null, cellPop = null, cellWave = null;
  let doneCount = 0, needCount = 0, picIndex = 0;
  let held = 1;                       // which paint is on the brush
  let completion = 0, finale = 0, denyFlash = 0;
  let waveT = 999, waveDiag = false;
  let scoreQueue = 0;

  const sVel = new Float32Array(SPARK * 3);
  const sLife = new Float32Array(SPARK);
  const sHue = new Float32Array(SPARK);
  let sNext = 0;

  const cellX = c => (c - (cols - 1) / 2) * CELL;
  const cellY = r => ((rows - 1) / 2 - r) * CELL;
  const hueOf = n => pic.hues[n - 1] ?? 0;
  const satOf = n => pic.sats?.[n - 1] ?? 0.8;

  function digitTexture(n) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.font = '300 82px "Didot", "Bodoni 72", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,255,255,0.7)';
    g.shadowBlur = 10;
    g.fillStyle = '#ffffff';
    g.fillText(String(n), 64, 68);
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
      const sp = (2 + Math.random() * 8) * power;
      sVel[i * 3] = Math.cos(a) * sp;
      sVel[i * 3 + 1] = Math.sin(a) * sp + 2 * power;
      sVel[i * 3 + 2] = Math.random() * 4;
      sLife[i] = 0.6 + Math.random() * 0.7;
      sHue[i] = (hue01 + (Math.random() - 0.5) * 0.05 + 1) % 1;
    }
  }

  function loadPicture(index) {
    pic = PICTURES[index % PICTURES.length];
    const src = pic.rows;
    rows = src.length; cols = src[0].length;
    const n = rows * cols;
    cellNum = new Uint8Array(n);
    cellDone = new Uint8Array(n);
    cellPop = new Float32Array(n);
    cellWave = new Float32Array(n);
    needCount = 0;
    nColors = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = src[r][c];
        const v = ch === '.' ? 0 : +ch;
        cellNum[r * cols + c] = v;
        if (v) { needCount++; nColors = Math.max(nColors, v); }
      }
    }
    doneCount = 0;
    completion = 0;
    held = 1;
    if (window.__setFigure) window.__setFigure(pic.name, 0, needCount);
  }

  return {
    name: 'PAINT BY NUMBERS',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;

      loadPicture(0);

      canvasMesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(CELL * 0.88, CELL * 0.88),
        new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true }),
        MAXCELLS
      );
      canvasMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      canvasMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXCELLS * 3), 3);
      canvasMesh.frustumCulled = false;
      group.add(canvasMesh);

      fillGlow = mkPts(MAXCELLS, CELL * 2.2, 0.45);
      sparkPts = mkPts(SPARK, 1.5, 0.95);
      for (let i = 0; i < SPARK; i++) sLife[i] = 0;

      // a numeral layer per paint number
      numPts.length = 0;
      for (let n = 1; n <= 6; n++) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXCELLS * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXCELLS * 3), 3).setUsage(THREE.DynamicDrawUsage));
        const p = new THREE.Points(g, new THREE.PointsMaterial({
          size: CELL * 0.66, map: digitTexture(n), transparent: true, vertexColors: true,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }));
        p.frustumCulled = false;
        group.add(p);
        numPts.push(p);
      }

      // the paint rack — one fat blob of colour per number, along the bottom
      rackPts.length = 0;
      for (let n = 0; n < 6; n++) {
        const s = glowSprite(4.6);
        s.material.opacity = 0;
        group.add(s);
        rackPts.push(s);
      }
      rackGlow = mkPts(6, 3.2, 1);

      const mp = new Float32Array(240 * 3);
      for (let i = 0; i < 240; i++) {
        mp[i * 3] = (Math.random() - 0.5) * 130;
        mp[i * 3 + 1] = (Math.random() - 0.5) * 90;
        mp[i * 3 + 2] = -50 + Math.random() * 40;
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      motes = new THREE.Points(mg, glowPoints(0.6, 0.4));
      motes.frustumCulled = false;
      group.add(motes);

      keyLight = glowSprite(110);
      keyLight.position.set(0, 0, -26);
      keyLight.material.opacity = 0;
      group.add(keyLight);

      sky = skyDome(280);
      group.add(sky);

      picIndex = 0; finale = 0; denyFlash = 0; waveT = 999;
      camera.position.set(0, 0, 38);
      camera.lookAt(0, 0, 0);
      camera.fov = 60;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    placeGhost(p, i, out) {
      // fellow painters stand around the easel
      const a = i * 1.6 + (this._t || 0) * 0.1;
      out.set(Math.cos(a) * 30, Math.sin(a * 0.7) * 16, 10 + Math.sin(a) * 6);
    },

    // tap the rack to load the brush; tap the canvas to lay paint down
    onTap(x, y) {
      _v.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      const t = -camera.position.z / _v.z;
      const wx = camera.position.x + _v.x * t;
      const wy = camera.position.y + _v.y * t;

      // the rack sits under the canvas
      const rackY = cellY(rows - 1) - CELL * 2.4;
      if (wy < rackY + CELL * 1.1) {
        const span = (nColors - 1) * CELL * 2;
        for (let n = 1; n <= nColors; n++) {
          const rx = (n - 1) * CELL * 2 - span / 2;
          if (Math.abs(wx - rx) < CELL * 0.95) {
            held = n;
            spark(rx, rackY, hueOf(n), 12, 0.6);
            return;
          }
        }
        return;
      }

      const c = Math.round(wx / CELL + (cols - 1) / 2);
      const r = Math.round((rows - 1) / 2 - wy / CELL);
      if (c < 0 || c >= cols || r < 0 || r >= rows) return;
      const i = r * cols + c;
      const want = cellNum[i];
      if (!want || cellDone[i]) return;
      if (want !== held) { denyFlash = 1; return; }

      cellDone[i] = 1;
      cellPop[i] = 1.7;
      doneCount++;
      scoreQueue += 5;
      spark(cellX(c), cellY(r), hueOf(want), 12, 0.7);
      if (window.__setFigure) window.__setFigure(pic.name, doneCount, needCount);

      if (doneCount >= needCount) {
        finale = 1;
        scoreQueue += 250;
        for (let k = 0; k < 6; k++) {
          spark((Math.random() - 0.5) * cols * CELL, (Math.random() - 0.5) * rows * CELL,
            hueOf(1 + Math.floor(Math.random() * nColors)), 34, 1.5);
        }
      }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, attract, time, hue } = opts;
      this._t = time;

      if (scoreQueue && opts.addScore) { opts.addScore(scoreQueue); scoreQueue = 0; }
      denyFlash = Math.max(0, denyFlash - dt * 2.2);

      if (finale > 0) {
        finale -= dt * 0.2;
        if (finale <= 0) { finale = 0; picIndex++; loadPicture(picIndex); }
      }

      const want = needCount ? doneCount / needCount : 0;
      completion += (want - completion) * Math.min(1, dt * 1.6);
      const lit = completion * (1 + finale * 1.3);

      // painted cells ripple together on the beat
      if (audio.beat) { waveT = 0; waveDiag = !waveDiag; }
      waveT += dt * (24 + audio.energy * 20);
      const voice = [audio.bass, audio.lowMid, audio.mid, audio.high, audio.treble, audio.volume];

      const px2 = attract ? Math.sin(time * 0.12) * 0.4 : pointer.x;
      const py2 = attract ? Math.cos(time * 0.1) * 0.3 : pointer.y;
      camera.position.set(px2 * 6, py2 * 4, 38 - completion * 3 - audio.bass * 0.6);
      camera.lookAt(px2 * 1.5, py2 * 1.2, 0);

      // ── the canvas ──
      const numA = numPts.map(p => p.geometry.attributes);
      const numN = [0, 0, 0, 0, 0, 0];
      const glowA = fillGlow.geometry.attributes;
      let glowN = 0;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const n = cellNum[i];
          const x = cellX(c), y = cellY(r);

          if (!n) {
            dummy.position.set(0, 0, -999); dummy.scale.setScalar(0.001);
            dummy.updateMatrix();
            canvasMesh.setMatrixAt(i, dummy.matrix);
            color.setRGB(0, 0, 0);
            canvasMesh.setColorAt(i, color);
            continue;
          }

          if (cellDone[i]) {
            cellPop[i] += (1 - cellPop[i]) * Math.min(1, dt * 3);
            const reach = waveDiag ? (x + y) * 0.7 + 24 : Math.hypot(x, y);
            cellWave[i] = Math.max(0, 1 - Math.abs(reach - waveT) * 0.4);
            const v = voice[(n - 1) % voice.length] * reactivity;
            dummy.position.set(x, y, (cellPop[i] - 1) * 2.5 + cellWave[i] * 1.2);
            dummy.scale.setScalar(0.97 + (cellPop[i] - 1) * 0.4 + v * 0.06 + cellWave[i] * 0.12);
            dummy.rotation.z = cellWave[i] * 0.06;
            dummy.updateMatrix();
            canvasMesh.setMatrixAt(i, dummy.matrix);
            const lum = 0.34 + v * 0.2 + cellWave[i] * 0.26 + audio.beatIntensity * 0.05;
            color.setHSL(hueOf(n), satOf(n), Math.min(0.72, lum * cellPop[i]));
            if (finale > 0) color.multiplyScalar(1 + finale * 1.1);
            canvasMesh.setColorAt(i, color);

            glowA.position.setXYZ(glowN, x, y, -0.7);
            color.multiplyScalar(0.6 + cellWave[i] * 0.8);
            glowA.color.setXYZ(glowN, color.r, color.g, color.b);
            glowN++;
          } else {
            // bare canvas: a pale plate wearing its number, and it warms when
            // the brush is loaded with the paint it wants
            const ready = held === n;
            dummy.position.set(x, y, 0);
            dummy.scale.setScalar(0.97);
            dummy.rotation.z = 0;
            dummy.updateMatrix();
            canvasMesh.setMatrixAt(i, dummy.matrix);
            const base = ready ? 0.14 + 0.03 * Math.sin(time * 4 + i * 0.3) : 0.062;
            color.setHSL(hueOf(n), ready ? 0.4 : 0.1, base + denyFlash * 0.05);
            canvasMesh.setColorAt(i, color);

            const a = numN[n - 1];
            numA[n - 1].position.setXYZ(a, x, y, 0.5);
            const g = ready ? 0.75 + 0.15 * Math.sin(time * 3.6 + i) : 0.4;
            color.setHSL(hueOf(n), ready ? 0.5 : 0.15, g);
            numA[n - 1].color.setXYZ(a, color.r, color.g, color.b);
            numN[n - 1]++;
          }
        }
      }
      for (let n = 0; n < 6; n++) {
        for (let k = numN[n]; k < MAXCELLS; k++) numA[n].position.setXYZ(k, 0, -999, 0);
        numA[n].position.needsUpdate = true;
        numA[n].color.needsUpdate = true;
      }
      for (let k = glowN; k < MAXCELLS; k++) glowA.position.setXYZ(k, 0, -999, 0);
      glowA.position.needsUpdate = true;
      glowA.color.needsUpdate = true;
      canvasMesh.instanceMatrix.needsUpdate = true;
      canvasMesh.instanceColor.needsUpdate = true;

      // ── the paint rack ──
      {
        const rackY = cellY(rows - 1) - CELL * 2.4;
        const span = (nColors - 1) * CELL * 2;
        const ra = rackGlow.geometry.attributes;
        for (let n = 0; n < 6; n++) {
          const s = rackPts[n];
          if (n >= nColors) { s.material.opacity = 0; ra.position.setXYZ(n, 0, -999, 0); continue; }
          const rx = n * CELL * 2 - span / 2;
          const on = held === n + 1;
          s.position.set(rx, rackY + (on ? 0.5 : 0), 0);
          s.scale.setScalar(4.6 * (on ? 1.35 : 1) * (1 + audio.beatIntensity * 0.12));
          color.setHSL(hueOf(n + 1), satOf(n + 1), on ? 0.6 : 0.34);
          s.material.color.copy(color);
          s.material.opacity = on ? 0.95 : 0.5;
          // the numeral sitting on the pot
          ra.position.setXYZ(n, rx, rackY, 0.6);
          color.setHSL(0, 0, on ? 0.95 : 0.4);
          ra.color.setXYZ(n, color.r, color.g, color.b);
        }
        ra.position.needsUpdate = true;
        ra.color.needsUpdate = true;
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

      keyLight.material.color.setHSL(hueOf(1 + (Math.floor(time * 0.2) % Math.max(1, nColors))), 0.6, 0.5);
      keyLight.material.opacity = 0.03 + lit * 0.14;
      keyLight.scale.setScalar(110 * (1 + lit * 0.3 + finale * 0.4));

      motes.material.color.setHSL((hue / 360 + 0.4) % 1, 0.5, 0.1 + lit * 0.24 + audio.high * 0.12);
      motes.material.size = 0.6 + lit * 0.4 + audio.high * 0.4;
      motes.rotation.y += dt * 0.01;

      sky.position.copy(camera.position);
      sky.material.color.setHSL((hue / 360 + 0.55) % 1, 0.35, 0.02 + lit * 0.07 + finale * 0.05);

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
