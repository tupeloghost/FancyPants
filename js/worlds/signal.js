// SIGNAL — slow atmospheric drift through darkness. Monolith structures
// illuminate as their frequency band strikes them. Fog, mood, no timer.

import * as THREE from 'three';

const COUNT = 320;
const FIELD = 380;          // world size; camera wraps within it

const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

export function createSignal() {
  let scene, camera, group, monoliths;
  let drift = 0;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // per-monolith state
  const mx = new Float32Array(COUNT), mz = new Float32Array(COUNT);
  const mh = new Float32Array(COUNT);
  const mBand = new Uint8Array(COUNT);
  const mThresh = new Float32Array(COUNT);
  const mLit = new Float32Array(COUNT);     // current light level, decays
  const ping = { active: false, x: 0, z: 0, r: 0 };

  return {
    name: 'SIGNAL',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x02030a, 0.014);

      monoliths = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        COUNT
      );
      monoliths.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
      group.add(monoliths);

      for (let i = 0; i < COUNT; i++) {
        mx[i] = (Math.random() - 0.5) * FIELD;
        mz[i] = (Math.random() - 0.5) * FIELD;
        mh[i] = 4 + Math.pow(Math.random(), 2) * 30;
        mBand[i] = Math.floor(Math.random() * BANDS.length);
        mThresh[i] = 0.3 + Math.random() * 0.35;
        mLit[i] = 0;
      }

      camera.position.set(0, 9, 0);
      camera.fov = 72;
      camera.updateProjectionMatrix();
      drift = 0;
    },

    onTap() {
      // radar ping from the camera: a light wave rolls outward
      ping.active = true;
      ping.x = camera.position.x;
      ping.z = camera.position.z;
      ping.r = 0;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time } = opts;

      // slow drift forward, gentle heading wander; volume barely nudges speed
      drift += dt * (3 + audio.energy * 5);
      const heading = Math.sin(time * 0.05) * 0.8;
      camera.position.x += Math.sin(heading) * dt * (3 + audio.energy * 5);
      camera.position.z -= Math.cos(heading) * dt * (3 + audio.energy * 5);
      camera.position.y = 9 + Math.sin(time * 0.2) * 1.5;
      // wrap within the field
      if (camera.position.x > FIELD / 2) camera.position.x -= FIELD;
      if (camera.position.x < -FIELD / 2) camera.position.x += FIELD;
      if (camera.position.z > FIELD / 2) camera.position.z -= FIELD;
      if (camera.position.z < -FIELD / 2) camera.position.z += FIELD;
      camera.rotation.set(Math.sin(time * 0.11) * 0.06, -heading, Math.sin(time * 0.13) * 0.02);

      if (ping.active) {
        ping.r += 90 * dt;
        if (ping.r > FIELD) ping.active = false;
      }

      // strike + decay per monolith
      for (let i = 0; i < COUNT; i++) {
        const level = audio[BANDS[mBand[i]]];
        if (level > mThresh[i]) {
          mLit[i] = Math.max(mLit[i], Math.min(1, (level - mThresh[i]) * 3 * reactivity));
        }
        if (ping.active) {
          const d = Math.hypot(mx[i] - ping.x, mz[i] - ping.z);
          if (Math.abs(d - ping.r) < 14) mLit[i] = Math.max(mLit[i], 1 - Math.abs(d - ping.r) / 14);
        }
        mLit[i] *= Math.pow(0.25, dt);

        const pulse = 1 + mLit[i] * 0.12 + audio.beatIntensity * 0.05;
        dummy.position.set(mx[i], (mh[i] * pulse) / 2, mz[i]);
        dummy.scale.set(2.2, mh[i] * pulse, 2.2);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        monoliths.setMatrixAt(i, dummy.matrix);

        const bandShift = mBand[i] * 0.05;
        color.setHSL(
          ((hue / 360) + bandShift) % 1,
          0.75,
          0.03 + mLit[i] * 0.55
        );
        monoliths.setColorAt(i, color);
      }
      monoliths.instanceMatrix.needsUpdate = true;
      monoliths.instanceColor.needsUpdate = true;
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
