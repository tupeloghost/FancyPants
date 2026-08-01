// SLINKY — a giant glowing slinky walking forever down an endless staircase.
// Coils compress with the bass, beats push it over the next step, and taps
// BOING it — a compression wave snaps down the whole spring.

import * as THREE from 'three';
import { glowPoints, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const RINGS = 84;           // coils
const RING_R = 4.2;
const STEP_H = 5, STEP_D = 8;
const STAIRS = 26;

export function createSlinky() {
  let scene, camera, group, coils, stairs, sky, dustF;
  let walk = 0, walkVel = 0;
  let boing = 0;
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const P = new THREE.Vector3(), P2 = new THREE.Vector3(), TAN = new THREE.Vector3();
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion();
  let pointer = { x: 0, active: false };

  // slinky end-over-end path: each unit of p is one stair
  function pathAt(p, out) {
    const n = Math.floor(p);
    const f = p - n;
    out.set(
      0,
      -n * STEP_H - f * STEP_H + Math.sin(f * Math.PI) * (STEP_H * 1.15),
      -n * STEP_D - f * STEP_D
    );
    return out;
  }

  return {
    name: 'SLINKY',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x04030a, 0.011);

      coils = new THREE.InstancedMesh(
        new THREE.TorusGeometry(RING_R, 0.22, 10, 42),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        RINGS
      );
      coils.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * 3), 3);
      coils.frustumCulled = false;
      group.add(coils);

      // the endless staircase
      stairs = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        STAIRS
      );
      stairs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STAIRS * 3), 3);
      stairs.frustumCulled = false;
      group.add(stairs);

      // drifting sparkle in the stairwell
      const dp = new Float32Array(200 * 3);
      for (let i = 0; i < 200; i++) {
        dp[i * 3] = (Math.random() - 0.5) * 70;
        dp[i * 3 + 1] = (Math.random() - 0.5) * 90;
        dp[i * 3 + 2] = (Math.random() - 0.5) * 160;
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      dustF = new THREE.Points(dg, glowPoints(0.6, 0.5));
      dustF.frustumCulled = false;
      group.add(dustF);

      sky = skyDome(280);
      group.add(sky);

      walk = 2; walkVel = 0; boing = 0;
      camera.fov = 66;
      camera.updateProjectionMatrix();
    },

    setInput(x) { pointer.x = x; pointer.active = true; },

    // fellow slinkies-in-spirit: motes hopping down neighboring stair lines
    placeGhost(p, i, out) {
      const gp = walk - 3 - (i % 5) * 1.3;
      pathAt(gp, out);
      out.x += (i % 2 ? 1 : -1) * (12 + (i % 4) * 3) + p.x * 4;
      out.y += 2;
    },

    // tap: BOING — a compression wave snaps through the spring
    onTap() {
      boing = 1;
      walkVel += 0.8;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;

      if (participants && participants[0]) {
        participants[0].x = pointer.active ? pointer.x : Math.sin(time * 0.3) * 0.3;
        participants[0].y = 0;
      }

      // the walk: constant amble + beats shove it over the lip
      const targetVel = 0.35 + audio.volume * 0.9 * reactivity;
      walkVel += (targetVel - walkVel) * Math.min(1, dt * 2);
      if (audio.beat) walkVel += audio.beatIntensity * 0.9 * reactivity;
      walk += walkVel * dt;
      boing *= Math.pow(0.04, dt);

      // coils: phase-offset copies along the path, compression waves running
      // through the spacing (bass breathes it, boing snaps it)
      for (let i = 0; i < RINGS; i++) {
        const squeeze =
          Math.sin(walk * 2.2 - i * 0.31) * (0.012 + audio.bass * 0.02 * reactivity) +
          Math.sin(time * 9 - i * 0.8) * boing * 0.028;
        const p = walk - i * (0.052 + squeeze * 0.5) - 0.0001;
        pathAt(p, P);
        pathAt(p + 0.02, P2);
        TAN.subVectors(P2, P).normalize();
        quat.setFromUnitVectors(Z_AXIS, TAN);
        dummy.position.copy(P);
        dummy.position.y += RING_R + 0.4;
        dummy.quaternion.copy(quat);
        const s = 1 + audio.bass * 0.12 * reactivity + boing * 0.15 * Math.sin(i * 0.8 - time * 9);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        coils.setMatrixAt(i, dummy.matrix);

        // rainbow slinky by default; every theme paints the coil run
        const jitv = Math.abs(Math.sin(i * 12.9898));
        themePaint(colorMode, hue / 360, i / RINGS, walk * 0.1, time, audio.bass, jitv, tp);
        color.setHSL(tp[0], tp[1], Math.min(0.66, (0.3 + audio.volume * 0.25 + boing * 0.15) * Math.min(1.5, tp[2])));
        coils.setColorAt(i, color);
      }
      coils.instanceMatrix.needsUpdate = true;
      coils.instanceColor.needsUpdate = true;

      // stairs march under it; the landing step flashes
      const base = Math.floor(walk);
      for (let k = 0; k < STAIRS; k++) {
        const n = base - 6 + k;
        dummy.position.set(0, -n * STEP_H - STEP_H / 2, -n * STEP_D - STEP_D / 2);
        dummy.scale.set(26, STEP_H, STEP_D);
        dummy.rotation.set(0, 0, 0);
        dummy.quaternion.setFromEuler(new THREE.Euler(0, 0, 0));
        dummy.updateMatrix();
        stairs.setMatrixAt(k, dummy.matrix);
        const jitv = Math.abs(Math.sin(n * 7.31));
        themePaint(colorMode, hue / 360, 0.15 + jitv * 0.2, n * 0.15, time, audio.mid, jitv, tp);
        const landing = n === base ? 0.25 + audio.beatIntensity * 0.3 : 0;
        color.setHSL(tp[0], tp[1] * 0.7, Math.min(0.4, 0.045 + landing + audio.mid * 0.03));
        stairs.setColorAt(k, color);
      }
      stairs.instanceMatrix.needsUpdate = true;
      stairs.instanceColor.needsUpdate = true;

      // camera: side-on, gliding down with the head of the spring
      pathAt(walk - RINGS * 0.026, P); // middle of the slinky
      const camX = 30 + (pointer.active && !attract ? pointer.x * 10 : Math.sin(time * 0.15) * 6);
      camera.position.set(camX, P.y + 10 + Math.sin(time * 0.3), P.z + 16);
      camera.lookAt(0, P.y + 3, P.z - 6);

      color.setHSL(((hue / 360) + 0.1) % 1, 0.6, 0.3 + audio.high * 0.3);
      dustF.material.color.copy(color);
      dustF.position.y = P.y;
      dustF.position.z = P.z;
      sky.position.copy(camera.position);
      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.energy, 0.5, tp);
      sky.material.color.setHSL(tp[0], tp[1] * 0.5, 0.22 + audio.energy * 0.15);

      const fovT = 66 + audio.volume * 8 * reactivity + boing * 6;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
