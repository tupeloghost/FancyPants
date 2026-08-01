// BLACKTOP — night street racing. Low camera, neon lane lines rushing past,
// streetlights strobing overhead, speed riding the volume. Tap = NITRO.
// Ghosts are rival cars ahead of you.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const DASHES = 46;
const POLES = 14;
const BUILDINGS = 90;
const SPAN = 480;
const ROAD_W = 24;
const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

export function createBlacktop() {
  let scene, camera, group, road, dashes, rails, poles, lampGlow, buildings, sky, lines;
  let travel = 0, nitro = 0;
  let steer = 0, steerTarget = 0;
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const dz = new Float32Array(DASHES);
  const dlane = new Int8Array(DASHES);
  const pz = new Float32Array(POLES);
  const bz = new Float32Array(BUILDINGS), bx = new Float32Array(BUILDINGS);
  const bh = new Float32Array(BUILDINGS), bband = new Uint8Array(BUILDINGS);
  let speedLines = [];

  const roadX = z => Math.sin(z * 0.008) * 26;

  return {
    name: 'BLACKTOP',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x030306, 0.0085);

      // asphalt: a dark ribbon following the road curve
      const rg = new THREE.PlaneGeometry(ROAD_W + 6, SPAN, 10, 60);
      rg.rotateX(-Math.PI / 2);
      road = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x08080d, toneMapped: false }));
      road.frustumCulled = false;
      group.add(road);

      // lane dashes: three neon lanes
      dashes = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.35, 0.08, 4.2),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        DASHES
      );
      dashes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DASHES * 3), 3);
      dashes.frustumCulled = false;
      group.add(dashes);
      for (let i = 0; i < DASHES; i++) {
        dz[i] = -(i % (DASHES / 2)) * (SPAN / (DASHES / 2));
        dlane[i] = i < DASHES / 2 ? -1 : 1;
      }

      // guard rails: continuous glowing edges
      rails = [];
      for (const side of [-1, 1]) {
        const r = new THREE.Mesh(
          new THREE.BoxGeometry(0.25, 0.5, SPAN),
          new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.8 })
        );
        r.frustumCulled = false;
        r.userData.side = side;
        group.add(r);
        rails.push(r);
      }

      // streetlight poles arcing overhead + their lamps
      poles = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.4, 11, 0.4),
        new THREE.MeshBasicMaterial({ color: 0x0c0c14, toneMapped: false }),
        POLES
      );
      poles.frustumCulled = false;
      group.add(poles);
      const lp = new Float32Array(POLES * 3);
      const lc = new Float32Array(POLES * 3);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage));
      lg.setAttribute('color', new THREE.BufferAttribute(lc, 3).setUsage(THREE.DynamicDrawUsage));
      lampGlow = new THREE.Points(lg, glowPoints(9, 0.8));
      lampGlow.material.vertexColors = true;
      lampGlow.frustumCulled = false;
      group.add(lampGlow);
      for (let i = 0; i < POLES; i++) pz[i] = -i * (SPAN / POLES);

      // skyline: dark towers with band-lit faces, both sides
      buildings = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        BUILDINGS
      );
      buildings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BUILDINGS * 3), 3);
      buildings.frustumCulled = false;
      group.add(buildings);
      for (let i = 0; i < BUILDINGS; i++) {
        bz[i] = -Math.random() * SPAN;
        bx[i] = (i % 2 ? 1 : -1) * (26 + Math.random() * 45);
        bh[i] = 8 + Math.pow(Math.random(), 1.6) * 34;
        bband[i] = i % BANDS.length;
      }

      // nitro speed lines
      speedLines = [];
      for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.07, 11),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.visible = false;
        m.userData = { z: 0, x: 0, y: 0 };
        group.add(m);
        speedLines.push(m);
      }

      sky = skyDome(340);
      group.add(sky);

      travel = 0; nitro = 0; steer = 0;
      camera.fov = 78;
      camera.updateProjectionMatrix();
    },

    setInput(x) { steerTarget = x; },

    // rivals: glowing cars in the lanes ahead, taillights to you
    placeGhost(p, i, out) {
      const z = camera.position.z - 22 - (i % 7) * 14;
      out.set(roadX(z) + (((i % 3) - 1) * 7) + p.x * 3, 1.6, z);
    },

    onTap() { nitro = 1; }, // NITRO

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;

      nitro *= Math.pow(0.25, dt);
      const speed = 26 + audio.volume * 70 * reactivity + nitro * 85;
      travel += speed * dt;
      const camZ = -travel;

      if (attract) steerTarget = Math.sin(time * 0.3) * 0.5;
      steer += (steerTarget - steer) * Math.min(1, dt * 3);
      if (participants && participants[0]) {
        participants[0].x = steer;
        participants[0].y = 0;
      }

      // low racing camera hugging the asphalt
      const cx = roadX(camZ) + steer * 8;
      camera.position.set(cx, 2.6 + audio.bass * 0.4, camZ);
      camera.lookAt(roadX(camZ - 60), 2.2, camZ - 60);
      camera.rotation.z += steer * -0.09 + nitro * Math.sin(time * 40) * 0.006; // nitro judder

      road.position.set(0, 0, camZ - SPAN / 2 + 40);
      // bend the road plane to the curve
      const rp = road.geometry.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        const wz = road.position.z + rp.getZ(i);
        rp.setX(i, roadX(wz) + ((i % 11) / 10 - 0.5) * (ROAD_W + 6));
      }
      rp.needsUpdate = true;

      // lane dashes scream past
      for (let i = 0; i < DASHES; i++) {
        if (dz[i] > camZ + 10) dz[i] -= SPAN;
        dummy.position.set(roadX(dz[i]) + dlane[i] * 4, 0.1, dz[i]);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1 + speed * 0.02); // stretch with speed
        dummy.updateMatrix();
        dashes.setMatrixAt(i, dummy.matrix);
        themePaint(colorMode, hue / 360, 0.5 + dlane[i] * 0.2, dz[i] * 0.01, time, audio.volume, 0.5, tp);
        color.setHSL(tp[0], tp[1], Math.min(0.68, (0.4 + audio.volume * 0.25 + nitro * 0.2) * Math.min(1.4, tp[2])));
        dashes.setColorAt(i, color);
      }
      dashes.instanceMatrix.needsUpdate = true;
      dashes.instanceColor.needsUpdate = true;

      // rails follow the curve near the camera
      for (const r of rails) {
        r.position.set(roadX(camZ - 40) + r.userData.side * (ROAD_W / 2 + 1.4), 0.3, camZ - 40);
        r.rotation.y = Math.atan2(roadX(camZ - 90) - roadX(camZ), 90) * 1.2;
        themePaint(colorMode, hue / 360, r.userData.side > 0 ? 0.8 : 0.2, camZ * 0.005, time, audio.mid, 0.4, tp);
        color.setHSL(tp[0], tp[1], Math.min(0.5, 0.22 + audio.mid * 0.2));
        r.material.color.copy(color);
      }

      // streetlights: poles + lamps that strobe on beats
      const lpn = lampGlow.geometry.attributes.position;
      const lcn = lampGlow.geometry.attributes.color;
      for (let i = 0; i < POLES; i++) {
        if (pz[i] > camZ + 12) pz[i] -= SPAN;
        const side = i % 2 ? 1 : -1;
        const x = roadX(pz[i]) + side * (ROAD_W / 2 + 2);
        dummy.position.set(x, 5.5, pz[i]);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);
        lpn.setXYZ(i, x - side * 2.4, 10.6, pz[i]);
        const flash = audio.beat ? 1.6 : 1;
        themePaint(colorMode, hue / 360, i / POLES, pz[i] * 0.008, time, audio.high, i / POLES, tp);
        color.setHSL(tp[0], tp[1] * 0.5, Math.min(0.7, (0.35 + audio.high * 0.3) * flash));
        lcn.setXYZ(i, color.r, color.g, color.b);
      }
      poles.instanceMatrix.needsUpdate = true;
      lpn.needsUpdate = true;
      lcn.needsUpdate = true;
      lampGlow.material.size = 8 + audio.beatIntensity * 5;

      // skyline crawls past slower (parallax) and lights with the bands
      for (let i = 0; i < BUILDINGS; i++) {
        if (bz[i] > camZ + 20) bz[i] -= SPAN;
        const level = audio[BANDS[bband[i]]];
        dummy.position.set(roadX(bz[i]) + bx[i], bh[i] / 2, bz[i]);
        dummy.scale.set(6 + (i % 4) * 2, bh[i], 7);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        buildings.setMatrixAt(i, dummy.matrix);
        const jitv = Math.abs(Math.sin(i * 12.99));
        themePaint(colorMode, (hue / 360 + bband[i] * 0.04) % 1, ((bx[i] / 140) + 0.5) % 1, bz[i] * 0.01, time, level, jitv, tp);
        color.setHSL(tp[0], tp[1] * 0.85, Math.min(0.6, (0.04 + level * 0.5) * Math.min(1.5, tp[2])));
        buildings.setColorAt(i, color);
      }
      buildings.instanceMatrix.needsUpdate = true;
      buildings.instanceColor.needsUpdate = true;

      // speed lines during nitro and hard beats
      if ((nitro > 0.25 || audio.beat) && Math.random() < dt * (6 + nitro * 20)) {
        const m = speedLines.find(x => !x.visible);
        if (m) {
          m.visible = true;
          m.userData.z = camZ - 90;
          m.userData.x = cx + (Math.random() - 0.5) * 26;
          m.userData.y = 1 + Math.random() * 7;
        }
      }
      for (const m of speedLines) {
        if (!m.visible) continue;
        m.userData.z += (speed + 160) * dt;
        if (m.userData.z > camZ + 6) { m.visible = false; continue; }
        m.position.set(m.userData.x, m.userData.y, m.userData.z);
        m.material.opacity = 0.8;
        color.setHSL(((hue / 360) + 0.5) % 1, 0.6, 0.7);
        color.multiplyScalar(1.4 + nitro);
        m.material.color.copy(color);
      }

      sky.position.copy(camera.position);
      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.energy, 0.5, tp);
      sky.material.color.setHSL(tp[0], tp[1] * 0.45, 0.2 + audio.energy * 0.12);

      const fovT = 78 + speed * 0.12 + nitro * 16;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      speedLines = [];
    },
  };
}
