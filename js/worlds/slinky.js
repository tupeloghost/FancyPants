// SLINKY — a giant glowing slinky walking forever down an endless staircase.
// Coils compress with the bass, beats push it over the next step, and taps
// BOING it — a compression wave snaps down the whole spring.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const RINGS = 84;           // coils
const RING_R = 4.2;
const STEP_H = 5, STEP_D = 8;
const STAIRS = 26;

export function createSlinky() {
  let scene, camera, group, coils, stairs, edges, sky, dustF, spot;
  let impacts = [];
  let walk = 0, walkVel = 0;
  let boing = 0, landPulse = 0, lastStep = 0;
  const camPos = new THREE.Vector3(30, 0, 0);
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

      const coilGeo = new THREE.TorusGeometry(RING_R, 0.34, 12, 48);
      {
        // top-lit gloss baked into the coil so it reads as shiny plastic
        const pa = coilGeo.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const t = 0.62 + (pa.getY(i) / (RING_R + 0.34) + 1) * 0.24;
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        coilGeo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      }
      coils = new THREE.InstancedMesh(
        coilGeo,
        new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true }),
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

      // glowing strip on every stair nose — the staircase becomes a light
      // sculpture instead of dark boxes
      edges = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 0.18, 0.35),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        STAIRS
      );
      edges.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STAIRS * 3), 3);
      edges.frustumCulled = false;
      group.add(edges);

      // landing impact rings on the stair tops
      impacts = [];
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1, 40),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        m.userData = { life: 0 };
        group.add(m);
        impacts.push(m);
      }

      // soft spotlight pool traveling with the slinky
      spot = glowSprite(30);
      spot.material.opacity = 0.2;
      group.add(spot);

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
      landPulse *= Math.pow(0.03, dt);
      if (Math.floor(walk) !== lastStep) {
        lastStep = Math.floor(walk);
        landPulse = 1; // the slap of the spring hitting the next step
        const m = impacts.find(x => !x.visible) || impacts[0];
        m.visible = true;
        m.userData.life = 1;
        m.position.set(0, -lastStep * STEP_H + 0.12, -lastStep * STEP_D - STEP_D / 2);
        m.scale.setScalar(1.5);
      }
      for (const m of impacts) {
        if (!m.visible) continue;
        m.userData.life -= dt * 1.4;
        if (m.userData.life <= 0) { m.visible = false; continue; }
        m.scale.addScalar(dt * 30);
        themePaint(colorMode, hue / 360, 0.5, walk * 0.1, time, 1, 0.5, tp);
        color.setHSL(tp[0], tp[1], 0.55);
        m.material.color.copy(color);
        m.material.opacity = m.userData.life * 0.8;
      }

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
        const s = 1 + audio.bass * 0.12 * reactivity + boing * 0.15 * Math.sin(i * 0.8 - time * 9)
                + landPulse * 0.07 * Math.max(0, 1 - i * 0.06); // head squashes on landing
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        coils.setMatrixAt(i, dummy.matrix);

        // rainbow slinky by default; every theme paints the coil run
        const jitv = Math.abs(Math.sin(i * 12.9898));
        themePaint(colorMode, hue / 360, i / RINGS, walk * 0.1, time, audio.bass, jitv, tp);
        color.setHSL(tp[0], tp[1], Math.min(0.66, (0.3 + audio.volume * 0.25 + boing * 0.15 + landPulse * 0.08) * Math.min(1.5, tp[2])));
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
        const landing = n === base ? landPulse * 0.35 + audio.beatIntensity * 0.2 : 0;
        color.setHSL(tp[0], tp[1] * 0.7, Math.min(0.4, 0.045 + landing + audio.mid * 0.03));
        stairs.setColorAt(k, color);

        // the glowing nose strip on each step
        dummy.position.set(0, -n * STEP_H + 0.1, -n * STEP_D + 0.15);
        dummy.scale.set(26, 1, 1);
        dummy.updateMatrix();
        edges.setMatrixAt(k, dummy.matrix);
        themePaint(colorMode, hue / 360, ((n % 7) / 7), n * 0.2, time, audio.mid, jitv, tp);
        color.setHSL(tp[0], tp[1], Math.min(0.62, (0.25 + audio.mid * 0.3 + landing) * Math.min(1.4, tp[2])));
        edges.setColorAt(k, color);
      }
      stairs.instanceMatrix.needsUpdate = true;
      stairs.instanceColor.needsUpdate = true;
      edges.instanceMatrix.needsUpdate = true;
      edges.instanceColor.needsUpdate = true;

      // camera: full orbit around the slinky — every angle, always moving.
      // In play mode your pointer steers anywhere on the circle.
      pathAt(walk - RINGS * 0.026, P); // middle of the slinky
      const ang = (pointer.active && !attract)
        ? pointer.x * Math.PI + time * 0.02
        : time * 0.08;
      camPos.set(
        Math.cos(ang) * 33,
        P.y + 9 + Math.sin(time * 0.3) + landPulse * -1.2, // dip on landing
        P.z - 4 + Math.sin(ang) * 33
      );
      camera.position.lerp(camPos, Math.min(1, dt * 2.5));
      camera.lookAt(0, P.y + 3, P.z - 6);

      spot.position.set(0, P.y - 2, P.z - 4);
      spot.material.opacity = 0.14 + audio.volume * 0.12 + landPulse * 0.1;

      color.setHSL(((hue / 360) + 0.1) % 1, 0.6, 0.3 + audio.high * 0.3);
      dustF.material.color.copy(color);
      themePaint(colorMode, hue / 360, 0.3, walk * 0.1, time, audio.volume, 0.4, tp);
      spot.material.color.setHSL(tp[0], tp[1] * 0.7, 0.45);
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
