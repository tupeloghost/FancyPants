// WATERSLIDE — a twisting open-top flume dropping forever downhill. Water
// rushes under you, the pipe banks through curves, beats splash. Tap for a
// splash burst + a shot of speed. Ghost riders slide the same flume.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=346';
import { themePaint } from '../lib/themes.js?v=346';
import { TUNE } from '../lib/tune.js?v=346';

const RINGS = 54;           // half-pipe rings alive at once
const SEGS = 14;            // arc segments per ring (lower half only)
const RING_SPACING = 5;
const DROP = 0.42;          // downhill slope per unit forward
const WATER_N = 240;

export function createWaterslide() {
  let scene, camera, group, wall, water, spray, sky;
  let travel = 0, boost = 0;
  // flume bought by one abstract race step
  const SLIDE_PER_STEP = 38;
  let steer = 0, steerTarget = 0;
  // ── HOOPS: the slide is steered now, not tapped ──
  // Tapping in a flume never worked — your eyes are on the tube, not a cue.
  // Rings of light hang in the pipe offset left or right; you lean through
  // them. Same chain logic as the river and the road: a hoop is a shot of
  // speed, a hoop taken while still surging pays double.
  const H_SPACING = 2.6;       // min seconds between hoops
  const MAX_HOOPS = 14;
  let hoops = [], hoopChartAt = 0, hoopLastT = -99, hoopBoost = 0;
  // THE THROTTLE — hold to drop steeper and faster. Hoops pay double flat
  // out and shaving a red one pays a close call; leaning into a red at
  // speed costs three and floods the run for a beat.
  let wThrottle = 0;
  let wStun = 0;
  let hoopCount = 0;           // arrivals, for the red cadence
  let bursts = [];             // golden rings left behind by a catch
  let wLastChartRef = null;
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const ringZ = new Float32Array(RINGS);
  const ringSeed = new Float32Array(RINGS);
  const waterLane = new Float32Array(WATER_N);
  const waterOff = new Float32Array(WATER_N);
  let sprayLife = 0;

  const R = 7;
  const curveX = t => Math.sin(t * 0.03) * 14 + Math.sin(t * 0.011) * 20;
  const dropY = t => -t * DROP + Math.sin(t * 0.02) * 4;

  return {
    name: 'SLIDE',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x02060a, 0.011);

      const geo = new THREE.BoxGeometry(1, 0.4, RING_SPACING * 0.9);
      {
        const pa = geo.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const t = 0.6 + (pa.getY(i) / 0.4 + 0.5) * 0.5;
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      }
      wall = new THREE.InstancedMesh(
        geo,
        new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true }),
        RINGS * SEGS
      );
      wall.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      wall.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * SEGS * 3), 3);
      wall.instanceColor.setUsage(THREE.DynamicDrawUsage);
      wall.frustumCulled = false;
      group.add(wall);

      for (let r = 0; r < RINGS; r++) {
        ringZ[r] = -r * RING_SPACING;
        ringSeed[r] = Math.random();
      }

      // rushing water: streaks tearing down the flume floor
      const wp = new Float32Array(WATER_N * 3);
      const wc = new Float32Array(WATER_N * 3);
      for (let i = 0; i < WATER_N; i++) {
        waterLane[i] = (Math.random() - 0.5) * (R * 0.9);
        waterOff[i] = Math.random() * RINGS * RING_SPACING;
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(wp, 3).setUsage(THREE.DynamicDrawUsage));
      wg.setAttribute('color', new THREE.BufferAttribute(wc, 3).setUsage(THREE.DynamicDrawUsage));
      water = new THREE.Points(wg, glowPoints(0.9, 0.85));
      water.material.vertexColors = true;
      water.frustumCulled = false;
      group.add(water);

      // splash spray burst
      const sp = new Float32Array(80 * 3);
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
      spray = new THREE.Points(sg, glowPoints(1.0, 0));
      spray.frustumCulled = false;
      group.add(spray);
      sprayLife = 0;

      sky = skyDome(300);
      group.add(sky);

      travel = 0; boost = 0;
      camera.fov = 76;
      camera.updateProjectionMatrix();
    },

    setInput(x) { steerTarget = x; },

    _buildHoops() {
      if (hoops.length) return;
      for (let i = 0; i < MAX_HOOPS; i++) {
        const grp = new THREE.Group();
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(2.6, 0.22, 10, 30),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        const gl = glowSprite(7);
        grp.add(ring, gl);
        grp.visible = false;
        group.add(grp);
        hoops.push({ mesh: grp, ring, gl, alive: false, t: 0, side: 0, red: false });
      }
      // catch-bursts: a golden ring blooms where you threaded a hoop
      bursts = [];
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(
          new THREE.TorusGeometry(2.6, 0.3, 8, 26),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        b.visible = false;
        b.userData = { life: 0 };
        group.add(b);
        bursts.push(b);
      }
    },

    // rings close on the flume ahead — where a rider is already looking
    cueAnchor(out) {
      const t = travel + 30;
      out.set(curveX(t), dropY(t) + 2.2, -t);
    },

    // ghost riders ahead in the same flume
    placeGhost(p, i, out) {
      const t = travel + 14 + (i % 6) * 9;
      out.set(curveX(t) + p.x * 3.5, dropY(t) + 1.4, -t);
    },

    // tap: splash burst + a shot of speed
    onTap() {
      boost = 1;
      sprayLife = 1;
      const pos = spray.geometry.attributes.position;
      const t = travel + 6;
      for (let i = 0; i < 80; i++) {
        pos.setXYZ(i,
          curveX(t) + (Math.random() - 0.5) * 5,
          dropY(t) + 1 + Math.random() * 2,
          -t + (Math.random() - 0.5) * 4
        );
      }
      pos.needsUpdate = true;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' , race = null } = opts;
      const racing = !!(race && race.active && race.mode === 'RACE');

      boost *= Math.pow(0.2, dt);
      // Racing, the flume runs at the pace you have earned and momentum is the
      // boost — the shot of speed a tap used to give is now a streak.
      let speed;
      const sliding = !!(race && race.active && race.mode === 'DODGE');
      if (sliding) {
        this._buildHoops();
        if (opts.chart !== wLastChartRef) { wLastChartRef = opts.chart; hoopChartAt = 0; hoopLastT = -99; }
        const wHeat = (opts.songDur ? Math.min(1, (opts.songTime || 0) / opts.songDur) : 0) * TUNE.heat;
        hoopBoost = Math.max(0, hoopBoost - dt * 0.42);
        wStun = Math.max(0, wStun - dt);
        const gasWanted = (opts.holding && wStun <= 0) ? 1 : 0;
        wThrottle += (gasWanted - wThrottle) * Math.min(1, dt * (gasWanted ? 5 : 2.6));
        boost = Math.max(hoopBoost, wThrottle * 0.85);
        speed = (14 + wThrottle * 24 + hoopBoost * 46) * (1 + 0.25 * Math.min(1, wHeat)) * TUNE.speed;
        travel += speed * dt;

        const songTime = opts.songTime || 0, chart = opts.chart;
        if (chart) {
          while (hoopChartAt < chart.length && chart[hoopChartAt].t <= songTime + 0.05) {
            const n = chart[hoopChartAt++];
            if (n.t < songTime - 0.4) { hoopLastT = Math.max(hoopLastT, n.t); continue; }
            if (n.t - hoopLastT < H_SPACING * (1 - 0.4 * Math.min(1, wHeat)) / TUNE.density) continue;
            const h = hoops.find(x => !x.alive);
            if (!h) continue;
            hoopLastT = n.t;
            hoopCount++;
            h.alive = true;
            h.t = travel + 130;                        // fixed distance down the pipe
            h.side = (((hoopChartAt * 48271) % 200) / 100 - 1) * 0.75;  // -0.75..0.75
            // every fourth hoop is RED: lean AWAY. Same signal grammar as the
            // whole game — green means through, red means never — and it gives
            // the flume the tension the green-only version had none of.
            h.red = (hoopCount % 4) === 0;
            h.mesh.visible = true;
          }
        }
        for (const h of hoops) {
          if (!h.alive) continue;
          const t = h.t;
          const hx = curveX(t) + h.side * (R * 0.55);
          h.mesh.position.set(hx, dropY(t) + 2.6, -t);
          h.mesh.rotation.y = Math.atan2(curveX(t - 6) - curveX(t + 6), 12);
          // green = through, red = never — the game's one colour promise
          color.setHSL(h.red ? 0.01 : 0.36, 0.95,
            0.5 + Math.sin(time * (h.red ? 8 : 5) + t) * 0.08 + audio.volume * 0.12);
          h.ring.material.color.copy(color);
          h.gl.material.color.copy(color);
          h.gl.material.opacity = 0.3 + audio.volume * 0.25;

          const ahead = t - travel;
          if (ahead < 4) {
            const gap = Math.abs(h.side - steer);
            const through = gap < 0.42;
            const flooring = wThrottle > 0.6;
            if (through && h.red) {
              // a red ring at speed hits harder and floods the run
              race.drop(flooring ? 3 : 2);
              hoopBoost = 0;
              wStun = flooring ? 1.2 : 0.5; wThrottle *= 0.2;
              if (opts.impact) opts.impact(1.0);
            } else if (h.red && flooring && gap < 0.8) {
              // the close call: shave past a red flat out and the near-miss pays
              race.collect(1);
              if (opts.impact) opts.impact(0.35);
            } else if (through) {
              race.collect((hoopBoost > 0.35 ? 2 : 1) * (flooring ? 2 : 1));
              hoopBoost = Math.min(1, hoopBoost + 0.85);
              if (opts.impact) opts.impact(hoopBoost > 0.9 ? 0.75 : 0.5);
              // leave a golden bloom where the catch happened
              const b = bursts.find(x => !x.visible) || bursts[0];
              b.visible = true;
              b.userData.life = 1;
              b.position.copy(h.mesh.position);
              b.rotation.copy(h.mesh.rotation);
            } else if (!h.red) {
              race.drop(0);                            // a missed hoop breaks the run
            }
            h.alive = false;
            h.mesh.visible = false;
          }
        }
      } else if (racing) {
        boost = race.momentum;
        speed = race.speed * SLIDE_PER_STEP;
        travel = race.progress * SLIDE_PER_STEP;
      } else {
        speed = 16 + audio.volume * 42 * reactivity + boost * 34;
        travel += speed * dt;
      }

      if (attract) steerTarget = Math.sin(time * 0.5) * 0.5;
      steer += (steerTarget - steer) * Math.min(1, dt * 4);
      if (participants && participants[0]) {
        participants[0].x = steer;
        participants[0].y = 0;
      }

      // bank into the curve like a rider would
      const ahead = curveX(travel + 30) - curveX(travel);
      const bank = ahead * 0.03 + steer * 0.35;
      // the lens widens as the throttle opens — speed you can SEE
      camera.fov += ((76 + wThrottle * 14 + boost * 4) - camera.fov) * Math.min(1, dt * 4);

      // camera rides low in the flume
      camera.position.set(
        curveX(travel) + steer * (R * 0.55),
        dropY(travel) + 2.6 + Math.abs(steer) * 1.4 + audio.bass * 0.3,
        -travel
      );
      camera.lookAt(curveX(travel + 34), dropY(travel + 34) + 1.6, -(travel + 34));
      camera.rotation.z += -bank;

      for (const b of bursts) {
        if (!b.visible) continue;
        b.userData.life -= dt * 2;
        if (b.userData.life <= 0) { b.visible = false; continue; }
        const e = 1 - b.userData.life;
        b.scale.setScalar(1 + e * 1.8);
        b.material.opacity = b.userData.life * 0.8;
        b.material.color.setHSL(0.12, 1, 0.6);
      }

      // half-pipe rings recycle ahead. ringZ is the ring's ABSOLUTE world z
      // (camera lives at z = -travel), and -ringZ is its path parameter.
      let idx = 0;
      for (let r = 0; r < RINGS; r++) {
        // Recycle by however many spans it takes, not one per frame. Stepping
        // back once assumes travel only ever creeps forward; a seek, a rejoin
        // or a race correction can move it by thousands at once, and the flume
        // would then be left behind the rider entirely.
        const limit = -travel + RING_SPACING * 1.5;
        if (ringZ[r] > limit) {
          const span = RINGS * RING_SPACING;
          ringZ[r] -= Math.ceil((ringZ[r] - limit) / span) * span;
          ringSeed[r] = Math.random();
        }
        const t = -ringZ[r];              // distance along the flume
        const distAhead = t - travel;     // 0 at the camera
        const cx = curveX(t);
        const cy = dropY(t) + R; // ring center sits R above the floor

        for (let s2 = 0; s2 < SEGS; s2++) {
          // arc across the LOWER half only — open-top flume
          const a = Math.PI + (s2 / (SEGS - 1)) * Math.PI;
          const level = audio[['bass', 'lowMid', 'mid', 'high', 'treble'][s2 % 5]];
          dummy.position.set(cx + Math.cos(a) * R, cy + Math.sin(a) * R, ringZ[r]);
          dummy.rotation.set(0, 0, a + Math.PI / 2);
          const w = (Math.PI * R) / SEGS * 0.85;
          dummy.scale.set(w, 1 + level * 1.6 * reactivity, 1);
          dummy.updateMatrix();
          wall.setMatrixAt(idx, dummy.matrix);

          const jitv = Math.abs(Math.sin(ringSeed[r] * 43.7 + s2 * 12.9));
          themePaint(colorMode, hue / 360, s2 / (SEGS - 1), t * 0.012, time, level, jitv, tp);
          const wet = 0.16 + level * 0.4 * reactivity + boost * 0.12;
          color.setHSL(tp[0], tp[1], Math.min(0.5, wet * Math.min(1.4, tp[2])));
          color.multiplyScalar(Math.min(1, Math.max(0.08, distAhead / 22))); // dim right at the camera
          wall.setColorAt(idx, color);
          idx++;
        }
      }
      wall.instanceMatrix.needsUpdate = true;
      wall.instanceColor.needsUpdate = true;

      // water streaks race down the floor, faster than you
      const wpos = water.geometry.attributes.position;
      const wcol = water.geometry.attributes.color;
      const span = RINGS * RING_SPACING;
      for (let i = 0; i < WATER_N; i++) {
        waterOff[i] += (speed * 0.55 + 26) * dt;
        const t = travel + (waterOff[i] % span);
        const floorY = dropY(t) + 0.55 + Math.abs(waterLane[i]) * 0.06;
        wpos.setXYZ(i, curveX(t) + waterLane[i], floorY, -t);
        const froth = 0.5 + 0.5 * Math.sin(i * 3.7 + time * 14);
        // dim streaks near the camera so overlap never whites out the lens
        const distDim = Math.min(1, Math.max(0.06, ((waterOff[i] % span)) / 22));
        color.setHSL((hue / 360 + 0.5) % 1, 0.4, (0.16 + froth * 0.14 + audio.volume * 0.1) * distDim);
        wcol.setXYZ(i, color.r, color.g, color.b);
      }
      wpos.needsUpdate = true;
      wcol.needsUpdate = true;
      water.material.size = 0.5 + audio.volume * 0.3 + boost * 0.3;

      // splash spray
      if (sprayLife > 0.02) {
        sprayLife *= Math.pow(0.06, dt);
        spray.material.opacity = sprayLife;
        color.setHSL((hue / 360 + 0.5) % 1, 0.3, 0.75);
        spray.material.color.copy(color);
        const pos = spray.geometry.attributes.position;
        for (let i = 0; i < 80; i++) {
          pos.setY(i, pos.getY(i) + dt * (4 + (i % 5)));
          pos.setZ(i, pos.getZ(i) - dt * speed * 0.4);
        }
        pos.needsUpdate = true;
      } else {
        spray.material.opacity = 0;
      }

      sky.position.copy(camera.position);
      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.energy, 0.5, tp);
      sky.material.color.setHSL(tp[0], tp[1] * 0.5, 0.24 + audio.energy * 0.15);

      const fovT = 76 + speed * 0.16 + boost * 10;
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
