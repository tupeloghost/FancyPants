// BIRTHDAY — an occasion world, reached by a link with a name on it, never
// by the weekly rotation. A grand dark cake stands on a night horizon under
// drifting golden flames. Catch a flame and a candle lights; light them all
// and the world holds its breath, the candles go out together, and the sky
// answers with fireworks and their name. Then it all begins again, one
// lantern richer. Chic and starry, never arcade: the celebration is light.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=665';
import { themePaint } from '../lib/themes.js?v=665';

const CANDLES_DEFAULT = 13;
const LITE = !!window.__LITE;
const FLAMES = LITE ? 6 : 9;         // drifting catchables alive at once
const STARS = LITE ? 400 : 700;
const BURSTS = LITE ? 6 : 10;        // firework spark clouds in the pool

export function createBirthday() {
  // the cake carries THEIR count when the link says so (candles=age)
  const CANDLES = window.__BDAY_N || CANDLES_DEFAULT;
  let scene, camera, group;
  let sky, stars, cake, rims = [], candles = [], flames = [], bursts = [], lanterns = [];
  let rings = [];                      // firework halo rings (torus pool)
  let player, halo;
  let steer = { x: 0, y: 0 }, steerTarget = { x: 0, y: 0 };
  let lit = 0, finales = 0;
  let state = 'gather';                // gather -> hush -> blow -> encore
  let stateT = 0;
  let tapGlit = 0;
  const color = new THREE.Color();

  const mkFlame = () => {
    const g = new THREE.Group();
    const s = glowSprite(4.2);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff2d0, toneMapped: false })
    );
    g.add(s, core);
    g.userData = { s, core, seed: Math.random() * 100, live: false };
    return g;
  };

  const dealFlame = (f, far) => {
    f.userData.live = true;
    f.visible = true;
    f.position.set(
      (Math.random() * 2 - 1) * 9,
      (Math.random() * 2 - 1) * 5.5,
      far ? -70 - Math.random() * 30 : -20 - Math.random() * 60
    );
    f.userData.seed = Math.random() * 100;
  };

  return {
    name: 'BIRTHDAY',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x05030a, 0.007);

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
      // thirteen candles in a circle on the top tier
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
      cake.position.set(0, -10, -40);
      group.add(cake);

      // ── the drifting flames you catch ──
      for (let i = 0; i < FLAMES; i++) {
        const f = mkFlame();
        dealFlame(f, false);
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

      // the player's mote: a soft light with a halo, steered through the field
      player = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
      );
      halo = glowSprite(7);
      player.add(halo);
      group.add(player);

      lit = 0; finales = 0; state = 'gather'; stateT = 0;
      // dev handle: light every candle and audition the ceremony
      window.__bdayFinale = () => {
        candles.forEach(c => { c.userData.on = true; });
        lit = CANDLES;
        state = 'hush'; stateT = 0;
      };
      camera.position.set(0, 1.5, 14);
      camera.lookAt(0, 0, -30);
      camera.fov = 74;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { steerTarget.x = x || 0; steerTarget.y = y || 0; },

    placeGhost(p, i, out) {
      out.set((p.x || 0) * 8, (p.y || 0) * 5, -8 - (i % 6) * 4);
    },

    onTap() {
      tapGlit = 1;
      if (state === 'hush') { state = 'blow'; stateT = 0; }   // a tap blows early
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      const tp = this._tp || (this._tp = [0, 0, 0]);
      const paint = (u, lvl) => { themePaint(colorMode, hue / 360, u, time * 0.15, time, lvl, (u * 7.13) % 1, tp); return tp; };
      const chorus = opts.chorus || 0;

      if (attract) { steerTarget.x = Math.sin(time * 0.4) * 0.7; steerTarget.y = Math.cos(time * 0.3) * 0.5; }
      steer.x += (steerTarget.x - steer.x) * Math.min(1, dt * 7);
      steer.y += (steerTarget.y - steer.y) * Math.min(1, dt * 7);
      player.position.set(steer.x * 8, steer.y * 5, 0);
      if (participants && participants[0]) { participants[0].x = steer.x; participants[0].y = steer.y; }

      const hushK = state === 'hush' ? Math.min(1, stateT / 0.8) : (state === 'blow' ? Math.max(0, 1 - stateT / 1.5) : 0);
      const dim = 1 - hushK * 0.65;   // the held breath: the world lowers its voice

      // sky and stars
      paint(0.9, audio.mid);
      color.setHSL(tp[0], tp[1] * 0.6, Math.min(0.4, (0.2 + audio.energy * 0.2) * tp[2]) * dim);
      sky.material.color.copy(color);
      stars.material.opacity = (0.5 + audio.high * 0.3) * dim;
      stars.rotation.y = time * 0.004;

      // cake rims breathe with the bass, each tier its own voice; the velvet
      // bodies carry a whisper of the same color so the silhouette reads
      rims.forEach((rim, i) => {
        paint(0.15 + i * 0.25, audio.bass);
        color.setHSL(tp[0], tp[1], Math.min(0.62, (0.4 + audio.bass * 0.3) * Math.min(1.3, tp[2])) * dim);
        rim.material.color.copy(color);
        rim.scale.setScalar(1 + audio.bass * 0.03 * reactivity);
        color.setHSL(tp[0], tp[1] * 0.7, (0.07 + audio.bass * 0.04) * dim);
        cake.children[i * 2].material.color.copy(color);
      });
      cake.rotation.y = time * 0.05;

      // candles: lit ones flicker like real flames, unlit ones wait
      candles.forEach((c, i) => {
        const u = c.userData;
        u.pop = Math.max(0, u.pop - dt * 2);
        const flick = 0.75 + Math.sin(time * 9 + u.seed) * 0.15 + audio.treble * 0.25;
        if (u.on) {
          color.setHSL(0.09, 0.9, 0.6);
          u.fl.material.color.copy(color);
          u.fl.material.opacity = (state === 'blow' && stateT > i * 0.06 ? Math.max(0, 0.9 - (stateT - i * 0.06) * 3) : flick * 0.9) * (state === 'blow' ? 1 : dim + hushK * 0.9);
          u.fl.scale.setScalar((1 + u.pop * 1.6 + chorus * 0.4) * (0.8 + flick * 0.3));
        } else {
          u.fl.material.opacity = 0.05;
          u.fl.scale.setScalar(0.7);
        }
      });

      // ── the drifting flames ──
      const speed = (7 + audio.volume * 6 * reactivity) * (state === 'gather' ? 1 : 0.15);
      for (const f of flames) {
        if (!f.userData.live) continue;
        f.position.z += speed * dt;
        f.position.x += Math.sin(time * 1.3 + f.userData.seed) * dt * 1.6;
        f.position.y += Math.cos(time * 1.1 + f.userData.seed) * dt * 1.2;
        const flick = 0.8 + Math.sin(time * 8 + f.userData.seed) * 0.2;
        color.setHSL(0.1, 0.85, 0.55 + audio.treble * 0.2);
        f.userData.s.material.color.copy(color);
        f.userData.s.material.opacity = (0.55 + audio.treble * 0.3) * flick * dim;
        f.userData.s.scale.setScalar((1 + chorus * 0.5) * flick);
        if (f.position.z > 6) dealFlame(f, true);   // sailed past: comes back around
        // the catch: close enough is caught, and a candle answers
        if (state === 'gather' && lit < CANDLES && f.position.distanceTo(player.position) < 2.4) {
          dealFlame(f, true);
          const c = candles[lit];
          c.userData.on = true;
          c.userData.pop = 1;
          lit++;
          tapGlit = Math.max(tapGlit, 0.6);
          if (opts.impact) opts.impact(0.45);
          if (lit >= CANDLES) { state = 'hush'; stateT = 0; }
        }
      }

      // ── the ceremony ──
      stateT += dt;
      if (state === 'hush' && stateT > 2.2) { state = 'blow'; stateT = 0; }
      if (state === 'blow') {
        if (stateT > 1.1 && !this._sung) {
          this._sung = true;
          // the sky answers: fireworks, their name, and the house repaint
          document.dispatchEvent(new CustomEvent('fp-bday'));
          this._volleys = 5;
          this._nextVolley = 0;
        }
        if (this._sung && this._volleys > 0 && stateT > this._nextVolley + 1.1) {
          this._nextVolley = stateT;
          this._volleys--;
          const at = new THREE.Vector3((Math.random() * 2 - 1) * 26, 8 + Math.random() * 14, -46 - Math.random() * 20);
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
          if (opts.impact) opts.impact(0.5);
          if (this._volleys === 2) document.dispatchEvent(new CustomEvent('fp-lookspark'));
        }
        if (this._sung && this._volleys <= 0 && stateT > this._nextVolley + 2.5) {
          // the encore: candles rest, lanterns rise, it begins again
          this._sung = false;
          finales++;
          this._lanternWant = Math.min(20, 4 + finales * 3);
          candles.forEach(c => { c.userData.on = false; });
          lit = 0;
          state = 'gather'; stateT = 0;
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
        l.position.set((Math.random() * 2 - 1) * 50, -12 + Math.random() * 8, -30 - Math.random() * 60);
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

      // the player's light answers taps with a glitter swell
      tapGlit = Math.max(0, tapGlit - dt * 1.6);
      paint(0.5, audio.mid);
      color.setHSL(tp[0], tp[1], Math.min(0.75, 0.55 + tapGlit * 0.3));
      player.material.color.copy(color);
      halo.material.color.copy(color);
      halo.material.opacity = 0.35 + tapGlit * 0.4 + audio.beatIntensity * 0.15;
      halo.scale.setScalar(1 + tapGlit * 1.2 + audio.bass * 0.3);

      // camera: a slow waltz, leaning where you steer
      camera.position.set(steer.x * 2.5 + Math.sin(time * 0.1) * 1.5, 1.5 + steer.y * 1.5, 14 - chorus * 1.5);
      camera.lookAt(steer.x * 3, steer.y * 2, -40);
      const fovT = 74 + audio.volume * 6 * reactivity + hushK * -6;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();

      // the quiet HUD: how many candles wait (the cake shows it, this confirms)
      if (window.__setFigure) window.__setFigure('CANDLES', lit, CANDLES);
    },

    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      rims = []; candles = []; flames = []; bursts = []; rings = []; lanterns = [];
      if (window.__setFigure) window.__setFigure(null);
    },
  };
}
