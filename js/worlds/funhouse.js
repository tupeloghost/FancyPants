// BALL PIT — a funhouse pit of glowing balls. Beats bounce the whole pit;
// taps blast balls away from where you click; drag to plow your own ball
// through the crowd. Pure play, no fail state.

import * as THREE from 'three';
import { glowTexture, skyDome } from '../lib/glow.js?v=572';
import { themePaint } from '../lib/themes.js?v=572';

const BALLS = 8000;
const PER_LAYER = 880;      // balls per stacking layer — full pit crests near the rim
const ARENA = 22;           // half-width of the pit
const WALL_H = 13;          // visible pit walls
const GRAV = -26;

export function createFunhouse() {
  let scene, camera, group, balls, floor, sky, walls;
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let pointer = { x: 0, y: 0, active: false };
  // first-person swim state
  const camVel = new THREE.Vector3();
  let camVelY = 0;              // vertical drift — the pit is nearly weightless
  const fwd = new THREE.Vector3();
  let yaw = 0, pitch = 0;

  const px = new Float32Array(BALLS), py = new Float32Array(BALLS), pz = new Float32Array(BALLS);
  const vx = new Float32Array(BALLS), vy = new Float32Array(BALLS), vz = new Float32Array(BALLS);
  const rad = new Float32Array(BALLS);
  const seed = new Float32Array(BALLS);
  const restY = new Float32Array(BALLS); // stacked rest height: no n2 collisions,
                                         // but the pile still fills the pit
  const homeX = new Float32Array(BALLS); // even home spread — the pit always
  const homeZ = new Float32Array(BALLS); // relaxes back to uniform, no clumps
  const me = 0; // ball #0 is the local player's
  let active = 240;          // taps add balls up to the full pool

  return {
    name: 'BALL PIT',
    options: ['balls'],

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

      active = 240;
      for (let i = 0; i < BALLS; i++) {
        px[i] = (Math.random() - 0.5) * ARENA * 1.8;
        pz[i] = (Math.random() - 0.5) * ARENA * 1.8;
        py[i] = 2 + Math.random() * 20;
        vx[i] = vy[i] = vz[i] = 0;
        rad[i] = 0.5 + Math.random() * 0.75;
        seed[i] = Math.random();
        restY[i] = rad[i] + Math.floor(i / PER_LAYER) * 0.95 + Math.random() * 1.6; // lumpy surface
        // jittered grid: fills the SQUARE pit corner to corner, every layer
        const k = i % PER_LAYER;
        const cols = 30;
        const cell = (ARENA * 2 - 2.4) / cols;
        homeX[i] = -ARENA + 1.2 + ((k % cols) + 0.15 + Math.random() * 0.7) * cell;
        homeZ[i] = -ARENA + 1.2 + (Math.floor(k / cols) % cols + 0.15 + Math.random() * 0.7) * cell;
      }
      rad[me] = 1.3; // the player's ball is a little bigger

      // the PIT: four translucent glowing walls with a bright rim, so the
      // space reads as a container, not a void
      walls = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const w = new THREE.Mesh(
          new THREE.PlaneGeometry(ARENA * 2, WALL_H),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0.1,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
          })
        );
        const rim = new THREE.Mesh(
          new THREE.BoxGeometry(ARENA * 2 + 0.6, 0.35, 0.35),
          new THREE.MeshBasicMaterial({ toneMapped: false })
        );
        const a = (i / 4) * Math.PI * 2;
        w.position.set(Math.sin(a) * ARENA, WALL_H / 2, Math.cos(a) * ARENA);
        w.rotation.y = a;
        rim.position.set(Math.sin(a) * ARENA, WALL_H, Math.cos(a) * ARENA);
        rim.rotation.y = a;
        walls.add(w, rim);
      }
      group.add(walls);

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

      camera.rotation.order = 'YXZ';
      camera.position.set(0, 6, ARENA * 0.7);
      yaw = 0; pitch = -0.05;
      camVel.set(0, 0, 0);
      camVelY = 0;
      camera.fov = 74;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    // fellow players are balls in the same pit
    placeGhost(p, i, out) {
      out.set(p.x * ARENA * 0.8, 2.5 + Math.abs(Math.sin((this._t || 0) * 1.3 + i * 2)) * 6, p.y * ARENA * 0.8);
    },

    // tap: DROP a handful of fresh balls from the sky at the click point,
    // and blast the ones already there
    onTap(x, y) {
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const t = (2 - camera.position.y) / (dir.y || -0.0001);
      const hx = Math.max(-ARENA, Math.min(ARENA, camera.position.x + dir.x * Math.abs(t)));
      const hz = Math.max(-ARENA, Math.min(ARENA, camera.position.z + dir.z * Math.abs(t)));
      // LUNGE: dive hard toward wherever you clicked
      camVel.addScaledVector(dir, 42);
      // spawn flash so adding balls is unmistakable
      this._flash = { x: hx, z: hz, t: 1 };
      for (let n = 0; n < 30; n++) {
        // grow the pool until it's full, then recycle random old balls
        const i = active < BALLS ? active++ : 1 + Math.floor(Math.random() * (BALLS - 1));
        px[i] = hx + (Math.random() - 0.5) * 6;
        pz[i] = hz + (Math.random() - 0.5) * 6;
        py[i] = 26 + Math.random() * 12;
        vx[i] = (Math.random() - 0.5) * 6;
        vy[i] = -4;
        vz[i] = (Math.random() - 0.5) * 6;
      }
      for (let i = 0; i < active; i++) {
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
      const { reactivity, hue, attract, time, colorMode = 'rainbow', balls: targetBalls = 240 } = opts;
      this._t = time;

      // the slider IS the pit: pour balls in from the sky to reach the
      // target, or quietly retire the extras
      if (active < targetBalls) {
        const add = Math.min(3, targetBalls - active); // steady pour, not a dump
        for (let n = 0; n < add; n++) {
          const i = active++;
          px[i] = (Math.random() - 0.5) * ARENA * 1.6;
          pz[i] = (Math.random() - 0.5) * ARENA * 1.6;
          py[i] = 30 + Math.random() * 10;
          vx[i] = (Math.random() - 0.5) * 4; vy[i] = -2; vz[i] = (Math.random() - 0.5) * 4;
        }
      } else if (active > targetBalls) {
        active = Math.max(targetBalls, 1);
      }

      // beats bounce the whole pit
      const kick = audio.beat ? 5 + audio.beatIntensity * 9 * reactivity : 0;

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
      balls.count = active;
      for (let i = 0; i < active; i++) {
        vy[i] += GRAV * step;
        if (kick && py[i] < restY[i] + rad[i] * 1.5) vy[i] += kick * (0.6 + seed[i] * 0.8);
        px[i] += vx[i] * step;
        py[i] += vy[i] * step;
        pz[i] += vz[i] * step;

        // floor + walls, springy
        if (py[i] < restY[i]) { py[i] = restY[i]; vy[i] = Math.abs(vy[i]) * 0.72; }
        if (py[i] > WALL_H + 6) vy[i] -= 30 * step; // gravity catches high fliers fast
        if (Math.abs(px[i]) > ARENA) { px[i] = Math.sign(px[i]) * ARENA; vx[i] *= -0.8; }
        if (Math.abs(pz[i]) > ARENA) { pz[i] = Math.sign(pz[i]) * ARENA; vz[i] *= -0.8; }
        // drift home: scattered balls settle back into an even pit
        vx[i] += (homeX[i] - px[i]) * step * 0.5;
        vz[i] += (homeZ[i] - pz[i]) * step * 0.5;
        vx[i] *= (1 - step * 0.7);
        vz[i] *= (1 - step * 0.7);

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

      // drop flash: the sky opens where the new balls pour in
      if (this._flash && this._flash.t > 0.02) {
        this._flash.t *= Math.pow(0.05, dt);
        if (!this._flashSprite) {
          this._flashSprite = new THREE.Mesh(
            new THREE.RingGeometry(0.9, 1, 40),
            new THREE.MeshBasicMaterial({
              toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending, depthWrite: false,
            })
          );
          this._flashSprite.rotation.x = -Math.PI / 2;
          group.add(this._flashSprite);
        }
        const fs = this._flashSprite;
        fs.visible = true;
        fs.position.set(this._flash.x, 24, this._flash.z);
        fs.scale.setScalar(3 + (1 - this._flash.t) * 22);
        themePaint(colorMode, hue / 360, 0.3, 0, time, 1, 0.5, tp);
        color.setHSL(tp[0], tp[1], 0.6);
        fs.material.color.copy(color);
        fs.material.opacity = this._flash.t * 0.9;
      } else if (this._flashSprite) {
        this._flashSprite.visible = false;
      }

      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.bass, 0.5, tp);
      color.setHSL(tp[0], tp[1] * 0.8, 0.3 + audio.bass * 0.2);
      floor.material.color.copy(color);
      for (let i = 0; i < walls.children.length; i++) {
        const el = walls.children[i];
        if (el.geometry.type === 'PlaneGeometry') {
          el.material.color.copy(color);
          el.material.opacity = 0.06 + audio.bass * 0.06 + audio.beatIntensity * 0.05;
        } else {
          color.setHSL(tp[0], tp[1], Math.min(0.62, 0.3 + audio.mid * 0.3));
          el.material.color.copy(color);
        }
      }
      floor.material.opacity = 0.26 + audio.bass * 0.2;
      sky.material.color.copy(color);

      // SWIM the pit: the mouse steers — weave with x, dive/climb with y —
      // while you glide forward through the balls. Clicks lunge you.
      if (!attract && pointer.active) {
        yaw -= pointer.x * dt * 1.7;
        pitch += (pointer.y * 0.85 - pitch) * Math.min(1, dt * 3);
      } else {
        yaw += dt * 0.12;
        pitch += (Math.sin(time * 0.17) * 0.25 - pitch) * Math.min(1, dt * 2);
      }
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      const swim = 4 + audio.volume * 3.5 * reactivity;
      camera.position.addScaledVector(fwd, swim * dt);
      camera.position.addScaledVector(camVel, dt);
      camVel.multiplyScalar(Math.max(0, 1 - dt * 2.2)); // lunge fades

      // height: you're BUOYANT in here, not falling through it. Steering up
      // and down is thrust, the ball pile floats you, and what little gravity
      // there is only sighs you back toward the crest.
      const pileTop2 = 1 + (active / PER_LAYER) * 0.95;
      const floatY = pileTop2 + 1.8;   // where you naturally hang
      if (!attract && pointer.active) camVelY += pointer.y * 20 * dt;   // thrust
      if (audio.beat) camVelY += 3.2 * reactivity;                      // beats bounce you
      const dY = camera.position.y - floatY;
      // below the crest the balls shoulder you up hard; above it you drift
      camVelY += (dY < 0 ? -dY * 6.5 : -dY * 0.5) * dt;
      camVelY *= Math.max(0, 1 - dt * 1.5);                             // swim-like drag
      camera.position.y += camVelY * dt;

      // soft walls: near the edge, the view bends back toward the pit —
      // you never end up staring at a wall
      const m2 = ARENA - 2;
      const cd = Math.hypot(camera.position.x, camera.position.z);
      if (cd > ARENA - 9) {
        const faceCenter = Math.atan2(camera.position.x, camera.position.z);
        let dy = faceCenter - yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        yaw += dy * Math.min(1, dt * (cd - (ARENA - 9)) * 0.55);
      }
      if (Math.abs(camera.position.x) > m2) camera.position.x = Math.sign(camera.position.x) * m2;
      if (Math.abs(camera.position.z) > m2) camera.position.z = Math.sign(camera.position.z) * m2;
      // you can rise right up to the rim and hang there
      if (camera.position.y > WALL_H - 0.8) { camera.position.y = WALL_H - 0.8; camVelY = Math.min(camVelY, 0); }
      if (camera.position.y < 1.6) { camera.position.y = 1.6; camVelY = Math.max(camVelY, 0); }

      camera.rotation.set(pitch * 0.5 - 0.22, yaw, Math.sin(time * 0.4) * 0.02 - pointer.x * 0.1 * (attract ? 0 : 1)); // gaze rests on the balls

      // nearby balls shoulder away from the lens so it never sits inside one
      for (let i = 0; i < active; i++) {
        const dx = px[i] - camera.position.x, dz = pz[i] - camera.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 4.5 && d > 0.01) {
          const f = (4.5 - d) * 5 * dt;
          vx[i] += (dx / d) * f;
          vz[i] += (dz / d) * f;
        }
      }
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
