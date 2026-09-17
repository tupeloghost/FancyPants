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
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=744';
import { themePaint } from '../lib/themes.js?v=744';

const CANDLES_DEFAULT = 13;
const LITE = !!window.__LITE;
const FLAMES = LITE ? 5 : 7;          // oncoming flames alive at once
const CONFETTI = LITE ? 260 : 480;    // the universe itself: streaming candy
const STARS = LITE ? 300 : 550;
const BURSTS = LITE ? 6 : 10;
const RAIN = LITE ? 120 : 220;
const TAIL = 10;                      // fireflies shown on the tail (the rest glow inside you)
const EMBERS = LITE ? 3 : 5;          // loose embers on the course: red means NEVER

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
  // radio -> drive -> arrive -> douse -> record -> fly -> rush -> gift -> open -> cascade -> wish -> blowing -> out -> sing -> after
  let state = window.__radioWaiting ? 'radio' : 'fly';
  let stateT = 0, blowProg = 0, cascadeT = 0;
  let tapGlit = 0, callPulse = 0;
  let hintT = 0, hintedFly = false, hintedGift = false;
  let commsSent = 0, briefed = false;   // dispatch speaks in quarters
  let embers = [], emberHurtT = 0;      // red heat on the course; clip one and a flame breaks loose
  // ── the PROLOGUE: the fire call ──
  let road = null, dashes = null, dashBits = [], cones = [], house = null, houseFires = [], smoke = [];
  let room = null, platter = null, tonearm = null;
  let drove = 0, coneSlowT = 0, dousedAll = false, sprayPts = null, sprayBits = [];
  let driveT = 0, traffic = [], reigniteWarnT = 0;
  const DRIVE_DIST = 520;
  const DRIVE_PAR = 26;   // beat the par or the porch spreads
  let wishStar = null;
  const color = new THREE.Color();
  const CAKE_POS = new THREE.Vector3(0, -9, -34);

  const mkFlame = () => {
    const g = new THREE.Group();
    const s = glowSprite(5.4);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff2d0, toneMapped: false })
    );
    // the slim gold ring is the house word for GO THROUGH THIS
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.06, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffce70, transparent: true, opacity: 0.85, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    g.add(s, core, ring);
    g.userData = { s, core, ring, seed: Math.random() * 100, live: false, dart: 0 };
    return g;
  };

  // ── the COURSE ── flames are not scattered: they hang on one winding
  // trail through the night, each leading the eye to the next. Following
  // the string IS the flying.
  let courseAt = 70;                     // course-distance of the next flame dealt
  const COURSE_GAP = 84;                 // spacing along the trail - long reaches, every catch earned
  // the chase ESCALATES: each quarter contained, the course swings wider
  const heat = () => 1 + Math.min(0.8, (caught / CANDLES) * 0.8);
  // REACH CONTRACT: the player's light spans x +-8, y +-4.5. The course may
  // swing up to x +-6 and y +-3.3 (growing from 70% to 100% as candles light),
  // plus each flame's wander (<=1.1 x, <=0.77 y) - so the farthest flame
  // still sits inside reach, before the 2.4 catch radius even helps
  const reachK = () => 0.75 + 0.25 * Math.min(1, caught / CANDLES);
  const laneX = d => (Math.sin(d * 0.021) * 0.69 + Math.sin(d * 0.0072) * 0.31) * 4.8 * reachK();
  const laneY = d => (Math.sin(d * 0.0137) * 0.67 + Math.cos(d * 0.019) * 0.33) * 2.6 * reachK();
  const mkEmber = () => {
    const g = new THREE.Group();
    const glow = glowSprite(4.6);
    glow.material.color.set(0xff4422);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x1a0503, toneMapped: false })
    );
    g.add(glow, core);
    g.userData = { glow, seed: Math.random() * 100, live: false, d: 0 };
    g.visible = false;
    return g;
  };
  const dealEmber = (e) => {
    const u = e.userData;
    u.live = true;
    e.visible = true;
    u.d = courseAt + COURSE_GAP * (0.4 + Math.random() * 0.3);
    u.off = (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 1.6);
    e.position.set(laneX(u.d) + u.off, laneY(u.d) + u.off * 0.4, -(u.d - travel));
    u.seed = Math.random() * 100;
  };
  const dealFlame = (f) => {
    const u = f.userData;
    u.live = true;
    u.dart = 0;
    f.visible = true;
    // the chase breathes: tight clusters (grab grab grab), then a long reach
    const roll = Math.random();
    courseAt += roll < 0.35 ? COURSE_GAP * 0.4 : roll < 0.8 ? COURSE_GAP : COURSE_GAP * 2;
    u.d = courseAt;
    u.wob = 0.25 + Math.random() * 0.5;   // each flame wanders its own amount (fair against the ring)
    f.position.set(laneX(u.d), laneY(u.d), -(u.d - travel));
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

      // ── PROLOGUE SET 1: the midnight street, the smoky house far ahead ──
      road = new THREE.Group();
      const tarmac = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 400),
        new THREE.MeshBasicMaterial({ color: 0x0a0912, toneMapped: false })
      );
      tarmac.rotation.x = -Math.PI / 2;
      tarmac.position.set(0, -4, -160);
      road.add(tarmac);
      // the world beyond the road: dark grass, a horizon that glows faintly
      for (const gx of [-45, 45]) {
        const grass = new THREE.Mesh(new THREE.PlaneGeometry(60, 400),
          new THREE.MeshBasicMaterial({ color: 0x070d06, toneMapped: false }));
        grass.rotation.x = -Math.PI / 2;
        grass.position.set(gx, -4.05, -160);
        road.add(grass);
      }
      const horizon = glowSprite(90);
      horizon.material.color.set(0x2a2348);
      horizon.material.opacity = 0.35;
      horizon.scale.y = 0.22;
      horizon.position.set(0, 2, -330);
      road.add(horizon);
      dashes = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.5, 0.05, 4),
        new THREE.MeshBasicMaterial({ color: 0xbfb89a, toneMapped: false }), 24);
      dashBits = [];
      for (let i = 0; i < 24; i++) dashBits.push({ z: -i * 14 });
      road.add(dashes);
      for (let i = 0; i < 10; i++) {
        const lx = i % 2 ? 13 : -13;
        const z0 = -30 - i * 34;
        const post2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7.5, 8),
          new THREE.MeshBasicMaterial({ color: 0x2a2545, toneMapped: false }));
        post2.position.set(lx, -0.3, z0);
        post2.userData = { z0 };
        const lamp = glowSprite(3.4);
        lamp.material.color.set(0xffc879);
        lamp.material.opacity = 0.5;
        lamp.position.set(lx, 3.6, z0);
        lamp.userData = { z0 };
        const pool = new THREE.Mesh(new THREE.CircleGeometry(3.4, 20),
          new THREE.MeshBasicMaterial({ color: 0x3a2f1a, transparent: true, opacity: 0.5, toneMapped: false }));
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(lx, -3.95, z0);
        pool.userData = { z0 };
        road.add(post2, lamp, pool);
      }
      cones = [];   // (cones retired - the PRIUS is the road's teeth now)
      // the house: a real one - lawn, porch, door, framed windows - and the
      // fire lives ON THE PORCH where mrs. dumplin's trouble started
      house = new THREE.Group();
      const lawn = new THREE.Mesh(new THREE.PlaneGeometry(70, 60),
        new THREE.MeshBasicMaterial({ color: 0x0a1208, toneMapped: false }));
      lawn.rotation.x = -Math.PI / 2;
      lawn.position.set(0, -3, 5);
      house.add(lawn);
      const walls = new THREE.Mesh(new THREE.BoxGeometry(18, 9, 10),
        new THREE.MeshBasicMaterial({ color: 0x1a1430, toneMapped: false }));
      walls.position.y = 1.5;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(14, 5.5, 4),
        new THREE.MeshBasicMaterial({ color: 0x0d0a18, toneMapped: false }));
      roof.position.y = 8.7; roof.rotation.y = Math.PI / 4;
      house.add(walls, roof);
      // the porch: slab, four posts, its own little roof
      const slab = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 5),
        new THREE.MeshBasicMaterial({ color: 0x241c38, toneMapped: false }));
      slab.position.set(0, -2.8, 7.4);
      const pRoof = new THREE.Mesh(new THREE.BoxGeometry(19, 0.4, 5.6),
        new THREE.MeshBasicMaterial({ color: 0x110d20, toneMapped: false }));
      pRoof.position.set(0, 3.4, 7.4);
      house.add(slab, pRoof);
      for (const px of [-8.2, -2.8, 2.8, 8.2]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 6.2, 8),
          new THREE.MeshBasicMaterial({ color: 0x8a84b8, toneMapped: false }));
        post.position.set(px, 0.3, 9.6);
        house.add(post);
      }
      // door and framed windows
      const door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.6),
        new THREE.MeshBasicMaterial({ color: 0x090714, toneMapped: false }));
      door.position.set(0, -0.4, 5.06);
      house.add(door);
      for (const wx of [-5.6, 5.6]) {
        const frame = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.4),
          new THREE.MeshBasicMaterial({ color: 0x2c2450, toneMapped: false }));
        frame.position.set(wx, 1.2, 5.05);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.8),
          new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }));
        win.position.set(wx, 1.2, 5.08);
        house.add(frame, win);
      }
      // ── the street furniture: curbs, parked cars, oncoming headlights ──
      for (const cx3 of [-11.5, 11.5]) {
        const curb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 400),
          new THREE.MeshBasicMaterial({ color: 0x3a3560, toneMapped: false }));
        curb.position.set(cx3, -3.9, -160);
        road.add(curb);
      }
      for (let i = 0; i < 4; i++) {
        const pk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 5),
          new THREE.MeshBasicMaterial({ color: 0x141126, toneMapped: false }));
        pk.position.set(i % 2 ? 9.5 : -9.5, -3.1, -50 - i * 85);
        pk.userData = { z0: pk.position.z };
        road.add(pk);
      }
      traffic = [];
      const mkCar = (oncoming) => {
        // a car you can READ at night: visible body, glass band lighter than
        // the paint, four wheels on the road - not a floating box with lights
        const car = new THREE.Group();
        const bodyC = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.9, 5.2),
          new THREE.MeshBasicMaterial({ color: 0x2a2342, toneMapped: false }));
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.75, 2.5),
          new THREE.MeshBasicMaterial({ color: 0x1a1530, toneMapped: false }));
        cabin.position.set(0, 0.8, -0.3);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.42, 2.4),
          new THREE.MeshBasicMaterial({ color: 0x4b4670, toneMapped: false }));
        glass.position.set(0, 0.88, -0.3);
        const wheelG = new THREE.CylinderGeometry(0.42, 0.42, 0.26, 10);
        const wheelM = new THREE.MeshBasicMaterial({ color: 0x07060e, toneMapped: false });
        for (const [wx, wz] of [[-1.25, 1.7], [1.25, 1.7], [-1.25, -1.7], [1.25, -1.7]]) {
          const wh = new THREE.Mesh(wheelG, wheelM);
          wh.rotation.z = Math.PI / 2;
          wh.position.set(wx, -0.55, wz);
          car.add(wh);
        }
        car.add(glass);
        if (oncoming) {
          const hl1 = glowSprite(2.4), hl2 = glowSprite(2.4);
          hl1.material.color.set(0xfff4cc); hl2.material.color.set(0xfff4cc);
          hl1.position.set(-0.85, -0.1, 2.6); hl2.position.set(0.85, -0.1, 2.6);
          const hglow = glowSprite(5);
          hglow.material.color.set(0xfff4cc);
          hglow.material.opacity = 0.16;
          hglow.position.set(0, -0.6, 3.6);
          car.add(bodyC, cabin, hl1, hl2, hglow);
        } else {
          const tl1 = glowSprite(1.6), tl2 = glowSprite(1.6);
          tl1.material.color.set(0xff2a30); tl2.material.color.set(0xff2a30);
          tl1.position.set(-0.9, 0, 2.6); tl2.position.set(0.9, 0, 2.6);
          car.add(bodyC, cabin, tl1, tl2);
        }
        road.add(car);
        traffic.push(car);
        return car;
      };
      for (let i = 0; i < 5; i++) {
        const car = mkCar(true);
        car.position.set(-4.5, -3.1, -90 - i * 115 - Math.random() * 40);
        car.userData = { z0: car.position.z, sp: 1.6 + Math.random() * 0.7, wrap: 580, hit: false };
      }
      for (let i = 0; i < 3; i++) {
        const car = mkCar(false);
        car.position.set(3.2 + Math.random() * 2.2, -3.1, -70 - i * 150 - Math.random() * 50);
        car.userData = { z0: car.position.z, sp: 0.45, wrap: 470, hit: false, ahead: true };
      }
      // the FIRE: layered flames licking up from the porch line, tall not round
      houseFires = [];
      for (let i = 0; i < 12; i++) {
        const g3 = new THREE.Group();
        const outer = glowSprite(5.2);
        outer.material.color.set(0xff5511);
        const inner = glowSprite(2.8);
        inner.material.color.set(0xffd060);
        inner.position.y = 0.7;
        g3.add(outer, inner);
        g3.position.set(-7.7 + (i % 8) * 2.2 + (i >= 8 ? 1.1 : 0), -1.4 + (i >= 8 ? 1.6 : 0), 8.2);
        g3.userData = {};   // filled below
        if (i >= 8) g3.visible = false;   // the SPREAD: lit only if the drive runs long
        const steam = glowSprite(2.6);
        steam.material.color.set(0xcfe8f2);
        steam.material.opacity = 0;
        steam.position.y = 1.4;
        g3.add(steam);
        g3.userData = { hp: 1, seed: Math.random() * 100, outer, inner, steam };
        house.add(g3);
        houseFires.push(g3);
      }
      smoke = [];
      for (let i = 0; i < 7; i++) {
        const sm = glowSprite(8);
        sm.material.color.set(0x555566);
        sm.userData = { seed: Math.random() * 100, rise: 0.8 + Math.random() * 0.8 };
        sm.position.set(-4 + Math.random() * 8, 6 + Math.random() * 6, 5.2);
        house.add(sm);
        smoke.push(sm);
      }
      // ── mrs. dumplin herself: out front, waving, garden hose not helping ──
      const lady = new THREE.Group();
      const dress = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 12),
        new THREE.MeshBasicMaterial({ color: 0x6b5a9e, toneMapped: false }));
      dress.position.y = 1.3;
      const headL = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xb08d6e, toneMapped: false }));
      headL.position.y = 3.1;
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xa8a4b0, toneMapped: false }));
      bun.position.y = 3.6;
      const wavArm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.4, 0.22),
        new THREE.MeshBasicMaterial({ color: 0x6b5a9e, toneMapped: false }));
      wavArm.position.set(0.9, 2.6, 0);
      wavArm.geometry.translate(0, 0.7, 0);
      const hoseArc = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.06, 6, 24, 1.4),
        new THREE.MeshBasicMaterial({ color: 0x4a7a4a, toneMapped: false }));
      hoseArc.position.set(-1.2, 1.2, 0.5);
      hoseArc.rotation.z = 0.6;
      const dribble = glowSprite(1.6);
      dribble.material.color.set(0x7fd4ff);
      dribble.material.opacity = 0.5;
      dribble.position.set(-2.6, 0.6, 0.8);
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.1),
        new THREE.MeshBasicMaterial({ color: 0x9c8f78, toneMapped: false }));
      apron.position.set(0, 1.15, 0.75);
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.2, 0.22),
        new THREE.MeshBasicMaterial({ color: 0x6b5a9e, toneMapped: false }));
      armL.position.set(-0.85, 1.9, 0.2);
      armL.rotation.z = 0.5;
      const slipL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.7),
        new THREE.MeshBasicMaterial({ color: 0xd06a8c, toneMapped: false }));
      slipL.position.set(-0.3, 0.1, 0.3);
      const slipR = slipL.clone();
      slipR.position.x = 0.3;
      // her porch light finds her: a warm halo so she reads from the street
      const ladyGlow = glowSprite(4.5);
      ladyGlow.material.color.set(0xffb060);
      ladyGlow.material.opacity = 0.12;
      ladyGlow.position.set(0, 1.6, -1.2);
      lady.add(ladyGlow, dress, headL, bun, wavArm, armL, apron, slipL, slipR, hoseArc, dribble);
      lady.scale.setScalar(1.45);
      lady.position.set(6.5, -3, 13.5);
      house.add(lady);
      this._lady = lady;
      this._lady = lady; this._ladyArm = wavArm;
      // the lawn flamingo (it will make it. hero.)
      const mingo = new THREE.Group();
      const mBody = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xff7ba6, toneMapped: false }));
      mBody.scale.set(1.3, 1, 1);
      mBody.position.y = 1.3;
      const mNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6),
        new THREE.MeshBasicMaterial({ color: 0xff7ba6, toneMapped: false }));
      mNeck.position.set(0.5, 2, 0);
      mNeck.rotation.z = -0.3;
      const mHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xd06a8c, toneMapped: false }));
      mHead.position.set(0.72, 2.55, 0);
      const mLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6),
        new THREE.MeshBasicMaterial({ color: 0xffb0cc, toneMapped: false }));
      mLeg.position.y = 0.55;
      mingo.add(mBody, mNeck, mHead, mLeg);
      mingo.position.set(-10, -3, 14);
      house.add(mingo);

      house.position.set(0, -1, -DRIVE_DIST - 30);
      road.add(house);
      // ── the neighborhood: dark houses asleep on both sides ──
      const hoodGeo = new THREE.BoxGeometry(8, 6, 8);
      const hoodMat = new THREE.MeshBasicMaterial({ color: 0x100d1d, toneMapped: false });
      for (let i = 0; i < 16; i++) {
        const hb = new THREE.Mesh(hoodGeo, hoodMat);
        const side = i % 2 ? 1 : -1;
        hb.position.set(side * (16 + Math.random() * 5), -1, -20 - i * 24 - Math.random() * 8);
        hb.scale.y = 0.8 + Math.random() * 0.7;
        hb.userData = { z0: hb.position.z };
        road.add(hb);
        if (Math.random() < 0.4) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.2),
            new THREE.MeshBasicMaterial({ color: 0x8a7448, toneMapped: false }));
          win.position.set(side * (16 + Math.random() * 3) - side * 4.2, 0.5, hb.position.z);
          win.rotation.y = side * -Math.PI / 2;
          win.userData = { z0: hb.position.z };
          road.add(win);
        }
      }
      // ── the SMOKE COLUMN: the beacon he follows, visible from blocks out ──
      this._plume = [];
      for (let i = 0; i < 6; i++) {
        const pl = glowSprite(16 + i * 5);
        pl.material.color.set(0x3d3d4d);
        pl.position.set(2, 10 + i * 9, -DRIVE_DIST - 30);
        pl.userData = { seed: Math.random() * 100, y0: 10 + i * 9 };
        road.add(pl);
        this._plume.push(pl);
      }
      const glow2 = glowSprite(22);
      glow2.material.color.set(0xff5511);
      glow2.material.opacity = 0.4;
      glow2.position.set(0, 4, -DRIVE_DIST - 29);
      road.add(glow2);
      this._fireGlow = glow2;
      // ── the truck cab: the red hood under your eyes, the lightbar above ──
      this._cab = new THREE.Group();
      const hood = new THREE.Mesh(
        new THREE.BoxGeometry(5.6, 0.5, 2.0),
        new THREE.MeshBasicMaterial({ color: 0x4a0c14, toneMapped: false })
      );
      hood.position.set(0, -2.0, -3.1);
      hood.rotation.x = 0.16;
      // a ridge of shine down the hood so it reads as painted metal, not a slab
      const ridge = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.9),
        new THREE.MeshBasicMaterial({ color: 0x8a1a26, toneMapped: false }));
      ridge.rotation.x = -Math.PI / 2 + 0.16;
      ridge.position.set(0, -1.73, -3.1);
      // the dark dashboard lip under your chin
      const dashLip = new THREE.Mesh(new THREE.BoxGeometry(6, 0.7, 0.8),
        new THREE.MeshBasicMaterial({ color: 0x120e1c, toneMapped: false }));
      dashLip.position.set(0, -2.0, -2.0);
      const mk1 = glowSprite(0.7), mk2 = glowSprite(0.7);
      mk1.material.color.set(0xffb040); mk2.material.color.set(0xffb040);
      mk1.material.opacity = 0.8; mk2.material.opacity = 0.8;
      mk1.position.set(-2.6, -1.8, -4.05);
      mk2.position.set(2.6, -1.8, -4.05);
      const barL = glowSprite(3.2), barR = glowSprite(3.2);
      barL.position.set(-1.9, 1.6, -2);
      barR.position.set(1.9, 1.6, -2);
      this._cab.add(hood, ridge, dashLip, mk1, mk2, barL, barR);
      this._barL = barL; this._barR = barR;
      this._cab.visible = false;
      camera.add(this._cab);
      scene.add(camera);
      // the water: a stream of droplets while dousing
      const spn = 60;
      const spp = new Float32Array(spn * 3);
      const spg = new THREE.BufferGeometry();
      spg.setAttribute('position', new THREE.BufferAttribute(spp, 3).setUsage(THREE.DynamicDrawUsage));
      sprayPts = new THREE.Points(spg, glowPoints(1.1, 0.9));
      sprayPts.material.color.set(0x7fd4ff);
      sprayPts.visible = false;
      sprayPts.frustumCulled = false;
      sprayBits = [];
      for (let i = 0; i < spn; i++) sprayBits.push({ t: Math.random() });
      road.add(sprayPts);
      road.visible = false;
      group.add(road);

      // ── PROLOGUE SET 2: mrs. dumplin's front room, one record player ──
      room = new THREE.Group();
      const table = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 6),
        new THREE.MeshBasicMaterial({ color: 0x352747, toneMapped: false }));
      table.position.y = -3;
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.24, 48),
        new THREE.MeshBasicMaterial({ color: 0x1a1526, toneMapped: false }));
      plinth.position.set(-1, -2.6, 0);
      platter = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.18, 48),
        new THREE.MeshBasicMaterial({ color: 0x0b0a12, toneMapped: false }));
      const grooves = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.03, 6, 64),
        new THREE.MeshBasicMaterial({ color: 0x3c3654, toneMapped: false }));
      grooves.rotation.x = Math.PI / 2;
      grooves.position.y = 0.12;
      const label = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.2, 32),
        new THREE.MeshBasicMaterial({ color: 0xffd98a, toneMapped: false }));
      platter.add(disc, grooves, label);
      // the record starts OFF the player, out of its sleeve on the table:
      // a task waiting to be done, label up so the gold reads at a glance
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.16, 6.8),
        new THREE.MeshBasicMaterial({ color: 0x3c2234, toneMapped: false }));
      sleeve.position.set(5.2, -2.66, 1.0);
      sleeve.rotation.y = 0.3;
      platter.position.set(4.7, -2.4, 0.6);
      platter.rotation.set(0, 0.4, 0);
      this._recHome = { pos: new THREE.Vector3(-1, -2.5, 0), sleevePos: platter.position.clone(), sleeveRot: platter.rotation.clone() };
      // a warm pool over the turntable so the task is the lit thing in the room
      const overGlow = glowSprite(9);
      overGlow.material.color.set(0xffc98a);
      overGlow.material.opacity = 0.22;
      overGlow.position.set(0.5, 0.5, 0.5);
      room.add(plinth, sleeve, overGlow);
      // the arm is sized to REACH: pivot (3.4, 1.2), 4.4 long - at rotation
      // 0.75 the needle sits over the grooves ~2.3 from the spindle; at -0.1
      // it rests clear of the record
      const armBase = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.5, 16),
        new THREE.MeshBasicMaterial({ color: 0x6d6790, toneMapped: false }));
      armBase.position.set(3.4, -2.45, 1.2);
      tonearm = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 4.4),
        new THREE.MeshBasicMaterial({ color: 0x847ea8, toneMapped: false }));
      arm.position.z = -2.2;
      const headshell = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.6),
        new THREE.MeshBasicMaterial({ color: 0x9a94c0, toneMapped: false }));
      headshell.position.set(0, -0.05, -4.4);
      const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.05, 0.34, 6),
        new THREE.MeshBasicMaterial({ color: 0xffe2a0, toneMapped: false }));
      needle.position.set(0, -0.3, -4.5);
      tonearm.add(arm, headshell, needle);
      tonearm.position.set(3.4, -1.55, 1.2);   // raised
      tonearm.rotation.y = -0.1;               // resting off the record
      room.add(armBase);
      room.add(table, platter, tonearm);
      this._recPhase = 0;   // 0 waiting, 1 placing, 2 placed, 3 needle down
      const lampGlow = glowSprite(14);
      lampGlow.material.color.set(0xffb968);
      lampGlow.material.opacity = 0.3;
      lampGlow.position.set(5, 3, -3);
      room.add(lampGlow);
      room.position.set(0, 1, -10);
      room.visible = false;
      group.add(room);

      drove = 0; coneSlowT = 0; dousedAll = false;

      // embers: the danger on the course (asleep until the chase heats up)
      embers = [];
      for (let i = 0; i < EMBERS; i++) {
        const e = mkEmber();
        group.add(e);
        embers.push(e);
      }
      // flames: the opening stretch of the course, strung in order
      courseAt = 46;
      for (let i = 0; i < FLAMES; i++) {
        const f = mkFlame();
        dealFlame(f);
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
      state = window.__radioWaiting ? 'radio' : 'fly'; stateT = 0; blowProg = 0; cascadeT = 0;
      hintT = 0; hintedFly = false; hintedGift = false;
      this._sung = false;

      this._onBlow = () => { if (state === 'wish') { state = 'blowing'; stateT = 0; blowProg = 0; } };
      document.addEventListener('fp-bday-blow', this._onBlow);
      this._onGo = () => {
        if (state !== 'radio') return;
        state = 'drive'; stateT = 0; drove = 0;
        road.visible = true;
        document.dispatchEvent(new CustomEvent('fp-bday-scene', { detail: 'call' }));
        document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: "dispatch: mrs. dumplin's porch is on fire. she says it can wait until wheel of fortune ends. it cannot" }));
      };
      document.addEventListener('fp-bday-go', this._onGo);
      this._onCta = () => {
        if (state !== 'lady') return;
        state = 'record'; stateT = 0;
        document.dispatchEvent(new CustomEvent('fp-bday-scene', { detail: 'record' }));
        road.visible = false;
        room.visible = true;
      };
      document.addEventListener('fp-bday-ctago', this._onCta);
      if (state === 'radio') setTimeout(() => document.dispatchEvent(new CustomEvent('fp-bday-radio')), 400);
      // dev handles: skip to the gift, or straight to the ceremony
      window.__bdayRecord = () => {
        state = 'record'; stateT = 0;
        if (this._cab) this._cab.visible = false;
        road.visible = false; room.visible = true;
        document.dispatchEvent(new CustomEvent('fp-bday-scene', { detail: 'record' }));
      };
      window.__bdayGift = () => { caught = CANDLES; state = 'gift'; stateT = 0; if (this._cab) this._cab.visible = false; if (road) road.visible = false; player.visible = true; };
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
      if (state === 'record') {
        if (this._recPhase === 0) {
          this._recPhase = 1;   // the record floats to the platter
          this._placeK = 0;
          return;
        }
        if (this._recPhase === 2 && !this._needleDown) {
          this._recPhase = 3;
          this._armT = 0;   // swing over, then lower until the needle touches
        }
        return;
      }
      if (state === 'unwrap') {
        const nw = performance.now();
        if (nw - (this._lastUnT || 0) < 450) return;   // one tap, one step
        this._lastUnT = nw;
        this._unwrapStep = (this._unwrapStep || 0) + 1;
        this._shiver = 1;
        if (this._unwrapStep === 1) {
          document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: 'the bow is off. now the ribbon. tap' } }));
        } else if (this._unwrapStep === 2) {
          document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: 'the lid. one more tap' } }));
        } else if (this._unwrapStep >= 3 && state === 'unwrap') {
          state = 'open'; stateT = 0;
          if (this._pillar) this._pillar.visible = false;
          this._fire(giftBox.position.clone().add(new THREE.Vector3(0, 14, 0)), opts, paint, tp);
          this._fire(giftBox.position.clone().add(new THREE.Vector3(-9, 8, 4)), opts, paint, tp);
          this._fire(giftBox.position.clone().add(new THREE.Vector3(9, 8, -4)), opts, paint, tp);
        }
        return;
      }
      if (state === 'drive' || state === 'douse') return;
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
      const aliveK = state === 'radio' ? 0.05
        : (state === 'fly' || state === 'rush' || state === 'gift' || state === 'unwrap' || state === 'open')
        ? 0.5 + 0.5 * Math.min(1, caught / CANDLES)
        : 1;
      const ceremonyDim = (state === 'wish' || state === 'blowing') ? 0.45 : state === 'out' ? 0.18 : 1;

      if (attract) { steerTarget.x = Math.sin(time * 0.33) * 0.6; steerTarget.y = Math.sin(time * 0.27) * 0.5; }
      steer.x += (steerTarget.x - steer.x) * Math.min(1, dt * 4.5);
      steer.y += (steerTarget.y - steer.y) * Math.min(1, dt * 4.5);
      player.position.set(steer.x * 8, steer.y * 4.5, 0);
      if (participants && participants[0]) { participants[0].x = steer.x; participants[0].y = steer.y; }

      // ── the flight itself: the universe streams past, faster on HOLD ──
      surge += ((opts.holding ? 1 : 0) - surge) * Math.min(1, dt * (opts.holding ? 4 : 1.6));
      const flying = state === 'fly' || state === 'rush' || state === 'gift' || state === 'after';
      if (state === 'radio') {
        stateT += dt;
        window.__bdayInfo = { state, caught, lit, stateT: Math.round(stateT * 10) / 10 };
        return;
      }
      // ── THE FIRE CALL ── three scenes before the sky
      if (state === 'drive' || state === 'arrive' || state === 'douse' || state === 'lady' || state === 'record') {
        stateT += dt;
        confetti.visible = false;
        player.visible = false;   // the light of the flight waits its turn
        stars.visible = state !== 'record';
        for (const f of flames) f.visible = false;
        for (const t2 of tailFlies) t2.material.opacity = 0;
        if (state === 'drive') {
          // parked until the call lands: the wheels (and the song) wait
          const rolling = stateT > 5;
          if (rolling && !this._rolled) {
            this._rolled = true;
            document.dispatchEvent(new CustomEvent('fp-bday-scene', { detail: 'drive' }));
          }
          if (rolling) driveT += dt;
          if (!this._spreadWarned && driveT > DRIVE_PAR) {
            this._spreadWarned = true;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'the fire is SPREADING. drive' }));
          }
          this._cab.visible = true;
          scene.fog.density = 0.0032;   // the smoke column must read from blocks away
          // the midnight run: steer the lane, hold for the siren push
          surge += ((opts.holding ? 1 : 0) - surge) * Math.min(1, dt * 4);
          coneSlowT = Math.max(0, coneSlowT - dt);
          const nearing = Math.max(0, Math.min(1, (drove - DRIVE_DIST * 0.9) / (DRIVE_DIST * 0.1)));
          const runSpeed = (26 + surge * 20) * (coneSlowT > 0 ? 0.45 : 1) * (1 - nearing * 0.75);
          if (rolling) drove += runSpeed * dt;
          // the lightbar washes the hood red and blue in turns
          const barPhase = Math.sin(time * 8) > 0;
          this._barL.material.color.set(barPhase ? 0xff2233 : 0x2244ff);
          this._barR.material.color.set(barPhase ? 0x2244ff : 0xff2233);
          this._barL.material.opacity = 0.35 + (barPhase ? 0.3 : 0);
          this._barR.material.opacity = 0.35 + (barPhase ? 0 : 0.3);
          // the plume breathes and leans; the fire glow pulses at its root
          this._plume.forEach(pl => {
            pl.position.y = pl.userData.y0 + Math.sin(time * 0.6 + pl.userData.seed) * 2;
            pl.position.x = 2 + Math.sin(time * 0.4 + pl.userData.seed) * 3 + (pl.userData.y0 - 10) * 0.12;
            pl.material.opacity = 0.24 + Math.sin(time * 0.8 + pl.userData.seed) * 0.06;
          });
          this._fireGlow.material.opacity = 0.3 + Math.sin(time * 6) * 0.12;
          this._ladyArm.rotation.z = 0.5 + Math.sin(time * 6) * 0.5;   // waving, urgently
          steer.x += (steerTarget.x - steer.x) * Math.min(1, dt * 5);
          const lane = steer.x * 6;
          // the road streams; the lightbar washes the night red and blue
          const dum4 = this._dum4 || (this._dum4 = new THREE.Object3D());
          for (let i = 0; i < dashBits.length; i++) {
            let z = dashBits[i].z + drove % (24 * 14);
            z = ((z + 30) % (24 * 14)) - (24 * 14) + 30;
            dum4.position.set(0, -3.9, z);
            dum4.rotation.set(0, 0, 0);
            dum4.scale.setScalar(1);
            dum4.updateMatrix();
            dashes.setMatrixAt(i, dum4.matrix);
          }
          dashes.instanceMatrix.needsUpdate = true;
          road.children.forEach(ch => {
            if (ch.userData && ch.userData.z0 !== undefined && ch !== house) {
              let z = ch.userData.z0 + drove;
              while (z > 20) z -= 380;
              ch.position.z = z;
            }
          });
          // traffic both ways: oncoming headlights to your left, slower
          // taillights ahead in your lane. weave or wear it
          for (const car of traffic) {
            const u4 = car.userData;
            let z = u4.z0 + drove * u4.sp;
            while (z > 20) {
              z -= u4.wrap; u4.hit = false;
              car.position.x = u4.ahead ? 3.2 + Math.random() * 2.2 : -4.5 + (Math.random() - 0.5) * 1.6;
            }
            car.position.z = z;
            const dzc = Math.abs(car.position.z);
            if (dzc < 5 && Math.abs(car.position.x - lane) < 2.4 && coneSlowT <= 0 && !u4.hit) {
              u4.hit = true;
              coneSlowT = 1.4;
              driveT += 3;
              if (opts.impact) opts.impact(0.9);
              const saidKey = u4.ahead ? '_minivanSaid' : '_priusSaid';
              if (!this[saidKey]) {
                this[saidKey] = true;
                document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: u4.ahead ? 'you rear-ended a MINIVAN. it was already like that. drive' : 'that was a PRIUS. dispatch saw nothing' } }));
              }
            }
          }
          house.position.z = -DRIVE_DIST - 30 + drove;
          const near = Math.max(0, Math.min(1, drove / DRIVE_DIST));
          // smoke breathes harder as you close in
          smoke.forEach(sm2 => {
            sm2.position.y += sm2.userData.rise * dt;
            if (sm2.position.y > 16) sm2.position.y = 6;
            sm2.material.opacity = 0.2 + near * 0.25 + Math.sin(time + sm2.userData.seed) * 0.06;
          });
          houseFires.forEach(fl2 => {
            const u3 = fl2.userData;
            const lick = 0.8 + Math.sin(time * 9 + u3.seed) * 0.25 + Math.sin(time * 23 + u3.seed * 2) * 0.1;
            fl2.scale.set(0.8, 1.5 * lick, 1);
            u3.outer.material.opacity = 0.6 + Math.sin(time * 7 + u3.seed) * 0.2;
            u3.inner.material.opacity = 0.75 + Math.sin(time * 11 + u3.seed) * 0.2;
          });
          // the lightbar: red and blue washing the sky in turns
          const bar = Math.sin(time * 7) > 0;
          sky.material.color.setRGB(bar ? 0.10 : 0.02, 0.02, bar ? 0.03 : 0.12);
          camera.position.lerp(this._cv2 || (this._cv2 = new THREE.Vector3()), 0);
          this._cv2.set(lane, 0.6 + Math.sin(drove * 0.06) * 0.12 + Math.sin(time * 31) * (0.02 + surge * 0.03), 8);
          camera.position.lerp(this._cv2, Math.min(1, dt * 5));
          const lv2 = this._lv2 || (this._lv2 = new THREE.Vector3(0, 0, -60));
          lv2.lerp(new THREE.Vector3(lane * 0.4, 0, -60), Math.min(1, dt * 3));
          camera.lookAt(lv2);
          camera.fov += ((78 + surge * 8) - camera.fov) * Math.min(1, dt * 5);
          camera.updateProjectionMatrix();
          if (window.__setFigure) window.__setFigure('BLOCKS', Math.min(9, Math.floor(near * 10)), 10);
          if (!this._droveHint2 && near > 0.3) {
            this._droveHint2 = true;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'she is out front waving. she is also spraying it with a garden hose. it is not helping' }));
          }
          if (drove >= DRIVE_DIST) {
            state = 'arrive'; stateT = 0;
            this._cab.visible = false;
            traffic.forEach(car => { car.visible = false; });
            // the drive's bill comes due: overtime lights extra fires
            const spread = Math.min(4, Math.max(0, Math.floor((driveT - DRIVE_PAR) / 7)));
            for (let i2 = 8; i2 < 8 + spread; i2++) houseFires[i2].visible = true;
            houseFires.forEach(fh => { fh.userData.active = fh.visible; if (!fh.visible) fh.userData.hp = 0; });
            this._spreadN = 8 + spread;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: 'on scene. mrs. dumplin made it out. the porch did not' } }));
          }
        }
        // ── the ARRIVAL: the truck stops, you take the scene in, you grab the hose ──
        if (state === 'arrive') {
          house.position.z = -26;
          this._ladyArm.rotation.z = 0.5 + Math.sin(time * 6) * 0.5;
          houseFires.forEach(fl2 => {
            if (!fl2.visible) return;
            const u3 = fl2.userData;
            const lick = 0.8 + Math.sin(time * 9 + u3.seed) * 0.25;
            fl2.scale.set(0.8, 1.5 * lick, 1);
            u3.outer.material.opacity = 0.6 + Math.sin(time * 7 + u3.seed) * 0.2;
            u3.inner.material.opacity = 0.75 + Math.sin(time * 11 + u3.seed) * 0.2;
          });
          smoke.forEach(sm2 => {
            sm2.position.y += sm2.userData.rise * dt;
            if (sm2.position.y > 16) sm2.position.y = 6;
          });
          sky.material.color.setRGB(0.03, 0.02, 0.07);
          camera.position.lerp(this._cv2 || (this._cv2 = new THREE.Vector3()), 0);
          this._cv2.set(0, 0.8, 6);
          camera.position.lerp(this._cv2, Math.min(1, dt * 2.5));
          camera.lookAt(2, -0.5, -24);
          camera.fov += (74 - camera.fov) * Math.min(1, dt * 3);
          camera.updateProjectionMatrix();
          if (!this._hoseHint && stateT > 2.6) {
            this._hoseHint = true;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: this._spreadN > 8 ? 'it spread to ' + this._spreadN + ' fires. HOLD to spray. aim the blue dot at each flame' : 'grab the hose. HOLD to spray. move your hand to aim the blue dot at each flame' }));
          }
          // the first HOLD takes the hose and the fight begins
          if (this._hoseHint && opts.holding) {
            state = 'douse'; stateT = 0;
            document.dispatchEvent(new CustomEvent('fp-bday-scene', { detail: 'douse' }));
            scene.fog.density = 0.009;
            if (opts.impact) opts.impact(0.4);
          }
          if (window.__setFigure) window.__setFigure(null);
          window.__bdayInfo = { state, caught, lit, stateT: Math.round(stateT * 10) / 10 };
          return;
        }
        if (state === 'douse') {
          // the hose: aim with your hand, HOLD to spray
          steer.x += (steerTarget.x - steer.x) * Math.min(1, dt * 6);
          steer.y += (steerTarget.y - steer.y) * Math.min(1, dt * 6);
          house.position.z = -26;
          const aim = this._aim || (this._aim = new THREE.Vector3());
          aim.set(steer.x * 9, steer.y * 6 + 1, -20.5);
          const spraying = !!opts.holding;
          if (!this._ret) {
            this._ret = glowSprite(1.6);
            this._ret.material.color.set(0x9fdcff);
            scene.add(this._ret);
          }
          this._ret.visible = true;
          this._ret.position.set(aim.x, aim.y, -20.4);
          this._ret.material.opacity = spraying ? 0.85 : 0.45 + Math.sin(time * 5) * 0.15;
          this._ret.scale.setScalar(spraying ? 1 + Math.sin(time * 24) * 0.12 : 1);
          sprayPts.visible = spraying;
          if (spraying) {
            const posA = sprayPts.geometry.attributes.position;
            for (let i = 0; i < sprayBits.length; i++) {
              const b2 = sprayBits[i];
              b2.t += dt * 2.2;
              if (b2.t > 1) b2.t -= 1;
              if (b2.jx === undefined) { b2.jx = (Math.random() - 0.5) * 0.5; b2.jy = (Math.random() - 0.5) * 0.3; }
              const px = b2.t * aim.x + b2.jx;
              const py = -3 + b2.t * (aim.y + 3) + Math.sin(b2.t * Math.PI) * 2.2 + b2.jy;
              const pz = 6 - b2.t * 26.5;
              posA.setXYZ(i, px, py, pz);
            }
            posA.needsUpdate = true;
          }
          let out = 0, activeN = 0, burning = 0;
          houseFires.forEach(f2 => { if (f2.userData.active && f2.userData.hp > 0) burning++; });
          reigniteWarnT = Math.max(0, reigniteWarnT - dt);
          houseFires.forEach(fl2 => {
            const u2 = fl2.userData;
            if (!u2.active) return;
            activeN++;
            if (u2.hp <= 0) {
              u2.deadT = (u2.deadT || 0) + dt;
              // one flare-back per fire, after six quiet seconds, never the last one
              if (burning > 1 && u2.deadT > 6 && !u2.flared) {
                u2.flared = true;
                u2.hp = 0.4;
                if (reigniteWarnT <= 0) {
                  reigniteWarnT = 7;
                  document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: 'one flared back up! hit it again' } }));
                }
              } else {
                out++;
                u2.outer.material.opacity = Math.max(0, u2.outer.material.opacity - dt);
                u2.inner.material.opacity = Math.max(0, u2.inner.material.opacity - dt);
                return;
              }
            }
            const fw = this._fw || (this._fw = new THREE.Vector3());
            fl2.getWorldPosition(fw);
            const onIt = spraying && Math.hypot(fw.x - aim.x, fw.y - aim.y) < 3.4;
            if (onIt) {
              u2.hp -= dt * 0.8;
              if (u2.hp <= 0) { u2.deadT = 0; if (opts.impact) opts.impact(0.4); }
            }
            if (u2.steam) u2.steam.material.opacity = Math.max(0, Math.min(0.5,
              (u2.steam.material.opacity || 0) + (onIt ? dt * 2.5 : -dt * 2)));
            const lick2 = 0.85 + Math.sin(time * 9 + u2.seed) * 0.25 + Math.sin(time * 21 + u2.seed * 2) * 0.1;
            fl2.scale.set(0.4 + u2.hp * 0.5, (0.4 + u2.hp * 1.1) * lick2, 1);
            u2.outer.material.opacity = (0.3 + u2.hp * 0.4) + Math.sin(time * 7 + u2.seed) * 0.12;
            u2.inner.material.opacity = (0.35 + u2.hp * 0.45) + Math.sin(time * 11 + u2.seed) * 0.15;
          });
          smoke.forEach(sm2 => {
            sm2.position.y += sm2.userData.rise * dt;
            if (sm2.position.y > 16) sm2.position.y = 6;
            sm2.material.opacity = (0.12 + (1 - out / houseFires.length) * 0.3);
          });
          sky.material.color.setRGB(0.03, 0.02, 0.07);
          camera.position.lerp(this._cv2 || (this._cv2 = new THREE.Vector3()), 0);
          this._cv2.set(steer.x * 1.5, 0.8, 6);
          camera.position.lerp(this._cv2, Math.min(1, dt * 4));
          const lv3 = this._lv3 || (this._lv3 = new THREE.Vector3(0, 0, -24));
          lv3.x += (aim.x * 0.5 - lv3.x) * Math.min(1, dt * 2.5);
          lv3.y += (aim.y * 0.5 - lv3.y) * Math.min(1, dt * 2.5);
          camera.lookAt(lv3);
          camera.fov += (76 - camera.fov) * Math.min(1, dt * 5);
          camera.updateProjectionMatrix();
          if (window.__setFigure) window.__setFigure('FIRES OUT', out, activeN);
          // fourteen seconds with nothing out means the loop has not clicked
          if (!this._douseNudge && stateT > 14 && out === 0) {
            this._douseNudge = true;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: 'hold the water ON one flame. it steams, shrinks, and goes out. then the next' } }));
          }
          window.__bdayFires = activeN ? 1 - out / activeN : 0;   // the crackle dies with the fire
          if (activeN > 0 && out >= activeN && !dousedAll) {
            dousedAll = true;
            sprayPts.visible = false;
            if (this._ret) this._ret.visible = false;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'all out. the lawn flamingo made it. hero' }));
            setTimeout(() => {
              if (state !== 'douse') return;
              state = 'lady'; stateT = 0;
              this._ladySaid = false; this._ctaShown = false;
            }, 2800);
          }
        }
        if (state === 'lady') {
          sprayPts.visible = false;
          if (this._ret) this._ret.visible = false;
          window.__bdayFires = 0;
          // the beat: camera walks to her (1.6s), she asks while you watch,
          // and only once the question has finished typing - plus a breath -
          // does the button appear
          const LADY_LINE = "mrs. dumplin: you saved my porch, sugar. one favor before you go... put a record on for me? my hip says no but my heart says boogie";
          if (!this._ladySaid && stateT > 1.6) {
            this._ladySaid = true;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: LADY_LINE } }));
          }
          if (this._ladySaid && !this._ctaShown && stateT > 1.6 + LADY_LINE.length * 0.034 + 2.2) {
            this._ctaShown = true;
            document.dispatchEvent(new CustomEvent('fp-bday-cta', { detail: 'put the record on' }));
          }
          // she gets the floor: the camera walks over, her arm chats along,
          // and the gold button is the only way forward - zero ambiguity
          const lw = this._lw || (this._lw = new THREE.Vector3());
          this._lady.getWorldPosition(lw);
          this._ladyArm.rotation.z = 0.35 + Math.sin(time * 3) * 0.28;   // talking now, not flagging down a truck
          camera.position.lerp(this._cv2 || (this._cv2 = new THREE.Vector3()), 0);
          this._cv2.set(lw.x - 7, lw.y + 5.5, lw.z + 17);
          camera.position.lerp(this._cv2, Math.min(1, dt * 2));
          const lv4 = this._lv4 || (this._lv4 = new THREE.Vector3());
          lv4.lerp(new THREE.Vector3(lw.x - 2, lw.y + 3, lw.z), Math.min(1, dt * 2.5));
          camera.lookAt(lv4);
          camera.fov += (64 - camera.fov) * Math.min(1, dt * 3);
          camera.updateProjectionMatrix();
          if (window.__setFigure) window.__setFigure(null);
        }
        if (state === 'record') {
          // her front room: put the record ON, then drop the needle. two taps,
          // both asked for in words, neither skippable by accident
          if (this._recPhase === 1) {
            this._placeK = Math.min(1, (this._placeK || 0) + dt / 1.3);
            const e2 = 1 - Math.pow(1 - this._placeK, 3);
            platter.position.lerpVectors(this._recHome.sleevePos, this._recHome.pos, e2);
            platter.position.y += Math.sin(e2 * Math.PI) * 1.8;   // an arc, not a slide
            platter.rotation.y = this._recHome.sleeveRot.y * (1 - e2);
            if (this._placeK >= 1) {
              this._recPhase = 2;
              platter.rotation.set(0, 0, 0);
              document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: 'now tap again to drop the needle' } }));
            }
          }
          if (this._recPhase >= 2) platter.rotation.y += dt * (this._needleDown ? 2.6 : 0.3);
          if (this._recPhase >= 3) {
            this._armT += dt;
            // 1) swing across to the grooves, arm held up
            const sk = Math.min(1, this._armT / 1.0);
            const se = sk < 0.5 ? 2 * sk * sk : 1 - Math.pow(-2 * sk + 2, 2) / 2;
            tonearm.rotation.y = -0.1 + 0.85 * se;
            // 2) lower: needle tip meets the disc surface (y -2.41)
            const lk = Math.min(1, Math.max(0, (this._armT - 1.15) / 0.45));
            tonearm.position.y = -1.55 + (-1.99 - -1.55) * (lk * lk);
            // 3) CONTACT
            if (lk >= 1 && !this._needleDown) {
              this._needleDown = true;
              this._needleAt = stateT;
              if (opts.impact) opts.impact(0.5);
              document.dispatchEvent(new CustomEvent('fp-bday-needle'));
              document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: 'mrs. dumplin: ooh, that is my song' } }));
            }
            // a tiny ride on the groove once it plays
            if (this._needleDown) tonearm.position.y = -1.99 + Math.sin(time * 14) * 0.006;
          }
          sky.material.color.setRGB(0.05, 0.03, 0.03);
          camera.position.lerp(this._cv2 || (this._cv2 = new THREE.Vector3()), 0);
          this._cv2.set(Math.sin(time * 0.2) * 0.8, 1.6, 2.5);
          camera.position.lerp(this._cv2, Math.min(1, dt * 3));
          camera.lookAt(-1, -1.6, -10);
          camera.fov += (66 - camera.fov) * Math.min(1, dt * 4);
          camera.updateProjectionMatrix();
          if (window.__setFigure) window.__setFigure(null);
          if (stateT > 4.5 && !this._recordHinted && this._recPhase === 0) {
            this._recordHinted = true;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'her record leans by the sleeve. tap it to put it on the player' }));
          }
          window.__bdayArm = { phase: this._recPhase, armT: +(this._armT || 0).toFixed(2), y: +tonearm.position.y.toFixed(2), rot: +tonearm.rotation.y.toFixed(2), down: !!this._needleDown };
          if (this._needleDown && !this._batterSaid && stateT - this._needleAt > 2.6) {
            this._batterSaid = true;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: 'dispatch: caller reports the kitchen smells like cake batter. unrelated. probably' } }));
          }
          if (this._needleDown && stateT - this._needleAt > 7.4) {
            // the groove catches - and the world comes apart
            room.visible = false;
            confetti.visible = true;
            state = 'fly'; stateT = 0; hintT = 0;
            document.dispatchEvent(new CustomEvent('fp-bday-scene', { detail: 'fly' }));
            sky.material.color.setRGB(0, 0, 0);
            document.dispatchEvent(new CustomEvent('fp-bday-glitch'));
          }
        }
        window.__bdayInfo = { state, caught, lit, stateT: Math.round(stateT * 10) / 10, drove: Math.round(drove) };
        return;
      }
      confetti.visible = true;
      player.visible = true;
      stars.visible = true;
      const rushK = state === 'rush' ? Math.min(1, stateT / 0.5) : 0;
      const speed = flying ? (10 + aliveK * 8 + audio.volume * 8 * reactivity + surge * 16 + chorus * 4 + rushK * 34) : 2;
      travel += speed * dt;

      // sky and stars
      paint(0.9, audio.mid);
      color.setHSL(tp[0], tp[1] * 0.6, Math.min(0.42, (0.08 + 0.18 * aliveK + audio.energy * 0.18 * aliveK + (flying ? audio.beatIntensity * 0.12 : 0)) * tp[2]) * ceremonyDim);
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
          const spinK = 1 + chorus * 2.5 + audio.beatIntensity * 1.5;
          dum2.rotation.set(time * c2.tumble * spinK + c2.spin, c2.spin, time * c2.tumble * 0.6 * spinK);
          const sc = 0.7 + 0.5 * aliveK + audio.beatIntensity * 0.9 + audio.bass * 0.25;
          dum2.scale.setScalar(sc);
          dum2.updateMatrix();
          confetti.setMatrixAt(i, dum2.matrix);
          paint(c2.hueSeed, audio.mid);
          const lum = (0.16 + 0.22 * aliveK + audio.treble * 0.16 * aliveK + audio.beatIntensity * 0.22) * ceremonyDim;
          color.setHSL(tp[0], Math.max(0.55, tp[1]), Math.min(0.7, lum));
          ic.setXYZ(i, color.r, color.g, color.b);
        }
        confetti.instanceMatrix.needsUpdate = true;
        ic.needsUpdate = true;
      }

      // ── BEAT HOOPS: every kick throws a ring of light down the tunnel at you ──
      {
        if (!this._gates) {
          this._gates = [];
          for (let i = 0; i < 12; i++) {
            const gm = new THREE.Mesh(
              new THREE.TorusGeometry(1, 0.012, 6, 72),
              new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false })
            );
            gm.visible = false;
            group.add(gm);
            this._gates.push(gm);
          }
          this._gateCd = 0; this._boomCd = 3;
        }
        const chasing = state === 'fly' || state === 'rush' || state === 'after';
        this._gateCd -= dt;
        this._boomCd -= dt;
        if (chasing && audio.beat && this._gateCd <= 0) {
          this._gateCd = 0.26;
          const gm = this._gates.find(x => !x.visible);
          if (gm) {
            gm.visible = true;
            gm.position.set(0, 0, -150);
            gm.userData.hueU = (time * 0.07) % 1;
            gm.userData.base = 15 + audio.beatIntensity * 6;
          }
        }
        for (const gm of this._gates) {
          if (!gm.visible) continue;
          gm.position.z += (speed * 1.7 + 30) * dt;
          const near = gm.position.z;
          if (near > 10 || !chasing) { gm.visible = false; gm.material.opacity = 0; continue; }
          gm.position.x = player.position.x * 0.25;
          gm.position.y = player.position.y * 0.25;
          gm.rotation.z += dt * 0.6;
          gm.scale.setScalar(gm.userData.base * (1 + audio.bass * 0.18));
          paint(gm.userData.hueU, audio.bass);
          color.setHSL(tp[0], Math.max(0.6, tp[1]), 0.6);
          gm.material.color.copy(color);
          const fadeIn = Math.min(1, (near + 150) / 35);
          const fadeOut = Math.min(1, (10 - near) / 18);
          gm.material.opacity = 0.6 * fadeIn * fadeOut * ceremonyDim;
        }
        // big hits and choruses light the sky far ahead
        if (chasing && this._boomCd <= 0 && (audio.beatIntensity > 0.72 || chorus > 0.6)) {
          this._boomCd = chorus > 0.6 ? 2.6 : 5.5;
          const side = Math.random() < 0.5 ? -1 : 1;
          this._fire(new THREE.Vector3(side * (8 + Math.random() * 12), 6 + Math.random() * 10, -70 - Math.random() * 30), { impact: null }, paint, tp);
        }
      }

      // ── ACT I: the flames come to meet you ──
      if (state === 'rush' && stateT > 2.4) { state = 'gift'; stateT = 0; }
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
          u.ring.rotation.y = time * 1.4 + u.seed;
          u.ring.rotation.x = 0.4;
          u.ring.material.opacity = 0.55 + Math.sin(time * 3 + u.seed) * 0.2;
          if (u.dart > 0) {
            u.dart -= dt;
            f.position.lerp(player.position, Math.min(1, dt * 3.4));
          } else {
            f.position.z += speed * dt;
            const wob = u.wob || 0.4;
            f.position.x = laneX(u.d) + Math.sin(time * 1.4 + u.seed) * wob;
            f.position.y = laneY(u.d) + Math.cos(time * 2.1 + u.seed) * wob * 0.7;
            if (f.position.z > 8) dealFlame(f);   // missed: it rejoins the course's end
          }
          // the catch is the ring, slide-style: thread it or it passes and
          // rejoins the end of the course
          const dz = Math.abs(f.position.z - player.position.z);
          if (dz < 3.2 && Math.hypot(f.position.x - player.position.x, f.position.y - player.position.y) < 2.9) {
            if (state === 'fly') {
              caught = Math.min(CANDLES, caught + 1);
              // mission control checks in at the quarter marks - never
              // explaining, always promising
              const q = Math.floor((caught / CANDLES) * 4);
              if (q > commsSent && caught < CANDLES) {
                commsSent = q;
                const lines = [
                  '', 'first dozen contained. dispatch is impressed. Fowler says hi',
                  'halfway. watch the red embers. Fowler touched one. Fowler is fine. ish',
                  'almost all of them. Fowler thinks they are migrating. Fowler is not a scientist'];
                if (lines[q]) document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: lines[q] }));
              }
              if (caught >= CANDLES) {
                state = 'rush'; stateT = 0;
                document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'all ' + CANDLES + ' contained. the paperwork will be enormous. wait... something is coming' }));
              }
            }
            dealFlame(f);
            // the catch LANDS: a gold ring blooms from your light, the night
            // lurches forward, your halo flares - unmistakable, every time
            tapGlit = 1;
            surge = Math.min(1, surge + 0.55);
            const m2 = rings.find(x => !x.visible);
            if (m2) {
              m2.visible = true;
              m2.position.copy(player.position);
              m2.userData.r = 0.6;
              m2.rotation.set(0, 0, 0);
              m2.material.color.setHSL(0.11, 0.9, 0.6);
            }
            if (opts.impact) opts.impact(0.45);
            if (state === 'after') this._fire(player.position.clone().add(new THREE.Vector3(0, 3, -8)), opts, paint, tp);
          }
        }
      } else {
        for (const f of flames) f.visible = false;
      }

      // ── the EMBERS: red heat drifting the course once the chase is on.
      // clip one and a contained flame BREAKS LOOSE - never fatal, always felt
      const embersOn = (state === 'fly' && caught >= CANDLES * 0.25) || state === 'after';
      emberHurtT = Math.max(0, emberHurtT - dt);
      for (const e of embers) {
        const u = e.userData;
        if (!embersOn) { e.visible = false; u.live = false; continue; }
        if (!u.live) { dealEmber(e); continue; }
        e.position.z += speed * dt;
        e.position.x = laneX(u.d) + u.off + Math.sin(time * 2.2 + u.seed) * 0.35;
        e.position.y = laneY(u.d) + u.off * 0.4 + Math.cos(time * 1.8 + u.seed) * 0.3;
        u.glow.material.opacity = 0.55 + Math.sin(time * 6 + u.seed) * 0.2 + audio.bass * 0.2;
        u.glow.scale.setScalar(0.9 + Math.sin(time * 5 + u.seed) * 0.15);
        if (e.position.z > 8) { dealEmber(e); continue; }
        const dz = Math.abs(e.position.z - player.position.z);
        if (state === 'fly' && emberHurtT <= 0 && dz < 3 &&
            Math.hypot(e.position.x - player.position.x, e.position.y - player.position.y) < 2.6) {
          emberHurtT = 1.2;
          dealEmber(e);
          if (caught > 0) {
            caught--;
            commsSent = Math.min(commsSent, Math.floor((caught / CANDLES) * 4));
            const runaway = flames.find(x => !x.userData.live) || null;
            if (runaway) dealFlame(runaway);
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'an ember knocked one loose! catch it again' }));
          }
          if (opts.impact) opts.impact(0.85);
        }
      }

      // the tail: your gathered flames fly with you, and your light grows
      const shown = state === 'fly' || state === 'gift' || state === 'unwrap' || state === 'open' ? Math.min(TAIL, caught) : 0;
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

      // ── ACT II: the gift drifts in from the deep, under a pillar of light ──
      if (state === 'gift') {
        if (!giftBox.visible) {
          giftBox.visible = true;
          giftBox.position.set(0, -9, -130);
          if (!this._pillar) {
            this._pillar = new THREE.Mesh(
              new THREE.CylinderGeometry(2.2, 3.6, 70, 16, 1, true),
              new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.14, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false })
            );
            group.add(this._pillar);
          }
          this._pillar.visible = true;
          if (!hintedGift) {
            hintedGift = true;
            document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'that is either a gift or a very fancy trap. get closer' }));
          }
        }
        giftBox.position.z = Math.min(-16, giftBox.position.z + speed * dt * 0.55);
        giftBox.rotation.y = Math.sin(time * 0.4) * 0.12;
        giftBox.position.y = -9 + Math.sin(time * 0.9) * 0.5;
        this._pillar.position.set(giftBox.position.x, giftBox.position.y + 40, giftBox.position.z);
        this._pillar.rotation.y = time * 0.3;
        this._pillar.material.opacity = 0.1 + audio.bass * 0.08 + Math.sin(time * 2) * 0.03;
        const gl = 0.5 + audio.bass * 0.4 + Math.sin(time * 2.5) * 0.15;
        [ribbonV, ribbonH, bowKnot, lid.children[1], lid.children[2]].forEach(rb => {
          if (rb && rb.material) rb.material.color.setHSL(0.11, 0.85, Math.min(0.72, gl));
        });
        // flying INTO it begins the unwrapping - the box is YOURS to open
        if (giftBox.position.z >= -20 && Math.hypot(player.position.x, player.position.y + 4) < 9) {
          state = 'unwrap'; stateT = 0;
          this._unwrapStep = 0; this._shiver = 1;
          if (opts.impact) opts.impact(0.6);
          document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: { now: true, text: 'it is wrapped. tap the bow to untie it' } }));
        }
      }

      // ── the UNWRAP: bow, then ribbon, then lid - three taps, three answers ──
      if (state === 'unwrap') {
        giftBox.position.x += (0 - giftBox.position.x) * Math.min(1, dt * 2);
        giftBox.position.z += (-30 - giftBox.position.z) * Math.min(1, dt * 2);
        giftBox.position.y = -10 + Math.sin(time * 0.9) * 0.4;
        this._shiver = Math.max(0, (this._shiver || 0) - dt * 2.2);
        giftBox.rotation.y = Math.sin(time * 0.4) * 0.12;
        giftBox.rotation.z = Math.sin(time * 38) * 0.05 * this._shiver;
        if (this._pillar) {
          this._pillar.position.set(giftBox.position.x, giftBox.position.y + 40, giftBox.position.z);
          this._pillar.material.opacity = 0.08 + Math.sin(time * 2) * 0.02;
        }
        const gl2 = 0.42 + audio.bass * 0.25 + Math.sin(time * 2.5) * 0.1;
        [ribbonV, ribbonH, bowKnot, lid.children[1], lid.children[2]].forEach(rb => {
          if (rb && rb.material) rb.material.color.setHSL(0.11, 0.85, Math.min(0.58, gl2));
        });
        // step 1: the bow spins off into the night
        if (this._unwrapStep >= 1 && bowKnot.visible) {
          this._bowT = (this._bowT || 0) + dt;
          if (this._bowY0 === undefined) this._bowY0 = bowKnot.position.y;
          bowKnot.position.y = this._bowY0 + this._bowT * 14;
          bowKnot.rotation.y += dt * 9;
          bowKnot.material.transparent = true;
          bowKnot.material.opacity = Math.max(0, 1 - this._bowT / 1.1);
          if (this._bowT > 1.1) bowKnot.visible = false;
        }
        // step 2: the ribbons slide off the box
        if (this._unwrapStep >= 2 && ribbonV.visible) {
          this._ribT = (this._ribT || 0) + dt;
          ribbonV.position.z += dt * 10;
          ribbonH.position.x += dt * 10;
          [ribbonV, ribbonH].forEach(rb => {
            rb.material.transparent = true;
            rb.material.opacity = Math.max(0, 1 - this._ribT / 0.9);
          });
          if (this._ribT > 0.9) { ribbonV.visible = false; ribbonH.visible = false; }
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
        [ribbonV, ribbonH].forEach(rb => { if (rb.visible) { rb.material.opacity = 1 - k; rb.material.transparent = true; } });
        if (!cake.visible && k > 0.3) cake.visible = true;
        if (cake.visible) {
          const ck = Math.min(1, Math.max(0, (k - 0.3) / 0.7));
          const e = 1 - Math.pow(1 - ck, 3);
          cake.scale.setScalar(0.001 + e * 0.999);
          // the tiers IGNITE bottom-up as it rises - a reveal, not an appearance
          this._igniteK = ck;
        }
        if (k >= 1) {
          giftBox.visible = false;
          state = 'cascade'; stateT = 0; cascadeT = 0;
          document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'dispatch: final report came in. cause of the fire: a birthday cake in the oven. she was baking it for you' }));
        }
      }

      // ── ACT III: the cascade - every flame STREAKS from you to its candle ──
      if (state === 'cascade') {
        if (!this._streak) {
          this._streak = glowSprite(3.2);
          this._streak.material.color.setHSL(0.1, 0.9, 0.65);
          group.add(this._streak);
          this._streakV = new THREE.Vector3();
        }
        cascadeT -= dt;
        if (cascadeT <= 0 && lit < CANDLES) {
          cascadeT = 0.13;
          const c = candles[lit];
          c.getWorldPosition(this._streakV);
          this._streakFrom = player.position.clone();
          this._streakTo = this._streakV.clone().add(new THREE.Vector3(0, 2.4, 0));
          this._streakK = 0;
          c.userData.on = true;
          c.userData.pop = 1;
          lit++;
          if (lit % 12 === 0 && opts.impact) opts.impact(0.4);
          if (lit >= CANDLES) {
            state = 'wish'; stateT = 0;
            document.dispatchEvent(new CustomEvent('fp-bday-wish'));
          }
        }
        if (this._streakFrom) {
          this._streakK = Math.min(1, (this._streakK || 0) + dt * 8);
          this._streak.visible = true;
          this._streak.position.lerpVectors(this._streakFrom, this._streakTo, this._streakK);
          this._streak.material.opacity = 0.9 * (1 - this._streakK * 0.4);
        }
      } else if (this._streak) {
        this._streak.visible = false;
      }

      // ── the cake lives (once it exists) ──
      if (cake.visible) {
        const ign = state === 'open' ? (this._igniteK || 0) : 1;
        rims.forEach((rim, i) => {
          paint(0.15 + i * 0.25, audio.bass);
          const tierOn = ign >= (i + 1) / 3.2;   // bottom tier first, crown last
          color.setHSL(tp[0], tp[1], Math.min(0.62, (0.34 + audio.bass * 0.3) * Math.min(1.3, tp[2])) * ceremonyDim * (tierOn ? 1 : 0.06));
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
      if (state === 'fly' && finales === 0) {
        hintT += dt;
        // the transport is a TWIST: dispatch is as lost as he is
        if (!briefed && hintT > 2.4) {
          briefed = true;
          document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'dispatch: where ARE you? our screens went full rainbow. Fowler fainted' }));
        }
        if (!this._brief2 && hintT > 8.5) {
          this._brief2 = true;
          document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'no time to explain. ' + CANDLES + ' flames loose in there. bring them in. do NOT lick them' }));
        }
        if (!hintedFly && hintT > 15 && caught === 0) {
          hintedFly = true;
          document.dispatchEvent(new CustomEvent('fp-bday-hint', { detail: 'follow the trail. tap and one comes to you' }));
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
          document.dispatchEvent(new CustomEvent('fp-bday-after'));
          courseAt = travel + 46;
          for (const f of flames) dealFlame(f);
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
      if (flying) {
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
      if (flying) {
        this._bank = (this._bank || 0) + ((-steer.x * 0.16) - (this._bank || 0)) * Math.min(1, dt * 3);
        camera.rotateZ(this._bank + Math.sin(time * 37) * audio.bass * 0.006 * reactivity);
      }
      const fovT = 76 + audio.volume * (3 + 4 * aliveK) * reactivity + surge * 8 + (flying ? audio.beatIntensity * 6 * reactivity : 0) - (state === 'wish' || state === 'blowing' ? 6 : 0);
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
      if (this._cab) { camera.remove(this._cab); }
      document.removeEventListener('fp-bday-blow', this._onBlow);
      document.removeEventListener('fp-bday-go', this._onGo);
      document.removeEventListener('fp-bday-ctago', this._onCta);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      rims = []; candles = []; flames = []; bursts = []; rings = []; lanterns = []; confBits = []; tailFlies = [];
      if (window.__setFigure) window.__setFigure(null);
    },
  };
}
