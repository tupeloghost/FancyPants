// BLACKTOP — night street racing. Low camera, neon lane lines rushing past,
// streetlights strobing overhead, speed riding the volume. Tap = NITRO.
// Ghosts are rival cars ahead of you.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=109';
import { themePaint } from '../lib/themes.js?v=109';

const DASHES = 46;
const RAILSEGS = 120;
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
  const rlz = new Float32Array(RAILSEGS);
  const dlane = new Int8Array(DASHES);
  const pz = new Float32Array(POLES);
  const bz = new Float32Array(BUILDINGS), bx = new Float32Array(BUILDINGS);
  const bh = new Float32Array(BUILDINGS), bband = new Uint8Array(BUILDINGS);
  let speedLines = [];
  let ufo = null, ufoT = -1, ufoNext = 12, ufoLights = null;
  let cow = null, beam = null, abduct = { z: 0, x: 0, on: false, target: -2, p2: 0 };
  // abduct.target: -2 = the cow, -1 = YOU, >=0 = that ghost gets taken
  let nitroClock = 0, survived = false;

  const roadX = z => Math.sin(z * 0.008) * 26;
  const roadYaw = z => Math.atan2(roadX(z - 8) - roadX(z + 8), 16);

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

      // guard rails: short segments that FOLLOW the curve (a straight beam
      // through a bending road reads as a broken line)
      rails = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.28, 0.5, 6.4),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        RAILSEGS
      );
      rails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RAILSEGS * 3), 3);
      rails.frustumCulled = false;
      group.add(rails);
      for (let i = 0; i < RAILSEGS; i++) rlz[i] = -(i % (RAILSEGS / 2)) * (SPAN / (RAILSEGS / 2));

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

      // the UFO: saucer + dome + running lights, visits now and then
      ufo = new THREE.Group();
      const saucer = new THREE.Mesh(
        new THREE.SphereGeometry(4, 24, 12),
        new THREE.MeshBasicMaterial({ color: 0x14141f, toneMapped: false })
      );
      saucer.scale.y = 0.26;
      const domeTop = new THREE.Mesh(
        new THREE.SphereGeometry(1.7, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.85 })
      );
      domeTop.position.y = 0.7;
      const halo = glowSprite(16);
      halo.material.opacity = 0.35;
      const lp2 = new Float32Array(10 * 3);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        lp2[i * 3] = Math.cos(a) * 3.6; lp2[i * 3 + 1] = -0.2; lp2[i * 3 + 2] = Math.sin(a) * 3.6;
      }
      const lg2 = new THREE.BufferGeometry();
      lg2.setAttribute('position', new THREE.BufferAttribute(lp2, 3));
      lg2.setAttribute('color', new THREE.BufferAttribute(new Float32Array(10 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      ufoLights = new THREE.Points(lg2, glowPoints(1.6, 0.95));
      ufoLights.material.vertexColors = true;
      ufo.add(saucer, domeTop, halo, ufoLights);
      ufo.visible = false;
      group.add(ufo);
      ufoT = -1; ufoNext = 10 + Math.random() * 15;

      // the cow. every great highway needs one.
      cow = new THREE.Group();
      const cowMat = new THREE.MeshBasicMaterial({ color: 0xd8d8e0, toneMapped: false });
      const spotMat = new THREE.MeshBasicMaterial({ color: 0x1a1a22, toneMapped: false });
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 1.2), cowMat);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.7), cowMat);
      head.position.set(1.5, 0.5, 0);
      const spot1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.25), spotMat);
      spot1.position.set(-0.5, 0.3, 0);
      const spot2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 1.22), spotMat);
      spot2.position.set(0.6, -0.2, 0);
      cow.add(body, head, spot1, spot2);
      for (let l = 0; l < 4; l++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.28), spotMat);
        leg.position.set(l < 2 ? 0.9 : -0.9, -1.05, l % 2 ? 0.35 : -0.35);
        cow.add(leg);
      }
      cow.visible = false;
      group.add(cow);

      // the tractor beam
      beam = new THREE.Mesh(
        new THREE.ConeGeometry(4.2, 1, 24, 1, true),
        new THREE.MeshBasicMaterial({
          toneMapped: false, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      beam.visible = false;
      group.add(beam);

      sky = skyDome(340);
      group.add(sky);

      travel = 0; nitro = 0; steer = 0;
      camera.fov = 78;
      camera.updateProjectionMatrix();
    },

    setInput(x) { steerTarget = x; },

    // rivals: glowing cars in the lanes ahead, taillights to you
    placeGhost(p, i, out) {
      // the beam takes whoever it takes — everyone watches them rise and spin
      if (abduct.on && abduct.target === i) {
        out.set(abduct.x + Math.sin(abduct.p2 * 25) * 0.7, 1.6 + abduct.p2 * 20, abduct.z);
        return;
      }
      const z = camera.position.z - 22 - (i % 7) * 14;
      out.set(roadX(z) + (((i % 3) - 1) * 7) + p.x * 3, 1.6, z);
    },

    onTap() { nitro = 1; }, // NITRO (hold the mouse to keep it floored)

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;

      // hold to keep the nitro pinned; release and it bleeds off
      if (opts.holding && !attract) nitro = 1;
      else nitro *= Math.pow(0.25, dt);
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

      // when the beam has YOU: lifted, spun, dropped back on the asphalt
      if (abduct.on && abduct.target === -1) {
        const lift = Math.sin(abduct.p2 * Math.PI) * 12;
        camera.position.y += lift;
        camera.rotation.z += Math.sin(time * 6) * 0.06 * (lift / 12);
        camera.rotation.y += Math.sin(abduct.p2 * 9) * 0.12 * (lift / 12);
      }

      // nitro discipline pays: +2 for every full second floored
      if (nitro > 0.7 && !attract) {
        nitroClock += dt;
        if (nitroClock >= 1) { nitroClock = 0; if (opts.addScore) opts.addScore(2); }
      } else nitroClock = 0;

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
        dummy.rotation.set(0, roadYaw(dz[i]), 0); // turn with the road
        dummy.scale.set(1, 1, 1 + speed * 0.012); // stretch with speed
        dummy.updateMatrix();
        dashes.setMatrixAt(i, dummy.matrix);
        themePaint(colorMode, hue / 360, 0.5 + dlane[i] * 0.2, dz[i] * 0.01, time, audio.volume, 0.5, tp);
        color.setHSL(tp[0], tp[1], Math.min(0.68, (0.4 + audio.volume * 0.25 + nitro * 0.2) * Math.min(1.4, tp[2])));
        dashes.setColorAt(i, color);
      }
      dashes.instanceMatrix.needsUpdate = true;
      dashes.instanceColor.needsUpdate = true;

      // rail segments hug the curve on both sides
      for (let i = 0; i < RAILSEGS; i++) {
        if (rlz[i] > camZ + 10) rlz[i] -= SPAN;
        const side = i % 2 ? 1 : -1;
        const z = rlz[i];
        dummy.position.set(roadX(z) + side * (ROAD_W / 2 + 1.4), 0.3, z);
        dummy.rotation.set(0, roadYaw(z), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        rails.setMatrixAt(i, dummy.matrix);
        themePaint(colorMode, hue / 360, side > 0 ? 0.8 : 0.2, z * 0.005, time, audio.mid, 0.4, tp);
        color.setHSL(tp[0], tp[1], Math.min(0.5, 0.2 + audio.mid * 0.2));
        rails.setColorAt(i, color);
      }
      rails.instanceMatrix.needsUpdate = true;
      rails.instanceColor.needsUpdate = true;

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

      // UFO visits: swoops across the skyline, wobbles, slips away
      if (ufoT < 0) {
        ufoNext -= dt;
        if (ufoNext <= 0) {
          ufoT = 0; ufo.visible = true; ufo.userData.side = Math.random() < 0.5 ? -1 : 1;
          // who's getting taken this time? cow, a ghost, or YOU
          const ghosts = participants ? participants.length - 1 : 0;
          const r = Math.random();
          abduct.target = r < 0.4 ? -2 : ghosts > 0 ? Math.floor(Math.random() * ghosts) : -1;
          survived = false;
        }
      } else {
        ufoT += dt / 9; // ~9s visit
        if (ufoT >= 1) {
          ufoT = -1; ufo.visible = false; beam.visible = false; cow.visible = false; abduct.on = false;
          ufoNext = 14 + Math.random() * 22;
          if (survived && opts.addScore) opts.addScore(40); // rode the beam, lived to race
        }
        else {
          const side = ufo.userData.side;
          const swoop = Math.sin(ufoT * Math.PI); // in and out
          // mid-visit: STOP, beam, and take the cow
          const abducting = ufoT > 0.35 && ufoT < 0.78;
          if (abducting && !abduct.on) {
            abduct.on = true;
            abduct.z = camZ - 130;
            abduct.x = roadX(abduct.z) + side * 24;
          }
          if (!abducting) abduct.on = false;
          if (abducting) {
            const p2 = (ufoT - 0.35) / 0.43; // 0..1 through the abduction
            abduct.p2 = p2;
            if (abduct.target === -1) {
              // it's coming for YOU — the beam keeps pace with the car
              abduct.x = camera.position.x;
              abduct.z = camera.position.z - 6;
              survived = true;
            }
            ufo.position.set(
              abduct.x + Math.sin(time * 1.6) * 0.8,
              24 + Math.sin(time * 2.2) * 0.8,
              abduct.z
            );
            beam.visible = true;
            beam.position.set(abduct.x, 12.2, abduct.z);
            beam.scale.set(1, 23, 1);
            color.setHSL(0.28, 0.8, 0.6);
            beam.material.color.copy(color);
            beam.material.opacity = 0.14 + Math.sin(time * 9) * 0.04 + audio.beatIntensity * 0.08;
            cow.visible = abduct.target === -2; // ghosts and drivers rise via the beam instead
            if (cow.visible) {
              cow.position.set(abduct.x, 1.5 + p2 * 21, abduct.z);
              cow.rotation.y += dt * (1.5 + p2 * 6); // spins faster as it rises
              cow.rotation.z = Math.sin(time * 2.5) * 0.15;
              const shrink = p2 > 0.85 ? 1 - (p2 - 0.85) / 0.15 : 1;
              cow.scale.setScalar(Math.max(0.01, shrink));
            }
          } else {
            beam.visible = false;
            cow.visible = false;
            ufo.position.set(
              roadX(camZ - 120) + side * (70 - swoop * 55) + Math.sin(time * 1.3) * 4,
              26 + Math.sin(ufoT * Math.PI * 3) * 6 + Math.sin(time * 2.1) * 1.5,
              camZ - 150 + ufoT * 60
            );
          }
          ufo.rotation.z = Math.sin(time * 1.7) * 0.12;
          ufo.rotation.y += dt * 2.2; // spinning saucer
          // running lights chase around the rim, hue-tinted
          const lc2 = ufoLights.geometry.attributes.color;
          for (let i = 0; i < 10; i++) {
            const on = (Math.floor(time * 9) % 10) === i ? 2.2 : 0.35 + audio.high * 0.4;
            color.setHSL(((hue / 360) + i * 0.08) % 1, 0.9, 0.5);
            lc2.setXYZ(i, color.r * on, color.g * on, color.b * on);
          }
          lc2.needsUpdate = true;
          const dome2 = ufo.children[1];
          color.setHSL(((hue / 360) + 0.5) % 1, 0.7, 0.5 + audio.beatIntensity * 0.2);
          dome2.material.color.copy(color);
          ufo.children[2].material.color.copy(color);
        }
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
