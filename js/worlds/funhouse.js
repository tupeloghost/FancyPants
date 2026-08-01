// BALL PIT — a funhouse pit of glowing balls. Beats bounce the whole pit;
// taps blast balls away from where you click; drag to plow your own ball
// through the crowd. Pure play, no fail state.

import * as THREE from 'three';
import { glowTexture, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const BALLS = 170;
const ARENA = 30;           // half-width of the pit
const GRAV = -26;

export function createFunhouse() {
  let scene, camera, group, balls, floor, sky;
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let pointer = { x: 0, y: 0, active: false };

  const px = new Float32Array(BALLS), py = new Float32Array(BALLS), pz = new Float32Array(BALLS);
  const vx = new Float32Array(BALLS), vy = new Float32Array(BALLS), vz = new Float32Array(BALLS);
  const rad = new Float32Array(BALLS);
  const seed = new Float32Array(BALLS);
  const me = 0; // ball #0 is the local player's

  return {
    name: 'BALL PIT',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x030308, 0.012);

      const geo = new THREE.SphereGeometry(1, 14, 14);
      // baked top-light so the balls read as round, not flat discs
      {
        const pa = geo.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const t = 0.55 + (pa.getY(i) + 1) * 0.3;
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      }
      balls = new THREE.InstancedMesh(
        geo,
        new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true }),
        BALLS
      );
      balls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BALLS * 3), 3);
      balls.frustumCulled = false;
      group.add(balls);

      for (let i = 0; i < BALLS; i++) {
        px[i] = (Math.random() - 0.5) * ARENA * 1.8;
        pz[i] = (Math.random() - 0.5) * ARENA * 1.8;
        py[i] = 2 + Math.random() * 20;
        vx[i] = vy[i] = vz[i] = 0;
        rad[i] = 1.1 + Math.random() * 1.5;
        seed[i] = Math.random();
      }
      rad[me] = 2.1; // the player's ball is a little bigger

      // soft pool of light under the pit
      floor = new THREE.Mesh(
        new THREE.CircleGeometry(ARENA * 1.9, 48),
        new THREE.MeshBasicMaterial({
          map: glowTexture(), toneMapped: false, transparent: true, opacity: 0.32,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      floor.rotation.x = -Math.PI / 2;
      group.add(floor);

      sky = skyDome(240);
      group.add(sky);

      camera.fov = 72;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    // fellow players are balls in the same pit
    placeGhost(p, i, out) {
      out.set(p.x * ARENA * 0.8, 2.5 + Math.abs(Math.sin((this._t || 0) * 1.3 + i * 2)) * 6, p.y * ARENA * 0.8);
    },

    // tap: blast — balls near the click point fly away from it
    onTap(x, y) {
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const t = (2 - camera.position.y) / (dir.y || -0.0001);
      const hx = camera.position.x + dir.x * Math.abs(t);
      const hz = camera.position.z + dir.z * Math.abs(t);
      for (let i = 0; i < BALLS; i++) {
        const dx = px[i] - hx, dz = pz[i] - hz;
        const d = Math.hypot(dx, dz);
        if (d < 16) {
          const f = (1 - d / 16) * 34;
          vx[i] += (dx / (d || 1)) * f;
          vz[i] += (dz / (d || 1)) * f;
          vy[i] += f * 0.8;
        }
      }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      this._t = time;

      // beats bounce the whole pit
      const kick = audio.beat ? 7 + audio.beatIntensity * 16 * reactivity : 0;

      // player ball chases the pointer
      if (!attract && pointer.active) {
        const tx = pointer.x * ARENA * 0.9;
        const tz = -pointer.y * ARENA * 0.6;
        vx[me] += (tx - px[me]) * dt * 14;
        vz[me] += (tz - pz[me]) * dt * 14;
      }
      if (participants && participants[0]) {
        participants[0].x = px[me] / (ARENA * 0.8);
        participants[0].y = pz[me] / (ARENA * 0.8);
      }

      const step = Math.min(dt, 0.033);
      for (let i = 0; i < BALLS; i++) {
        vy[i] += GRAV * step;
        if (kick && py[i] < rad[i] * 2.5) vy[i] += kick * (0.6 + seed[i] * 0.8);
        px[i] += vx[i] * step;
        py[i] += vy[i] * step;
        pz[i] += vz[i] * step;

        // floor + walls, springy
        if (py[i] < rad[i]) { py[i] = rad[i]; vy[i] = Math.abs(vy[i]) * 0.72; }
        if (Math.abs(px[i]) > ARENA) { px[i] = Math.sign(px[i]) * ARENA; vx[i] *= -0.8; }
        if (Math.abs(pz[i]) > ARENA) { pz[i] = Math.sign(pz[i]) * ARENA; vz[i] *= -0.8; }
        vx[i] *= (1 - step * 0.6);
        vz[i] *= (1 - step * 0.6);

        // squash on landing, stretch in flight
        const squash = py[i] <= rad[i] + 0.05 && Math.abs(vy[i]) > 2 ? 0.8 : 1 + Math.min(0.25, Math.abs(vy[i]) * 0.006);
        dummy.position.set(px[i], py[i], pz[i]);
        dummy.scale.set(rad[i] / squash ** 0.5, rad[i] * squash, rad[i] / squash ** 0.5);
        dummy.rotation.set(0, seed[i] * 6 + time * 0.2, 0);
        dummy.updateMatrix();
        balls.setMatrixAt(i, dummy.matrix);

        const energy = Math.min(1, (Math.abs(vy[i]) + Math.abs(vx[i]) + Math.abs(vz[i])) / 26);
        themePaint(colorMode, hue / 360, seed[i], py[i] * 0.04, time, energy, seed[i], tp);
        const boost = i === me ? 1.3 : 1;
        color.setHSL(tp[0], tp[1], Math.min(0.72, (0.22 + energy * 0.35 + audio.beatIntensity * 0.1) * Math.min(1.6, tp[2]) * boost));
        balls.setColorAt(i, color);
      }
      balls.instanceMatrix.needsUpdate = true;
      balls.instanceColor.needsUpdate = true;

      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.bass, 0.5, tp);
      color.setHSL(tp[0], tp[1] * 0.8, 0.3 + audio.bass * 0.2);
      floor.material.color.copy(color);
      floor.material.opacity = 0.26 + audio.bass * 0.2;
      sky.material.color.copy(color);

      // camera circles the pit, dipping with the bass
      const r = 44 - audio.bass * 5;
      camera.position.set(Math.sin(time * 0.06) * r, 17 + Math.sin(time * 0.1) * 4 - audio.bass * 3, Math.cos(time * 0.06) * r);
      camera.lookAt(0, 4, 0);
      const fovT = 72 + audio.volume * 8 * reactivity + audio.beatIntensity * 4;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
