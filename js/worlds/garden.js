// MAGIC RUN — drop in and watch the path unfold. An infinite runner along a
// glowing vine through the night garden: three lanes (magenta / cyan /
// electric blue), bloom-gates rushing at you, and the rule of the song —
// THREE of the same color in a row is the MAGIC NUMBER. Combos build speed
// and multiplier; gray husks fizzle the streak; ×5 ignites SUPERBLOOM.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const TRIO = [0.86, 0.5, 0.62];  // magenta / cyan / electric blue
const SLATS = 130;               // vine plank pool
const SLAT_GAP = 2.2;
const LANE_W = 4.6;              // lane center offsets: -LANE_W, 0, +LANE_W
const GATES = 12;
const FW = 220;
const DEW = 340;

export function createGarden() {
  let scene, camera, group, sky, dew, slats, railL, railR, gateCore, gateHalo, gateRing, avatar, avatarTrail, fireworks;
  const tp = [0, 0, 0];
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  const pointer = { x: 0, y: 0, active: false };

  let travel = 0, lanePos = 0, speed = 18;
  let multi = 1, streakColor = -1, streak = 0;
  let comboFlash = 0, fizzle = 0, fever = 0;
  let nextGateT = 30;
  let scoreQueue = 0, scoreQX = 0, scoreQY = 0;

  // path through the garden
  const px = t => Math.sin(t * 0.02) * 18 + Math.sin(t * 0.007) * 26;
  const py = t => Math.sin(t * 0.015) * 5;

  // gates
  const gT = new Float32Array(GATES);      // path distance
  const gLane = new Int8Array(GATES);      // -1 / 0 / 1
  const gCol = new Int8Array(GATES);       // 0..2 into TRIO, -1 = husk
  const gAlive = new Uint8Array(GATES);
  const gPop = new Float32Array(GATES);    // pop flash after collect

  // fireworks
  const fwVel = new Float32Array(FW * 3);
  const fwLife = new Float32Array(FW);
  const fwHue = new Float32Array(FW);
  let fwNext = 0;
  function boom(x, y, z, hue01, count) {
    const pos = fireworks.geometry.attributes.position;
    for (let k = 0; k < count; k++) {
      const i = fwNext++ % FW;
      pos.setXYZ(i, x, y, z);
      const a = Math.random() * Math.PI * 2;
      fwVel[i * 3] = Math.cos(a) * (3 + Math.random() * 10);
      fwVel[i * 3 + 1] = 7 + Math.random() * 15;
      fwVel[i * 3 + 2] = Math.sin(a) * (3 + Math.random() * 10);
      fwLife[i] = 1.1 + Math.random() * 0.8;
      fwHue[i] = (hue01 + (Math.random() - 0.5) * 0.08 + 1) % 1;
    }
  }

  function spawnGate(minT) {
    let i = -1;
    for (let k = 0; k < GATES; k++) if (!gAlive[k]) { i = k; break; }
    if (i < 0) return;
    gAlive[i] = 1;
    gPop[i] = 0;
    gT[i] = minT;
    gLane[i] = Math.floor(Math.random() * 3) - 1;
    // mostly colors; sometimes a husk you must dodge
    gCol[i] = fever > 0 ? 3 : (Math.random() < 0.16 ? -1 : Math.floor(Math.random() * 3));
  }

  const mkPts = (n, size, op, parent) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const p = new THREE.Points(g, glowPoints(size, op));
    p.material.vertexColors = true;
    p.frustumCulled = false;
    parent.add(p);
    return p;
  };

  return {
    name: 'MAGIC RUN',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x020409, 0.0085);

      // the vine: glowing planks + two bright rails
      const sg = new THREE.BoxGeometry(LANE_W * 3 + 2, 0.35, SLAT_GAP * 0.82);
      slats = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ toneMapped: false }), SLATS);
      slats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      slats.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SLATS * 3), 3);
      slats.frustumCulled = false;
      group.add(slats);
      railL = mkPts(SLATS, 1.5, 0.85, group);
      railR = mkPts(SLATS, 1.5, 0.85, group);

      gateCore = mkPts(GATES, 4.2, 1, group);
      gateHalo = mkPts(GATES, 11, 0.4, group);
      gateRing = mkPts(GATES, 6, 0.5, group);

      fireworks = mkPts(FW, 1.6, 0.95, group);
      for (let i = 0; i < FW; i++) fwLife[i] = 0;

      // your rider: a bright orb with a comet trail
      avatar = glowSprite(4.5);
      group.add(avatar);
      avatarTrail = mkPts(24, 2.2, 0.7, group);

      // dew stars floating through the garden night
      const dp = new Float32Array(DEW * 3);
      for (let i = 0; i < DEW; i++) {
        dp[i * 3] = (Math.random() - 0.5) * 260;
        dp[i * 3 + 1] = -8 + Math.random() * 60;
        dp[i * 3 + 2] = (Math.random() - 0.5) * 260;
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      dew = new THREE.Points(dg, glowPoints(0.8, 0.5));
      dew.frustumCulled = false;
      group.add(dew);

      sky = skyDome(300);
      group.add(sky);

      travel = 0; lanePos = 0; speed = 18;
      multi = 1; streakColor = -1; streak = 0;
      comboFlash = 0; fizzle = 0; fever = 0;
      nextGateT = 30;
      for (let i = 0; i < GATES; i++) gAlive[i] = 0;
      for (let k = 0; k < 5; k++) spawnGate(35 + k * 16);

      camera.fov = 74;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    placeGhost(p, i, out) {
      // friends run their own vines alongside yours
      const t = travel + 10 + (i % 5) * 8;
      const side = (i % 2 ? 1 : -1) * (14 + (i % 3) * 6);
      out.set(px(t) + side + p.x * 2, py(t) + 3, -t);
    },

    // tap: pulse — snap toward the tapped side AND pop the nearest gate ahead
    onTap(x) {
      lanePos = Math.max(-1, Math.min(1, x * 1.6));
      let best = -1, bestD = 1e9;
      for (let i = 0; i < GATES; i++) {
        if (!gAlive[i]) continue;
        const d = gT[i] - travel;
        if (d > 2 && d < 26 && d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && gCol[best] !== -1) gT[best] = travel + 2.5; // yank it in
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;

      if (scoreQueue && opts.addScore) { opts.addScore(scoreQueue, scoreQX, scoreQY); scoreQueue = 0; }

      comboFlash = Math.max(0, comboFlash - dt * 0.8);
      fizzle = Math.max(0, fizzle - dt * 1.4);
      if (fever > 0) {
        fever -= dt;
        if (fever <= 0) {
          fever = 0;
          multi = 2;
          if (window.__announce) window.__announce('the vine remembers ×2', 'hsl(310, 80%, 70%)');
          for (let i = 0; i < GATES; i++) if (gAlive[i] && gCol[i] === 3) gCol[i] = Math.floor(Math.random() * 3);
        }
      }

      // speed IS the reward: combos and music push the throttle
      const targetSpeed = (18 + audio.energy * 16 * reactivity + multi * 4 + (fever > 0 ? 14 : 0)) * (1 - fizzle * 0.45);
      speed += (targetSpeed - speed) * Math.min(1, dt * 2);
      travel += speed * dt;

      // steering: pointer eases you across the three lanes
      if (attract) lanePos += (Math.sin(time * 0.6) - lanePos) * Math.min(1, dt * 2);
      else lanePos += (Math.max(-1, Math.min(1, pointer.x * 1.6)) - lanePos) * Math.min(1, dt * 6);
      const laneX = lanePos * LANE_W;

      // camera rides the vine
      const cx = px(travel), cy = py(travel);
      const aheadX = px(travel + 24), aheadY = py(travel + 24);
      const bank = (aheadX - cx) * 0.02 + lanePos * 0.12;
      camera.position.set(cx + laneX * 0.6, cy + 5.2 + audio.bass * 0.5, -travel);
      camera.lookAt(aheadX + laneX * 0.4, aheadY + 3.2, -(travel + 24));
      camera.rotation.z += -bank;

      // avatar orb hovers ahead in your lane
      const at = travel + 7;
      avatar.position.set(px(at) + laneX, py(at) + 2.3 + Math.sin(time * 6) * 0.15, -at);
      const avHue = streakColor >= 0 ? TRIO[streakColor] : (hue / 360);
      color.setHSL(fever > 0 ? 0.13 : avHue, 0.95, 0.62).multiplyScalar(1.3 + audio.beatIntensity * 0.5);
      avatar.material.color.copy(color);
      avatar.scale.setScalar(4.5 * (1 + audio.beatIntensity * 0.3 + comboFlash * 0.5));
      {
        const tp2 = avatarTrail.geometry.attributes.position;
        const tc = avatarTrail.geometry.attributes.color;
        for (let i = 23; i > 0; i--) {
          tp2.setXYZ(i, tp2.getX(i - 1), tp2.getY(i - 1), tp2.getZ(i - 1));
          color.setHSL(fever > 0 ? 0.13 : avHue, 0.9, 0.5).multiplyScalar((1 - i / 24) * 1.1);
          tc.setXYZ(i, color.r, color.g, color.b);
        }
        tp2.setXYZ(0, avatar.position.x, avatar.position.y, avatar.position.z);
        color.setHSL(fever > 0 ? 0.13 : avHue, 0.95, 0.6);
        tc.setXYZ(0, color.r, color.g, color.b);
        tp2.needsUpdate = true; tc.needsUpdate = true;
      }

      // vine planks recycle ahead, painted by theme + streak
      for (let s = 0; s < SLATS; s++) {
        const t = travel - 8 + s * SLAT_GAP;
        const wob = Math.sin(t * 0.3 + time * 2) * 0.06;
        dummy.position.set(px(t), py(t) - 0.4 + wob, -t);
        dummy.rotation.set(0, -(px(t + 1) - px(t)) * 0.4, (px(t + 2) - px(t)) * 0.05);
        dummy.updateMatrix();
        slats.setMatrixAt(s, dummy.matrix);
        const level = audio[['bass', 'lowMid', 'mid', 'high', 'treble'][s % 5]];
        themePaint(colorMode, hue / 360, (s % 10) / 10, t * 0.01, time, level, (s * 7.3) % 1, tp);
        const glow = 0.10 + level * 0.30 * reactivity + comboFlash * 0.12;
        color.setHSL(fever > 0 ? 0.13 : tp[0], Math.max(0.6, tp[1]), Math.min(0.5, glow * Math.min(1.5, tp[2])));
        slats.setColorAt(s, color);

        const rl = railL.geometry.attributes, rr = railR.geometry.attributes;
        const edge = LANE_W * 1.5 + 1;
        rl.position.setXYZ(s, px(t) - edge, py(t) + 0.25, -t);
        rr.position.setXYZ(s, px(t) + edge, py(t) + 0.25, -t);
        color.setHSL(fever > 0 ? 0.13 : (hue / 360 + 0.08) % 1, 0.9, 0.4 + audio.volume * 0.25).multiplyScalar(1 + comboFlash);
        rl.color.setXYZ(s, color.r, color.g, color.b);
        rr.color.setXYZ(s, color.r, color.g, color.b);
      }
      slats.instanceMatrix.needsUpdate = true;
      slats.instanceColor.needsUpdate = true;
      railL.geometry.attributes.position.needsUpdate = true;
      railL.geometry.attributes.color.needsUpdate = true;
      railR.geometry.attributes.position.needsUpdate = true;
      railR.geometry.attributes.color.needsUpdate = true;

      // gates: spawn ahead, rush in, collect or dodge
      nextGateT -= speed * dt;
      if (nextGateT <= 0) {
        spawnGate(travel + 110 + Math.random() * 30);
        nextGateT = (fever > 0 ? 7 : 13) + Math.random() * 8;
      }
      const gc = gateCore.geometry.attributes, gh = gateHalo.geometry.attributes, gr = gateRing.geometry.attributes;
      for (let i = 0; i < GATES; i++) {
        if (!gAlive[i]) {
          if (gPop[i] > 0.02) gPop[i] *= Math.pow(0.05, dt);
          else { gc.position.setXYZ(i, 0, -999, 0); gh.position.setXYZ(i, 0, -999, 0); gr.position.setXYZ(i, 0, -999, 0); continue; }
        }
        const t = gT[i];
        const gx = px(t) + gLane[i] * LANE_W;
        const gy = py(t) + 2.3;

        if (gAlive[i] && t < travel + 3.2) {
          // the moment of truth: are you in its lane?
          const hit = Math.abs(laneX - gLane[i] * LANE_W) < LANE_W * 0.55;
          gAlive[i] = 0;
          gPop[i] = hit ? 1 : 0;
          if (hit) {
            if (gCol[i] === -1) {
              // husk: streak dies, vine sours, world drags
              fizzle = 1; multi = 1; streak = 0; streakColor = -1;
              boom(gx, gy, -t, 0.02, 16);
            } else if (gCol[i] === 3) {
              // SUPERBLOOM gold: everything pays
              scoreQueue += 25; scoreQX = 0; scoreQY = 0;
              boom(gx, gy, -t, 0.13, 22);
              comboFlash = Math.max(comboFlash, 0.6);
            } else {
              if (streakColor === -1 || gCol[i] === streakColor) {
                streakColor = gCol[i];
                streak++;
                scoreQueue += 3; scoreQX = 0; scoreQY = 0;
                boom(gx, gy, -t, TRIO[gCol[i]], 10);
                if (streak >= 3) {
                  scoreQueue += 15 * multi;
                  multi = Math.min(5, multi + 1);
                  comboFlash = 1;
                  streak = 0; streakColor = -1;
                  boom(gx, gy, -t, TRIO[gCol[i]], 40 + multi * 20);
                  if (window.__announce) window.__announce(`MAGIC NUMBER ×${multi}`, `hsl(${Math.round(TRIO[gCol[i]] * 360)}, 95%, 68%)`);
                  if (multi >= 5 && fever <= 0) {
                    fever = 10;
                    for (let k = 0; k < GATES; k++) if (gAlive[k]) gCol[k] = 3;
                    if (window.__announce) setTimeout(() => window.__announce('🌸 SUPERBLOOM 🌸', 'hsl(46, 100%, 62%)'), 500);
                  }
                }
              } else {
                // wrong color — soft fizzle, start a new streak in that color
                fizzle = Math.max(fizzle, 0.5); multi = Math.max(1, multi - 1);
                streakColor = gCol[i]; streak = 1;
                scoreQueue += 1; scoreQX = 0; scoreQY = 0;
                boom(gx, gy, -t, TRIO[gCol[i]], 6);
              }
            }
          }
        }

        const show = gAlive[i] ? 1 : gPop[i];
        const pulse = 1 + Math.sin(time * 5 + i * 2) * 0.15 + audio.beatIntensity * 0.35;
        const h01 = gCol[i] === -1 ? 0.06 : gCol[i] === 3 ? 0.13 : TRIO[gCol[i]];
        const sat = gCol[i] === -1 ? 0.15 : 0.95;
        const isStreak = gCol[i] === streakColor && streak > 0;
        gc.position.setXYZ(i, gx, gy, -t);
        gh.position.setXYZ(i, gx, gy, -t);
        gr.position.setXYZ(i, gx, py(t) + 0.15, -t);
        color.setHSL(h01, sat, gCol[i] === -1 ? 0.24 : 0.55).multiplyScalar(show * pulse * (isStreak ? 1.6 : 1));
        gc.color.setXYZ(i, color.r, color.g, color.b);
        color.multiplyScalar(0.5);
        gh.color.setXYZ(i, color.r, color.g, color.b);
        gr.color.setXYZ(i, color.r * 0.8, color.g * 0.8, color.b * 0.8);
      }
      gc.position.needsUpdate = true; gc.color.needsUpdate = true;
      gh.position.needsUpdate = true; gh.color.needsUpdate = true;
      gr.position.needsUpdate = true; gr.color.needsUpdate = true;
      gateHalo.material.size = 11 * (1 + comboFlash * 0.4);

      // fireworks physics
      {
        const fp = fireworks.geometry.attributes.position;
        const fc = fireworks.geometry.attributes.color;
        for (let i = 0; i < FW; i++) {
          if (fwLife[i] <= 0) { fp.setXYZ(i, 0, -999, 0); continue; }
          fwLife[i] -= dt;
          fwVel[i * 3 + 1] -= 15 * dt;
          fp.setXYZ(i, fp.getX(i) + fwVel[i * 3] * dt, fp.getY(i) + fwVel[i * 3 + 1] * dt, fp.getZ(i) + fwVel[i * 3 + 2] * dt);
          const l = Math.max(0, Math.min(1, fwLife[i]));
          color.setHSL(fwHue[i], 0.95, 0.55).multiplyScalar(l * 1.5);
          fc.setXYZ(i, color.r, color.g, color.b);
        }
        fp.needsUpdate = true; fc.needsUpdate = true;
      }

      // night garden dressing
      dew.position.z = -travel;
      dew.rotation.y = time * 0.01;
      dew.material.color.setHSL(fever > 0 ? 0.13 : (hue / 360 + 0.45) % 1, 0.8, 0.5 + audio.high * 0.3);
      dew.material.size = 0.8 + audio.high * 0.8 + comboFlash * 0.6;
      sky.position.copy(camera.position);
      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.energy, 0.5, tp);
      sky.material.color.setHSL(
        fizzle > 0.4 ? 0.02 : fever > 0 ? 0.13 : tp[0],
        tp[1] * 0.5,
        0.15 + audio.energy * 0.1 + comboFlash * 0.13
      );

      // speed you can feel
      const fovT = 74 + speed * 0.28 + comboFlash * 8;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();

      if (participants && participants[0]) {
        participants[0].x = lanePos;
        participants[0].y = 0;
      }
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
