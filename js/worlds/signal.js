// SIGNAL — slow atmospheric drift through darkness. Monolith structures
// illuminate as their frequency band strikes them. Fog, mood, no timer.

import * as THREE from 'three';
import { glowPoints, skyDome } from '../lib/glow.js';

const COUNT = 320;
const FIELD = 380;          // world size; camera wraps within it

const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

export function createSignal() {
  let scene, camera, group, monoliths, reflections, ground, dust, pingRing, sky;
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

      // vertical gradient baked into vertex colors — multiplies with the
      // per-instance color, so monoliths glow from the ground up instead of
      // reading as flat boxes
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
      group.add(monoliths);

      // dark ground so the field reads as a place, not a void
      ground = new THREE.Mesh(
        new THREE.PlaneGeometry(FIELD * 2, FIELD * 2),
        new THREE.MeshBasicMaterial({ color: 0x04050f, toneMapped: false, transparent: true, opacity: 0.72 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.05;
      group.add(ground);

      // mirrored monoliths under the floor — wet-ground reflection
      reflections = new THREE.InstancedMesh(
        monoliths.geometry,
        new THREE.MeshBasicMaterial({
          toneMapped: false, transparent: true, opacity: 0.28, vertexColors: true,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
        COUNT
      );
      reflections.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
      group.add(reflections);

      // dust motes hanging in the fog
      const dp = new Float32Array(700 * 3);
      for (let i = 0; i < 700; i++) {
        dp[i * 3] = (Math.random() - 0.5) * FIELD;
        dp[i * 3 + 1] = 1 + Math.random() * 28;
        dp[i * 3 + 2] = (Math.random() - 0.5) * FIELD;
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      dust = new THREE.Points(dg, glowPoints(0.8, 0.5));
      group.add(dust);

      // visible ping ring rolling across the floor
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

      // sky follows the drifting camera; very dim — SIGNAL stays moody
      sky.position.copy(camera.position);
      color.setHSL(((hue / 360) + 0.02) % 1, 0.6, 0.22 + audio.energy * 0.2);
      sky.material.color.copy(color);

      if (ping.active) {
        ping.r += 90 * dt;
        if (ping.r > FIELD) ping.active = false;
        pingRing.position.x = ping.x;
        pingRing.position.z = ping.z;
        pingRing.scale.setScalar(Math.max(0.01, ping.r));
        color.setHSL(((hue / 360) + 0.12) % 1, 0.9, 0.55);
        pingRing.material.color.copy(color);
        pingRing.material.opacity = Math.max(0, 0.7 * (1 - ping.r / FIELD));
      } else {
        pingRing.material.opacity = 0;
      }

      // beats sparkle a random handful of monoliths across the field
      let sparkle = 0;
      if (audio.beat) sparkle = 10 + Math.floor(audio.beatIntensity * 14);

      // strike + decay per monolith
      for (let i = 0; i < COUNT; i++) {
        if (sparkle > 0 && Math.random() < sparkle / COUNT * 3) {
          mLit[i] = Math.max(mLit[i], 0.4 + audio.beatIntensity * 0.5);
          sparkle--;
        }
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

        // mirror below the floor
        dummy.position.y = -dummy.position.y;
        dummy.scale.y = -dummy.scale.y;
        dummy.updateMatrix();
        reflections.setMatrixAt(i, dummy.matrix);

        const bandShift = mBand[i] * 0.05;
        color.setHSL(
          ((hue / 360) + bandShift) % 1,
          0.8,
          0.05 + mLit[i] * 0.65
        );
        monoliths.setColorAt(i, color);
        reflections.setColorAt(i, color);
      }
      monoliths.instanceMatrix.needsUpdate = true;
      monoliths.instanceColor.needsUpdate = true;
      reflections.instanceMatrix.needsUpdate = true;
      reflections.instanceColor.needsUpdate = true;

      // dust shimmers with the highs
      color.setHSL(((hue / 360) + 0.1) % 1, 0.6, 0.3 + audio.high * 0.4);
      dust.material.color.copy(color);
      dust.material.size = 0.8 + audio.high * 0.7;
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
