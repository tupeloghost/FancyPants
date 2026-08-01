// SIGNAL — an endless flight down a dark monolith corridor. Structures are
// tuned to frequency bands and ignite as their band strikes; the floor
// mirrors them like wet ground. Fog, mood, no enemies, no timer.

import * as THREE from 'three';
import { glowPoints, skyDome } from '../lib/glow.js';

const COUNT = 340;
const SPAN = 520;           // corridor length before structures recycle ahead
const LANE_MIN = 11, LANE_MAX = 58;

const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

export function createSignal() {
  let scene, camera, group, monoliths, reflections, ground, dust, pingRing, sky;
  let travel = 0;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const mx = new Float32Array(COUNT), mz = new Float32Array(COUNT);
  const mh = new Float32Array(COUNT), mw = new Float32Array(COUNT);
  const mBand = new Uint8Array(COUNT);
  const mThresh = new Float32Array(COUNT);
  const mLit = new Float32Array(COUNT);
  const ping = { active: false, x: 0, z: 0, r: 0 };

  function laneX() {
    const side = Math.random() < 0.5 ? -1 : 1;
    return side * (LANE_MIN + Math.pow(Math.random(), 1.4) * (LANE_MAX - LANE_MIN));
  }

  return {
    name: 'SIGNAL',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x02030a, 0.010);

      const boxGeo = new THREE.BoxGeometry(1, 1, 1);
      const vc = new Float32Array(boxGeo.attributes.position.count * 3);
      for (let i = 0; i < boxGeo.attributes.position.count; i++) {
        const t = 0.25 + (boxGeo.attributes.position.getY(i) + 0.5) * 0.75;
        vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
      }
      boxGeo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      monoliths = new THREE.InstancedMesh(
        boxGeo,
        new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true }),
        COUNT
      );
      monoliths.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
      monoliths.frustumCulled = false;
      group.add(monoliths);

      ground = new THREE.Mesh(
        new THREE.PlaneGeometry(500, SPAN * 2),
        new THREE.MeshBasicMaterial({ color: 0x04050f, toneMapped: false, transparent: true, opacity: 0.72 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.05;
      group.add(ground);

      reflections = new THREE.InstancedMesh(
        monoliths.geometry,
        new THREE.MeshBasicMaterial({
          toneMapped: false, transparent: true, opacity: 0.28, vertexColors: true,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
        COUNT
      );
      reflections.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
      reflections.frustumCulled = false;
      group.add(reflections);

      const dp = new Float32Array(700 * 3);
      for (let i = 0; i < 700; i++) {
        dp[i * 3] = (Math.random() - 0.5) * 260;
        dp[i * 3 + 1] = 1 + Math.random() * 34;
        dp[i * 3 + 2] = -Math.random() * SPAN;
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      dust = new THREE.Points(dg, glowPoints(0.8, 0.5));
      dust.frustumCulled = false;
      group.add(dust);

      pingRing = new THREE.Mesh(
        new THREE.RingGeometry(0.96, 1, 64),
        new THREE.MeshBasicMaterial({
          toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      pingRing.rotation.x = -Math.PI / 2;
      pingRing.position.y = 0.3;
      group.add(pingRing);

      sky = skyDome(340);
      group.add(sky);

      for (let i = 0; i < COUNT; i++) {
        mx[i] = laneX();
        mz[i] = -Math.random() * SPAN;
        mh[i] = 6 + Math.pow(Math.random(), 2) * 58;
        mw[i] = 1.8 + Math.random() * 2.6;
        mBand[i] = Math.floor(Math.random() * BANDS.length);
        mThresh[i] = 0.28 + Math.random() * 0.35;
        mLit[i] = 0;
      }

      travel = 0;
      camera.position.set(0, 9, 0);
      camera.rotation.set(0, 0, 0);
      camera.fov = 74;
      camera.updateProjectionMatrix();
    },

    onTap() {
      ping.active = true;
      ping.x = camera.position.x;
      ping.z = camera.position.z;
      ping.r = 0;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time } = opts;

      // constant forward flight — faster when the music surges
      const speed = 9 + audio.energy * 26 * reactivity + audio.volume * 8;
      travel += speed * dt;
      const wander = Math.sin(travel * 0.01) * 7;
      camera.position.set(wander, 6.5 + Math.sin(time * 0.2) * 1.5, -travel);
      camera.rotation.set(
        Math.sin(time * 0.11) * 0.04,
        Math.sin(travel * 0.01) * -0.12,
        Math.sin(travel * 0.013) * -0.05   // banking into the drift
      );
      const fovT = 74 + audio.volume * 8 * reactivity + audio.beatIntensity * 4;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();

      if (ping.active) {
        ping.r += 110 * dt;
        if (ping.r > SPAN) ping.active = false;
        pingRing.position.x = ping.x;
        pingRing.position.z = ping.z;
        pingRing.scale.setScalar(Math.max(0.01, ping.r));
        color.setHSL(((hue / 360) + 0.12) % 1, 0.9, 0.55);
        pingRing.material.color.copy(color);
        pingRing.material.opacity = Math.max(0, 0.7 * (1 - ping.r / SPAN));
      } else {
        pingRing.material.opacity = 0;
      }

      // beats sparkle a handful of structures down the corridor
      let sparkle = 0;
      if (audio.beat) sparkle = 10 + Math.floor(audio.beatIntensity * 14);

      const camZ = camera.position.z;
      for (let i = 0; i < COUNT; i++) {
        // recycle structures that fall behind into the darkness ahead
        if (mz[i] > camZ + 25) {
          mz[i] -= SPAN;
          mx[i] = laneX();
          mh[i] = 6 + Math.pow(Math.random(), 2) * 58;
          mw[i] = 1.8 + Math.random() * 2.6;
          mBand[i] = Math.floor(Math.random() * BANDS.length);
          mThresh[i] = 0.28 + Math.random() * 0.35;
          mLit[i] = 0;
        }

        const level = audio[BANDS[mBand[i]]];
        if (level > mThresh[i]) {
          mLit[i] = Math.max(mLit[i], Math.min(1, (level - mThresh[i]) * 3 * reactivity));
        }
        if (sparkle > 0 && Math.random() < sparkle / COUNT * 3) {
          mLit[i] = Math.max(mLit[i], 0.4 + audio.beatIntensity * 0.5);
          sparkle--;
        }
        if (ping.active) {
          const d = Math.hypot(mx[i] - ping.x, mz[i] - ping.z);
          if (Math.abs(d - ping.r) < 16) mLit[i] = Math.max(mLit[i], 1 - Math.abs(d - ping.r) / 16);
        }
        mLit[i] *= Math.pow(0.25, dt);

        const pulse = 1 + mLit[i] * 0.12 + audio.beatIntensity * 0.05;
        dummy.position.set(mx[i], (mh[i] * pulse) / 2, mz[i]);
        dummy.scale.set(mw[i], mh[i] * pulse, mw[i]);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        monoliths.setMatrixAt(i, dummy.matrix);

        dummy.position.y = -dummy.position.y;
        dummy.scale.y = -dummy.scale.y;
        dummy.updateMatrix();
        reflections.setMatrixAt(i, dummy.matrix);

        const bandShift = mBand[i] * 0.05;
        color.setHSL(((hue / 360) + bandShift) % 1, 0.8, 0.05 + mLit[i] * 0.65);
        monoliths.setColorAt(i, color);
        reflections.setColorAt(i, color);
      }
      monoliths.instanceMatrix.needsUpdate = true;
      monoliths.instanceColor.needsUpdate = true;
      reflections.instanceMatrix.needsUpdate = true;
      reflections.instanceColor.needsUpdate = true;

      // dust wraps around the camera; shimmers with the highs
      const dpos = dust.geometry.attributes.position;
      for (let i = 0; i < dpos.count; i++) {
        const z = dpos.getZ(i);
        if (z > camZ + 20) dpos.setZ(i, z - SPAN);
      }
      dpos.needsUpdate = true;
      color.setHSL(((hue / 360) + 0.1) % 1, 0.6, 0.3 + audio.high * 0.4);
      dust.material.color.copy(color);
      dust.material.size = 0.8 + audio.high * 0.7;

      // ground + sky ride along; floor flashes faintly on beats
      ground.position.z = camZ - SPAN / 2;
      ground.material.color.setHSL((hue / 360) % 1, 0.5, 0.015 + audio.beatIntensity * 0.02);
      sky.position.copy(camera.position);
      color.setHSL(((hue / 360) + 0.02) % 1, 0.6, 0.22 + audio.energy * 0.2);
      sky.material.color.copy(color);
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
