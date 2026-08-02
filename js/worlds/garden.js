// MAGIC GARDEN — the match-three-in-the-dirt game. Buds sprout in three
// colors (magenta / cyan / electric blue). Pop THREE OF THE SAME COLOR in a
// row and they erupt — the MAGIC NUMBER — feeding a multiplier that climbs
// with every clean burst. A wrong color fizzles the streak. Buds wilt if
// ignored. Beats plant buds, so the music sets the pace. The canopy grows
// with your multiplier: chase ×5 and the sky itself blooms.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const TRIO = [0.86, 0.5, 0.62]; // magenta / cyan / electric blue
const BUDS = 14;                // live buds max
const FLOWERS = 64;             // decorative blooms left behind by bursts
const DEW = 320;

export function createGarden() {
  let scene, camera, group, sky, dew, ground, vine;
  let budCore, budHalo, budRing;     // the game pieces
  let stems, petals, halos;          // decoration that bursts leave behind
  const rings = [];
  const canopy = [];
  let travel = 0;
  const tp = [0, 0, 0];
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  const pointer = { x: 0, y: 0, active: false };

  // bud state
  const bx = new Float32Array(BUDS), bz = new Float32Array(BUDS);
  const bage = new Float32Array(BUDS);
  const bhue = new Uint8Array(BUDS);     // 0/1/2 into TRIO
  const balive = new Uint8Array(BUDS);
  const WILT = 8;                        // seconds before a bud gives up
  let spawnT = 0;

  // chain state — the whole game
  let chainColor = -1, chainCount = 0, chainT = 0, multi = 1;
  let comboFlash = 0, fizzle = 0;
  const chainPts = [];                   // positions of the current chain's pops
  let scoreQueue = 0, scoreQX = 0, scoreQY = 0;

  // decoration state
  const fx = new Float32Array(FLOWERS), fz = new Float32Array(FLOWERS);
  const fh = new Float32Array(FLOWERS), fage = new Float32Array(FLOWERS);
  const fhue = new Float32Array(FLOWERS);
  const falive = new Uint8Array(FLOWERS);
  let nextFlower = 0;

  const groundY = (x, z) => Math.sin(x * 0.07) * 1.1 + Math.cos(z * 0.05 + x * 0.02) * 1.4;

  function spawnBud(camZ) {
    let i = -1;
    for (let k = 0; k < BUDS; k++) if (!balive[k]) { i = k; break; }
    if (i < 0) return;
    balive[i] = 1;
    bage[i] = 0;
    bhue[i] = Math.floor(Math.random() * 3);
    bx[i] = (Math.random() - 0.5) * 56;
    bz[i] = camZ - 20 - Math.random() * 55;
  }

  function plantDecoration(x, z, hue01) {
    const i = nextFlower++ % FLOWERS;
    fx[i] = x; fz[i] = z; fh[i] = 0; fage[i] = 0; fhue[i] = hue01; falive[i] = 1;
  }

  return {
    name: 'MAGIC GARDEN',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x020408, 0.011);

      const gg = new THREE.PlaneGeometry(240, 240, 48, 48);
      gg.rotateX(-Math.PI / 2);
      {
        const pa = gg.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          pa.setY(i, groundY(pa.getX(i), pa.getZ(i)));
          const t = 0.5 + Math.random() * 0.5;
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        gg.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      }
      ground = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      ground.frustumCulled = false;
      group.add(ground);

      const dp = new Float32Array(DEW * 3);
      for (let i = 0; i < DEW; i++) {
        const x = (Math.random() - 0.5) * 200, z = (Math.random() - 0.5) * 200;
        dp[i * 3] = x; dp[i * 3 + 1] = groundY(x, z) + 0.15; dp[i * 3 + 2] = z;
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      dew = new THREE.Points(dg, glowPoints(0.9, 0.5));
      dew.frustumCulled = false;
      group.add(dew);

      // buds: core orb + big halo + a ground ring so they read as TARGETS
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
      budCore = mkPts(BUDS, 3.4, 1);
      budHalo = mkPts(BUDS, 9, 0.4);
      budRing = mkPts(BUDS, 5, 0.5);

      stems = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.16, 1, 0.16),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        FLOWERS
      );
      stems.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      stems.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FLOWERS * 3), 3);
      stems.frustumCulled = false;
      group.add(stems);
      petals = mkPts(FLOWERS, 2.4, 0.9);
      halos = mkPts(FLOWERS, 6, 0.3);

      for (let i = 0; i < 6; i++) {
        const r = new THREE.Mesh(
          new THREE.RingGeometry(0.7, 1, 40),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        r.rotation.x = -Math.PI / 2;
        group.add(r);
        rings.push(r);
      }

      vine = new THREE.Line(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 3), 3).setUsage(THREE.DynamicDrawUsage)),
        new THREE.LineBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, blending: THREE.AdditiveBlending })
      );
      vine.frustumCulled = false;
      group.add(vine);

      canopy.length = 0;
      for (let i = 0; i < 22; i++) {
        const c = glowSprite(14 + Math.random() * 14);
        c.position.set((Math.random() - 0.5) * 150, 22 + Math.random() * 10, (Math.random() - 0.5) * 150);
        c.material.opacity = 0;
        group.add(c);
        canopy.push(c);
      }

      sky = skyDome(260);
      group.add(sky);

      for (let i = 0; i < BUDS; i++) balive[i] = 0;
      for (let i = 0; i < FLOWERS; i++) falive[i] = 0;
      travel = 0; spawnT = 0; nextFlower = 0;
      chainColor = -1; chainCount = 0; chainT = 0; multi = 1; comboFlash = 0; fizzle = 0;
      chainPts.length = 0;

      // the field starts stocked — something to shoot at immediately
      for (let k = 0; k < 7; k++) spawnBud(0);

      camera.fov = 66;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    placeGhost(p, i, out) {
      const a = i * 2.1 + (this._t || 0) * 0.12;
      const x = Math.sin(a) * (13 + (i % 3) * 5) + p.x * 3;
      const z = camera.position.z - 16 - (i % 5) * 9;
      out.set(x, groundY(x, z) + 2.2, z);
    },

    // tap: pop the bud you aimed at. Same color three times = MAGIC NUMBER.
    onTap(x, y) {
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const bp = new THREE.Vector3();
      let best = -1, bestD = 1e9;
      for (let i = 0; i < BUDS; i++) {
        if (!balive[i]) continue;
        bp.set(bx[i], groundY(bx[i], bz[i]) + 2.2, bz[i]).sub(camera.position);
        const along = bp.dot(dir);
        if (along < 4) continue;
        const d = bp.clone().cross(dir).length() / Math.max(1, along * 0.045);
        if (d < bestD) { bestD = d; best = i; }
      }

      if (best < 0 || bestD > 11) {
        // missed everything: plant a consolation flower where the dirt was hit
        if (dir.y < -0.02) {
          const t = Math.min(90, -(camera.position.y - 1) / dir.y);
          plantDecoration(camera.position.x + dir.x * t, camera.position.z + dir.z * t, (chainColor >= 0 ? TRIO[chainColor] : TRIO[0]));
        }
        return;
      }

      const i = best;
      const hue01 = TRIO[bhue[i]];
      const px2 = bx[i], pz2 = bz[i];
      balive[i] = 0;
      plantDecoration(px2, pz2, hue01); // every pop leaves a flower behind

      // burst ring at the pop
      const r = rings.find(q => q.material.opacity <= 0.01) || rings[0];
      r.position.set(px2, groundY(px2, pz2) + 0.25, pz2);
      r.scale.setScalar(1);
      r.material.opacity = 0.9;
      color.setHSL(hue01, 0.95, 0.6);
      r.material.color.copy(color);

      if (chainColor === -1 || bhue[i] === chainColor) {
        // right color — the chain climbs
        chainColor = bhue[i];
        chainCount++;
        chainT = 5;
        chainPts.push(px2, groundY(px2, pz2) + 2.2, pz2);
        if (chainPts.length > 9) chainPts.splice(0, 3);
        if (chainCount >= 3) {
          // MAGIC NUMBER! 15 base × multiplier, then the streak deepens
          scoreQueue += 15 * multi; scoreQX = x; scoreQY = y;
          multi = Math.min(5, multi + 1);
          comboFlash = 1;
          chainColor = -1; chainCount = 0;
          chainPts.length = 0;
          // an eruption of decoration around the third pop
          for (let k = 0; k < 5; k++) {
            plantDecoration(px2 + (Math.random() - 0.5) * 10, pz2 + (Math.random() - 0.5) * 10, hue01);
          }
        } else {
          scoreQueue += 3; scoreQX = x; scoreQY = y; // a pop on the way up
        }
      } else {
        // wrong color — the streak fizzles, multiplier resets
        fizzle = 1;
        multi = 1;
        chainColor = bhue[i];
        chainCount = 1;
        chainT = 5;
        chainPts.length = 0;
        chainPts.push(px2, groundY(px2, pz2) + 2.2, pz2);
        scoreQueue += 1; scoreQX = x; scoreQY = y; // solace point
      }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      this._t = time;

      if (scoreQueue && opts.addScore) { opts.addScore(scoreQueue, scoreQX, scoreQY); scoreQueue = 0; }

      chainT -= dt;
      if (chainT <= 0 && chainColor !== -1) { chainColor = -1; chainCount = 0; chainPts.length = 0; }
      comboFlash = Math.max(0, comboFlash - dt * 0.7);
      fizzle = Math.max(0, fizzle - dt * 1.6);

      travel += dt * (2.2 + audio.energy * 4);
      const camZ = -travel;
      const sway = Math.sin(time * 0.24) * 5;
      camera.position.set(
        sway + (attract ? 0 : pointer.x * 6),
        4.2 + Math.sin(time * 0.4) * 0.4 + audio.bass * 0.6,
        camZ
      );
      camera.lookAt(sway * 0.4, 2.6 + (attract ? 0 : pointer.y * 3), camZ - 26);

      // buds spawn with the music: every beat plants one, plus a slow drip
      spawnT -= dt;
      if (audio.beat || spawnT <= 0) {
        spawnBud(camZ);
        spawnT = 2.2 - Math.min(1.4, audio.energy * 1.6);
      }

      // draw the buds — pulsing targets, wilting as they age
      const bc = budCore.geometry.attributes; const bh2 = budHalo.geometry.attributes; const br = budRing.geometry.attributes;
      for (let i = 0; i < BUDS; i++) {
        if (balive[i]) {
          bage[i] += dt;
          if (bage[i] > WILT || bz[i] > camZ + 8) balive[i] = 0; // wilted or passed
        }
        if (!balive[i]) {
          bc.position.setXYZ(i, 0, -999, 0); bh2.position.setXYZ(i, 0, -999, 0); br.position.setXYZ(i, 0, -999, 0);
          continue;
        }
        const gy = groundY(bx[i], bz[i]);
        const bob = Math.sin(time * 2 + i * 3) * 0.25;
        const y = gy + 2.2 + bob;
        bc.position.setXYZ(i, bx[i], y, bz[i]);
        bh2.position.setXYZ(i, bx[i], y, bz[i]);
        br.position.setXYZ(i, bx[i], gy + 0.2, bz[i]);
        const wilt = Math.max(0, 1 - Math.max(0, bage[i] - WILT * 0.6) / (WILT * 0.4)); // dims in its last stretch
        const pulse = 1 + Math.sin(time * 5 + i) * 0.18 + audio.beatIntensity * 0.4;
        const isChainColor = chainColor === bhue[i] && chainCount > 0;
        color.setHSL(TRIO[bhue[i]], 0.95, 0.52 + (isChainColor ? 0.14 : 0)).multiplyScalar(wilt * pulse * (isChainColor ? 1.5 : 1));
        bc.color.setXYZ(i, color.r, color.g, color.b);
        color.multiplyScalar(0.5);
        bh2.color.setXYZ(i, color.r, color.g, color.b);
        color.multiplyScalar(0.8);
        br.color.setXYZ(i, color.r, color.g, color.b);
      }
      bc.position.needsUpdate = true; bc.color.needsUpdate = true;
      bh2.position.needsUpdate = true; bh2.color.needsUpdate = true;
      br.position.needsUpdate = true; br.color.needsUpdate = true;
      budCore.material.size = 3.4 * (1 + audio.beatIntensity * 0.2);
      budHalo.material.size = 9 * (1 + comboFlash * 0.5);

      // decorative flowers left by pops
      const pp = petals.geometry.attributes, hp = halos.geometry.attributes;
      for (let i = 0; i < FLOWERS; i++) {
        if (!falive[i] || fz[i] > camZ + 14) {
          if (falive[i]) falive[i] = 0;
          dummy.position.set(0, -999, 0); dummy.scale.setScalar(0.001);
          dummy.updateMatrix(); stems.setMatrixAt(i, dummy.matrix);
          pp.position.setXYZ(i, 0, -999, 0); hp.position.setXYZ(i, 0, -999, 0);
          continue;
        }
        fage[i] += dt;
        const target = 2.4 + Math.sin(i * 7.3);
        fh[i] += (target - fh[i]) * Math.min(1, dt * 2.5);
        const gy = groundY(fx[i], fz[i]);
        dummy.position.set(fx[i], gy + fh[i] / 2, fz[i]);
        dummy.scale.set(1, Math.max(0.05, fh[i]), 1);
        dummy.updateMatrix();
        stems.setMatrixAt(i, dummy.matrix);
        color.setHSL(fhue[i], 0.85, 0.3);
        stems.setColorAt(i, color);
        const head = gy + fh[i] + 0.3;
        pp.position.setXYZ(i, fx[i], head, fz[i]);
        hp.position.setXYZ(i, fx[i], head, fz[i]);
        color.setHSL(fhue[i], 0.95, 0.5).multiplyScalar((0.6 + Math.min(1, fage[i]) * 0.6) * (1 + audio.beatIntensity * 0.4));
        pp.color.setXYZ(i, color.r, color.g, color.b);
        color.multiplyScalar(0.45);
        hp.color.setXYZ(i, color.r, color.g, color.b);
      }
      stems.instanceMatrix.needsUpdate = true;
      stems.instanceColor.needsUpdate = true;
      pp.position.needsUpdate = true; pp.color.needsUpdate = true;
      hp.position.needsUpdate = true; hp.color.needsUpdate = true;

      for (const r of rings) {
        if (r.material.opacity <= 0.01) continue;
        r.material.opacity *= Math.pow(0.12, dt);
        r.scale.multiplyScalar(1 + dt * 7);
      }

      // vine threads the current chain's pops
      const n = chainPts.length / 3;
      if (n >= 2) {
        const vp = vine.geometry.attributes.position;
        for (let k = 0; k < 3; k++) {
          const src = Math.min(k, n - 1) * 3;
          vp.setXYZ(k, chainPts[src], chainPts[src + 1], chainPts[src + 2]);
        }
        vp.needsUpdate = true;
        color.setHSL(TRIO[chainColor] || 0, 0.95, 0.6).multiplyScalar(1.3);
        vine.material.color.copy(color);
        vine.material.opacity = 0.55 + audio.beatIntensity * 0.3;
      } else {
        vine.material.opacity *= Math.pow(0.05, dt);
      }

      // the canopy is your multiplier made visible — solo or not
      const souls = participants ? participants.length : 1;
      const canopyIn = Math.min(1, (multi - 1) / 4) * 0.8 + Math.min(0.2, (souls - 1) * 0.07);
      canopy.forEach((c, i) => {
        c.material.color.setHSL(TRIO[i % 3], 0.8, 0.4);
        c.material.opacity = canopyIn * (0.1 + 0.08 * Math.sin(time * 0.5 + i * 2)) * (1 + audio.energy * 0.8);
      });

      themePaint(colorMode, hue / 360, 0.1, 0, time, audio.energy, 0.4, tp);
      ground.material.color.setHSL(tp[0], tp[1] * 0.7, 0.028 + audio.bass * 0.03 + comboFlash * 0.06 - fizzle * 0.015);
      dew.material.color.setHSL((hue / 360 + 0.45) % 1, 0.8, 0.55 + audio.high * 0.3);
      dew.material.size = 0.9 + audio.high * 1.0 + comboFlash * 0.7;

      sky.position.copy(camera.position);
      sky.material.color.setHSL(
        fizzle > 0.3 ? 0.02 : tp[0],
        tp[1] * 0.5,
        0.16 + audio.energy * 0.1 + comboFlash * 0.14
      );

      if (ground.position.z > camZ + 60) ground.position.z = camZ;
      ground.position.z += (camZ - ground.position.z) * Math.min(1, dt * 0.5);
      dew.position.z = ground.position.z;

      const fovT = 66 + audio.volume * 6 * reactivity + comboFlash * 7;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();

      if (participants && participants[0]) {
        participants[0].x = attract ? Math.sin(time * 0.3) * 0.4 : pointer.x;
        participants[0].y = 0;
      }
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
