// BIRTHDAY — an occasion world, reached by a link with a name on it, never
// by the weekly rotation. You FLY the night in a slow orbit around a grand
// velvet cake, chasing golden flames. Catch up to three, they ride your
// tail like fireflies, and a swoop past the cake delivers them: candles
// light in a run of pops. Tap and the nearest flame answers, darting to
// your hand. Light them all and the world holds its breath, the candles go
// out together, and the sky answers with fireworks and their name. Then it
// begins again, one lantern richer. Chic and starry, never arcade.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=675';
import { themePaint } from '../lib/themes.js?v=675';

const CANDLES_DEFAULT = 13;
const LITE = !!window.__LITE;
const FLAMES = LITE ? 7 : 10;        // flames alive in the orbit at once
const STARS = LITE ? 400 : 700;
const BURSTS = LITE ? 6 : 10;        // firework spark clouds in the pool
const SPRINKLES = LITE ? 80 : 140;   // candy specks scattered on the tier tops
const RAIN = LITE ? 120 : 220;       // sprinkles falling from the fireworks
const CARRY = 3;                     // fireflies your light can tow at once

export function createBirthday() {
  // the cake carries THEIR count when the link says so (candles=age)
  const CANDLES = window.__BDAY_N || CANDLES_DEFAULT;
  let scene, camera, group;
  let sky, stars, cake, rims = [], candles = [], flames = [], bursts = [], lanterns = [];
  let rings = [];                      // firework halo rings (torus pool)
  let sprinkles = null, rain = null;   // candy on the cake; candy from the sky
  let rainDrops = [], rainOn = 0;
  let player, halo;
  let steer = { x: 0, y: 0 }, steerTarget = { x: 0, y: 0 };
  let ang = 0, orbitR = 22, heightY = 3;
  let carried = [];                    // flames riding the tail
  let deliverT = 0, deliverQueue = 0;  // candles waiting to pop after a swoop
  let surge = 0;                       // HOLD: the night rushes
  let lit = 0, finales = 0;
  let state = 'gather';                // gather -> wish -> blowing -> out -> sing -> encore
  let blowProg = 0;                    // how far their breath has gotten
  let stateT = 0;
  let tapGlit = 0, callPulse = 0;
  let wishStar = null, numberPlate = null;
  const color = new THREE.Color();
  const CAKE_POS = new THREE.Vector3(0, -10, 0);   // the cake IS the center now

  const mkFlame = () => {
    const g = new THREE.Group();
    const s = glowSprite(4.2);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff2d0, toneMapped: false })
    );
    g.add(s, core);
    g.userData = { s, core, seed: Math.random() * 100, live: false, dart: 0, a: 0, r: 0, y: 0 };
    return g;
  };

  // flames live in the ORBIT: an angle, a radius, a height, all drifting
  const dealFlame = (f) => {
    const u = f.userData;
    u.live = true;
    u.dart = 0;
    f.visible = true;
    u.a = Math.random() * Math.PI * 2;
    u.r = 17 + Math.random() * 16;
    u.y = -1 + Math.random() * 9;
    u.seed = Math.random() * 100;
    f.position.set(Math.cos(u.a) * u.r, u.y, Math.sin(u.a) * u.r);
  };

  return {
    name: 'BIRTHDAY',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x05030a, 0.0065);

      sky = skyDome(300, 0);
      group.add(sky);

      const sp = new Float32Array(STARS * 3);
      for (let i = 0; i < STARS; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(110 + Math.random() * 140);
        sp.set([v.x, Math.abs(v.y) * 0.8 - 6, v.z], i * 3);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      stars = new THREE.Points(sg, glowPoints(1.5, 0.7));
      stars.material.color.set(0x99a6cc);
      group.add(stars);

      // ── the cake: three velvet tiers, each crowned with a ring of light ──
      cake = new THREE.Group();
      const tiers = [[17, 6], [12, 5.2], [7.6, 4.6]];
      let ty = 0;
      for (const [r, h] of tiers) {
        const tier = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r * 1.03, h, 48),
          new THREE.MeshBasicMaterial({ color: 0x0d0a18, toneMapped: false })
        );
        tier.position.y = ty + h / 2;
        cake.add(tier);
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(r, 0.14, 8, 72),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        rim.rotation.x = Math.PI / 2;
        rim.position.y = ty + h;
        cake.add(rim);
        rims.push(rim);
        ty += h;
      }
      const twoRows = CANDLES > 20;
      for (let i = 0; i < CANDLES; i++) {
        const row = twoRows ? i % 2 : 0;
        const n = twoRows ? Math.ceil(CANDLES / 2) : CANDLES;
        const a = (Math.floor(i / (twoRows ? 2 : 1)) / n) * Math.PI * 2 + row * 0.35;
        const c = new THREE.Group();
        const stick = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, 2.2, 8),
          new THREE.MeshBasicMaterial({ color: 0xd8cfee, toneMapped: false })
        );
        stick.position.y = 1.1;
        const fl = glowSprite(2.6);
        fl.position.y = 2.6;
        fl.material.opacity = 0.05;          // unlit: an ember of a promise
        c.add(stick, fl);
        c.position.set(Math.cos(a) * (5.1 - row * 1.9), ty, Math.sin(a) * (5.1 - row * 1.9));
        c.userData = { fl, on: false, pop: 0, seed: i * 7.3 };
        cake.add(c);
        candles.push(c);
      }
      // ── sprinkles: candy specks scattered on every tier top, glinting ──
      const sprGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 6);
      const sprMat = new THREE.MeshBasicMaterial({ toneMapped: false });
      sprinkles = new THREE.InstancedMesh(sprGeo, sprMat, SPRINKLES);
      const dum = new THREE.Object3D();
      const tierTops = [[17, 12, 6], [12, 7.6, 11.2], [7.6, 5.6, 15.8]];
      for (let i = 0; i < SPRINKLES; i++) {
        const [ro, ri, y] = tierTops[i % 3];
        const rr = ri + Math.random() * (ro - ri - 0.6);
        const aa = Math.random() * Math.PI * 2;
        dum.position.set(Math.cos(aa) * rr, y + 0.12, Math.sin(aa) * rr);
        dum.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 0.5, 0, Math.random() * Math.PI);
        dum.updateMatrix();
        sprinkles.setMatrixAt(i, dum.matrix);
      }
      sprinkles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SPRINKLES * 3), 3);
      cake.add(sprinkles);

      // ── sprinkle RAIN: falls from the fireworks, tumbling ──
      rain = new THREE.InstancedMesh(sprGeo.clone(), new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.95 }), RAIN);
      rain.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RAIN * 3), 3);
      rain.visible = false;
      rain.frustumCulled = false;
      group.add(rain);
      rainDrops = [];
      for (let i = 0; i < RAIN; i++) rainDrops.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, spin: Math.random() * 6, tumble: 1 + Math.random() * 3 });
      rainOn = 0;

      // their number in gold, riding just above the candles so it reads
      // from every side of the orbit (it turns to face the rider each frame)
      if (window.__BDAY_N) {
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 256;
        const cx2 = cv.getContext('2d');
        cx2.fillStyle = '#ffd98a';
        cx2.shadowColor = '#ffb347';
        cx2.shadowBlur = 26;
        cx2.font = '400 150px Didot, "Bodoni 72", Georgia, serif';
        cx2.textAlign = 'center';
        cx2.textBaseline = 'middle';
        cx2.fillText(String(CANDLES), 128, 138);
        const tex = new THREE.CanvasTexture(cv);
        numberPlate = new THREE.Mesh(
          new THREE.PlaneGeometry(6.5, 6.5),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false })
        );
        numberPlate.position.set(0, CAKE_POS.y + ty + 7.5, 0);
        group.add(numberPlate);
      }

      cake.position.copy(CAKE_POS);
      group.add(cake);

      // ── the flames, dealt into the orbit ──
      for (let i = 0; i < FLAMES; i++) {
        const f = mkFlame();
        dealFlame(f);
        group.add(f);
        flames.push(f);
      }

      // ── fireworks pools ──
      for (let i = 0; i < BURSTS; i++) {
        const n = LITE ? 60 : 110;
        const pos = new Float32Array(n * 3), vel = [];
        for (let j = 0; j < n; j++) {
          const v = new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 9);
          vel.push(v);
        }
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        const b = new THREE.Points(bg, glowPoints(1.3, 0.95));
        b.visible = false;
        b.userData = { vel, life: 0 };
        group.add(b);
        bursts.push(b);
      }
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(
          new THREE.TorusGeometry(1, 0.02, 6, 64),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        m.visible = false;
        m.userData = { r: 0 };
        group.add(m);
        rings.push(m);
      }

      // ── rising lanterns: the world remembers every finale ──
      lanterns = [];
      this._lanternWant = 4;

      // the player's light, towing its fireflies
      player = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
      );
      halo = glowSprite(7);
      player.add(halo);
      group.add(player);

      lit = 0; finales = 0; state = 'gather'; stateT = 0;
      ang = 0; orbitR = 22; heightY = 3; carried = []; deliverQueue = 0; surge = 0;
      // dev handle: light every candle and audition the ceremony
      window.__bdayFinale = () => {
        candles.forEach(c => { c.userData.on = true; });
        lit = CANDLES;
        state = 'wish'; stateT = 0; blowProg = 0;
        document.dispatchEvent(new CustomEvent('fp-bday-wish'));
      };
      this._onBlow = () => { if (state === 'wish') { state = 'blowing'; stateT = 0; blowProg = 0; } };
      document.addEventListener('fp-bday-blow', this._onBlow);
      camera.fov = 74;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { steerTarget.x = x || 0; steerTarget.y = y || 0; },

    // everyone flies the same orbit, offset around the ring
    placeGhost(p, i, out) {
      const r = 22 + (p.x || 0) * 8;
      const a = ang + 0.9 + i * 1.3;
      out.set(Math.cos(a) * r, 3 + (p.y || 0) * 5, Math.sin(a) * r);
    },

    onTap() {
      tapGlit = 1;
      callPulse = 1;
      // no mic: every quick tap is a puff of breath
      if (state === 'blowing' && window.__blowLevel == null) { blowProg = Math.min(1, blowProg + 0.12); return; }
      if (state !== 'gather') return;
      // the CALL: the nearest free flame answers your light and darts to you
      let best = null, bd = 40;
      for (const f of flames) {
        if (!f.userData.live || f.userData.dart > 0) continue;
        const d = f.position.distanceTo(player.position);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) best.userData.dart = 1.6;
    },

    // one firework: a spark burst, a halo ring, and a shed of sprinkles
    _fire(at, opts, paint, tp) {
      const b = bursts.find(x => !x.visible);
      if (b) {
        b.visible = true;
        b.position.copy(at);
        b.userData.life = 1;
        const posA = b.geometry.attributes.position;
        for (let j = 0; j < b.userData.vel.length; j++) posA.setXYZ(j, 0, 0, 0);
        posA.needsUpdate = true;
        paint(Math.random(), 1);
        color.setHSL(Math.random() < 0.4 ? 0.11 : tp[0], 0.9, 0.62);
        b.material.color.copy(color);
      }
      const m = rings.find(x => !x.visible);
      if (m) {
        m.visible = true;
        m.position.copy(at);
        m.userData.r = 1;
        m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        color.setHSL(0.11, 0.9, 0.55);
        m.material.color.copy(color);
      }
      rain.visible = true; rainOn = 6;
      let seeded = 0;
      for (const d of rainDrops) {
        if (d.y > -90 || seeded >= RAIN / 4) continue;
        seeded++;
        d.x = at.x + (Math.random() * 2 - 1) * 6;
        d.y = at.y + (Math.random() * 2 - 1) * 3;
        d.z = at.z + (Math.random() * 2 - 1) * 6;
        d.vx = (Math.random() * 2 - 1) * 2.5;
        d.vy = 1 + Math.random() * 2;
      }
      if (opts.impact) opts.impact(0.5);
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      const tp = this._tp || (this._tp = [0, 0, 0]);
      const paint = (u, lvl) => { themePaint(colorMode, hue / 360, u, time * 0.15, time, lvl, (u * 7.13) % 1, tp); return tp; };
      const chorus = opts.chorus || 0;
      // ── the WAKING: every lit candle turns the world's aliveness up ──
      // it opens half-asleep; each candle brightens it, quickens the music's
      // grip on everything, and after the first finale it never fully sleeps
      const aliveK = Math.min(1, Math.max(lit / CANDLES, finales > 0 ? 0.35 : 0));

      if (attract) { steerTarget.x = Math.sin(time * 0.3) * 0.6; steerTarget.y = Math.sin(time * 0.23) * 0.5; }
      steer.x += (steerTarget.x - steer.x) * Math.min(1, dt * 7);
      steer.y += (steerTarget.y - steer.y) * Math.min(1, dt * 7);

      // ── the RIDE: a night orbit around the cake, always moving ──
      // steer x picks how wide you fly, y how high; HOLD opens the throttle
      surge += ((opts.holding ? 1 : 0) - surge) * Math.min(1, dt * 4);
      const gatherK = state === 'gather' ? 1 : 0.25;   // the ceremony slows the sky
      ang += dt * (0.3 + 0.18 * aliveK + audio.volume * (0.08 + 0.3 * aliveK) * reactivity + surge * 0.5 + chorus * 0.12) * gatherK;
      orbitR += ((26 + steer.x * 10) - orbitR) * Math.min(1, dt * 5);
      heightY += ((3.5 + steer.y * 6) - heightY) * Math.min(1, dt * 5);
      player.position.set(Math.cos(ang) * orbitR, heightY, Math.sin(ang) * orbitR);
      if (participants && participants[0]) { participants[0].x = steer.x; participants[0].y = steer.y; }

      const hushK = (state === 'wish' || state === 'blowing') ? Math.min(1, stateT / 0.8 + (state === 'blowing' ? 1 : 0))
        : state === 'out' ? 1
        : state === 'sing' ? Math.max(0, 1 - stateT / 1.5) : 0;
      const dim = 1 - hushK * (state === 'out' ? 0.85 : 0.65);   // the held breath, then near-dark


      // sky and stars
      paint(0.9, audio.mid);
      color.setHSL(tp[0], tp[1] * 0.6, Math.min(0.4, (0.1 + 0.14 * aliveK + audio.energy * (0.06 + 0.2 * aliveK)) * tp[2]) * dim);
      sky.material.color.copy(color);
      stars.material.opacity = (0.32 + 0.22 * aliveK + audio.high * 0.35 * aliveK) * dim;
      stars.rotation.y = time * 0.004;

      // cake rims breathe with the bass; the velvet carries a whisper of theme
      rims.forEach((rim, i) => {
        paint(0.15 + i * 0.25, audio.bass);
        color.setHSL(tp[0], tp[1], Math.min(0.62, (0.22 + 0.22 * aliveK + audio.bass * (0.08 + 0.3 * aliveK)) * Math.min(1.3, tp[2])) * dim);
        rim.material.color.copy(color);
        rim.scale.setScalar(1 + audio.bass * (0.01 + 0.06 * aliveK) * reactivity);
        color.setHSL(tp[0], tp[1] * 0.7, (0.04 + 0.05 * aliveK + audio.bass * 0.05 * aliveK) * dim);
        cake.children[i * 2].material.color.copy(color);
      });
      cake.rotation.y = time * (0.05 + 0.06 * aliveK);
      // half awake, the cake starts breathing with the beat outright
      cake.scale.y = 1 + audio.beatIntensity * 0.05 * aliveK;
      // fully waking, the cake rings the sky on the big beats
      if (audio.beat && aliveK > 0.35 && Math.random() < aliveK * 0.5) {
        const m = rings.find(x => !x.visible);
        if (m) {
          m.visible = true;
          m.position.set(0, CAKE_POS.y + 17, 0);
          m.userData.r = 3;
          m.rotation.set(Math.PI / 2, 0, 0);
          paint(0.4, audio.beatIntensity);
          color.setHSL(tp[0], tp[1], 0.5);
          m.material.color.copy(color);
        }
      }
      if (numberPlate) numberPlate.lookAt(camera.position);
      {
        const ic = sprinkles.instanceColor;
        for (let i = 0; i < SPRINKLES; i++) {
          const sd = i * 0.618 % 1;
          paint(sd, audio.treble);
          const glint = 0.3 + 0.15 * aliveK + Math.abs(Math.sin(time * (2 + 2 * aliveK) + i * 1.7)) * (0.12 + 0.18 * aliveK) + audio.treble * (0.08 + 0.3 * aliveK);
          color.setHSL(tp[0], Math.max(0.55, tp[1]), Math.min(0.75, glint) * dim);
          ic.setXYZ(i, color.r, color.g, color.b);
        }
        ic.needsUpdate = true;
      }

      // candles: lit ones flicker like real flames, unlit ones wait
      candles.forEach((c, i) => {
        const u = c.userData;
        u.pop = Math.max(0, u.pop - dt * 2);
        const flick = 0.75 + Math.sin(time * 9 + u.seed) * 0.15 + audio.treble * 0.25;
        if (u.on) {
          color.setHSL(0.09, 0.9, 0.6);
          u.fl.material.color.copy(color);
          const lvl = (state === 'blowing' && typeof window.__blowLevel === 'number') ? window.__blowLevel : 0;
          const gone = state === 'blowing' && i < Math.floor(blowProg * CANDLES);
          if (gone || state === 'out' || state === 'sing') {
            u.fl.material.opacity = Math.max(0, u.fl.material.opacity - dt * 4);
            u.fl.scale.setScalar(0.6);
          } else {
            // the flames LEAN and shrink under the breath - the magic trick
            const bend = 1 - lvl * (0.45 + Math.sin(time * 14 + u.seed) * 0.25);
            u.fl.material.opacity = flick * 0.9 * (dim + hushK * 0.9) * Math.max(0.25, bend);
            u.fl.scale.setScalar((1 + u.pop * 1.6 + chorus * 0.4) * (0.8 + flick * 0.3) * Math.max(0.35, bend));
            u.fl.position.x = lvl * 0.5 * Math.sin(u.seed);   // flames lean away together
          }
        } else {
          u.fl.material.opacity = 0.05;
          u.fl.scale.setScalar(0.7);
        }
      });

      // a swoop's delivery lights candles one by one, each with a pop
      if (deliverQueue > 0) {
        deliverT -= dt;
        if (deliverT <= 0) {
          deliverT = 0.16;
          deliverQueue--;
          if (lit < CANDLES) {
            const c = candles[lit];
            c.userData.on = true;
            c.userData.pop = 1;
            lit++;
            if (opts.impact) opts.impact(0.35);
            // every twelfth candle, the cake celebrates the progress
            if (lit % 12 === 0 && lit < CANDLES) {
              this._fire(new THREE.Vector3((Math.random() * 2 - 1) * 14, 14, (Math.random() * 2 - 1) * 14), opts, paint, tp);
            }
            if (lit >= CANDLES) {
              state = 'wish'; stateT = 0; blowProg = 0;
              document.dispatchEvent(new CustomEvent('fp-bday-wish'));
            }
          }
        }
      }

      // ── the flames: drifting the orbit, answering the call, riding the tail ──
      for (const f of flames) {
        const u = f.userData;
        if (!u.live) continue;
        const flick = 0.8 + Math.sin(time * 8 + u.seed) * 0.2;
        color.setHSL(0.1, 0.85, 0.55 + audio.treble * 0.2);
        u.s.material.color.copy(color);
        u.s.material.opacity = (0.55 + audio.treble * 0.3) * flick * dim;
        u.s.scale.setScalar((1 + chorus * 0.5 + (u.dart > 0 ? 0.5 : 0)) * flick);
        if (u.dart > 0) {
          // called: it darts for your light
          u.dart -= dt;
          f.position.lerp(player.position, Math.min(1, dt * 3.2));
        } else {
          // drifting its own slow lap, breathing up and down
          u.a += dt * (0.05 + 0.06 * aliveK) * (state === 'gather' ? 1 : 0.2);
          u.y += Math.sin(time * 0.8 + u.seed) * dt * 0.6;
          f.position.set(Math.cos(u.a) * u.r, u.y, Math.sin(u.a) * u.r);
        }
        // the catch: your light takes it, up to three at a time
        if (state === 'gather' && carried.length < CARRY && f.position.distanceTo(player.position) < 3.1) {
          u.live = false;
          f.visible = true;             // it stays visible: now it rides the tail
          carried.push(f);
          tapGlit = Math.max(tapGlit, 0.6);
          if (opts.impact) opts.impact(0.3 + carried.length * 0.1);
        }
      }

      // carried flames trail the player like fireflies on a string
      carried.forEach((f, i) => {
        const back = ang - (i + 1) * 0.14;
        const target = this._tv || (this._tv = new THREE.Vector3());
        target.set(Math.cos(back) * orbitR, heightY + 0.4 + i * 0.3, Math.sin(back) * orbitR);
        f.position.lerp(target, Math.min(1, dt * 6));
        f.userData.s.material.opacity = 0.8;
        f.userData.s.scale.setScalar(0.8);
      });

      // ── the delivery: swoop CLOSE over the cake and the candles take them ──
      const flat = Math.hypot(player.position.x, player.position.z);
      if (state === 'gather' && carried.length && flat < 15.5) {
        deliverQueue += carried.length;
        if (carried.length === CARRY) {
          // a full string of three earns its own firework
          this._fire(player.position.clone(), opts, paint, tp);
        }
        for (const f of carried) { dealFlame(f); }
        carried = [];
        deliverT = 0;
        if (opts.impact) opts.impact(0.5);
      }

      // ── the ceremony ──
      stateT += dt;
      // blowing: their real breath (or their taps) puts the candles out
      if (state === 'blowing') {
        const lvl = (typeof window.__blowLevel === 'number') ? window.__blowLevel : 0;
        blowProg = Math.min(1, blowProg + lvl * dt * 0.5);
        if (blowProg >= 1) {
          state = 'out'; stateT = 0;
          document.dispatchEvent(new CustomEvent('fp-bday-blown'));
          if (opts.impact) opts.impact(0.3);
        }
      }
      // out: one dark beat with nothing in it - the room before the cheer
      if (state === 'out' && stateT > 0.9) { state = 'sing'; stateT = 0; }
      if (state === 'sing') {
        if (stateT > 1.1 && !this._sung) {
          this._sung = true;
          document.dispatchEvent(new CustomEvent('fp-bday'));
          this._volleys = 5;
          this._nextVolley = 0;
          wishStar = { t: -2.2 };   // waits out the banner, then crosses
        }
        if (this._sung && this._volleys > 0 && stateT > this._nextVolley + 1.1) {
          this._nextVolley = stateT;
          this._volleys--;
          const at = new THREE.Vector3((Math.random() * 2 - 1) * 26, 8 + Math.random() * 14, (Math.random() * 2 - 1) * 26);
          this._fire(at, opts, paint, tp);
          if (this._volleys === 2) document.dispatchEvent(new CustomEvent('fp-lookspark'));
        }
        if (this._sung && this._volleys <= 0 && stateT > this._nextVolley + 2.5) {
          this._sung = false;
          finales++;
          this._lanternWant = Math.min(20, 4 + finales * 3);
          candles.forEach(c => { c.userData.on = false; });
          lit = 0;
          state = 'gather'; stateT = 0;
        }
      }

      // the wish star: one streak across the whole sky, the wish leaving
      if (wishStar) {
        wishStar.t += dt;
        if (!wishStar.m && wishStar.t >= 0) {
          const star = glowSprite(6);
          const tail = new THREE.Mesh(
            new THREE.PlaneGeometry(26, 0.5),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false })
          );
          tail.position.x = 13.5;
          const g2 = new THREE.Group();
          g2.add(star, tail);
          g2.position.set(camera.position.x + 46, 34, camera.position.z - 40);
          g2.rotation.z = -0.28;
          group.add(g2);
          wishStar.m = g2; wishStar.star = star; wishStar.tail = tail;
        }
        if (wishStar.m) {
          wishStar.m.position.x -= dt * 44;
          wishStar.m.position.y -= dt * 12;
          const k = Math.min(1, wishStar.t / 2.4);
          wishStar.star.material.opacity = 0.9 * (1 - k);
          wishStar.tail.material.opacity = 0.5 * (1 - k);
          if (k >= 1) {
            group.remove(wishStar.m);
            wishStar.m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
            wishStar = null;
          }
        }
      }

      // firework physics
      for (const b of bursts) {
        if (!b.visible) continue;
        b.userData.life -= dt * 0.55;
        if (b.userData.life <= 0) { b.visible = false; continue; }
        const posA = b.geometry.attributes.position;
        const k = 1 - b.userData.life;
        for (let j = 0; j < b.userData.vel.length; j++) {
          const v = b.userData.vel[j];
          posA.setXYZ(j, v.x * k * 2.2, v.y * k * 2.2 - k * k * 6, v.z * k * 2.2);
        }
        posA.needsUpdate = true;
        b.material.opacity = Math.min(1, b.userData.life * 1.6);
      }
      if (rain.visible) {
        rainOn -= dt;
        const dum2 = this._dum2 || (this._dum2 = new THREE.Object3D());
        const ic = rain.instanceColor;
        let alive = 0;
        for (let i = 0; i < RAIN; i++) {
          const d = rainDrops[i];
          if (d.y <= -90) { dum2.position.set(0, -999, 0); dum2.updateMatrix(); rain.setMatrixAt(i, dum2.matrix); continue; }
          alive++;
          d.vy -= dt * 5;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          if (d.y < -14) { d.y = -99; continue; }
          dum2.position.set(d.x, d.y, d.z);
          dum2.rotation.set(time * d.tumble + d.spin, d.spin, time * d.tumble * 0.7);
          dum2.updateMatrix();
          rain.setMatrixAt(i, dum2.matrix);
          paint((i * 0.618) % 1, 1);
          color.setHSL(tp[0], Math.max(0.6, tp[1]), 0.6);
          ic.setXYZ(i, color.r, color.g, color.b);
        }
        rain.instanceMatrix.needsUpdate = true;
        ic.needsUpdate = true;
        if (!alive && rainOn <= 0) rain.visible = false;
      }
      for (const m of rings) {
        if (!m.visible) continue;
        m.userData.r += dt * 26;
        if (m.userData.r > 34) { m.visible = false; continue; }
        m.scale.setScalar(m.userData.r);
        m.material.opacity = Math.max(0, 0.5 * (1 - m.userData.r / 30));
      }

      // lanterns drift up forever, one warm light per finale survived
      while (lanterns.length < this._lanternWant) {
        const l = glowSprite(5);
        l.position.set((Math.random() * 2 - 1) * 50, -12 + Math.random() * 8, (Math.random() * 2 - 1) * 50);
        l.userData = { seed: Math.random() * 100, rise: 0.5 + Math.random() * 0.6 };
        group.add(l);
        lanterns.push(l);
      }
      for (const l of lanterns) {
        l.position.y += l.userData.rise * dt;
        l.position.x += Math.sin(time * 0.4 + l.userData.seed) * dt * 0.5;
        if (l.position.y > 40) { l.position.y = -12; l.position.x = (Math.random() * 2 - 1) * 50; }
        color.setHSL(0.08, 0.8, 0.5);
        l.material.color.copy(color);
        l.material.opacity = (0.25 + Math.sin(time * 2 + l.userData.seed) * 0.08 + audio.mid * 0.15) * dim;
        l.scale.setScalar(0.8 + Math.sin(time * 1.5 + l.userData.seed) * 0.15);
      }

      // the player's light answers taps; the call sends a visible pulse ring
      tapGlit = Math.max(0, tapGlit - dt * 1.6);
      callPulse = Math.max(0, callPulse - dt * 2.2);
      paint(0.5, audio.mid);
      color.setHSL(tp[0], tp[1], Math.min(0.75, 0.55 + tapGlit * 0.3));
      player.material.color.copy(color);
      halo.material.color.copy(color);
      halo.material.opacity = 0.35 + tapGlit * 0.4 + audio.beatIntensity * 0.15;
      halo.scale.setScalar(1 + tapGlit * 1.2 + callPulse * 1.8 + audio.bass * 0.3 + carried.length * 0.25);

      // ── the chase camera: behind the rider, the night streaming past ──
      const camBack = ang - 0.34;
      const camR = orbitR + 7 - surge * 2.5;
      const cx = Math.cos(camBack) * camR, cz = Math.sin(camBack) * camR;
      camera.position.lerp(this._cv || (this._cv = new THREE.Vector3(cx, heightY + 3.2, cz)), 0);
      this._cv.set(cx, heightY + 3.2 + Math.sin(time * 0.3) * 0.6, cz);
      camera.position.lerp(this._cv, Math.min(1, dt * 4));
      const look = this._lv || (this._lv = new THREE.Vector3());
      // look ahead of the rider, with the cake sweeping through frame
      look.set(Math.cos(ang + 0.5) * orbitR * 0.55, heightY * 0.6 + 1.5, Math.sin(ang + 0.5) * orbitR * 0.55);
      camera.lookAt(look);
      const fovT = 74 + aliveK * 2 + audio.volume * (3 + 4 * aliveK) * reactivity + surge * 8 + hushK * -6;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();

      // the quiet HUD: candles lit, and fireflies on the string
      if (window.__setFigure) window.__setFigure('CANDLES', lit, CANDLES);
      window.__bdayInfo = { state, lit, blowProg: Math.round(blowProg * 100) / 100, stateT: Math.round(stateT * 10) / 10, dt: Math.round(dt * 1000), mic: window.__blowLevel === undefined ? 'undef' : window.__blowLevel === null ? 'null' : 'live' };
    },

    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      rims = []; candles = []; flames = []; bursts = []; rings = []; lanterns = []; carried = [];
      if (window.__setFigure) window.__setFigure(null);
    },
  };
}
