// COMETS — you ARE the comet. Deep space at full burn: silver stars hang on
// the music, and every one you thread joins a glowing dot-to-dot line drawn
// behind you — "connecting all the planets like a dot-to-dot game". Every
// fifth star completes a constellation and pays a bonus. Red giants are the
// hazard: shave one at full burn for a close call, hit one and your flame
// snuffs. Planets drift past for scale; your constellations linger and fade,
// leaving your signature, leaving your mark.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=243';
import { TUNE } from '../lib/tune.js?v=243';

const MAX_STARS = 24;
const AHEAD = 110;            // where stars appear down the flight path
const SPACING = 2.1;          // min seconds between arrivals
const REACH = 9;              // how far steering carries you off the path
const HIT_W = 3.8;            // close enough counts as threaded
const SEG_MAX = 300;          // constellation segments alive at once
const SEG_FADE = 40;          // seconds a drawn line lingers — long enough
                              // that the turn-around at the bell still finds them
const LITE = () => !!window.__LITE;

// the constellations you complete get NAMES — the southern sky's own
const CONSTELLATIONS = [
  'THE FIDDLE', 'THE PORCH LIGHT', 'THE MASON JAR', 'THE FIREFLY',
  'THE MAGNOLIA', 'THE SLOW TRAIN', 'THE SCREEN DOOR', 'THE LIGHTNING BUG',
  'THE BANJO', 'THE HONEYSUCKLE', 'THE CATFISH', 'THE JULEP',
];

