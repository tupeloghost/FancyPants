// BIRTHDAY — an occasion world in three acts, reached by a link with a name
// on it, never by the weekly rotation.
//   ACT I   you fly through a confetti universe catching golden flames -
//           the night wakes a little with every one you take
//   ACT II  with the flames gathered, a wrapped gift drifts in out of the
//           dark. you fly into it and it bursts open -
//   ACT III - revealing the cake. your flames cascade onto its candles,
//           the world asks for a wish, and their real BREATH blows the
//           candles out. fireworks, their name across the sky, sprinkle
//           rain, a wish star. Chic and starry, never arcade.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=682';
import { themePaint } from '../lib/themes.js?v=682';

const CANDLES_DEFAULT = 13;
const LITE = !!window.__LITE;
const FLAMES = LITE ? 5 : 7;          // oncoming flames alive at once
const CONFETTI = LITE ? 260 : 480;    // the universe itself: streaming candy
const STARS = LITE ? 300 : 550;
const BURSTS = LITE ? 6 : 10;
const RAIN = LITE ? 120 : 220;
const TAIL = 10;                      // fireflies shown on the tail (the rest glow inside you)

export function createBirthday() {
  const CANDLES = window.__BDAY_N || CANDLES_DEFAULT;
  let scene, camera, group;
  let sky, stars, confetti, confBits = [];
  let cake, rims = [], candles = [], sprinkles = null, numberPlate = null;
  let giftBox = null, lid = null, ribbonV = null, ribbonH = null, bowKnot = null;
  let flames = [], bursts = [], rings = [], lanterns = [], rain = null, rainDrops = [], rainOn = 0;
  let tailFlies = [];
  let player, halo;
  let steer = { x: 0, y: 0 }, steerTarget = { x: 0, y: 0 };
  let caught = 0, lit = 0, finales = 0;
  let travel = 0, surge = 0;
  // fly -> gift -> open -> cascade -> wish -> blowing -> out -> sing -> after
  let state = 'fly';
  let stateT = 0, blowProg = 0, cascadeT = 0;
  let tapGlit = 0, callPulse = 0;
  let hintT = 0, hintedFly = false, hintedGift = false;
  let wishStar = null;
  const color = new THREE.Color();
  const CAKE_POS = new THREE.Vector3(0, -9, -34);

  const mkFlame = () => {
    const g = new THREE.Group();
    const s = glowSprite(4.4);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff2d0, toneMapped: false })
    );
    g.add(s, core);
    g.userData = { s, core, seed: Math.random() * 100, live: false, dart: 0 };
    return g;
  };

  // flames come to meet you out of the deep: pick a lane, hold it
  const dealFlame = (f, first) => {
    const u = f.userData;
    u.live = true;
    u.dart = 0;
    f.visible = true;
    f.position.set(
      (Math.random() * 2 - 1) * 8,
      (Math.random() * 2 - 1) * 4.5,
      -60 - Math.random() * (first ? 40 : 70)
    );
    u.seed = Math.random() * 100;
  };

  return {
    name: 'BIRTHDAY',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x05030a, 0.009);

      sky = skyDome(300, 0);
      group.add(sky);

      const sp = new Float32Array(STARS * 3);
      for (let i = 0; i < STARS; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(120 + Math.random() * 140);
        sp.set([v.x, v.y, v.z], i * 3);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      stars = new THREE.Points(sg, glowPoints(1.4, 0.6));
      stars.material.color.set(0x8f9cc4);
      group.add(stars);

      // ── the confetti universe: candy streaming past forever ──
      const cGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.55, 6);
      const cMat = new THREE.MeshBasicMaterial({ toneMapped: false });
      confetti = new THREE.InstancedMesh(cGeo, cMat, CONFETTI);
      confetti.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CONFETTI * 3), 3);
      confetti.frustumCulled = false;
      confBits = [];
      for (let i = 0; i < CONFETTI; i++) {
        confBits.push({
          x: (Math.random() * 2 - 1) * 34,
          y: (Math.random() * 2 - 1) * 20,
          z: -Math.random() * 140,
          spin: Math.random() * 6,
          tumble: 0.6 + Math.random() * 2.4,
          hueSeed: (i * 0.618) % 1,
        });
      }
      group.add(confetti);

      // ── the cake, hidden inside its gift until Act III ──
      cake = new THREE.Group();
      const tiers = [[15, 5.4], [10.6, 4.8], [6.8, 4.2]];
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
          new THREE.MeshBasicMaterial({ color: 0x453f66, toneMapped: false })
        );
        stick.position.y = 1.1;
        const fl = glowSprite(2.6);
        fl.position.y = 2.6;
        fl.material.opacity = 0.012;
        c.add(stick, fl);
        c.position.set(Math.cos(a) * (4.6 - row * 1.8), ty, Math.sin(a) * (4.6 - row * 1.8));
        c.userData = { fl, stick, on: false, pop: 0, seed: i * 7.3 };
        cake.add(c);
        candles.push(c);
      }
      // sprinkles on the tier tops
      const SPR = LITE ? 80 : 140;
      const sprGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 6);
      sprinkles = new THREE.InstancedMesh(sprGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), SPR);
      sprinkles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SPR * 3), 3);
      const dum = new THREE.Object3D();
      const tierTops = [[15, 10.6, 5.4], [10.6, 6.8, 10.2], [6.8, 5.1, 14.4]];
      for (let i = 0; i < SPR; i++) {
        const [ro, ri, y] = tierTops[i % 3];
        const rr = ri + Math.random() * (ro - ri - 0.6);
        const aa = Math.random() * Math.PI * 2;
        dum.position.set(Math.cos(aa) * rr, y + 0.12, Math.sin(aa) * rr);
        dum.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 0.5, 0, Math.random() * Math.PI);
        dum.updateMatrix();
        sprinkles.setMatrixAt(i, dum.matrix);
      }
      cake.add(sprinkles);
      this._sprN = SPR;
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
        numberPlate = new THREE.Mesh(
          new THREE.PlaneGeometry(6, 6),
          new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, toneMapped: false, depthWrite: false })
        );
        numberPlate.position.set(0, ty + 6.5, 0);
        cake.add(numberPlate);
      }
      cake.position.copy(CAKE_POS);
      cake.scale.setScalar(0.001);      // waiting inside the gift
      cake.visible = false;
      group.add(cake);

      // ── the GIFT: a wrapped box big enough to hold a universe's cake ──
      const boxMat = new THREE.MeshBasicMaterial({ color: 0x1a1030, toneMapped: false });
      const ribMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, toneMapped: false });
      giftBox = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(16, 13, 16), boxMat);
      body.position.y = 6.5;
      lid = new THREE.Group();
      const lidTop = new THREE.Mesh(new THREE.BoxGeometry(17.4, 2.6, 17.4), boxMat.clone());
      ribbonV = new THREE.Mesh(new THREE.BoxGeometry(2.2, 13.3, 16.3), ribMat);
      ribbonV.position.y = 6.5;
      ribbonH = new THREE.Mesh(new THREE.BoxGeometry(16.3, 13.3, 2.2), ribMat.clone());
      ribbonH.position.y = 6.5;
      const lidRibV = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.9, 17.6), ribMat.clone());
      const lidRibH = new THREE.Mesh(new THREE.BoxGeometry(17.6, 2.9, 2.2), ribMat.clone());
      bowKnot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.6, 0.5, 48, 8), ribMat.clone());
      bowKnot.position.y = 2.8;
      lid.add(lidTop, lidRibV, lidRibH, bowKnot);
      lid.position.y = 14.3;
      giftBox.add(body, ribbonV, ribbonH, lid);
      giftBox.position.set(0, -9, -140);
      giftBox.visible = false;
      group.add(giftBox);

      // flames
      for (let i = 0; i < FLAMES; i++) {
        const f = mkFlame();
        dealFlame(f, true);
        group.add(f);
        flames.push(f);
      }
      // tail fireflies: small lights that accumulate behind the player
      for (let i = 0; i < TAIL; i++) {
        const t = glowSprite(2.2);
        t.material.opacity = 0;
        group.add(t);
        tailFlies.push(t);
      }

      // fireworks pools
      for (let i = 0; i < BURSTS; i++) {
        const n = LITE ? 60 : 110;
        const pos = new Float32Array(n * 3), vel = [];
        for (let j = 0; j < n; j++) vel.push(new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 9));
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
      rain = new THREE.InstancedMesh(sprGeo.clone(), new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.95 }), RAIN);
      rain.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RAIN * 3), 3);
      rain.visible = false;
      rain.frustumCulled = false;
      group.add(rain);
      rainDrops = [];
      for (let i = 0; i < RAIN; i++) rainDrops.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, spin: Math.random() * 6, tumble: 1 + Math.random() * 3 });
      rainOn = 0;

      lanterns = [];
      this._lanternWant = 3;

      player = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
      );
      halo = glowSprite(7);
      player.add(halo);
      group.add(player);

      caught = 0; lit = 0; finales = 0; travel = 0; surge = 0;
      state = 'fly'; stateT = 0; blowProg = 0; cascadeT = 0;
      hintT = 0; hintedFly = false; hintedGift = false;
      this._sung = false;

      this._onBlow = () => { if (state === 'wish') { state = 'blowing'; stateT = 0; blowProg = 0; } };
      document.addEventListener('fp-bday-blow', this._onBlow);
      // dev handles: skip to the gift, or straight to the ceremony
      window.__bdayGift = () => { caught = CANDLES; state = 'gift'; stateT = 0; };
      window.__bdayFinale = () => {
        candles.forEach(c => { c.userData.on = true; });
        cake.visible = true; cake.scale.setScalar(1);
        giftBox.visible = false;
        caught = CANDLES; lit = CANDLES;
        state = 'wish'; stateT = 0; blowProg = 0;
        document.dispatchEvent(new CustomEvent('fp-bday-wish'));
      };
      camera.position.set(0, 0.5, 12);
      camera.fov = 76;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { steerTarget.x = x || 0; steerTarget.y = y || 0; },

    placeGhost(p, i, out) {
      out.set((p.x || 0) * 8, (p.y || 0) * 4.5, -6 - (i % 6) * 4);
    },

    onTap() {
      tapGlit = 1;
      callPulse = 1;
      if (state === 'blowing' && window.__blowLevel == null) { blowProg = Math.min(1, blowProg + 0.12); return; }
      if (state !== 'fly' && state !== 'after') return;
      // the CALL: the nearest oncoming flame answers and darts to your light
      let best = null, bd = 60;
      for (const f of flames) {
        if (!f.userData.live || f.userData.dart > 0 || f.position.z > 0) continue;
        const d = f.position.distanceTo(player.position);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) best.userData.dart = 1.8;
    },

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
      // the waking: the universe brightens with every flame taken, and once
      // the cake is out it stays fully awake
      const aliveK = (state === 'fly' || state === 'gift' || state === 'open')
        ? 0.15 + 0.85 * Math.min(1, caught / CANDLES)
        : 1;
      const ceremonyDim = (state === 'wish' || state === 'blowing') ? 0.45 : state === 'out' ? 0.18 : 1;

      if (attract) { steerTarget.x = Math.sin(time * 0.33) * 0.6; steerTarget.y = Math.sin(time * 0.27) * 0.5; }
      steer.x += (steerTarget.x - steer.x) * Math.min(1, dt * 4.5);
      steer.y += (steerTarget.y - steer.y) * Math.min(1, dt * 4.5);
      player.position.set(steer.x * 8, steer.y * 4.5, 0);
      if (participants && participants[0]) { participants[0].x = steer.x; participants[0].y = steer.y; }

      // ── the flight itself: the universe streams past, faster on HOLD ──
      surge += ((opts.holding ? 1 : 0) - surge) * Math.min(1, dt * 4);
      const flying = state === 'fly' || state === 'gift' || state === 'after';
      const speed = flying ? (10 + aliveK * 8 + audio.volume * 8 * reactivity + surge * 16 + chorus * 4) : 2;
      travel += speed * dt;

      // sky and stars
      paint(0.9, audio.mid);
      color.setHSL(tp[0], tp[1] * 0.6, Math.min(0.38, (0.08 + 0.18 * aliveK + audio.energy * 0.18 * aliveK) * tp[2]) * ceremonyDim);
      sky.material.color.copy(color);
      stars.material.opacity = (0.3 + 0.3 * aliveK + audio.high * 0.3 * aliveK) * ceremonyDim;
      stars.rotation.z = time * 0.003;

      // ── the confetti universe streams and tumbles, waking as he gathers ──
      {
        const dum2 = this._dum2 || (this._dum2 = new THREE.Object3D());
        const ic = confetti.instanceColor;
        for (let i = 0; i < CONFETTI; i++) {
          const c2 = confBits[i];
          c2.z += speed * dt * (0.6 + (i % 5) * 0.12);
          if (c2.z > 12) {
            c2.z -= 150;
            c2.x = (Math.random() * 2 - 1) * 34;
            c2.y = (Math.random() * 2 - 1) * 20;
          }
          dum2.position.set(c2.x, c2.y, c2.z);
          dum2.rotation.set(time * c2.tumble + c2.spin, c2.spin, time * c2.tumble * 0.6);
          const sc = 0.7 + 0.5 * aliveK + audio.beatIntensity * 0.35 * aliveK;
          dum2.scale.setScalar(sc);
          dum2.updateMatrix();
          confetti.setMatrixAt(i, dum2.matrix);
          paint(c2.hueSeed, audio.mid);
          const lum = (0.22 + 0.3 * aliveK + audio.treble * 0.2 * aliveK) * ceremonyDim;
          color.setHSL(tp[0], Math.max(0.55, tp[1]), Math.min(0.7, lum));
          ic.setXYZ(i, color.r, color.g, color.b);
        }
        confetti.instanceMatrix.needsUpdate = true;
        ic.needsUpdate = true;
      }

      // ── ACT I: the flames come to meet you ──
      if (state === 'fly' || state === 'after') {
        for (const f of flames) {
          const u = f.userData;
          if (!u.live) continue;
          f.visible = true;
          const flick = 0.8 + Math.sin(time * 8 + u.seed) * 0.2;
          color.setHSL(0.1, 0.85, 0.58 + audio.treble * 0.2);
          u.s.material.color.copy(color);
          u.s.material.opacity = (0.7 + audio.treble * 0.25) * flick;
          u.s.scale.setScalar((1 + chorus * 0.4 + (u.dart > 0 ? 0.5 : 0)) * flick);
          if (u.dart > 0) {
            u.dart -= dt;
            f.position.lerp(player.position, Math.min(1, dt * 3.4));
          } else {
            f.position.z += speed * dt;
            f.position.x += Math.sin(time * 1.1 + u.seed) * dt * 1.1;
            f.position.y += Math.cos(time * 0.9 + u.seed) * dt * 0.8;
            if (f.position.z > 8) dealFlame(f);
          }
          // the catch: lane and height, generous, as it reaches you
          const dz = Math.abs(f.position.z - player.position.z);
          if (dz < 3.5 && Math.hypot(f.position.x - player.position.x, f.position.y - player.position.y) < 3.4) {
            if (state === 'fly') {
              caught = Math.min(CANDLES, caught + 1);
              if (caught >= CANDLES) { state = 'gift'; stateT = 0; }
            }
            dealFlame(f);
            tapGlit = Math.max(tapGlit, 0.6);
            if (opts.impact) opts.impact(0.3);
            if (state === 'after') this._fire(player.position.clone().add(new THREE.Vector3(0, 3, -8)), opts, paint, tp);
          }
        }
      } else {
        for (const f of flames) f.visible = false;
      }

      // the tail: your gathered flames fly with you, and your light grows
      const shown = state === 'fly' || state === 'gift' || state === 'open' ? Math.min(TAIL, caught) : 0;
      tailFlies.forEach((t, i) => {
        const on = i < shown;
        t.material.opacity += ((on ? 0.75 : 0) - t.material.opacity) * Math.min(1, dt * 3);
        if (t.material.opacity < 0.02) return;
        const a2 = time * 1.4 + i * (Math.PI * 2 / TAIL);
        const tv = this._tv || (this._tv = new THREE.Vector3());
        tv.set(player.position.x + Math.cos(a2) * (1.6 + i * 0.12), player.position.y + Math.sin(a2) * 1.1, player.position.z - 1.2 - i * 0.35);
        t.position.lerp(tv, Math.min(1, dt * 5));
        color.setHSL(0.1, 0.85, 0.55);
        t.material.color.copy(color);
        t.scale.setScalar(0.7 + Math.sin(time * 5 + i) * 0.15);
      });

      // ── ACT II: the gift drifts in from the deep ──
      if (state === 'gift') {
        if (!giftBox.visible) {
          giftBox.visible = true;
          giftBox.position.set(0, -9, -130);
          if (!hintedGift) {
            hintedGift = true;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'a gift! fly into it' }));
          }
        }
        giftBox.position.z = Math.min(-16, giftBox.position.z + speed * dt * 0.55);
        giftBox.rotation.y = Math.sin(time * 0.4) * 0.12;
        giftBox.position.y = -9 + Math.sin(time * 0.9) * 0.5;
        const gl = 0.5 + audio.bass * 0.4 + Math.sin(time * 2.5) * 0.15;
        [ribbonV, ribbonH, bowKnot, lid.children[1], lid.children[2]].forEach(rb => {
          if (rb && rb.material) rb.material.color.setHSL(0.11, 0.85, Math.min(0.72, gl));
        });
        // flying INTO it opens it
        if (giftBox.position.z >= -20 && Math.hypot(player.position.x, player.position.y + 4) < 9) {
          state = 'open'; stateT = 0;
          this._fire(giftBox.position.clone().add(new THREE.Vector3(0, 12, 0)), opts, paint, tp);
          if (opts.impact) opts.impact(0.8);
        }
      }

      // ── the OPENING: the lid flies, the box falls away, the cake rises ──
      if (state === 'open') {
        const k = Math.min(1, stateT / 1.6);
        lid.position.y = 14.3 + k * k * 60;
        lid.rotation.z = k * 2.4;
        lid.rotation.x = k * 1.1;
        giftBox.children[0].material.opacity = 1 - k;
        giftBox.children[0].material.transparent = true;
        [ribbonV, ribbonH].forEach(rb => { rb.material.opacity = 1 - k; rb.material.transparent = true; });
        if (!cake.visible && k > 0.35) cake.visible = true;
        if (cake.visible) {
          const ck = Math.min(1, Math.max(0, (k - 0.35) / 0.6));
          const e = 1 - Math.pow(1 - ck, 3);
          cake.scale.setScalar(0.001 + e * 0.999);
        }
        if (k >= 1) {
          giftBox.visible = false;
          state = 'cascade'; stateT = 0; cascadeT = 0;
          document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'your flames light the candles' }));
        }
      }

      // ── ACT III: the cascade - every gathered flame finds its candle ──
      if (state === 'cascade') {
        cascadeT -= dt;
        if (cascadeT <= 0 && lit < CANDLES) {
          cascadeT = Math.max(0.06, 1.6 / CANDLES + 0.04);
          const c = candles[lit];
          c.userData.on = true;
          c.userData.pop = 1;
          lit++;
          if (lit % 12 === 0 && opts.impact) opts.impact(0.4);
          if (lit >= CANDLES) {
            state = 'wish'; stateT = 0;
            document.dispatchEvent(new CustomEvent('fp-bday-wish'));
          }
        }
      }

      // ── the cake lives (once it exists) ──
      if (cake.visible) {
        rims.forEach((rim, i) => {
          paint(0.15 + i * 0.25, audio.bass);
          color.setHSL(tp[0], tp[1], Math.min(0.62, (0.34 + audio.bass * 0.3) * Math.min(1.3, tp[2])) * ceremonyDim);
          rim.material.color.copy(color);
          rim.scale.setScalar(1 + audio.bass * 0.05 * reactivity);
          color.setHSL(tp[0], tp[1] * 0.7, (0.08 + audio.bass * 0.05) * ceremonyDim);
          cake.children[i * 2].material.color.copy(color);
        });
        cake.rotation.y = time * 0.08;
        cake.scale.y = cake.scale.x * (1 + audio.beatIntensity * 0.04);
        if (numberPlate) numberPlate.lookAt(camera.position);
        {
          const ic = sprinkles.instanceColor;
          for (let i = 0; i < this._sprN; i++) {
            paint((i * 0.618) % 1, audio.treble);
            const glint = 0.4 + Math.abs(Math.sin(time * 3.5 + i * 1.7)) * 0.25 + audio.treble * 0.25;
            color.setHSL(tp[0], Math.max(0.55, tp[1]), Math.min(0.72, glint) * ceremonyDim);
            ic.setXYZ(i, color.r, color.g, color.b);
          }
          ic.needsUpdate = true;
        }
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
              const bend = 1 - lvl * (0.45 + Math.sin(time * 14 + u.seed) * 0.25);
              u.fl.material.opacity = flick * 0.95 * Math.max(0.25, bend);
              u.fl.scale.setScalar((1 + u.pop * 1.6 + chorus * 0.4) * (0.8 + flick * 0.3) * Math.max(0.35, bend));
              u.fl.position.x = lvl * 0.5 * Math.sin(u.seed);
            }
            u.stick.material.color.set(0xd8cfee);
          } else {
            u.fl.material.opacity = 0.012;
            u.fl.scale.setScalar(0.4);
            u.stick.material.color.set(0x453f66);
          }
        });
      }

      // whispers at the right moment
      if (state === 'fly') {
        hintT += dt;
        if (!hintedFly && hintT > 8 && caught === 0) {
          hintedFly = true;
          document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'fly into the flames. tap and one comes to you' }));
        }
      }

      // ── the ceremony ──
      stateT += dt;
      if (state === 'blowing') {
        const lvl = (typeof window.__blowLevel === 'number') ? window.__blowLevel : 0;
        blowProg = Math.min(1, blowProg + lvl * dt * 0.5);
        if (blowProg >= 1) {
          state = 'out'; stateT = 0;
          document.dispatchEvent(new CustomEvent('fp-bday-blown'));
          if (opts.impact) opts.impact(0.3);
        }
      }
      if (state === 'out' && stateT > 0.9) { state = 'sing'; stateT = 0; }
      if (state === 'sing') {
        if (stateT > 1.1 && !this._sung) {
          this._sung = true;
          document.dispatchEvent(new CustomEvent('fp-bday'));
          this._volleys = 5;
          this._nextVolley = 0;
          wishStar = { t: -2.2 };
        }
        if (this._sung && this._volleys > 0 && stateT > this._nextVolley + 1.1) {
          this._nextVolley = stateT;
          this._volleys--;
          const at = new THREE.Vector3((Math.random() * 2 - 1) * 24, 6 + Math.random() * 14, -30 - Math.random() * 22);
          this._fire(at, opts, paint, tp);
          if (this._volleys === 2) document.dispatchEvent(new CustomEvent('fp-lookspark'));
        }
        if (this._sung && this._volleys <= 0 && stateT > this._nextVolley + 2.5) {
          this._sung = false;
          finales++;
          this._lanternWant = Math.min(20, 3 + finales * 4);
          // the candles stay LIT and the party stays: flames keep coming for
          // the joy of it, every catch its own small firework
          state = 'after'; stateT = 0;
          for (const f of flames) dealFlame(f, true);
        }
      }

      // the wish star
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
          g2.position.set(46, 30, -60);
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
        const dum3 = this._dum3 || (this._dum3 = new THREE.Object3D());
        const ic = rain.instanceColor;
        let alive = 0;
        for (let i = 0; i < RAIN; i++) {
          const d = rainDrops[i];
          if (d.y <= -90) { dum3.position.set(0, -999, 0); dum3.updateMatrix(); rain.setMatrixAt(i, dum3.matrix); continue; }
          alive++;
          d.vy -= dt * 5;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          if (d.y < -16) { d.y = -99; continue; }
          dum3.position.set(d.x, d.y, d.z);
          dum3.rotation.set(time * d.tumble + d.spin, d.spin, time * d.tumble * 0.7);
          dum3.updateMatrix();
          rain.setMatrixAt(i, dum3.matrix);
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

      // lanterns
      while (lanterns.length < this._lanternWant) {
        const l = glowSprite(5);
        l.position.set((Math.random() * 2 - 1) * 46, -14 + Math.random() * 8, -20 - Math.random() * 70);
        l.userData = { seed: Math.random() * 100, rise: 0.5 + Math.random() * 0.6 };
        group.add(l);
        lanterns.push(l);
      }
      for (const l of lanterns) {
        l.position.y += l.userData.rise * dt;
        l.position.x += Math.sin(time * 0.4 + l.userData.seed) * dt * 0.5;
        if (l.position.y > 34) { l.position.y = -14; l.position.x = (Math.random() * 2 - 1) * 46; }
        color.setHSL(0.08, 0.8, 0.5);
        l.material.color.copy(color);
        l.material.opacity = (0.22 + Math.sin(time * 2 + l.userData.seed) * 0.08 + audio.mid * 0.15) * ceremonyDim;
        l.scale.setScalar(0.8 + Math.sin(time * 1.5 + l.userData.seed) * 0.15);
      }

      // the player's light: brighter for every flame inside it
      tapGlit = Math.max(0, tapGlit - dt * 1.6);
      callPulse = Math.max(0, callPulse - dt * 2.2);
      paint(0.5, audio.mid);
      color.setHSL(tp[0], tp[1], Math.min(0.78, 0.5 + tapGlit * 0.3 + 0.15 * (caught / CANDLES)));
      player.material.color.copy(color);
      halo.material.color.copy(color);
      halo.material.opacity = 0.35 + tapGlit * 0.4 + audio.beatIntensity * 0.15 + 0.2 * (caught / CANDLES);
      halo.scale.setScalar(1 + tapGlit * 1.1 + callPulse * 1.6 + audio.bass * 0.3 + (caught / CANDLES) * 0.6);

      // ── the camera: a steady flight; the ceremony draws it to the cake ──
      const camT = this._camT || (this._camT = new THREE.Vector3(0, 0.5, 12));
      const lookT = this._lookT || (this._lookT = new THREE.Vector3(0, 0, -40));
      if (flying || state === 'open') {
        camT.set(steer.x * 3, 0.5 + steer.y * 2 + Math.sin(time * 0.3) * 0.5, 12 - surge * 2.5);
        lookT.set(steer.x * 4, steer.y * 2.5, -50);
      } else {
        camT.set(Math.sin(time * 0.06) * 8, 3.5, 4);
        lookT.set(CAKE_POS.x, CAKE_POS.y + 12, CAKE_POS.z);
      }
      camera.position.lerp(camT, Math.min(1, dt * 3));
      const lv = this._lv || (this._lv = new THREE.Vector3(0, 0, -40));
      lv.lerp(lookT, Math.min(1, dt * 3));
      camera.lookAt(lv);
      const fovT = 76 + audio.volume * (3 + 4 * aliveK) * reactivity + surge * 8 - (state === 'wish' || state === 'blowing' ? 6 : 0);
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();

      // the quiet HUD: flames gathered, then candles lit
      if (window.__setFigure) {
        if (state === 'fly') window.__setFigure('FLAMES', caught, CANDLES);
        else window.__setFigure('CANDLES', lit, CANDLES);
      }
      window.__bdayInfo = { state, caught, lit, blowProg: Math.round(blowProg * 100) / 100, stateT: Math.round(stateT * 10) / 10, mic: window.__blowLevel === undefined ? 'undef' : window.__blowLevel === null ? 'null' : 'live' };
    },

    dispose() {
      document.removeEventListener('fp-bday-blow', this._onBlow);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      rims = []; candles = []; flames = []; bursts = []; rings = []; lanterns = []; confBits = []; tailFlies = [];
      if (window.__setFigure) window.__setFigure(null);
    },
  };
}
