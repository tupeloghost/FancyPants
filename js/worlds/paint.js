// PAINT — fly through a gray world and everything you touch turns to colour.
//
// The old paint-by-numbers plate was scrapped whole: it was a static board in
// a product where every other world moves, and no mechanic was going to fix a
// desk activity. This is the same fantasy — colour where there was none — as
// MOTION: a corridor of gray panels streams past, your held pointer is a
// spray, painted panels keep their colour and dance with the music behind you
// while the road ahead arrives forever unpainted. The score is simply how
// much of the world you have brought to life.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=208';
import { themePaint } from '../lib/themes.js?v=208';
import { PALETTE } from '../net.js?v=208';
import { clear as sfxClear, fanfare as sfxFanfare, thud as sfxThud } from '../lib/sfx.js?v=208';

const SEGS = 14;            // panels around the ring
const RINGS = 42;           // rings alive at once
const SPACING = 6;          // distance between rings
const RADIUS = 16;
const COUNT = SEGS * RINGS;

export function createPaint() {
  let scene, camera, group, panels, sky, motes;
  let travel = 0;
  let painted, hueAt, popAt;         // per-panel state
  let ringZ;                          // absolute z per ring
  let paintedCount = 0, scoreQueue = 0;
  let brushHue = Math.random();
  let sprays = [];
  // ── dopamine state ──
  let combo = 0, comboT = 0;          // unbroken painting: wider brush, more score
  let ringChain = 0, lastRingT = -9;  // consecutive full rings pay escalating bonuses
  let waveZ = 1;                      // milestone wave rolling down the tunnel
  let nextMilestone = 100;
  let flashRing = -1, flashT = 0;     // the ring that just cleared, white-hot
  let decayAcc = 0, decayWarned = false;   // the gray eating back while you idle
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const _v = new THREE.Vector3();
  const tp = [0, 0, 0];
  let pointer = { x: 0, y: 0, active: false };

  const pathX = z => Math.sin(z * 0.012) * 10;
  const pathY = z => Math.sin(z * 0.008 + 2) * 5;

  function panelPos(ring, seg, out) {
    const z = ringZ[ring];
    const a = (seg / SEGS) * Math.PI * 2 + ring * 0.11; // slight twist per ring
    out.set(pathX(z) + Math.cos(a) * RADIUS, pathY(z) + Math.sin(a) * RADIUS, z);
    return a;
  }

  return {
    name: 'PAINT',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x050507, 0.009);

      panels = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(6.4, 4.6),
        new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }),
        COUNT
      );
      panels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      panels.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
      panels.frustumCulled = false;
      group.add(panels);

      painted = new Float32Array(COUNT);   // 0 gray … 1 fully painted
      hueAt = new Float32Array(COUNT);
      popAt = new Float32Array(COUNT);     // pop animation on the paint moment
      ringZ = new Float32Array(RINGS);
      for (let r = 0; r < RINGS; r++) ringZ[r] = -r * SPACING;
      paintedCount = 0;

      // spray bursts where the brush lands
      sprays = [];
      for (let i = 0; i < 10; i++) {
        const s = glowSprite(6);
        s.visible = false;
        s.userData = { life: 0 };
        group.add(s);
        sprays.push(s);
      }

      // drifting motes so the gray world still breathes before you touch it
      const mp = new Float32Array(160 * 3);
      for (let i = 0; i < 160; i++) {
        mp[i * 3] = (Math.random() - 0.5) * 60;
        mp[i * 3 + 1] = (Math.random() - 0.5) * 40;
        mp[i * 3 + 2] = -Math.random() * RINGS * SPACING;
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      motes = new THREE.Points(mg, glowPoints(0.7, 0.5));
      motes.frustumCulled = false;
      group.add(motes);

      sky = skyDome(240);
      group.add(sky);

      travel = 0;
      camera.fov = 74;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    // a tap is a BOMB of paint — a wide splash for the moment the sweep is not
    onTap(x, y) {
      pointer.x = x; pointer.y = y; pointer.active = true;
      this._spray(x, y, 0.24, 3);
    },

    // paint every unpainted panel whose screen position sits near the pointer
    _spray(px, py, radius, strengthBonus = 1, ghostHue = -1) {
      let hit = 0, hx = 0, hy = 0, hz = 0;
      const mine = ghostHue < 0;
      const useHue = mine ? brushHue : ghostHue;
      for (let r = 0; r < RINGS; r++) {
        // only rings ahead of the camera can be sprayed
        if (ringZ[r] > camera.position.z - 2 || ringZ[r] < camera.position.z - 130) continue;
        let ringFilled = true;
        for (let s2 = 0; s2 < SEGS; s2++) {
          const i = r * SEGS + s2;
          if (painted[i] >= 1) continue;
          panelPos(r, s2, _v);
          const wx = _v.x, wy = _v.y, wz = _v.z;
          _v.project(camera);
          if (_v.z > 1) { ringFilled = false; continue; }
          if (Math.hypot(_v.x - px, _v.y - py) < radius) {
            painted[i] = 1;
            popAt[i] = 1.4;
            hueAt[i] = useHue;
            paintedCount++;
            // the combo pays: unbroken painting is worth up to double
            if (mine) scoreQueue += strengthBonus * (combo > 40 ? 2 : combo > 15 ? 1.5 : 1);
            hit++; hx = wx; hy = wy; hz = wz;
          } else ringFilled = false;
        }
        // ── RING! ── the whole hoop done: it detonates, and chains escalate.
        // The clear unit players can SEE coming ("two more panels...") is
        // where the anticipation-payoff loop actually lives.
        if (mine && hit && ringFilled) {
          let all = true;
          for (let s2 = 0; s2 < SEGS; s2++) if (painted[r * SEGS + s2] < 1) { all = false; break; }
          if (all && flashRing !== r) {
            ringChain = (performance.now() / 1000 - lastRingT < 7) ? ringChain + 1 : 1;
            lastRingT = performance.now() / 1000;
            scoreQueue += 20 * ringChain;
            sfxClear(ringChain);
            flashRing = r; flashT = 1;
            for (let s2 = 0; s2 < SEGS; s2++) popAt[r * SEGS + s2] = 2.0;
          }
        }
      }
      if (hit) {
        if (mine) {
          combo += hit; comboT = 0;
          brushHue = (brushHue + 0.004 * hit) % 1;   // the brush drifts through the rainbow
        }
        const sp = sprays.find(q => !q.visible) || sprays[0];
        sp.visible = true;
        sp.userData.life = 1;
        sp.position.set(hx, hy, hz);
        color.setHSL(useHue, 0.9, 0.65);
        sp.material.color.copy(color);
        // milestones roll a wave of light down everything you have painted
        if (mine && paintedCount >= nextMilestone) {
          nextMilestone += 100;
          waveZ = 0;   // 0 = start at the camera, animates forward in update
          scoreQueue += 30;
          sfxFanfare();
        }
      }
      return hit;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;

      if (scoreQueue && opts.addScore) { opts.addScore(scoreQueue); scoreQueue = 0; }

      // steady glide — painting is the act, flying is the canvas coming to you
      travel += dt * (9 + audio.energy * 7 + audio.volume * 4);
      const camZ = -travel;
      camera.position.set(pathX(camZ), pathY(camZ), camZ);
      camera.lookAt(pathX(camZ - 40), pathY(camZ - 40), camZ - 40);
      camera.rotation.z = Math.sin(time * 0.15) * 0.05;

      if (participants && participants[0]) {
        participants[0].x = pointer.x || 0;
        participants[0].y = pointer.y || 0;
      }

      // combo breathes out when you stop — three seconds of grace, then gone
      comboT += dt;
      if (comboT > 3) combo = Math.max(0, combo - dt * 30);

      // ── the gray eats back ──
      // The missing half of the loop was JEOPARDY: nothing could go wrong, so
      // holding still was free. Now idling lets the gray creep back into what
      // you painted — slowly at first, then hungrily — and one low thud
      // announces the moment it starts. Painting is the only defence, which
      // is exactly the loop: keep your world alive.
      if (comboT > 2.5 && paintedCount > 0 && !attract) {
        if (!decayWarned) { decayWarned = true; sfxThud(); }
        decayAcc += dt * Math.min(6, (comboT - 2.5) * 2.5);   // hunger grows
        while (decayAcc >= 1) {
          decayAcc -= 1;
          for (let tries = 0; tries < 12; tries++) {
            const i = (Math.random() * COUNT) | 0;
            if (painted[i] >= 1) {
              painted[i] = 0;
              popAt[i] = 1.0;          // a gray flicker marks the bite
              paintedCount--;
              break;
            }
          }
        }
      } else { decayAcc = 0; decayWarned = false; }
      const brushR = 0.11 + Math.min(0.06, combo * 0.0012);   // combo widens the brush

      // the brush: hold and sweep
      if (opts.holding && pointer.active && !attract) {
        this._spray(pointer.x, pointer.y, brushR);
      }

      // ── rivals paint the same canvas, live, in their own colour ──
      // Their pointer already rides the wire (x, y). A shared canvas is the
      // multiplayer dopamine: the tunnel fills with everyone's colours at
      // once, and every unpainted panel is a little race.
      if (participants) {
        for (let gi = 1; gi < participants.length; gi++) {
          const p = participants[gi];
          if (p.x === undefined || p.y === undefined) continue;
          color.setHex(PALETTE[(p.color || 0) % PALETTE.length]);
          const hsl = { h: 0, s: 0, l: 0 };
          color.getHSL(hsl);
          this._spray(p.x, p.y, p.action === 'tap' ? 0.18 : 0.06, 0, hsl.h);
        }
      }
      if (attract) {
        // watch mode paints itself lazily, so the world demos its own point
        this._spray(Math.sin(time * 0.7) * 0.5, Math.cos(time * 0.44) * 0.35, 0.09);
      }

      // rings recycle ahead — and arrive UNPAINTED. The road behind you stays
      // yours; the road ahead is always a fresh canvas.
      for (let r = 0; r < RINGS; r++) {
        if (ringZ[r] > camZ + SPACING * 1.5) {
          ringZ[r] -= RINGS * SPACING;
          for (let s2 = 0; s2 < SEGS; s2++) {
            const i = r * SEGS + s2;
            if (painted[i] >= 1) paintedCount--;
            painted[i] = 0; popAt[i] = 0;
          }
        }
      }

      // draw
      const bands = [audio.bass, audio.lowMid, audio.mid, audio.high, audio.treble];
      for (let r = 0; r < RINGS; r++) {
        for (let s2 = 0; s2 < SEGS; s2++) {
          const i = r * SEGS + s2;
          const a = panelPos(r, s2, _v);
          popAt[i] = Math.max(0, popAt[i] - dt * 2.2);
          const pop = popAt[i];

          dummy.position.copy(_v);
          dummy.lookAt(pathX(ringZ[r]), pathY(ringZ[r]), ringZ[r]);
          const band = bands[(s2 + r) % 5];
          const dance = painted[i] ? 1 + band * 0.35 * reactivity + pop * 0.5 : 1;
          dummy.scale.set(dance, dance, 1);
          dummy.updateMatrix();
          panels.setMatrixAt(i, dummy.matrix);

          // the milestone wave: a band of white light rolling away from you
          const waveBoost = waveZ < 1
            ? Math.max(0, 1 - Math.abs((camZ - ringZ[r]) - waveZ * 130) / 10) : 0;
          const ringFlash = (flashRing === r) ? flashT : 0;

          if (painted[i]) {
            // painted panels live: they carry their stroke's hue, breathe with
            // their band, and flash white at the instant of the stroke
            themePaint(colorMode, hueAt[i], 0.5 + (s2 % 5) * 0.1, ringZ[r] * 0.01, time, band, s2 / SEGS, tp);
            color.setHSL(tp[0], Math.min(1, tp[1] + 0.2),
              Math.min(0.85, tp[2] + band * 0.22 + pop * 0.4 + waveBoost * 0.35 + ringFlash * 0.3));
          } else {
            // the unpainted world: near-monochrome, faintly alive, waiting
            const g = 0.07 + ((i * 2654435761) % 100) / 100 * 0.05 + audio.volume * 0.02;
            color.setHSL(0.6, 0.04, g);
          }
          panels.setColorAt(i, color);
        }
      }
      panels.instanceMatrix.needsUpdate = true;
      panels.instanceColor.needsUpdate = true;

      if (waveZ < 1) waveZ = Math.min(1, waveZ + dt * 0.7);
      if (flashT > 0) { flashT = Math.max(0, flashT - dt * 1.4); if (flashT === 0) flashRing = -1; }

      for (const sp of sprays) {
        if (!sp.visible) continue;
        sp.userData.life -= dt * 2.4;
        if (sp.userData.life <= 0) { sp.visible = false; continue; }
        sp.material.opacity = sp.userData.life * 0.55;
        sp.scale.setScalar(6 * (1.6 - sp.userData.life));
      }

      // motes ride along
      const mpos = motes.geometry.attributes.position;
      for (let i = 0; i < mpos.count; i++) {
        if (mpos.getZ(i) > camZ + 8) mpos.setZ(i, mpos.getZ(i) - RINGS * SPACING);
      }
      mpos.needsUpdate = true;
      motes.material.opacity = 0.35 + audio.high * 0.3;

      sky.position.copy(camera.position);
      if (window.__setFigure) {
        const label = combo > 15 ? 'PAINT  \u00b7  ' + Math.floor(combo) + ' COMBO' + (ringChain > 1 ? '  \u00b7  RING \u00d7' + ringChain : '') : 'PAINT';
        window.__setFigure(label, paintedCount, COUNT);
      }
    },

    dispose() {
      scene.remove(group);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.fog = null;
    },
  };
}