// ceremony text rides the same flash the passes use
function skyFlash(text, bad) {
  const el = document.getElementById('pass-flash');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('bad', !!bad);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(skyFlash._t);
  skyFlash._t = setTimeout(() => el.classList.remove('show'), 2000);
}

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
  let nebulae = [], milky = null, sun = null, meteors = [];
  let meteorNext = 3;
  let rivals = [];              // comet ghosts for placeGhost
  let head = null, tail = [];   // your own comet, and the fire it drags
  let tailAt = 0;
  let previewLine = null;       // the next stitch, shown before you sew it
  let constAt = 0;              // which named constellation is next
  let wh = { armed: false, done: false, z: 0, x: 0, grp: null };
  let wasDodging = false, reviewT = 99;
  const color = new THREE.Color();

  // a pickup should GLINT, not blob: a four-point star cross
  function sparkleTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    x.globalCompositeOperation = 'lighter';
    x.fillStyle = 'rgba(255,255,255,0.95)';
    for (const [w, h] of [[2.6, 30], [30, 2.6]]) {
      x.save(); x.translate(32, 32);
      const gr = x.createRadialGradient(0, 0, 0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr;
      x.fillRect(-w / 2, -h, w, h * 2);
      x.restore();
    }
    return new THREE.CanvasTexture(c);
  }

  // a nebula is weather, not wallpaper: a few soft blobs of one hue family
  function nebulaTex(baseHue) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    for (let i = 0; i < 9; i++) {
      const px = 40 + Math.random() * 176, py = 40 + Math.random() * 176;
      const r = 34 + Math.random() * 68;
      const h = (baseHue + (Math.random() - 0.5) * 50 + 360) % 360;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'hsla(' + h + ', 75%, 62%, 0.16)');
      g.addColorStop(1, 'hsla(' + h + ', 75%, 62%, 0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 256, 256);
    }
    return new THREE.CanvasTexture(c);
  }

  // a gas giant is WEATHER: wavy bands, storm ovals, darkened poles.
  // Painted once per planet onto a canvas; the light does the rest.
  function bandTexture(hex, seed) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    const base = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    const rnd = (n) => (((seed * 92821 + n * 68917) % 1000) / 1000);
    // wavy bands: each drawn as a ribbon whose edge undulates
    let y = 0, i = 0;
    while (y < 132) {
      const bh = 7 + rnd(i) * 16;
      const dl = (rnd(i + 50) - 0.5) * 0.26;
      const ds = (rnd(i + 90) - 0.5) * 0.2;
      color.setHSL(hsl.h + (rnd(i + 130) - 0.5) * 0.03, Math.max(0.15, Math.min(1, hsl.s + ds)),
                   Math.max(0.12, Math.min(0.85, hsl.l * 0.8 + dl)));
      ctx.fillStyle = '#' + color.getHexString();
      ctx.beginPath();
      const amp = 1.5 + rnd(i + 170) * 3, ph = rnd(i + 210) * 6.28, fr = 2 + rnd(i + 250) * 3;
      ctx.moveTo(0, y + Math.sin(ph) * amp);
      for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, y + Math.sin(ph + x / 256 * fr * 6.28) * amp);
      for (let x = 256; x >= 0; x -= 8) ctx.lineTo(x, y + bh + Math.sin(ph + 1 + x / 256 * fr * 6.28) * amp);
      ctx.closePath();
      ctx.fill();
      y += bh; i++;
    }
    // storm ovals — every giant carries a few
    for (let k = 0; k < 3 + (seed % 3); k++) {
      const sx = rnd(k + 300) * 256, sy = 25 + rnd(k + 340) * 78;
      const rw = 8 + rnd(k + 380) * 18, rh = rw * (0.35 + rnd(k + 420) * 0.25);
      const light = rnd(k + 460) > 0.5;
      color.setHSL(hsl.h + (light ? 0.02 : -0.03), Math.min(1, hsl.s + 0.15), light ? 0.72 : 0.22);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#' + color.getHexString();
      ctx.beginPath(); ctx.ellipse(sx, sy, rw, rh, 0, 0, 6.28); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // poles darken like real giants do
    for (const [gy0, gy1] of [[0, 22], [128, 106]]) {
      const g = ctx.createLinearGradient(0, gy0, 0, gy1);
      g.addColorStop(0, 'rgba(0,0,10,0.5)');
      g.addColorStop(1, 'rgba(0,0,10,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.min(gy0, gy1), 256, Math.abs(gy1 - gy0));
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  // a ring is a DISC of many thin bands, gapped like the real thing
  function ringTexture(hex) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 8;
    const ctx = c.getContext('2d');
    const base = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    for (let x = 0; x < 128; x++) {
      const band = Math.sin(x * 0.55) * 0.5 + Math.sin(x * 0.19) * 0.5;
      const a = Math.max(0, 0.55 + band * 0.45) * (x < 8 ? x / 8 : x > 118 ? (128 - x) / 10 : 1);
      color.setHSL(hsl.h, hsl.s * 0.5, 0.55 + band * 0.18);
      ctx.fillStyle = 'rgba(' + Math.round(color.r * 255) + ',' + Math.round(color.g * 255) + ',' + Math.round(color.b * 255) + ',' + a.toFixed(2) + ')';
      ctx.fillRect(x, 0, 1, 8);
    }
    return new THREE.CanvasTexture(c);
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
      // The stock dome is near-black away from the horizon, and when the
      // flight path pitched the camera the dark pole swung into frame — the
      // "black void" that came and went. Repaint it: indigo depths overhead,
      // teal warmth at the horizon, colour everywhere, void nowhere.
      {
        const posA = sky.geometry.attributes.position;
        const colA = sky.geometry.attributes.color;
        for (let i = 0; i < posA.count; i++) {
          const y = posA.getY(i) / 400;                     // -1..1
          const horizon = Math.max(0, 1 - Math.abs(y) * 1.4);
          color.setHSL(
            0.72 - horizon * 0.22,                          // indigo up top, teal at the rim
            0.55,
            0.075 + horizon * horizon * 0.12 + Math.max(0, -y) * 0.02
          );
          colA.setXYZ(i, color.r, color.g, color.b);
        }
        colA.needsUpdate = true;
      }
      group.add(sky);

      // dust — the starfield you fly THROUGH, not a painted backdrop
      {
        const N = LITE() ? 450 : 900;
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

      // colour the dust: most stars white, some blue-hot, some gold
      {
        const pos = dust.geometry.attributes.position;
        const cols = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          const roll = Math.random();
          color.setHSL(roll < 0.12 ? 0.58 : roll < 0.24 ? 0.12 : 0, roll < 0.24 ? 0.7 : 0, 0.75 + Math.random() * 0.25);
          cols[i * 3] = color.r; cols[i * 3 + 1] = color.g; cols[i * 3 + 2] = color.b;
        }
        dust.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        dust.material.vertexColors = true;
      }

      // the Milky Way — a dense tilted river of faint stars behind everything
      {
        const N = LITE() ? 700 : 1600;
        const pos = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
          const along = (Math.random() - 0.5) * 700;
          const thick = (Math.random() - 0.5) * (Math.random() - 0.5) * 160;
          pos[i * 3] = along * 0.8;
          pos[i * 3 + 1] = along * 0.28 + thick;         // the tilt
          pos[i * 3 + 2] = -120 - Math.random() * 320;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        milky = new THREE.Points(geo, glowPoints(1.0, 0.4));
        milky.material.color.setHSL(0.09, 0.35, 0.8);    // old starlight is warm
        group.add(milky);
      }

      // nebulae — the weather of deep space, in this world's hue family
      {
        const HUES = [270, 200, 330, 45, 180, 290];
        const count = LITE() ? 4 : 7;
        for (let i = 0; i < count; i++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({
            map: nebulaTex(HUES[i % HUES.length]),
            transparent: true, opacity: 0.5,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
          }));
          sp.scale.setScalar(150 + (i * 47 % 130));
          sp.userData = { base: i * 130 + 60, side: ((i % 2) ? -1 : 1) * (60 + (i * 31 % 80)), lift: (i * 23 % 90) - 45 };
          nebulae.push(sp);
          group.add(sp);
        }
      }

      // ── real light: the sun casts it, the planets wear it. Every other
      // material in this world is unlit glow, so the two lights below touch
      // only the Lambert planet surfaces and moons.
      {
        const dir = new THREE.DirectionalLight(0xfff0d8, 2.2);
        dir.position.set(-0.55, 0.35, 0.35);
        group.add(dir);
        group.add(new THREE.AmbientLight(0x202838, 1.4));
      }

      // one far sun — something for the whole sky to orbit around
      {
        sun = new THREE.Group();
        const g1 = glowSprite(60);
        g1.material.color.setHSL(0.09, 0.9, 0.75);
        const g2 = glowSprite(22);
        g2.material.color.setHSL(0.12, 0.6, 0.92);
        sun.add(g1, g2);
        group.add(sun);
      }

      // shooting stars — rare, fast, and worth pointing at
      if (!LITE()) {
        for (let i = 0; i < 3; i++) {
          const sp = glowSprite(3);
          sp.scale.set(14, 0.8, 1);
          sp.visible = false;
          sp.userData = { life: 0, vx: 0, vy: 0 };
          group.add(sp);
          meteors.push(sp);
        }
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
          new THREE.SphereGeometry(r, 36, 26),
          new THREE.MeshLambertMaterial({ map: bandTexture(PALETTE_P[i], i + 3) })
        );
        grp.add(body);
        // atmosphere — a whisper of the planet's own colour past its edge
        const atmo = new THREE.Mesh(
          new THREE.SphereGeometry(r * 1.05, 24, 18),
          new THREE.MeshBasicMaterial({
            color: PALETTE_P[i], transparent: true, opacity: 0.26,
            side: THREE.BackSide, blending: THREE.AdditiveBlending,
            depthWrite: false, toneMapped: false,
          })
        );
        grp.add(atmo);
        if (i % 2 === 0) {
          // the Saturn treatment, properly: a flat banded DISC, not a donut
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(r * 1.45, r * 2.35, 56),
            new THREE.MeshBasicMaterial({
              map: ringTexture(PALETTE_P[i]), transparent: true,
              side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
            })
          );
          // map the texture across the ring's radius
          const uv = ring.geometry.attributes.uv;
          const pos2 = ring.geometry.attributes.position;
          for (let v = 0; v < uv.count; v++) {
            const len = Math.hypot(pos2.getX(v), pos2.getY(v));
            uv.setXY(v, (len - r * 1.45) / (r * 0.9), 0.5);
          }
          ring.rotation.x = Math.PI / 2 - 0.32;
          grp.add(ring);
        }
        grp.rotation.z = (i % 2 ? -1 : 1) * (0.12 + (i * 17 % 20) * 0.012);  // axis tilt
        const halo = glowSprite(r * 3.4);
        halo.material.color.setHex(PALETTE_P[i]);
        halo.material.opacity = 0.3;
        grp.add(halo);
        // moons — one or two small companions, each on its own clock
        const moons = [];
        for (let m = 0; m < 1 + (i % 2); m++) {
          const moon = new THREE.Mesh(
            new THREE.SphereGeometry(r * 0.16, 12, 10),
            new THREE.MeshLambertMaterial({ color: 0xbdb8ac })
          );
          moon.userData = { orbit: r * (2.3 + m * 0.9), speed: 0.5 + m * 0.35 + (i % 3) * 0.15, phase: i * 2.1 + m * 3.3 };
          moons.push(moon);
          grp.add(moon);
        }
        grp.userData = {
          base: i * 150 + 80,
          side: (i % 2 ? -1 : 1) * (46 + (i * 53 % 30)),
          lift: ((i * 29 % 40) - 20),
          spin: 0.02 + (i * 13 % 10) * 0.004,
          body, halo, moons, pulse: 0,
        };
        planets.push(grp);
        group.add(grp);
      }

      // the next stitch — a faint dashed thread from your last star to the
      // coming one, so you draw on purpose instead of merely reacting
      {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        previewLine = new THREE.Line(geo, new THREE.LineDashedMaterial({
          color: 0xffffff, dashSize: 1.4, gapSize: 1.8, transparent: true,
          opacity: 0.3, depthWrite: false, toneMapped: false,
        }));
        previewLine.frustumCulled = false;
        previewLine.visible = false;
        group.add(previewLine);
      }

      // the wormhole — one per song, off the line, worth the detour
      {
        const g = new THREE.Group();
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(5.5, 0.6, 10, 40),
          new THREE.MeshBasicMaterial({ color: 0xb86bff, toneMapped: false })
        );
        const halo = glowSprite(22);
        halo.material.color.setHex(0xb86bff);
        halo.material.opacity = 0.4;
        g.add(ring, halo);
        g.visible = false;
        group.add(g);
        wh.grp = g;
      }

      // star + red giant pools — silver stars GLINT with a four-point cross
      const sparkMap = sparkleTex();
      for (let i = 0; i < MAX_STARS; i++) {
        const g = new THREE.Group();
        const core = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.9, 1),
          new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
        );
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: sparkMap, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }));
        halo.scale.setScalar(9);
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
      for (let i = 0; i < (LITE() ? 20 : 48); i++) {
        const sp = glowSprite(1.1);
        sp.visible = false;
        sp.userData = { life: 0, vx: 0, vy: 0 };
        group.add(sp);
        tail.push(sp);
      }
    },

    setInput(x) { steerTarget = x; },

    // tap a planet and it ANSWERS — flare, spin, a burst of sparks. The sky
    // is scenery you can poke, which is the whole Fancy Britches promise.
    onTap(nx, ny) {
      if (!camera) return;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, camera);
      for (const pl of planets) {
        const hit = ray.intersectObject(pl.userData.body, false);
        if (hit.length) {
          pl.userData.pulse = 1;
          pl.userData.wob = 1;                 // it rings like a struck bell
          pl.userData.tapSpin = 1;             // and the moons hurry for a while
          // touching a planet PAYS a little — the sky tips you for curiosity
          if (this._addScore) {
            this._addScore(2, (nx + 1) / 2 * window.innerWidth, (1 - (ny + 1) / 2) * window.innerHeight);
          }
          // a handful of embers thrown off the surface
          for (let k = 0; k < 10; k++) {
            const sp = tail[tailAt]; tailAt = (tailAt + 1) % tail.length;
            sp.visible = true;
            sp.userData.life = 1;
            sp.userData.vx = (Math.random() - 0.5) * 18;
            sp.userData.vy = (Math.random() - 0.5) * 18;
            sp.position.copy(hit[0].point);
            sp.material.color.copy(pl.userData.halo.material.color);
          }
          break;
        }
      }
    },

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
            // a red giant is FIRE, not geometry: a small molten heart inside
            // a huge breathing corona — the silhouette is all glow
            const th = 0.5 + Math.sin(time * 6 + d.spin) * 0.15;
            d.core.scale.setScalar(0.9 + th * 0.3);
            d.core.material.color.setHSL(0.05, 1, 0.62 + th * 0.2);
            d.halo.material.color.setHSL(0.015, 0.95, 0.45);
            d.halo.scale.setScalar(17 + th * 6);
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
              if (fifth) {
                // ── the ceremony: your five stars get a NAME, and the lines
                // you just drew flare fresh
                skyFlash(CONSTELLATIONS[constAt % CONSTELLATIONS.length] + ' \u00b7 +5');
                constAt++;
                for (let k = 1; k <= 5; k++) {
                  const idx = (segAt - k + SEG_MAX) % SEG_MAX;
                  if (segBorn[idx] > -1e8) segBorn[idx] = time;
                }
              }
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
        // ── the wormhole: once per song, past the halfway mark ──
        if (!wh.done && !wh.armed && opts.songDur && songTime > opts.songDur * 0.55) {
          wh.armed = true;
          wh.z = -(travel + 240);
          wh.x = (steer > 0 ? -1 : 1) * REACH * 0.92;   // the far side, on purpose
          wh.grp.visible = true;
        }
        if (wh.armed && !wh.done) {
          const t = -wh.z;
          const wx = pathX(t) + wh.x;
          const wy = pathY(t) + 1.5;
          wh.grp.position.set(wx, wy, wh.z);
          wh.grp.children[0].rotation.z = time * 2.2;
          const near = Math.max(0, 1 - (t - travel) / 240);
          wh.grp.children[0].scale.setScalar(1 + Math.sin(time * 5) * 0.06 + near * 0.15);
          const ahead = t - travel;
          if (ahead <= 5) {
            const gap = Math.abs(wx - (pathX(travel) + steer * REACH));
            if (gap < 5.5) {
              // skipping through time: a fat payout and a genuine jump ahead
              race.collect(8);
              boost = 1;
              travel += 25;
              skyFlash('THROUGH THE WORMHOLE \u00b7 +8');
              if (opts.impact) opts.impact(1.0);
            }
            wh.done = true;
            wh.grp.visible = false;
          }
        }

        // ── the next stitch ──
        if (lastStar) {
          let next = null, bestAhead = 1e9;
          for (const d of stars) {
            if (!d.alive || d.red) continue;
            const a = -d.z - travel;
            if (a > 4 && a < bestAhead) { bestAhead = a; next = d; }
          }
          if (next) {
            const pa = previewLine.geometry.attributes.position;
            pa.setXYZ(0, lastStar.x, lastStar.y, lastStar.z);
            pa.setXYZ(1, pathX(-next.z) + next.x, pathY(-next.z) + 1.5 + next.y, next.z);
            pa.needsUpdate = true;
            previewLine.computeLineDistances();
            color.setHSL(((hue + 30) % 360) / 360, 0.4, 0.7);
            previewLine.material.color.copy(color);
            previewLine.visible = true;
          } else previewLine.visible = false;
        } else previewLine.visible = false;
      } else {
        // vibing: stars off, the line rests
        for (const d of stars) { d.alive = false; d.mesh.visible = false; }
        previewLine.visible = false;
        wh.grp.visible = false;
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

      // nebulae drift on the longest loop of all, breathing with the bass
      for (let i = 0; i < nebulae.length; i++) {
        const sp = nebulae[i];
        const u = sp.userData;
        const z = -(((u.base + travel * 0.18) % 800));
        sp.position.set(pathX(travel) + u.side, u.lift, -travel + z - 80);
        sp.material.opacity = 0.35 + audio.bass * 0.35 * reactivity;
        sp.material.rotation = time * 0.008 * (i % 2 ? 1 : -1);
      }
      if (milky) milky.position.z = -travel - 0;
      if (milky) milky.position.x = pathX(travel) * 0.9;
      if (sun) sun.position.set(pathX(travel) - 130, 40, -travel - 380);

      // a meteor now and then — the sky is alive even between beats
      if (meteors.length) {
        meteorNext -= dt;
        if (meteorNext <= 0) {
          meteorNext = 4 + Math.random() * 7;
          const m = meteors.find(x => !x.visible);
          if (m) {
            m.visible = true;
            m.userData.life = 1;
            m.position.set(pathX(travel) + (Math.random() - 0.5) * 160, 30 + Math.random() * 50, -travel - 200 - Math.random() * 150);
            m.userData.vx = 30 + Math.random() * 40;
            m.userData.vy = -(12 + Math.random() * 18);
            m.material.rotation = Math.atan2(-m.userData.vy, m.userData.vx);
          }
        }
        for (const m of meteors) {
          if (!m.visible) continue;
          m.userData.life -= dt * 0.7;
          if (m.userData.life <= 0) { m.visible = false; continue; }
          m.position.x += m.userData.vx * dt;
          m.position.y += m.userData.vy * dt;
          m.material.opacity = Math.sin(m.userData.life * Math.PI) * 0.8;
        }
      }

      // planets wheel past on a long loop — breathing, orbited, poke-able
      this._addScore = opts.addScore;
      for (const pl of planets) {
        const u = pl.userData;
        const z = -(((u.base + travel * 0.35) % 900));   // parallax: far things move slow
        pl.position.set(pathX(travel) + u.side, u.lift, -travel + z);
        pl.rotation.y += u.spin * dt * 10;
        u.pulse = Math.max(0, u.pulse - dt * 1.6);
        u.wob = Math.max(0, (u.wob || 0) - dt * 0.7);
        u.tapSpin = Math.max(0, (u.tapSpin || 0) - dt * 0.4);
        // a struck planet rings: a damped wobble you can SEE settle
        const ring = 1 + Math.sin(u.wob * 26) * u.wob * 0.12;
        // flying close, it BLOOMS — mass you can feel on the way past
        const near = Math.max(0, 1 - Math.abs(pl.position.z - -travel) / 90);
        const breathe = (1 + audio.bass * 0.05 * reactivity + u.pulse * 0.1) * ring;
        u.body.scale.setScalar(breathe);
        u.halo.material.opacity = 0.3 + u.pulse * 0.55 + audio.bass * 0.12 + near * 0.3;
        for (const moon of u.moons) {
          const md = moon.userData;
          const a = time * md.speed * (1 + (u.tapSpin || 0) * 2.5) + md.phase;
          moon.position.set(Math.cos(a) * md.orbit, Math.sin(a * 0.7) * md.orbit * 0.25, Math.sin(a) * md.orbit);
        }
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

      // ── the comet's eye — low, banking, lens opening with the burn.
      // At the bell it TURNS AROUND: nine seconds facing everything you
      // drew, glittering behind the results card. Leaving your mark.
      if (dodging) { wasDodging = true; reviewT = 0; }
      else if (wasDodging) { reviewT += dt; if (reviewT > 9) wasDodging = false; }
      const reviewing = !dodging && wasDodging && reviewT <= 9;
      const camX = pathX(travel) + steer * REACH;
      const camY = pathY(travel) + 1.5 + Math.sin(time * 1.3) * 0.15;
      camera.position.set(camX, camY, -travel);
      if (reviewing) {
        const back = travel - 70;
        const swing = Math.min(1, reviewT / 2.2);          // ease into the turn
        const lookT = travel + 40 - (110 + Math.sin(reviewT * 0.3) * 20) * swing;
        camera.lookAt(pathX(back), pathY(back) + 6, -lookT);
        camera.rotation.z += Math.sin(time * 0.2) * 0.03;
      } else {
        const lookT = travel + 40;
        camera.lookAt(pathX(lookT) + steer * REACH * 0.4, pathY(lookT) + 1.5, -lookT);
        camera.rotation.z += steer * -0.16 + Math.sin(time * 0.3) * 0.02;
      }
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
