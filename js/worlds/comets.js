// COMETS — you ARE the comet. Deep space at full burn: silver stars hang on
// the music, and every one you thread joins a glowing dot-to-dot line drawn
// behind you — "connecting all the planets like a dot-to-dot game". Every
// fifth star completes a constellation and pays a bonus. Red giants are the
// hazard: shave one at full burn for a close call, hit one and your flame
// snuffs. Planets drift past for scale; your constellations linger and fade,
// leaving your signature, leaving your mark.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=237';
import { TUNE } from '../lib/tune.js?v=237';

const MAX_STARS = 24;
const AHEAD = 110;            // where stars appear down the flight path
const SPACING = 2.1;          // min seconds between arrivals
const REACH = 9;              // how far steering carries you off the path
const HIT_W = 3.8;            // close enough counts as threaded
const SEG_MAX = 300;          // constellation segments alive at once
const SEG_FADE = 26;          // seconds a drawn line lingers

export function createComets() {
  let scene, camera, group, sky, dust, lines;
  let travel = 0, boost = 0;
  let steer = 0, steerTarget = 0;
  let throttle = 0, stun = 0;
  let stars = [], giants = [];
  let chartAt = 0, lastT = -99, arrivals = 0;
  let caught = 0;               // consecutive stars toward a constellation
  let lastStar = null;          // world position of the previous threaded star
  let cLastChartRef = null;
  let planets = [];
  let rivals = [];              // comet ghosts for placeGhost
  let head = null, tail = [];   // your own comet, and the fire it drags
  let tailAt = 0;
  const color = new THREE.Color();

  // a gas giant is bands, not a flat ball: paint them once onto a canvas.
  // Each planet gets its own weather from the same recipe.
  function bandTexture(hex, seed) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 128;
    const ctx = c.getContext('2d');
    const base = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    let y = 0, i = 0;
    while (y < 128) {
      const bh = 6 + ((seed * 37 + i * 61) % 17);          // band height
      const dl = (((seed * 13 + i * 29) % 100) / 100 - 0.5) * 0.22;
      const ds = (((seed * 7 + i * 43) % 100) / 100 - 0.5) * 0.15;
      color.setHSL(hsl.h, Math.max(0.1, Math.min(1, hsl.s + ds)), Math.max(0.05, Math.min(0.8, hsl.l * 0.55 + dl)));
      ctx.fillStyle = '#' + color.getHexString();
      ctx.fillRect(0, y, 8, bh);
      y += bh; i++;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  // the flight path — a lazy 3D weave, so space itself banks and rolls
  const pathX = t => Math.sin(t * 0.021) * 22 + Math.sin(t * 0.0077) * 30;
  const pathY = t => Math.sin(t * 0.013) * 12;

  // constellation ring buffer: [ax,ay,az, bx,by,bz] + birth time per segment
  const segPos = new Float32Array(SEG_MAX * 6);
  const segCol = new Float32Array(SEG_MAX * 6);
  const segBorn = new Float32Array(SEG_MAX).fill(-1e9);
  let segAt = 0;

  return {
    name: 'COMETS',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;                       // space has no weather
      camera.fov = 70;

      sky = skyDome(400);
      group.add(sky);

      // dust — the starfield you fly THROUGH, not a painted backdrop
      {
        const N = 900;
        const pos = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
          pos[i * 3] = (Math.random() - 0.5) * 240;
          pos[i * 3 + 1] = (Math.random() - 0.5) * 160;
          pos[i * 3 + 2] = -Math.random() * 500;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        dust = new THREE.Points(geo, glowPoints(1.6, 0.75));
        group.add(dust);
      }

      // the constellation — one growing line, additive, fading by color
      {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(segPos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(segCol, 3));
        lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
          vertexColors: true, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }));
        lines.frustumCulled = false;
        group.add(lines);
      }

      // planets — scale and majesty, drifting past out of reach
      const PALETTE_P = [0xd9a86c, 0x7fb8d9, 0xc76e6e, 0x9a7fd9, 0x6ed9a8, 0xd9d06e];
      for (let i = 0; i < 6; i++) {
        const grp = new THREE.Group();
        const r = 7 + (i * 37 % 11);
        const body = new THREE.Mesh(
          new THREE.SphereGeometry(r, 24, 18),
          new THREE.MeshBasicMaterial({ map: bandTexture(PALETTE_P[i], i + 3), toneMapped: false })
        );
        grp.add(body);
        if (i % 2 === 0) {
          // every other one gets the Saturn treatment — "Saturn has the rings"
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(r * 1.7, r * 0.16, 2, 40),
            new THREE.MeshBasicMaterial({ color: PALETTE_P[i], transparent: true, opacity: 0.5, toneMapped: false })
          );
          ring.rotation.x = Math.PI / 2.4;
          grp.add(ring);
        }
        const halo = glowSprite(r * 3.2);
        halo.material.color.setHex(PALETTE_P[i]);
        halo.material.opacity = 0.22;
        grp.add(halo);
        grp.userData = {
          base: i * 150 + 80,
          side: (i % 2 ? -1 : 1) * (46 + (i * 53 % 30)),
          lift: ((i * 29 % 40) - 20),
          spin: 0.02 + (i * 13 % 10) * 0.004,
        };
        planets.push(grp);
        group.add(grp);
      }

      // star + red giant pools
      for (let i = 0; i < MAX_STARS; i++) {
        const g = new THREE.Group();
        const core = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.9, 1),
          new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
        );
        const halo = glowSprite(9);
        g.add(core, halo);
        g.visible = false;
        group.add(g);
        stars.push({ mesh: g, core, halo, alive: false, z: 0, x: 0, y: 0, red: false, spin: i * 2.3 });
      }

      // ── your own comet: a bright head riding just under the lens, and a
      // tail of embers that stream back past the frame. The tail is the
      // speedometer you feel instead of read.
      // glow-only: geometry that close to the lens only ever reads as an
      // artifact — a comet head IS light
      head = new THREE.Group();
      const hGlow = glowSprite(2.4);
      head.add(hGlow);
      group.add(head);
      for (let i = 0; i < 48; i++) {
        const sp = glowSprite(1.1);
        sp.visible = false;
        sp.userData = { life: 0, vx: 0, vy: 0 };
        group.add(sp);
        tail.push(sp);
      }
    },

    setInput(x) { steerTarget = x; },

    placeGhost(p, i, out) {
      // rival comets fly the same sky, ahead or behind by score — and each
      // trails its own small tail of light
      const myScore = (typeof this._score === 'number') ? this._score : 0;
      const diff = Math.max(-8, Math.min(30, ((p.z || 0) - myScore) * 1.2));
      const t = travel + 14 + diff;
      out.set(pathX(t) + (p.x || 0) * REACH * 0.7, pathY(t) + 1.5, -t);
    },

    update(dt, audio, participants, opts) {
      const time = performance.now() / 1000;
      const race = opts.race, chart = opts.chart, songTime = opts.songTime || 0;
      const reactivity = opts.reactivity != null ? opts.reactivity : 1;
      const hue = opts.hue != null ? opts.hue : 210;
      const dodging = !!(race && race.active && race.mode === 'DODGE');

      // ── THE BURN — same bargain as every steered world: hold to floor it.
      // Stars pay double flat out and a shaved red giant pays a close call;
      // hitting one at speed costs three and snuffs the flame for a beat.
      boost = Math.max(0, boost - dt * 0.42);
      stun = Math.max(0, stun - dt);
      const gasWanted = (opts.holding && stun <= 0 && !opts.attract) ? 1 : 0;
      throttle += (gasWanted - throttle) * Math.min(1, dt * (gasWanted ? 5 : 2.6));
      const heat = ((dodging && opts.songDur) ? Math.min(1, songTime / opts.songDur) : 0) * TUNE.heat;
      const speed = dodging
        ? (16 + throttle * 26 + boost * 30) * (1 + 0.25 * Math.min(1, heat)) * TUNE.speed
        : 10 + audio.energy * 14 + audio.volume * 8 + throttle * 20;
      travel += speed * dt;

      if (opts.attract || steerTarget === undefined) { }
      steer += ((opts.attract ? Math.sin(time * 0.4) * 0.5 : steerTarget) - steer) * Math.min(1, dt * 3.5);
      if (participants && participants[0]) { participants[0].x = steer; participants[0].y = 0; }

      // ── stars on the chart ──
      if (dodging) {
        this._score = race.progress;
        if (chart !== cLastChartRef) {
          cLastChartRef = chart; chartAt = 0; lastT = -99; arrivals = 0;
          caught = 0; lastStar = null;
        }
        const spacingNow = SPACING * (1 - 0.4 * Math.min(1, heat)) / TUNE.density;
        const playerX = pathX(travel) + steer * REACH;
        if (chart) {
          while (chartAt < chart.length && chart[chartAt].t <= songTime + 0.05) {
            const n = chart[chartAt++];
            if (n.t < songTime - 0.4) { lastT = Math.max(lastT, n.t); continue; }
            if (n.t - lastT < spacingNow) continue;
            const d = stars.find(x => !x.alive);
            if (!d) continue;
            lastT = n.t; arrivals++;
            d.alive = true;
            d.z = -(travel + AHEAD);
            d.red = (arrivals % 4) === 0;          // every fourth is a red giant
            d.x = Math.sin((arrivals * 0.9) + (d.red ? 2.1 : 0)) * REACH * 0.85;
            d.y = Math.sin(arrivals * 1.7) * 3;
            d.mesh.visible = true;
          }
        }

        for (const d of stars) {
          if (!d.alive) continue;
          const t = -d.z;
          const wx = pathX(t) + d.x;
          const wy = pathY(t) + 1.5 + d.y;
          d.mesh.position.set(wx, wy, d.z);
          d.core.rotation.y = d.spin + time * (d.red ? 0.6 : 1.6);
          if (d.red) {
            // a red giant breathes like an ember — plainly not yours to touch
            const th = 0.5 + Math.sin(time * 6 + d.spin) * 0.15;
            d.core.scale.setScalar(2.4 + th * 0.5);
            d.core.material.color.setHSL(0.01, 0.95, 0.42 + th * 0.15);
            d.halo.material.color.setHSL(0.01, 0.95, 0.5);
            d.halo.scale.setScalar(14 + th * 4);
          } else {
            d.core.scale.setScalar(1);
            d.core.material.color.setHSL(0, 0, 0.95);
            d.halo.material.color.setHSL(0.14, 0.5, 0.8);  // silver-gold
            d.halo.scale.setScalar(8 + Math.sin(time * 5 + d.spin) * 1.5 + audio.volume * 3);
          }

          const ahead = t - travel;
          if (ahead <= 5) {
            const gap = Math.abs(wx - (pathX(travel) + steer * REACH));
            const through = gap < HIT_W;
            const flooring = throttle > 0.6;
            if (through && d.red) {
              race.drop(flooring ? 3 : 2);
              boost = 0; stun = flooring ? 1.2 : 0.5; throttle *= 0.2;
              caught = 0; lastStar = null;          // the line breaks
              if (opts.impact) opts.impact(flooring ? 1.0 : 0.8);
            } else if (d.red && flooring && gap < HIT_W * 2.1) {
              race.collect(1);                       // the close call pays
              if (opts.impact) opts.impact(0.35);
            } else if (through && !d.red) {
              caught++;
              const fifth = caught % 5 === 0;
              race.collect((boost > 0.35 ? 2 : 1) * (flooring ? 2 : 1) + (fifth ? 4 : 0));
              boost = Math.min(1, boost + 0.8);
              if (opts.impact) opts.impact(fifth ? 0.9 : (boost > 0.9 ? 0.7 : 0.45));
              // ── draw the line: this star joins the constellation ──
              const here = new THREE.Vector3(wx, wy, d.z);
              if (lastStar) {
                const o = segAt * 6;
                segPos[o] = lastStar.x; segPos[o + 1] = lastStar.y; segPos[o + 2] = lastStar.z;
                segPos[o + 3] = here.x; segPos[o + 4] = here.y; segPos[o + 5] = here.z;
                segBorn[segAt] = time;
                segAt = (segAt + 1) % SEG_MAX;
                lines.geometry.attributes.position.needsUpdate = true;
              }
              lastStar = here;
            } else if (!d.red) {
              race.drop(0);                          // a missed star breaks the run
              caught = 0; lastStar = null;
            }
            d.alive = false;
            d.mesh.visible = false;
          }
        }
      } else {
        // vibing: stars off, the line rests
        for (const d of stars) { d.alive = false; d.mesh.visible = false; }
      }

      // constellation fade — your signature lingers, then returns to the dark
      {
        color.setHSL(((hue + 30) % 360) / 360, 0.55, 0.75);
        for (let i = 0; i < SEG_MAX; i++) {
          const age = time - segBorn[i];
          const a = age > SEG_FADE ? 0 : Math.pow(1 - age / SEG_FADE, 1.4);
          const o = i * 6;
          segCol[o] = color.r * a; segCol[o + 1] = color.g * a; segCol[o + 2] = color.b * a;
          segCol[o + 3] = color.r * a; segCol[o + 4] = color.g * a; segCol[o + 5] = color.b * a;
        }
        lines.geometry.attributes.color.needsUpdate = true;
      }

      // planets wheel past on a long loop
      for (const pl of planets) {
        const u = pl.userData;
        const z = -(((u.base + travel * 0.35) % 900));   // parallax: far things move slow
        pl.position.set(pathX(travel) + u.side, u.lift, -travel + z);
        pl.rotation.y += u.spin * dt * 10;
      }

      // dust wraps around the flight
      {
        const pos = dust.geometry.attributes.position;
        dust.position.z = -travel;
        // cheap wrap: dust lives in camera space via group offset — recycle
        // points that fall behind by pushing them ahead
        for (let i = 0; i < pos.count; i++) {
          if (pos.getZ(i) + 40 > 0) pos.setZ(i, pos.getZ(i) - 500);
        }
        // slide the field back as we fly so there is always dust ahead
        const drift = speed * dt;
        for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + drift);
        pos.needsUpdate = true;
      }

      // ── the head leads the lens; the tail streams home past it ──
      if (head) {
        const hx = pathX(travel + 12) + steer * REACH * 0.9;
        const hy = pathY(travel + 12) - 0.6;
        head.position.set(hx, hy, -(travel + 12));
        head.children[0].scale.setScalar(2.2 + throttle * 1.4 + boost * 1);
        head.children[0].material.opacity = 0.55;
        color.setHSL(((hue + 30) % 360) / 360, 0.5, 0.8);
        head.children[0].material.color.copy(color);
        // spawn embers at the head — more and hotter the harder you burn
        const born = throttle > 0.3 ? 2 : 1;
        for (let k = 0; k < born; k++) {
          const sp = tail[tailAt]; tailAt = (tailAt + 1) % tail.length;
          sp.visible = true;
          sp.userData.life = 1;
          sp.userData.vx = (Math.random() - 0.5) * 3;
          sp.userData.vy = (Math.random() - 0.5) * 3;
          // scatter along the flight line so a slow frame never stacks them
          sp.position.set(hx, hy, -(travel + 12) + (Math.random() - 0.2) * 4);
          sp.material.color.copy(color);
        }
        for (const sp of tail) {
          if (!sp.visible) continue;
          sp.userData.life -= dt * 2.2;
          if (sp.userData.life <= 0) { sp.visible = false; continue; }
          // embers hold still in space — flying past them is what reads as speed
          sp.position.x += sp.userData.vx * dt;
          sp.position.y += sp.userData.vy * dt;
          sp.material.opacity = sp.userData.life * 0.3;
          sp.scale.setScalar(0.7 + (1 - sp.userData.life) * (1.2 + throttle * 1.4));
        }
      }

      sky.position.set(pathX(travel), 0, -travel);
      sky.material.color.setHSL(hue / 360, 0.5, 0.5);

      // ── the comet's eye — low, banking, lens opening with the burn ──
      const camX = pathX(travel) + steer * REACH;
      const camY = pathY(travel) + 1.5 + Math.sin(time * 1.3) * 0.15;
      camera.position.set(camX, camY, -travel);
      const lookT = travel + 40;
      camera.lookAt(pathX(lookT) + steer * REACH * 0.4, pathY(lookT) + 1.5, -lookT);
      camera.rotation.z += steer * -0.16 + Math.sin(time * 0.3) * 0.02;
      camera.fov += ((70 + throttle * 16 + boost * 5) - camera.fov) * Math.min(1, dt * 4);

      // rivals: glowing comet heads with tails, placed by score
      if (participants && participants.length > 1) {
        while (rivals.length < participants.length - 1) {
          const g = new THREE.Group();
          const head = glowSprite(6);
          const tail = glowSprite(11);
          tail.position.z = 4; tail.material.opacity = 0.35;
          g.add(head, tail);
          group.add(g);
          rivals.push(g);
        }
        const out = new THREE.Vector3();
        for (let i = 1; i < participants.length; i++) {
          const g = rivals[i - 1];
          if (!g) break;
          g.visible = true;
          this.placeGhost(participants[i], i, out);
          g.position.copy(out);
          const hex = participants[i].color || 0;
          g.children[0].material.color.setHex([0xff5c8a, 0xffb84d, 0xfff05c, 0x7dff6e, 0x53f5d6, 0x5cb8ff, 0x8f7dff, 0xd96bff, 0xff7d5c, 0x6effb8, 0x5c7dff, 0xff5cd9][hex % 12]);
        }
        for (let i = participants.length - 1; i < rivals.length; i++) rivals[i].visible = false;
      } else {
        for (const g of rivals) g.visible = false;
      }
    },

    dispose() {
      scene.remove(group);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.fog = null;
    },
  };
}
