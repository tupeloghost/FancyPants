// RIVER — a lazy river at night. You drift downstream between banks of
// glowing lanterns; the water carries the waveform as slow swells. No fail
// state, no hurry. Tap drops a ripple where you touch the water.

import * as THREE from 'three';
import { glowSprite, glowPoints, glowTexture, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const WCOLS = 40, WROWS = 70;       // water mesh
const WW = 90, WL = 340;
const LANTERNS = 56;
const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

export function createRiver() {
  let scene, camera, group, water, lanterns, lanternGlow, fireflies, sky, moon, foam;
  const foamLat = new Float32Array(130);
  let drift = 0;
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let pointer = { x: 0, active: false };
  let steer = 0;

  const lz = new Float32Array(LANTERNS);
  const lside = new Float32Array(LANTERNS);
  const lh = new Float32Array(LANTERNS);
  const lband = new Uint8Array(LANTERNS);

  // expanding tap ripples on the water
  let ripples = [];

  const riverX = z => Math.sin(z * 0.014) * 20 + Math.sin(z * 0.0045) * 26;

  return {
    name: 'RIVER',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x020409, 0.009);

      const geo = new THREE.PlaneGeometry(WW, WL, WCOLS - 1, WROWS - 1);
      geo.rotateX(-Math.PI / 2);
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      water = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      water.frustumCulled = false; // vertices are placed in world space
      group.add(water);

      // lantern posts along both banks
      lanterns = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.9, 10, 10),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        LANTERNS
      );
      lanterns.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LANTERNS * 3), 3);
      lanterns.frustumCulled = false;
      group.add(lanterns);

      const gp = new Float32Array(LANTERNS * 3);
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(gp, 3).setUsage(THREE.DynamicDrawUsage));
      gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(LANTERNS * 3), 3).setUsage(THREE.DynamicDrawUsage));
      lanternGlow = new THREE.Points(gg, glowPoints(7, 0.55));
      lanternGlow.material.vertexColors = true;
      lanternGlow.frustumCulled = false;
      group.add(lanternGlow);

      // lantern pairs spaced evenly over exactly one wrap period (WL),
      // so recycling is seamless — no visible teleports
      for (let i = 0; i < LANTERNS; i++) {
        lz[i] = -Math.floor(i / 2) * (WL / (LANTERNS / 2));
        lside[i] = (i % 2 ? 1 : -1) * (16 + Math.random() * 7);
        lh[i] = 2.5 + Math.random() * 4;
        lband[i] = i % BANDS.length;
      }

      // fireflies over the water
      const fp = new Float32Array(240 * 3);
      for (let i = 0; i < 240; i++) {
        fp[i * 3] = (Math.random() - 0.5) * 70;
        fp[i * 3 + 1] = 1 + Math.random() * 9;
        fp[i * 3 + 2] = -Math.random() * WL;
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
      fireflies = new THREE.Points(fg, glowPoints(0.7, 0.7));
      fireflies.frustumCulled = false;
      group.add(fireflies);

      // foam streaks riding the current past the camera — the flow made visible
      {
        const fo = new Float32Array(130 * 3);
        for (let i = 0; i < 130; i++) {
          fo[i * 3] = 0; fo[i * 3 + 1] = 0.35; fo[i * 3 + 2] = -Math.random() * WL;
        }
        const fog2 = new THREE.BufferGeometry();
        fog2.setAttribute('position', new THREE.BufferAttribute(fo, 3).setUsage(THREE.DynamicDrawUsage));
        foam = new THREE.Points(fog2, glowPoints(0.55, 0.55));
        foam.frustumCulled = false;
        group.add(foam);
        for (let i = 0; i < 130; i++) foamLat[i] = (Math.random() - 0.5) * 24;
      }

      moon = glowSprite(46);
      moon.material.fog = false;
      group.add(moon);

      // ripple pool
      ripples = [];
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1, 48),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        m.userData = { life: 0 };
        group.add(m);
        ripples.push(m);
      }

      sky = skyDome(320);
      group.add(sky);

      drift = 0;
      camera.fov = 70;
      camera.updateProjectionMatrix();
    },

    setInput(x) { pointer.x = x; pointer.active = true; },

    // fellow floaters drifting the same river
    placeGhost(p, i, out) {
      const z = camera.position.z - 16 - (i % 6) * 9;
      out.set(riverX(z) + p.x * 9 + Math.sin(i * 2.6) * 4, 1.2, z);
    },

    onTap(x, y) {
      // drop a ripple where the tap ray meets the water plane (y = 0)
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const t = -camera.position.y / (dir.y || -0.0001);
      if (t > 0 && t < 300) {
        const m = ripples.find(r => !r.visible) || ripples[0];
        m.visible = true;
        m.userData.life = 1;
        m.position.copy(camera.position).addScaledVector(dir, t);
        m.position.y = 0.15;
        m.scale.setScalar(0.8);
      }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;

      // lazy drift — the river never hurries, even on drops
      drift += dt * (5 + audio.energy * 9 + audio.volume * 4);
      const camZ = -drift;
      if (attract || !pointer.active) steer += (Math.sin(time * 0.2) * 0.4 - steer) * Math.min(1, dt);
      else steer += (pointer.x - steer) * Math.min(1, dt * 1.5);

      if (participants && participants[0]) {
        participants[0].x = steer;
        participants[0].y = 0;
      }

      camera.position.set(riverX(camZ) + steer * 8, 4.2 + Math.sin(time * 0.5) * 0.4, camZ);
      camera.lookAt(riverX(camZ - 55), 2.2, camZ - 55);
      camera.rotation.z += Math.sin(time * 0.33) * 0.02 + steer * -0.04;

      // water: gentle swells + the waveform breathing through the surface
      water.position.z = camZ - WL / 2 + 40;
      const pos = water.geometry.attributes.position;
      const col = water.geometry.attributes.color;
      for (let r = 0; r < WROWS; r++) {
        for (let c = 0; c < WCOLS; c++) {
          const i = r * WCOLS + c;
          const wz = water.position.z + (r / (WROWS - 1) - 0.5) * WL;
          const wx = riverX(wz) + (c / (WCOLS - 1) - 0.5) * WW;
          pos.setX(i, wx);
          // waves travel WITH the current — the surface visibly flows
          const flowPhase = wz * 0.09 + drift * 0.22;
          const swell =
            Math.sin(flowPhase + time * 0.4) * 0.5 +
            Math.sin(wx * 0.14 - time * 0.8 + drift * 0.05) * 0.35;
          const h = swell * (0.5 + audio.volume * 1.6 * reactivity);
          pos.setY(i, h);
          const bright = 0.06 + Math.max(0, swell) * (0.12 + audio.volume * 0.3);
          const jitv = Math.abs(Math.sin(c * 12.99 + r * 78.23));
          themePaint(colorMode, hue / 360, 0.15 + Math.max(0, swell) * 0.5, wz * 0.02 + time * 0.1, time, audio.volume, jitv, tp);
          color.setHSL(tp[0], tp[1] * 0.85, Math.min(0.6, bright * Math.min(1.6, tp[2]) * 3));
          col.setXYZ(i, color.r, color.g, color.b);
        }
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;

      // lanterns line the banks, each pulsing with its band
      const gpos = lanternGlow.geometry.attributes.position;
      const gcol = lanternGlow.geometry.attributes.color;
      for (let i = 0; i < LANTERNS; i++) {
        let z = lz[i];
        while (z > camZ + 18) z -= WL;
        while (z < camZ + 18 - WL) z += WL;
        lz[i] = z;
        const x = riverX(z) + lside[i];
        const level = audio[BANDS[lband[i]]];
        dummy.position.set(x, lh[i], z);
        dummy.scale.setScalar(0.8 + level * 0.9 * reactivity);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        lanterns.setMatrixAt(i, dummy.matrix);
        themePaint(colorMode, hue / 360, (i / LANTERNS), z * 0.02, time, level, Math.abs(Math.sin(i * 7.7)), tp);
        color.setHSL(tp[0], tp[1], Math.min(0.72, (0.2 + level * 0.5) * Math.min(1.5, tp[2])));
        lanterns.setColorAt(i, color);
        gpos.setXYZ(i, x, lh[i], z);
        gcol.setXYZ(i, color.r, color.g, color.b);
      }
      lanterns.instanceMatrix.needsUpdate = true;
      lanterns.instanceColor.needsUpdate = true;
      gpos.needsUpdate = true;
      gcol.needsUpdate = true;
      lanternGlow.material.size = 6 + audio.bass * 5;

      // ripples spread and fade
      for (const m of ripples) {
        if (!m.visible) continue;
        m.userData.life -= dt * 0.8;
        if (m.userData.life <= 0) { m.visible = false; continue; }
        m.scale.addScalar(dt * 26);
        themePaint(colorMode, hue / 360, 0.5, 0, time, 1, 0.5, tp);
        color.setHSL(tp[0], tp[1], 0.55);
        m.material.color.copy(color);
        m.material.opacity = m.userData.life * 0.7;
      }

      // foam rides the current — overtaking the camera so the flow reads
      {
        const fpos2 = foam.geometry.attributes.position;
        const flowSpeed = 7 + audio.energy * 8;
        for (let i = 0; i < 130; i++) {
          let z = fpos2.getZ(i) - flowSpeed * dt; // downstream faster than the camera
          if (z < camZ - WL * 0.9) z = camZ + 12;
          if (z > camZ + 15) z = camZ - WL * 0.85;
          fpos2.setZ(i, z);
          fpos2.setX(i, riverX(z) + foamLat[i]);
          fpos2.setY(i, 0.35);
        }
        fpos2.needsUpdate = true;
        color.setHSL((hue / 360) % 1, 0.15, 0.65);
        foam.material.color.copy(color);
        foam.material.size = 0.5 + audio.volume * 0.4;
      }

      // fireflies wrap and shimmer with the highs
      const fpos = fireflies.geometry.attributes.position;
      for (let i = 0; i < fpos.count; i++) {
        const z = fpos.getZ(i);
        if (z > camZ + 15) fpos.setZ(i, z - WL);
        fpos.setX(i, riverX(fpos.getZ(i)) + Math.sin(i * 3.3 + time * 0.4) * 26);
      }
      fpos.needsUpdate = true;
      color.setHSL(((hue / 360) + 0.12) % 1, 0.7, 0.35 + audio.high * 0.35);
      fireflies.material.color.copy(color);
      fireflies.material.size = 0.7 + audio.high * 0.6;

      // moon hangs downstream; sky breathes
      moon.position.set(riverX(camZ - 260), 42, camZ - 280);
      color.setHSL((hue / 360) % 1, 0.25, 0.75);
      moon.material.color.copy(color);
      moon.material.opacity = 0.55 + audio.energy * 0.2;
      sky.position.copy(camera.position);
      color.setHSL((hue / 360) % 1, 0.55, 0.3 + audio.energy * 0.2);
      sky.material.color.copy(color);

      const fovT = 70 + audio.volume * 5 * reactivity;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      ripples = [];
    },
  };
}
