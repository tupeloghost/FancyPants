// RIVER — a lazy river at night. You drift downstream between banks of
// glowing lanterns; the water carries the waveform as slow swells. No fail
// state, no hurry. Tap drops a ripple where you touch the water.

import * as THREE from 'three';
import { glowSprite, glowPoints, glowTexture, skyDome } from '../lib/glow.js?v=663';
import { themePaint } from '../lib/themes.js?v=663';
import { TUNE } from '../lib/tune.js?v=663';

const WCOLS = 40, WROWS = 70;       // water mesh
const WW = 26, WL = 340;
const LANTERNS = 56;
const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

export function createRiver() {
  let scene, camera, group, water, lanterns, lanternGlow, fireflies, sky, moon, foam, banks;
  const foamLat = new Float32Array(240);
  let drift = 0, rush = 0;   // taps shoot the current forward
  // how much river one abstract race step buys, tuned to the pace this world
  // already drifted at
  const RIVER_PER_STEP = 15;
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let pointer = { x: 0, active: false };
  let steer = 0;

  // ── DODGE: the river stops being a race and becomes a line to thread ──
  // You drift at a steady pace and the only thing you control is which side of
  // the channel you are on. Blossoms are worth gathering, rocks are worth
  // missing, and both arrive on the beat — so the music writes the pattern and
  // your hands answer it with position rather than timing.
  const DRIFT_RATE = 26;        // the river's own pace
  const BOOST_ADD = 30;         // what an arrow is worth, on top of it
  const AHEAD = 115;            // where things appear, in front of you
  // Spacing is in SECONDS of river, not notes. The note-count gate was lost in
  // a rewrite and never actually ran, so every note in the chart spawned — the
  // density complaint was real and the constant was decorative.
  const SPACING = 2.4;          // close enough that chains are possible
  const PAD_EVERY = 2;          // every Nth arrival is a boost; the rest are rocks
  const LANE = 9;               // how far either side of the channel things sit
  const HIT_W = 3.4;            // how close counts as touching it
  const MAX_DRIFTERS = 34;
  let drifters = [];
  let riverChartAt = 0;
  let lastSpawnT = -99, arrivals = 0, gArrivalPhase = 0;
  let rLastChartRef = null;
  const R_SCORE_GAP = 9;       // river units per point of score difference
  let riverMyScore = 0;        // kept from the race so placeGhost can read it
  let riverPassSeen = new Map();
  let gatherFlash = 0, rockFlash = 0;
  let boost = 0;
  // THE THROTTLE — the river no longer sets your pace; your finger does.
  // Hold (touch, mouse, or space) to open it, release to ease off. Speed is
  // the round's one continuous choice: flooring it doubles every ramp and
  // pays for shaving past rocks, but a rock at speed costs more and floods
  // the engine for a beat.
  let throttle = 0;
  let stun = 0;         // seconds of flooded engine after eating a rock                // 0..1, decays; an arrow tops it back up

  const lz = new Float32Array(LANTERNS);
  const lside = new Float32Array(LANTERNS);
  const lh = new Float32Array(LANTERNS);
  const lband = new Uint8Array(LANTERNS);

  // expanding tap ripples on the water
  let ripples = [];

  const riverX = z => Math.sin(z * 0.014) * 20 + Math.sin(z * 0.0045) * 26;
  let swellAt = () => 0; // bound in update (needs time + drift)

  return {
    name: 'RIVER',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x020409, 0.009);

      const geo = new THREE.PlaneGeometry(WW, WL, WCOLS - 1, WROWS - 1);
      geo.rotateX(-Math.PI / 2);
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      water = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      water.frustumCulled = false; // vertices are placed in world space
      group.add(water);

      // lantern posts along both banks
      lanterns = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.9, 10, 10),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        LANTERNS
      );
      lanterns.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LANTERNS * 3), 3);
      lanterns.frustumCulled = false;
      group.add(lanterns);

      const gp = new Float32Array(LANTERNS * 3);
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(gp, 3).setUsage(THREE.DynamicDrawUsage));
      gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(LANTERNS * 3), 3).setUsage(THREE.DynamicDrawUsage));
      lanternGlow = new THREE.Points(gg, glowPoints(7, 0.55));
      lanternGlow.material.vertexColors = true;
      lanternGlow.frustumCulled = false;
      group.add(lanternGlow);

      // lantern pairs spaced evenly over exactly one wrap period (WL),
      // so recycling is seamless — no visible teleports
      for (let i = 0; i < LANTERNS; i++) {
        lz[i] = -Math.floor(i / 2) * (WL / (LANTERNS / 2));
        lside[i] = (i % 2 ? 1 : -1) * (15 + Math.random() * 3);
        lh[i] = 2.5 + Math.random() * 4;
        lband[i] = i % BANDS.length;
      }

      // fireflies over the water
      const fp = new Float32Array(240 * 3);
      for (let i = 0; i < 240; i++) {
        fp[i * 3] = (Math.random() - 0.5) * 44;
        fp[i * 3 + 1] = 1 + Math.random() * 9;
        fp[i * 3 + 2] = -Math.random() * WL;
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
      fireflies = new THREE.Points(fg, glowPoints(0.7, 0.7));
      fireflies.frustumCulled = false;
      group.add(fireflies);

      // foam streaks riding the current past the camera — the flow made visible
      {
        const fo = new Float32Array(240 * 3);
        for (let i = 0; i < 240; i++) {
          fo[i * 3] = 0; fo[i * 3 + 1] = 0.35; fo[i * 3 + 2] = -Math.random() * WL;
        }
        const fog2 = new THREE.BufferGeometry();
        fog2.setAttribute('position', new THREE.BufferAttribute(fo, 3).setUsage(THREE.DynamicDrawUsage));
        foam = new THREE.Points(fog2, glowPoints(0.5, 0.8));
        foam.frustumCulled = false;
        group.add(foam);
        for (let i = 0; i < 240; i++) foamLat[i] = (Math.random() - 0.5) * (WW * 0.85);
      }

      // shore lines: soft glowing banks containing the river
      banks = new THREE.InstancedMesh(
        new THREE.BoxGeometry(3.2, 0.8, 9),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        64
      );
      banks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
      banks.frustumCulled = false;
      group.add(banks);

      moon = glowSprite(46);
      moon.material.fog = false;
      group.add(moon);

      // ripple pool
      ripples = [];
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1, 48),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        m.userData = { life: 0 };
        group.add(m);
        ripples.push(m);
      }

      sky = skyDome(320);
      group.add(sky);

      drift = 0;
      camera.fov = 70;
      camera.updateProjectionMatrix();
    },

    setInput(x) { pointer.x = x; pointer.active = true; },

    _buildDodge() {
      if (drifters.length) return;
      riverChartAt = 0;
      const petalGeo = new THREE.SphereGeometry(0.95, 14, 10);
      const rockGeo = new THREE.DodecahedronGeometry(1.5, 0);
      for (let i = 0; i < MAX_DRIFTERS; i++) {
        const g = new THREE.Group();

        // A BOOST PAD, lying FLAT on the water. Stacked upright chevrons read
        // as a jump — something to launch off — which is the wrong instruction
        // entirely. Painted flat on the surface, pointing the way you travel,
        // it reads as a pad you drive over.
        const bloom = new THREE.Group();
        const petalMat = new THREE.MeshBasicMaterial({ toneMapped: false });

        const pad = new THREE.Group();
        // the deck it is painted on
        const deck = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.12, 9.0), petalMat);
        deck.position.y = -0.06;
        pad.add(deck);
        // three chevrons pointing downstream, flat on the deck
        for (let k = 0; k < 3; k++) {
          for (const sgn of [-1, 1]) {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.85), petalMat);
            arm.position.set(sgn * 0.95, 0.08, -2.6 + k * 2.6);
            arm.rotation.y = sgn * 0.62;      // the two halves of a > seen from above
            pad.add(arm);
          }
        }
        // tilt the deck slightly toward the viewer: flat-on to a low camera a
        // pad is edge-on and reads as a smudge, and this keeps the chevrons
        // legible without standing them up into a jump
        pad.rotation.x = -0.22;
        bloom.add(pad);

        // A small chevron floating over the pad, bobbing. The light columns
        // read as odd architecture — smokestacks on a river — and at three at
        // once they WERE the picture. A marker is a waypoint: it says "here",
        // stays small, and lets the river stay the subject.
        const marker = new THREE.Group();
        for (const sgn of [-1, 1]) {
          const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.32, 0.32), petalMat);
          arm.position.x = sgn * 0.55;
          arm.rotation.z = -sgn * 0.7;          // a ^ pointing up
          marker.add(arm);
        }
        const markGlow = glowSprite(3.2);
        marker.add(markGlow);
        marker.position.y = 3.2;
        bloom.add(marker);

        const halo = glowSprite(9);
        halo.position.y = 0.6;
        bloom.add(halo);

        // a rock: matte, heavy, and unmistakably not a flower
        const rock = new THREE.Mesh(rockGeo, new THREE.MeshBasicMaterial({
          color: 0x191a1f, toneMapped: false,
        }));
        rock.scale.set(1.5, 0.9, 1.3);
        const foam = glowSprite(4.5);
        foam.material.color.setHex(0xbfd4e8);
        foam.material.opacity = 0.3;
        foam.position.y = -0.3;
        const rockGrp = new THREE.Group();
        rockGrp.add(rock, foam);

        g.add(bloom, rockGrp);
        g.visible = false;
        group.add(g);
        drifters.push({ mesh: g, bloom, rockGrp, petalMat, halo, marker,
                        alive: false, z: 0, x: 0, rock: false, spin: 0 });
      }
    },

    // fellow floaters drifting the same river
    placeGhost(p, i, out) {
      // Rivals ride the river by their SCORE, not at a fixed offset — the same
      // fix Blacktop got. Gather ramps and you reel them in and slip past;
      // fumble a stretch and they drift back through you. Their place on the
      // water IS the standings.
      const theirs = p.z || 0;
      const gapZ = Math.max(-95, Math.min(95, (theirs - riverMyScore) * R_SCORE_GAP));
      const z = camera.position.z - 18 - gapZ;
      out.set(riverX(z) + p.x * 7 + Math.sin(i * 2.6) * 3.5, 1.2, z);
    },

    onTap(x, y) {
      rush = 1; // the stream grabs you — a shot of current
      // drop a ripple where the tap ray meets the water plane (y = 0)
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const t = -camera.position.y / (dir.y || -0.0001);
      if (t > 0 && t < 300) {
        const m = ripples.find(r => !r.visible) || ripples[0];
        m.visible = true;
        m.userData.life = 1;
        m.position.copy(camera.position).addScaledVector(dir, t);
        m.position.y = 0.15;
        m.scale.setScalar(0.8);
      }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow',
              race = null, chart = null, songTime = 0 } = opts;
      const dodging = !!(race && race.active && race.mode === 'DODGE');
      const racing = !!(race && race.active && race.mode === 'RACE');
      if (dodging) this._buildDodge();

      // HEAT is computed once, up here — it is used by BOTH dodge blocks below,
      // and declaring it in the second while the first used it threw every frame.
      const heat = ((dodging && opts.songDur) ? Math.min(1, (opts.songTime || 0) / opts.songDur) : 0) * TUNE.heat;
      if (dodging) {
        // Objects are placed a fixed DISTANCE ahead rather than at a fixed
        // time, so speed is free to change: the music decides when one appears,
        // and how fast you are going decides how soon you meet it. That is what
        // makes a boost feel like a boost instead of a number going up.
        boost = Math.max(0, boost - dt * 0.42);
        stun = Math.max(0, stun - dt);
        // spool up fast, ease off slower — feels like a motor, not a switch
        const gasWanted = (opts.holding && stun <= 0) ? 1 : 0;
        throttle += (gasWanted - throttle) * Math.min(1, dt * (gasWanted ? 5 : 2.6));
        drift += dt * (DRIFT_RATE * (0.72 + throttle * 1.05 + 0.25 * Math.min(1, heat)) + boost * BOOST_ADD) * TUNE.speed;
        rush = Math.max(rush * Math.pow(0.3, dt), Math.max(boost, throttle * 0.85));
        gatherFlash *= Math.pow(0.02, dt);
        rockFlash *= Math.pow(0.05, dt);
      } else if (racing) {
        rush = race.momentum;
        drift = race.progress * RIVER_PER_STEP;
      } else {
        // lazy drift — the river never hurries, even on drops
        rush *= Math.pow(0.18, dt); // surge, then ease back to the stream's pace
        drift += dt * (8 + audio.energy * 11 + audio.volume * 5 + rush * 34);
      }
      const camZ = -drift;
      if (attract || !pointer.active) steer += (Math.sin(time * 0.2) * 0.4 - steer) * Math.min(1, dt);
      else steer += (pointer.x - steer) * Math.min(1, dt * 1.5);

      if (participants && participants[0]) {
        participants[0].x = steer;
        participants[0].y = 0;
      }

      // ── the line to thread ──
      if (dodging) {
        riverMyScore = race.progress;
        // arrivals tighten by 40% as the song builds
        const spacingNow = SPACING * (1 - 0.4 * Math.min(1, heat)) / TUNE.density;
        // call the overtake by name — a silent position swap is just scenery
        if (participants && opts.onPass) {
          for (let i = 1; i < participants.length; i++) {
            const p = participants[i];
            const wasAhead = riverPassSeen.get(p.id);
            const isAhead = (p.z || 0) > riverMyScore + 0.5;
            if (wasAhead === true && isAhead === false) opts.onPass(p, true);
            else if (wasAhead === false && isAhead === true) opts.onPass(p, false);
            riverPassSeen.set(p.id, isAhead);
          }
        }
        const playerX = riverX(-drift) + steer * 8;

        // place each arrival exactly where the current will carry it to the
        // player on its own beat — constant speed makes that simple arithmetic
        if (chart !== rLastChartRef) {
          rLastChartRef = chart; riverChartAt = 0; lastSpawnT = -99; gArrivalPhase = 0;
        }
        if (chart) {
          // Entering part-way through a track fast-forwards the read head over
          // every note already played, and each eligible one still spawned —
          // arriving as a batch stacked in the same spot. One per frame.
          while (riverChartAt < chart.length && chart[riverChartAt].t <= songTime + 0.05) {
            const n = chart[riverChartAt++];
            // A note already behind the playhead must NOT spawn. Entering a
            // track mid-way sweeps the read head over everything played so
            // far, and each stale note spawned an object — a stacked batch
            // that resolved as instant misses. You could hit every ramp on
            // screen and be told 5% accuracy for objects that never existed.
            if (n.t < songTime - 0.4) { lastSpawnT = Math.max(lastSpawnT, n.t); continue; }
            if (n.t - lastSpawnT < spacingNow) continue;
            const d = drifters.find(x => !x.alive);
            if (!d) continue;
            lastSpawnT = n.t;
            arrivals++;
            d.alive = true;
            d.z = -(drift + AHEAD);
            d.rock = (arrivals % PAD_EVERY) !== 0;   // alternate: rock, pad, rock, pad
            // pads sweep across the channel in a slow sine, so consecutive
            // pads draw a LINE you can carve along; rocks sit off-line as
            // punctuation. Pure hash placement read as noise — nothing to
            // plan, nothing to carve, nothing to feel clever about.
            d.x = d.rock
              ? Math.sin(gArrivalPhase * 1.9 + 2.2) * LANE * 0.8
              : Math.sin((gArrivalPhase += 0.7)) * LANE * 0.85;
            d.spin = ((riverChartAt * 53) % 100) / 100 * 6.28;
            d.mesh.visible = true;
            d.bloom.visible = !d.rock;
            d.rockGrp.visible = d.rock;
          }
        }

        for (const d of drifters) {
          if (!d.alive) continue;
          const wz = d.z;
          const ahead = -drift - wz;          // >0 while it is still upstream
          const wx = riverX(wz) + d.x;
          const ride = swellAt ? 0 : 0;
          // Ramps ride low so you pass OVER them; rocks sit proud so they are
          // plainly in the way. Height is the second signal after colour.
          d.mesh.position.set(wx, d.rock ? 1.7 : 0.25, wz);   // pads lie on the surface
          d.mesh.rotation.y = d.rock ? d.spin + time * 0.3 : 0;   // ramps face downstream
          if (!d.rock) {
            // Fixed yellow, NOT the theme colour: "go" has to mean the same
            // thing in every palette, or the one piece of information the
            // player needs changes with the looks tab.
            color.setHSL(0.135, 1, 0.55 + Math.sin(time * 6 + d.spin) * 0.08 + audio.volume * 0.12);
            d.petalMat.color.copy(color);
            d.halo.material.color.copy(color);
            d.halo.material.opacity = (0.4 + audio.volume * 0.25) * Math.max(0.25, Math.min(1, ahead / 30));
            if (d.marker) {
              // bob gently, sink onto the pad as it arrives
              const settle = Math.max(0, Math.min(1, ahead / 40));
              d.marker.position.y = 1.2 + settle * (2.0 + Math.sin(time * 2.4 + d.spin) * 0.5);
              d.marker.visible = ahead > 8;      // gone by the time you take it
            }
          }

          // Resolve just BEFORE it reaches the lens. Resolving at zero means
          // the last frame of every object is drawn from inside it, which
          // filled the whole screen with a cyan wall on every single ramp.
          // Resolve well clear of the lens. An arrow is several units tall
          // with a wide halo, so anything under about ten units still fills
          // the frame on its last drawn frame.
          if (ahead <= 6) {
            const gap = Math.abs(wx - playerX);
            const touching = gap < HIT_W;
            const flooring = throttle > 0.6;
            if (touching && d.rock) {
              // at speed a rock hits harder AND floods the engine — the risk
              // side of the throttle bargain
              race.drop(flooring ? 3 : 2); rockFlash = 1; boost = 0;
              stun = flooring ? 1.2 : 0.5; throttle *= 0.2;
              if (opts.impact) opts.impact(flooring ? 1.0 : 0.8);
            } else if (d.rock && flooring && gap < HIT_W * 2.1) {
              // the Burnout rule: shave past a rock with the throttle open and
              // the near-miss itself pays — danger becomes worth steering INTO
              race.collect(1);
              gatherFlash = Math.max(gatherFlash, 0.6);
              if (opts.impact) opts.impact(0.35);
            } else if (touching) {
              // the chain: take a pad while STILL surging from the last one
              // and it pays double — the round becomes about holding a run
              // together, not collecting isolated pickups
              race.collect((boost > 0.35 ? 2 : 1) * (flooring ? 2 : 1));
              gatherFlash = 1;
              boost = Math.min(1, boost + 0.85);
              if (opts.impact) opts.impact(boost > 0.9 ? 0.75 : 0.5);
            } else if (!d.rock) {
              race.drop(0);                    // a blossom missed breaks the run
            }
            d.alive = false;
            d.mesh.visible = false;
          }
        }
      }

      // FLOATING: sit just above the surface and ride the actual swell
      // choppy stream water: several short overlapping waves, all racing
      // downstream — turbulence, not gentle swells
      swellAt = (x, z) =>
        (Math.sin(z * 0.22 - drift * 0.5) * 0.42 +
         Math.sin(z * 0.47 - drift * 0.83 + x * 0.3) * 0.28 +
         Math.sin(x * 0.55 + drift * 0.6) * 0.22 +
         Math.sin(z * 0.13 - drift * 0.3) * 0.3) *
        (0.45 + audio.volume * 1.3 * reactivity + rush * 0.5);
      const camX = riverX(camZ) + steer * 8;
      const ride = swellAt(camX, camZ);
      camera.position.set(camX, 2.1 + ride * 1.1 - throttle * 0.55, camZ);
      if (dodging) {
        // the lens widens as the throttle opens — speed you can SEE
        camera.fov += ((66 + throttle * 16 + boost * 4) - camera.fov) * Math.min(1, dt * 4);
      }
      // your gaze wanders side to side, drifting with the current
      const wander = Math.sin(time * 0.13) * 14;
      camera.lookAt(riverX(camZ - 45) + wander, 2.1 + ride * 0.4, camZ - 45);
      camera.rotation.z += Math.sin(time * 0.21) * 0.035 + steer * -0.05 + ride * (0.045 + rush * 0.03);

      // water: gentle swells + the waveform breathing through the surface
      water.position.z = camZ - WL / 2 + 40;
      const pos = water.geometry.attributes.position;
      const col = water.geometry.attributes.color;
      for (let r = 0; r < WROWS; r++) {
        for (let c = 0; c < WCOLS; c++) {
          const i = r * WCOLS + c;
          const wz = water.position.z + (r / (WROWS - 1) - 0.5) * WL;
          const wx = riverX(wz) + (c / (WCOLS - 1) - 0.5) * WW;
          pos.setX(i, wx);
          const h = swellAt(wx, wz);
          pos.setY(i, h);
          const jitv = Math.abs(Math.sin(c * 12.99 + r * 78.23));
          themePaint(colorMode, hue / 360, 0.15 + Math.max(0, h) * 0.4, wz * 0.02 + time * 0.1, time, audio.volume, jitv, tp);
          // WHITECAPS: high crests froth toward white
          const crest = Math.max(0, h - 0.5) * 1.4;
          const satW = Math.max(0.1, tp[1] * 0.8 - crest * 0.9);
          const lumW = Math.min(0.62, 0.05 + Math.max(0, h) * 0.16 + crest * 0.5 + audio.volume * 0.04);
          color.setHSL(tp[0], satW, lumW);
          col.setXYZ(i, color.r, color.g, color.b);
        }
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;

      // lanterns line the banks, each pulsing with its band
      const gpos = lanternGlow.geometry.attributes.position;
      const gcol = lanternGlow.geometry.attributes.color;
      for (let i = 0; i < LANTERNS; i++) {
        let z = lz[i];
        while (z > camZ + 18) z -= WL;
        while (z < camZ + 18 - WL) z += WL;
        lz[i] = z;
        const x = riverX(z) + lside[i];
        const level = audio[BANDS[lband[i]]];
        dummy.position.set(x, lh[i], z);
        dummy.scale.setScalar(0.8 + level * 0.9 * reactivity);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        lanterns.setMatrixAt(i, dummy.matrix);
        themePaint(colorMode, hue / 360, (i / LANTERNS), z * 0.02, time, level, Math.abs(Math.sin(i * 7.7)), tp);
        color.setHSL(tp[0], tp[1], Math.min(0.72, (0.2 + level * 0.5) * Math.min(1.5, tp[2])));
        lanterns.setColorAt(i, color);
        gpos.setXYZ(i, x, lh[i], z);
        gcol.setXYZ(i, color.r, color.g, color.b);
      }

      lanterns.instanceMatrix.needsUpdate = true;
      lanterns.instanceColor.needsUpdate = true;
      gpos.needsUpdate = true;
      gcol.needsUpdate = true;
      lanternGlow.material.size = 6 + audio.bass * 5;

      // ripples spread and fade
      for (const m of ripples) {
        if (!m.visible) continue;
        m.userData.life -= dt * 0.8;
        if (m.userData.life <= 0) { m.visible = false; continue; }
        m.scale.addScalar(dt * 26);
        themePaint(colorMode, hue / 360, 0.5, 0, time, 1, 0.5, tp);
        color.setHSL(tp[0], tp[1], 0.55);
        m.material.color.copy(color);
        m.material.opacity = m.userData.life * 0.7;
      }

      // glowing banks contain the river on both sides
      for (let i = 0; i < 64; i++) {
        const side = i % 2 ? 1 : -1;
        let z = camZ + 10 - Math.floor(i / 2) * 10.5;
        dummy.position.set(riverX(z) + side * (WW * 0.5 + 2), 0.35 + Math.sin(z * 0.2) * 0.15, z);
        dummy.rotation.set(0, Math.atan2(riverX(z - 6) - riverX(z + 6), 12), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        banks.setMatrixAt(i, dummy.matrix);
        themePaint(colorMode, hue / 360, 0.06, z * 0.015, time, audio.bass, Math.abs(Math.sin(i * 5.1)), tp);
        color.setHSL(tp[0], tp[1] * 0.5, Math.min(0.22, 0.05 + audio.bass * 0.08));
        banks.setColorAt(i, color);
      }
      banks.instanceMatrix.needsUpdate = true;
      banks.instanceColor.needsUpdate = true;

      // foam rides the current — overtaking the camera so the flow reads
      {
        const fpos2 = foam.geometry.attributes.position;
        const flowSpeed = 9 + audio.energy * 8 + rush * 22;
        for (let i = 0; i < 240; i++) {
          let z = fpos2.getZ(i) + flowSpeed * dt; // rushing TOWARD you — you're moving
          if (z > camZ + 12) z = camZ - WL * 0.85;
          fpos2.setZ(i, z);
          fpos2.setX(i, riverX(z) + foamLat[i]);
          fpos2.setY(i, 0.3 + Math.max(0, swellAt(riverX(z) + foamLat[i], z)) * 0.9);
        }
        fpos2.needsUpdate = true;
        color.setHSL((hue / 360) % 1, 0.06, 0.8);
        foam.material.color.copy(color);
        foam.material.size = 0.45 + audio.volume * 0.45;
      }

      // fireflies wrap and shimmer with the highs
      const fpos = fireflies.geometry.attributes.position;
      for (let i = 0; i < fpos.count; i++) {
        const z = fpos.getZ(i);
        if (z > camZ + 15) fpos.setZ(i, z - WL);
        fpos.setX(i, riverX(fpos.getZ(i)) + Math.sin(i * 3.3 + time * 0.4) * 26);
      }
      fpos.needsUpdate = true;
      color.setHSL(((hue / 360) + 0.12) % 1, 0.7, 0.35 + audio.high * 0.35);
      fireflies.material.color.copy(color);
      fireflies.material.size = 0.7 + audio.high * 0.6;

      // moon hangs downstream; sky breathes
      moon.position.set(riverX(camZ - 260), 42, camZ - 280);
      color.setHSL((hue / 360) % 1, 0.25, 0.75);
      moon.material.color.copy(color);
      moon.material.opacity = 0.55 + audio.energy * 0.2;
      sky.position.copy(camera.position);
      color.setHSL((hue / 360) % 1, 0.55, 0.3 + audio.energy * 0.2);
      sky.material.color.copy(color);

      const fovT = 70 + audio.volume * 5 * reactivity + rush * 14;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      ripples = [];
    },
  };
}
