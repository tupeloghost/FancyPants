// SURFER — infinite plane whose vertices displace from the frequency
// spectrum, so the terrain IS the waveform. One-button jump. Glowing wireframe.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=609';
import { swoosh as sfxSwoosh } from '../lib/sfx.js?v=609';
import { themePaint, richHSL } from '../lib/themes.js?v=609';


const COLS = 64;            // one column per spectrum bin
const ROWS = 96;            // rows of spectrum history scrolling toward camera
const WIDTH = 170, DEPTH = 260;
const ROW_INTERVAL = 0.035; // seconds between history rows

export function createSurfer() {
  let scene, camera, group, mesh, ceiling, sun, sunHalo, stars, sky;
  let steer = 0, steerTarget = 0;
  let jumpY = 0, jumpVel = 0;
  // ── airtime is the verb's paycheck: hang time counts, beats crossed
  // mid-air multiply, and the landing announces what you earned ──
  let airT = 0, airBeats = 0, airCombo = 0, comboT = 0;
  // ── sparks ── the reason to steer: they ride the flow toward you on the
  // beat. Low ones you carve into; high ones demand a jump. Catch mid-air
  // and they pay double. A chain builds while you keep catching.
  let sparks = [], sparkTimer = 0, sparkChain = 0, sparkDry = 0, sparkN = 0;
  // what the run is MADE of — reported to the signal ledger so the end-of-song
  // card can talk about sparks and air instead of stats this world never keeps
  let caught = 0, bestChain = 0, midairs = 0, rainbows = 0, jumps = 0;
  // ── surge ── hold to open the throttle. Sparks are the fuel: a full tank
  // surges harder, and it drains while you burn.
  let surge = 0, sparkFuel = 0.5;
  let rowTimer = 0, scrollOff = 0;
  let waveR = -1;             // tap shockwave position in row units (-1 = off)
  const history = [];       // ring of Float32Array(COLS), newest first
  for (let r = 0; r < ROWS; r++) history.push(new Float32Array(COLS));
  const color = new THREE.Color();

  return {
    name: 'SURFER',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x010208, 0.008);

      const geo = new THREE.PlaneGeometry(WIDTH, DEPTH, COLS - 1, ROWS - 1);
      geo.rotateX(-Math.PI / 2);
      const colors = new Float32Array(geo.attributes.position.count * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ wireframe: true, vertexColors: true, toneMapped: false })
      );
      mesh.frustumCulled = false; // heights are rewritten every frame
      group.add(mesh);

      // mirrored ceiling — the same waveform hangs overhead, so the frame
      // is enclosed top and bottom like the tunnel. Shares geometry: free.
      ceiling = new THREE.Mesh(geo, mesh.material);
      ceiling.frustumCulled = false;
      ceiling.scale.y = -1;
      ceiling.position.y = 30;
      // a phone screen is too small for two waveforms: the mirror doubled
      // the wireframe into visual noise and paid a full draw for it
      ceiling.visible = !window.__LITE;
      group.add(ceiling);

      // the spark pool
      sparks = [];
      for (let i = 0; i < 20; i++) {
        const sp = glowSprite(7);
        sp.visible = false;
        group.add(sp);
        // the pillar: a stretched glow beneath a high spark — reads as
        // "this one's above you, jump" from any distance
        const pil = glowSprite(7);
        pil.visible = false;
        group.add(pil);
        const o1 = glowSprite(5), o2 = glowSprite(5);
        o1.visible = false; o2.visible = false;
        group.add(o1); group.add(o2);
        sparks.push({ m: sp, pil, o1, o2, alive: false, x: 0, y: 0, z: 0, high: false, pop: 0 });
      }
      sparkTimer = 0; sparkChain = 0; sparkDry = 0; sparkN = 0;
      caught = 0; bestChain = 0; midairs = 0; rainbows = 0; jumps = 0;

      // synthwave sun — layered soft glows, no hard disc: geometry crossing
      // a gradient just dims it gently instead of slicing a seam through it
      sun = glowSprite(85);
      sun.material.fog = false;
      sun.position.set(0, 24, -230);
      group.add(sun);
      sunHalo = glowSprite(200);
      sunHalo.material.fog = false;
      sunHalo.position.copy(sun.position);
      sunHalo.position.z += 2;
      group.add(sunHalo);

      // stars above the horizon
      const sp = new Float32Array(400 * 3);
      for (let i = 0; i < 400; i++) {
        sp[i * 3] = (Math.random() - 0.5) * 500;
        sp[i * 3 + 1] = 20 + Math.random() * 160;
        sp[i * 3 + 2] = -260 + Math.random() * 60;
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      stars = new THREE.Points(sg, glowPoints(2.4, 0.8));
      stars.material.color.set(0xaabbee);
      stars.material.fog = false;
      group.add(stars);

      sky = skyDome(320);
      group.add(sky);

      camera.position.set(0, 10, 40);
      camera.rotation.set(0, 0, 0);
      camera.fov = 75;
      camera.updateProjectionMatrix();
    },

    // the tutor asks where to steer: the nearest catchable spark, in input
    // units, so the demonstration visibly catches instead of wandering
    demoTarget() {
      // the nearest ground spark still ahead of the board: z grows toward
      // the player and the catch happens around z 30-40, so chase the
      // largest z that has not passed yet
      let best = null;
      for (const sp of sparks) {
        if (!sp.alive || sp.look || sp.high || sp.z > 32) continue;
        if (!best || sp.z > best.z) best = sp;
      }
      return best ? Math.max(-1, Math.min(1, best.x / 36)) : null;
    },

    // the ledger only needs the totals; cheap enough to send on every event
    _report() {
      if (window.__declareSignals) {
        window.__declareSignals({ sparksCaught: caught, bestChain, midairCatches: midairs, rainbowSparks: rainbows, jumps });
      }
    },

    setInput(x) {
      if (Math.abs(x - steerTarget) > 0.04) this._lastActive = performance.now();
      steerTarget = x;
    },

    // ghost riders share the terrain, staggered ahead of the camera
    placeGhost(p, i, out) {
      out.set(p.x * 42, 7 + p.y * 4 + Math.sin(i * 3.1) * 1.5, 18 - (i % 5) * 8);
    },

    onTap() {
      // the wave does the throwing: jump ON a bass swell and it launches you
      // half again higher — the music is the trampoline, and you can feel it
      if (jumpY <= 0.01) { this._lastActive = performance.now(); jumpVel = 17 + this._lastBass * 14; jumps++; this._report(); if (this._lastBass > 0.45) sfxSwoosh('soft'); }
      waveR = 0;                        // + a shockwave ridge racing to the horizon
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      this._lastBass = audio.bass;
      const tp = this._tp || (this._tp = [0, 0, 0]);

      // hold = surge; fuel decides how hard. Eases in and out like a throttle
      const surgeTarget = (opts.holding && !attract) ? (0.45 + sparkFuel * 0.75) : 0;
      surge += (surgeTarget - surge) * Math.min(1, dt * 5);
      if (opts.holding) sparkFuel = Math.max(0, sparkFuel - dt * 0.15);
      camera.fov = 76 + surge * 16;
      camera.updateProjectionMatrix();

      // push a new spectrum row at a fixed cadence; terrain scrolls between rows
      rowTimer += dt * (0.6 + audio.volume * 1.2) * (1 + surge * 1.6); // music (and the throttle) speed the world up
      while (rowTimer >= ROW_INTERVAL) {
        rowTimer -= ROW_INTERVAL;
        const row = history.pop();
        const amp = (5 + audio.bass * 16 * reactivity);
        for (let c = 0; c < COLS; c++) {
          // mirror the spectrum so the lows rise at the road's edges and
          // the center stays surfable
          const bin = Math.min(63, Math.floor(Math.abs(c - COLS / 2) * 2));
          row[c] = audio.spectrum[bin] * amp * (0.35 + Math.abs(c - COLS / 2) / (COLS / 2));
        }
        history.unshift(row);
      }

      if (participants && participants[0]) {
        participants[0].x = steer;
        participants[0].y = jumpY / 12;
      }

      // steering / attract drift
      if (attract) steerTarget = Math.sin(time * 0.25) * 0.5;
      steer += (steerTarget - steer) * Math.min(1, dt * 3);

      // ── sparks: spawn on the beat, flow with the terrain, get caught ──
      const flow = 77 * (0.6 + audio.volume * 1.2) * (1 + surge * 1.6) * (1 + (opts.peak || 0) * 0.25);
      sparkTimer -= dt;
      // a steady stream regardless of the beat detector (some songs hide
      // their beats from it) — detected beats just make it rain harder
      const pk = opts.peak || 0;
      const aliveN = sparks.reduce((a, x) => a + (x.alive ? 1 : 0), 0);
      if (!attract && aliveN < (pk > 0.5 ? 6 : 3) && (sparkTimer <= 0 || (audio.beat && sparkTimer <= 0.8))) {
        sparkTimer = (audio.beat ? 0.9 : 1.6) * (pk > 0.5 ? 0.45 : 1);
        const sp = sparks.find(x => !x.alive);
        if (sp) {
          sparkN++;
          sp.alive = true;
          sp.look = (sparkN % 7) === 0;              // the shimmering repainter
          sp.high = !sp.look && (sparkN % 3) === 0;  // every third asks for air
          // spawn only where a surfer can actually get: steering reaches
          // x ±40, and a full-bass jump tops out around boardY 17
          sp.x = (Math.random() * 2 - 1) * 36;
          sp.y = sp.look ? 12 + Math.random() * 5 : sp.high ? 15 + Math.random() * 5 : 8 + Math.random() * 3;
          sp.z = -235;
          sp.pop = 0;
          sp.m.visible = true;
        }
      }
      for (const sp of sparks) {
        if (!sp.alive) continue;
        if (sp.pop > 0) {
          // caught: a quick bloom, then gone
          sp.pop -= dt * 4;
          sp.m.scale.setScalar(18 * (1.8 - sp.pop));
          sp.m.material.opacity = sp.pop;
          sp.pil.visible = false;
          sp.o1.visible = false; sp.o2.visible = false;
          if (sp.pop <= 0) { sp.alive = false; sp.m.visible = false; }
          continue;
        }
        sp.z += flow * dt;
        const bob = Math.sin(time * 5 + sp.x) * (0.6 + audio.volume * 1.4);
        sp.m.position.set(sp.x, sp.y + bob, sp.z);
        if (sp.look) {
          // RAINBOW — the rare repainter: a cycling core with two orbiting
          // motes in offset hues. Nothing else on the water looks like this.
          const h0 = (time * 0.9 + sp.x * 0.01) % 1;
          color.setHSL(h0, 1, 0.6);
          sp.m.scale.setScalar(18 * (1 + audio.beatIntensity * 0.6));
          const orbR = 6 + Math.sin(time * 3) * 1.5;
          sp.o1.visible = true; sp.o2.visible = true;
          sp.o1.position.set(sp.x + Math.cos(time * 4) * orbR, sp.y + bob + Math.sin(time * 4) * orbR, sp.z);
          sp.o2.position.set(sp.x + Math.cos(time * 4 + Math.PI) * orbR, sp.y + bob + Math.sin(time * 4 + Math.PI) * orbR, sp.z);
          sp.o1.material.color.setHSL((h0 + 0.33) % 1, 1, 0.6);
          sp.o2.material.color.setHSL((h0 + 0.66) % 1, 1, 0.6);
          sp.o1.material.opacity = 0.95; sp.o2.material.opacity = 0.95;
          sp.o1.scale.setScalar(7); sp.o2.scale.setScalar(7);
        } else if (sp.high) {
          // the jump bait: complementary to the world's palette, pillar below
          color.setHSL(((hue / 360) + 0.5) % 1, 1, 0.55 + audio.high * 0.2);
          sp.m.scale.setScalar(14 * (1 + audio.high * 0.5));
          sp.pil.visible = true;
          sp.pil.material.color.copy(color);
          sp.pil.material.opacity = 0.35 + audio.high * 0.3;
          sp.pil.scale.set(3.5, sp.y * 1.9, 1);
          sp.pil.position.set(sp.x, sp.y / 2, sp.z);
        } else {
          // the everyday catch: a warm shift of the world's own hue,
          // breathing with the bass
          richHSL(color, ((hue / 360) + 0.09) % 1, 1, 0.55 + audio.bass * 0.2);
          sp.m.scale.setScalar(12 * (1 + audio.bass * 0.5));
        }
        sp.m.material.color.copy(color);
        sp.m.material.opacity = 1;
        // a gentle magnet: ground sparks lean toward a surfer who's close —
        // carving NEAR one is rewarded, pixel-perfect isn't required.
        // Rainbows are exempt: repainting the world must be a CHOICE.
        if (!sp.high && !sp.look && sp.z > 0 && sp.z < 34) {
          const bx = steer * 40;
          if (Math.abs(sp.x - bx) < 20) sp.x += (bx - sp.x) * Math.min(1, dt * 2.2);
        }
        // the catch plane rides with the surfer
        if (sp.z > 30 && sp.z < 48) {
          const dx = Math.abs(sp.x - steer * 40);
          const boardY = 9 + jumpY;
          const dy = Math.abs(sp.y - boardY);
          // a rainbow only counts for someone actually PLAYING — hands on
          // in the last few seconds, and a tighter window. Drifters keep
          // their look.
          const active = this._lastActive && performance.now() - this._lastActive < 3000;
          if (sp.look && (!active || dx >= 9)) { /* passes by, unclaimed */ }
          else if (dx < 12 && dy < 8) {
            const midair = jumpY > 3;
            sparkChain++;
            sparkDry = 0;
            caught++;
            if (sparkChain > bestChain) bestChain = sparkChain;
            if (midair) midairs++;
            if (sp.look) rainbows++;
            this._report();
            sparkFuel = Math.min(1, sparkFuel + 0.22);   // every catch feeds the throttle
            if (sp.look && !attract) {
              document.dispatchEvent(new CustomEvent('fp-lookspark'));
              sfxSwoosh('bloom');                 // the rainbow ceremony
            } else if (midair || sp.high) {
              sfxSwoosh('air');                   // air catches whoosh
            } else {
              sfxSwoosh('soft');                  // ground catches breathe
            }
            if (opts.addScore) opts.addScore((sp.look ? 5 : sp.high ? 3 : 2) * (midair ? 2 : 1) + (sparkChain >= 5 ? 2 : 0));
            if (opts.impact) opts.impact(sp.look ? 0.7 : midair ? 0.5 : 0.3);
            if (window.__setFigure && sparkChain >= 3) window.__setFigure('SPARKS \u00d7' + sparkChain + (midair ? ' \u00b7 MID-AIR' : ''), 0, 0);
            sp.pop = 1;
            continue;
          }
        }
        if (sp.z > 60) { sp.alive = false; sp.m.visible = false; sp.pil.visible = false; sp.o1.visible = false; sp.o2.visible = false; }
      }
      window.__sparkInfo = { alive: sparks.filter(x => x.alive).length, n: sparkN, timer: +sparkTimer.toFixed(2), beat: audio.beat, sample: sparks.find(x => x.alive) ? { z: Math.round(sparks.find(x => x.alive).z), y: Math.round(sparks.find(x => x.alive).y), vis: sparks.find(x => x.alive).m.visible } : null };
      // the chain fades if the catching stops
      sparkDry += dt;
      if (sparkDry > 5 && sparkChain) { sparkChain = 0; if (window.__setFigure) window.__setFigure(null); }

      // jump physics — and the airtime meter that makes it a game
      const wasAir = jumpY > 0.01;
      if (jumpY > 0 || jumpVel > 0) {
        jumpVel -= 60 * dt;
        jumpY = Math.max(0, jumpY + jumpVel * dt);
        if (jumpY === 0) jumpVel = 0;
        airT += dt;
        if (audio.beat) airBeats++;
      }
      // the landing: real jumps pay, beats crossed mid-air pay more,
      // and back-to-back clean jumps build a combo
      if (wasAir && jumpY <= 0.01 && !attract) {
        if (airT > 0.45) {
          comboT = 0;
          airCombo = Math.min(9, airCombo + 1);
          const pay = Math.round(airT * 6) + airBeats * 3 + (airCombo >= 3 ? airCombo : 0);
          if (opts.addScore) opts.addScore(pay);
          if (opts.impact) opts.impact(Math.min(1, 0.35 + airT * 0.25));
          if (window.__setFigure) window.__setFigure('AIR ' + airT.toFixed(1) + 's' + (airBeats ? ' \u00b7 ' + airBeats + ' beats' : '') + (airCombo >= 3 ? ' \u00b7 \u00d7' + airCombo : ''), 0, 0);
        }
        airT = 0; airBeats = 0;
      }
      // the combo cools if you stay grounded too long
      if (!wasAir) {
        comboT += dt;
        if (comboT > 4 && airCombo) { airCombo = 0; if (window.__setFigure) window.__setFigure(null); }
      } else if (attract && audio.beat && audio.beatIntensity > 0.6) {
        jumpVel = 16 + audio.beatIntensity * 10; // auto-hop on hard beats
      }

      // write heights + colors
      // tap shockwave: a ridge of light racing from the camera to the horizon
      if (waveR >= 0) {
        waveR += dt * 90;
        if (waveR > ROWS + 8) waveR = -1;
      }

      const pos = mesh.geometry.attributes.position;
      const col = mesh.geometry.attributes.color;
      const rowScroll = rowTimer / ROW_INTERVAL;
      for (let r = 0; r < ROWS; r++) {
        const hRow = history[Math.min(ROWS - 1, r)];
        const hRowNext = history[Math.min(ROWS - 1, r + 1)];
        // row ROWS-1 is nearest the camera; the wave travels toward row 0
        let rowBump = 0;
        if (waveR >= 0) {
          const d = (ROWS - 1 - r) - waveR;
          rowBump = 8 * Math.exp(-(d * d) / 12) * (1 - waveR / (ROWS + 8));
        }
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const h = hRow[c] * (1 - rowScroll) + hRowNext[c] * rowScroll + rowBump;
          pos.setY(i, h);
          const t = Math.min(1, h / 14);
          // bright enough to cross the bloom threshold on peaks and beats;
          // the center "road" columns glow so the path reads
          const road = Math.exp(-Math.pow(c - COLS / 2, 2) / 16) * (0.1 + audio.volume * 0.12);
          // valleys run deep, peaks run bright — the contrast is the beauty
          const lum = 0.16 + t * 0.56 + audio.beatIntensity * 0.15 + road;
          // theme paints the terrain: u = height (sunset stacks correctly),
          // v = depth so themes flow toward the horizon
          const jitv = Math.abs(Math.sin(c * 12.9898 + r * 78.233));
          // height feeds the theme COMPRESSED: full height used to sweep the
          // whole hue wheel, so a noisy audio-driven surface wore a different
          // colour on every triangle — confetti, not landscape. A third of
          // the wheel per frame reads as one weather system, and the slow
          // depth drift still walks the family around over time.
          themePaint(colorMode, hue / 360, t * 0.34, r * 0.08 + time * 0.11, time, t, jitv, tp);
          // altitude grades the hue a touch — peaks lean warm, valleys lean
          // cool — and saturation runs rich instead of safe. The acid-yellow
          // band is off the menu: it slides to amber-coral like the sun does.
          let gradedHue = ((tp[0] + (t - 0.45) * 0.05) % 1 + 1) % 1;
          // the center road takes the sun's color — a lit path to the horizon
          const roadMix = Math.exp(-Math.pow(c - COLS / 2, 2) / 16);
          let dh = this._sunHue !== undefined ? this._sunHue - gradedHue : 0;
          if (dh > 0.5) dh -= 1; else if (dh < -0.5) dh += 1;
          gradedHue = ((gradedHue + dh * roadMix * 0.5) % 1 + 1) % 1;
          // warm hues bleach toward acid under the bloom — hold them dimmer,
          // easing the cap in and out so brightness never steps either
          // Yellow is welcome; HEAVY yellow was the problem. Old builds let
          // big fields of it run bright and saturated until the bloom
          // bleached them, which read as cheap. So yellow keeps its hue and
          // just carries less weight: the brightness cap dips smoothly
          // through the band, and a light pull toward a deeper gold keeps it
          // rich instead of fluorescent. Smooth weights, so no seams.
          const yw = Math.max(0, 1 - Math.abs(gradedHue - 0.145) / 0.075);
          const lumCap = 0.66 - 0.09 * yw;
          richHSL(color, gradedHue, Math.min(1, tp[1] * 1.1 + 0.05), Math.min(lumCap, lum * Math.min(1.45, tp[2])));
          if (yw > 0.01) {
            this._gold || (this._gold = new THREE.Color().setHSL(0.115, 0.95, 0.42));
            color.lerp(this._gold, yw * 0.3);
          }
          col.setXYZ(i, color.r, color.g, color.b);
        }
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;

      // the sky is atmosphere, not paint: original softer tint, with the
      // yellow band tamed so a complement landing on yellow reads as haze,
      // never a mustard wall
      richHSL(color, ((hue / 360) + 0.5) % 1, 0.6, 0.38 + audio.energy * 0.22);
      sky.material.color.copy(color);

      // sun pulses with bass, hue-complementary so it pops against the grid
      const sunScale = 1 + audio.bass * 0.25 * reactivity + audio.beatIntensity * 0.1;
      // a tighter, deeper sun: the glow stays local so the world's own
      // colors keep their saturation instead of bleaching at the horizon
      sun.scale.setScalar(62 * sunScale);
      sun.material.opacity = 0.85;
      sunHalo.scale.setScalar(150 * sunScale * (1 + audio.beatIntensity * 0.2));
      // the sun never goes yellow — when the complement lands there it
      // slides to sunset coral instead, which always reads expensive
      let sunHue = ((hue / 360) + 0.5) % 1;
      if (sunHue > 0.06 && sunHue < 0.22) sunHue = 0.02;
      this._sunHue = sunHue;
      color.setHSL(sunHue, 1, 0.52 + audio.bass * 0.1);
      sun.material.color.copy(color);
      // fog breathes in the sky's deep tone — distance melts into atmosphere
      if (scene.fog) scene.fog.color.setHSL(sunHue, 0.5, 0.035);
      sunHalo.material.color.copy(color);
      sunHalo.material.opacity = 0.38 + audio.beatIntensity * 0.3;

      // camera rides the wave
      const camH = 9 + audio.volume * 5 * reactivity + jumpY;
      camera.position.set(steer * 40, camH, 40);
      camera.lookAt(steer * 30, 3 + jumpY * 0.4, -60);
      camera.rotation.z += steer * -0.1 + Math.sin(time * 0.4) * 0.015;
      const fovT = 75 + audio.volume * 10 * reactivity + audio.beatIntensity * 5;
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
