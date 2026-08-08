// BLACKTOP — night street racing. Low camera, neon lane lines rushing past,
// streetlights strobing overhead, speed riding the volume. Tap = NITRO.
// Ghosts are rival cars ahead of you.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=196';
import { themePaint } from '../lib/themes.js?v=196';

const DASHES = 46;
const RAILSEGS = 120;
const POLES = 14;
const BUILDINGS = 90;
const SPAN = 480;
const ROAD_W = 24;
const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

export function createBlacktop() {
  let scene, camera, group, road, dashes, rails, poles, lampGlow, buildings, sky, lines;
  let travel = 0, nitro = 0;
  // A race step is an abstract unit the harness owns; this is how much road it
  // buys here. Tuned so a full-momentum run drives at the pace this world
  // already felt right at.
  const ROAD_PER_STEP = 70;
  let steer = 0, steerTarget = 0;
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const dz = new Float32Array(DASHES);
  const rlz = new Float32Array(RAILSEGS);
  const dlane = new Int8Array(DASHES);
  const pz = new Float32Array(POLES);
  const bz = new Float32Array(BUILDINGS), bx = new Float32Array(BUILDINGS);
  const bh = new Float32Array(BUILDINGS), bband = new Uint8Array(BUILDINGS);
  let speedLines = [];

  // ── GATES: blacktop stops being a press-in-time game ──
  // You drive. Green gates across the road are worth threading, dark barriers
  // are worth missing, and a gate IS your nitro — so the thing that felt good
  // in this world all along (flooring it) is now the reward loop itself.
  const G_AHEAD = 260;         // where gates appear down the road
  const G_SPACING = 2.2;       // close enough that chains are possible
  const G_REACH = 8;           // how far steer moves you; gates sit within it
  const G_HIT = 4.2;           // how close counts as through it
  const MAX_GATES = 20;
  let gates = [];
  let gChartAt = 0, gLastT = -99, gArrivals = 0, gHeat = 0;
  const SCORE_GAP = 26;        // road units per point of score difference
  let myScore = 0;             // kept from the race so placeGhost can read it
  let passSeen = new Map();    // id -> were they ahead last frame?
  let bLastChartRef = null;
  let gBoost = 0;
  let ufo = null, ufoT = -1, ufoNext = 12, ufoLights = null;
  let cow = null, beam = null, abduct = { z: 0, x: 0, on: false, target: -2, p2: 0 };
  // ── the wider alien programme ──
  let escort = null, escortT = -1, escortNext = 22 + Math.random() * 20;
  let cropRings = [], cropNext = 16 + Math.random() * 18;
  let tug = 0;                 // sideways pull while the beam has you
  // abduct.target: -2 = the cow, -1 = YOU, >=0 = that ghost gets taken
  let nitroClock = 0, survived = false;

  const roadX = z => Math.sin(z * 0.008) * 26;
  const roadYaw = z => Math.atan2(roadX(z - 8) - roadX(z + 8), 16);

  return {
    name: 'BLACKTOP',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x030306, 0.0085);

      // asphalt: a dark ribbon following the road curve
      const rg = new THREE.PlaneGeometry(ROAD_W + 6, SPAN, 10, 60);
      rg.rotateX(-Math.PI / 2);
      road = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x08080d, toneMapped: false }));
      road.frustumCulled = false;
      group.add(road);

      // lane dashes: three neon lanes
      dashes = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.35, 0.08, 4.2),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        DASHES
      );
      dashes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DASHES * 3), 3);
      dashes.frustumCulled = false;
      group.add(dashes);
      for (let i = 0; i < DASHES; i++) {
        dz[i] = -(i % (DASHES / 2)) * (SPAN / (DASHES / 2));
        dlane[i] = i < DASHES / 2 ? -1 : 1;
      }

      // guard rails: short segments that FOLLOW the curve (a straight beam
      // through a bending road reads as a broken line)
      rails = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.28, 0.5, 6.4),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        RAILSEGS
      );
      rails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RAILSEGS * 3), 3);
      rails.frustumCulled = false;
      group.add(rails);
      for (let i = 0; i < RAILSEGS; i++) rlz[i] = -(i % (RAILSEGS / 2)) * (SPAN / (RAILSEGS / 2));

      // streetlight poles arcing overhead + their lamps
      poles = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.4, 11, 0.4),
        new THREE.MeshBasicMaterial({ color: 0x0c0c14, toneMapped: false }),
        POLES
      );
      poles.frustumCulled = false;
      group.add(poles);
      const lp = new Float32Array(POLES * 3);
      const lc = new Float32Array(POLES * 3);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage));
      lg.setAttribute('color', new THREE.BufferAttribute(lc, 3).setUsage(THREE.DynamicDrawUsage));
      lampGlow = new THREE.Points(lg, glowPoints(9, 0.8));
      lampGlow.material.vertexColors = true;
      lampGlow.frustumCulled = false;
      group.add(lampGlow);
      for (let i = 0; i < POLES; i++) pz[i] = -i * (SPAN / POLES);

      // skyline: dark towers with band-lit faces, both sides
      buildings = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        BUILDINGS
      );
      buildings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BUILDINGS * 3), 3);
      buildings.frustumCulled = false;
      group.add(buildings);
      for (let i = 0; i < BUILDINGS; i++) {
        bz[i] = -Math.random() * SPAN;
        bx[i] = (i % 2 ? 1 : -1) * (26 + Math.random() * 45);
        bh[i] = 8 + Math.pow(Math.random(), 1.6) * 34;
        bband[i] = i % BANDS.length;
      }

      // nitro speed lines
      speedLines = [];
      for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.07, 11),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.visible = false;
        m.userData = { z: 0, x: 0, y: 0 };
        group.add(m);
        speedLines.push(m);
      }

      // the UFO: saucer + dome + running lights, visits now and then
      ufo = new THREE.Group();
      const saucer = new THREE.Mesh(
        new THREE.SphereGeometry(4, 24, 12),
        new THREE.MeshBasicMaterial({ color: 0x14141f, toneMapped: false })
      );
      saucer.scale.y = 0.26;
      const domeTop = new THREE.Mesh(
        new THREE.SphereGeometry(1.7, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.85 })
      );
      domeTop.position.y = 0.7;
      const halo = glowSprite(16);
      halo.material.opacity = 0.35;
      const lp2 = new Float32Array(10 * 3);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        lp2[i * 3] = Math.cos(a) * 3.6; lp2[i * 3 + 1] = -0.2; lp2[i * 3 + 2] = Math.sin(a) * 3.6;
      }
      const lg2 = new THREE.BufferGeometry();
      lg2.setAttribute('position', new THREE.BufferAttribute(lp2, 3));
      lg2.setAttribute('color', new THREE.BufferAttribute(new Float32Array(10 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      ufoLights = new THREE.Points(lg2, glowPoints(1.6, 0.95));
      ufoLights.material.vertexColors = true;
      ufo.add(saucer, domeTop, halo, ufoLights);
      ufo.visible = false;
      group.add(ufo);
      ufoT = -1; ufoNext = 10 + Math.random() * 15;

      // ── the escort: three scout saucers that fall in alongside you ──
      // The big UFO is an event you watch. The escort is an event you DRIVE
      // WITH — it flies your speed, banks when you bank, and leaves when it
      // feels like it, which makes the road feel inhabited rather than staged.
      escort = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const sc = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.SphereGeometry(1.5, 14, 8),
          new THREE.MeshBasicMaterial({ toneMapped: false })
        );
        body.scale.set(1, 0.34, 1);
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(0.72, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.75 })
        );
        dome.position.y = 0.28;
        const gl = glowSprite(6);

        // ── a beam, and somebody dancing in it ──
        // The big UFO's beam takes things away. These ones are just... out.
        // A saucer that pulls alongside with a lit dancefloor slung underneath
        // is the difference between set dressing and a joke you can see.
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.55, 2.3, 6.2, 16, 1, true),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0.16,
            side: THREE.DoubleSide, depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        );
        beam.position.y = -3.2;
        sc.add(beam);

        // a floor of light where the beam lands, so it reads as a stage
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(2.2, 20),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0.2,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = -6.3;
        sc.add(disc);

        // the dancer: big head, little body, long arms — the silhouette does
        // all the work at this distance
        const al = new THREE.Group();
        const alMat = new THREE.MeshBasicMaterial({ toneMapped: false });
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), alMat);
        head.scale.set(1, 1.15, 0.9);
        head.position.y = 0.62;
        const torso = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), alMat);
        torso.scale.set(1, 1.5, 0.8);
        torso.position.y = 0.18;
        const armL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.09), alMat);
        const armR = armL.clone();
        armL.position.set(-0.26, 0.3, 0); armR.position.set(0.26, 0.3, 0);
        const legL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.09), alMat);
        const legR = legL.clone();
        legL.position.set(-0.1, -0.24, 0); legR.position.set(0.1, -0.24, 0);
        const alGlow = glowSprite(2.6);
        alGlow.position.y = 0.3;
        al.add(head, torso, armL, armR, legL, legR, alGlow);
        al.position.y = -5.4;
        sc.add(al);

        sc.add(body, dome, gl);
        sc.userData = {
          body, dome, gl, beam, disc, phase: i * 2.1,
          al, alMat, alGlow, armL, armR, legL, legR,
          move: i % 3,          // each one dances differently
        };
        escort.add(sc);
      }
      escort.visible = false;
      group.add(escort);

      // ── crop circles: rings scorched into the asphalt, rushing past ──
      cropRings = [];
      for (let i = 0; i < 5; i++) {
        const r = new THREE.Mesh(
          new THREE.RingGeometry(3.2, 4.4, 40),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        r.rotation.x = -Math.PI / 2;
        r.visible = false;
        group.add(r);
        cropRings.push(r);
      }

      // the cow. every great highway needs one.
      cow = new THREE.Group();
      const cowMat = new THREE.MeshBasicMaterial({ color: 0xd8d8e0, toneMapped: false });
      const spotMat = new THREE.MeshBasicMaterial({ color: 0x1a1a22, toneMapped: false });
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 1.2), cowMat);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.7), cowMat);
      head.position.set(1.5, 0.5, 0);
      const spot1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.25), spotMat);
      spot1.position.set(-0.5, 0.3, 0);
      const spot2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 1.22), spotMat);
      spot2.position.set(0.6, -0.2, 0);
      cow.add(body, head, spot1, spot2);
      for (let l = 0; l < 4; l++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.28), spotMat);
        leg.position.set(l < 2 ? 0.9 : -0.9, -1.05, l % 2 ? 0.35 : -0.35);
        cow.add(leg);
      }
      cow.visible = false;
      group.add(cow);

      // the tractor beam
      beam = new THREE.Mesh(
        new THREE.ConeGeometry(4.2, 1, 24, 1, true),
        new THREE.MeshBasicMaterial({
          toneMapped: false, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      beam.visible = false;
      group.add(beam);

      sky = skyDome(340);
      group.add(sky);

      travel = 0; nitro = 0; steer = 0;
      camera.fov = 78;
      camera.updateProjectionMatrix();
    },

    setInput(x) { steerTarget = x; },

    _buildGates() {
      if (gates.length) return;
      gChartAt = 0; gLastT = -99; gArrivals = 0;
      for (let i = 0; i < MAX_GATES; i++) {
        const g = new THREE.Group();

        // a gate: two posts and a lintel, glowing green, chevrons on the deck
        const gate = new THREE.Group();
        const gMat = new THREE.MeshBasicMaterial({ toneMapped: false });
        for (const sx of [-3.4, 3.4]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 7, 0.45), gMat);
          post.position.set(sx, 3.5, 0);
          gate.add(post);
        }
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.45, 0.45), gMat);
        lintel.position.y = 7;
        gate.add(lintel);
        const glow = glowSprite(9);
        glow.position.y = 3.4;
        gate.add(glow);

        // A barrier is a WALL, not a frame. The tall end-posts and rail made
        // it read as another gate — the same silhouette as the thing it must
        // never be confused with. The distinction is solid versus hollow: a
        // gate is an opening you drive through, a barrier is a face you would
        // hit. So: one solid slab, waist-high but wide, the whole face striped
        // like a road-works board, lit red, blinking faster as it comes.
        const barrier = new THREE.Group();
        const block = new THREE.Mesh(
          new THREE.BoxGeometry(7.6, 3.4, 1.2),
          new THREE.MeshBasicMaterial({ color: 0x1a0c10, toneMapped: false })
        );
        block.position.y = 1.7;
        barrier.add(block);
        // full-face diagonal hazard stripes — nothing hollow about it
        const stripeMats = [];
        for (let k = 0; k < 5; k++) {
          const st = new THREE.Mesh(
            new THREE.BoxGeometry(1.15, 3.9, 0.1),
            new THREE.MeshBasicMaterial({ color: k % 2 ? 0xff3a1a : 0xffb81e, toneMapped: false })
          );
          st.position.set(-2.6 + k * 1.3, 1.7, 0.66);
          st.rotation.z = 0.44;
          stripeMats.push(st.material);
          barrier.add(st);
        }
        const topLight = new THREE.Mesh(
          new THREE.BoxGeometry(7.8, 0.3, 0.3),
          new THREE.MeshBasicMaterial({ color: 0xff3020, toneMapped: false })
        );
        topLight.position.y = 3.55;
        const bGlow = glowSprite(10);
        bGlow.material.color.setHex(0xff3524);
        bGlow.material.opacity = 0.35;
        bGlow.position.y = 2.0;
        barrier.add(topLight, bGlow);
        barrier.userData = { stripeMats, topLight, bGlow, lampMats: [] };

                g.add(gate, barrier);
        g.visible = false;
        group.add(g);
        gates.push({ mesh: g, gate, barrier, gMat, glow, alive: false, z: 0, x: 0, isBar: false });
      }
    },

    // rivals: glowing cars in the lanes ahead, taillights to you
    placeGhost(p, i, out) {
      // the beam takes whoever it takes — everyone watches them rise and spin
      if (abduct.on && abduct.target === i) {
        out.set(abduct.x + Math.sin(abduct.p2 * 25) * 0.7, 1.6 + abduct.p2 * 20, abduct.z);
        return;
      }
      // Rivals sit on the road by their SCORE, not at a fixed offset. That is
      // the whole difference between traffic and a race: thread gates and you
      // reel them in and go past; drop a run and they come back through you.
      // Position on the asphalt is the standings, exactly as the staircase is
      // in Slinky.
      const mine = myScore;
      const theirs = p.z || 0;
      const gapZ = Math.max(-170, Math.min(170, (theirs - mine) * SCORE_GAP));
      const z = camera.position.z - 26 - gapZ;
      // lanes either side of the centre line so a pass has somewhere to happen
      const lane = ((i % 3) - 1) * 6.5;
      out.set(roadX(z) + lane + p.x * 2, 1.6, z);
    },

    onTap() { nitro = 1; }, // NITRO (hold the mouse to keep it floored)

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow',
              race = null, chart = null, songTime = 0 } = opts;
      const racing = !!(race && race.active && race.mode === 'RACE');
      const gating = !!(race && race.active && race.mode === 'DODGE');
      if (gating) this._buildGates();

      // Racing, the road is driven by your playing rather than by the mix, and
      // momentum IS the nitro — a streak literally floors it. Everything below
      // still reads as driving because only the speed source changed.
      let speed;
      if (gating) {
        // a gate is the nitro: thread one and the car surges, clip a barrier
        // and the surge dies. The mix no longer drives the car — you do.
        // HEAT: the road runs a quarter faster and gates arrive 40% tighter by
        // the last chorus.
        gHeat = opts.songDur ? Math.min(1, (opts.songTime || 0) / opts.songDur) : 0;
        gBoost = Math.max(0, gBoost - dt * 0.4);
        nitro = gBoost;
        speed = (34 + gBoost * 80) * (1 + 0.25 * gHeat);
        travel += speed * dt;
      } else if (racing) {
        nitro = race.momentum;
        speed = race.speed * ROAD_PER_STEP;
        travel = race.progress * ROAD_PER_STEP;
      } else {
        // hold to keep the nitro pinned; release and it bleeds off
        if (opts.holding && !attract) nitro = 1;
        else nitro *= Math.pow(0.25, dt);
        speed = 26 + audio.volume * 70 * reactivity + nitro * 85;
        travel += speed * dt;
      }
      const camZ = -travel;

      if (attract) steerTarget = Math.sin(time * 0.3) * 0.5;
      // The beam does not just look at you — it PULLS. While it has you the
      // car drags toward the light and you have to steer against it, which
      // turns a cutscene into thirty seconds of actual driving.
      tug = abduct.on && abduct.target === -1
        ? Math.min(1, tug + dt * 2.2)
        : Math.max(0, tug - dt * 1.6);
      const pulled = steerTarget + tug * Math.sin(time * 0.9) * 0.85;
      steer += (pulled - steer) * Math.min(1, dt * 3);
      if (participants && participants[0]) {
        participants[0].x = steer;
        participants[0].y = 0;
      }

      // ── the gates ──
      if (gating) {
        myScore = race.progress;
        // An overtake is the moment worth naming. Nothing else in a race feels
        // like going past somebody, and without calling it the position swap
        // just happens quietly in the scenery.
        if (participants && opts.onPass) {
          for (let i = 1; i < participants.length; i++) {
            const p = participants[i];
            const wasAhead = passSeen.get(p.id);
            const isAhead = (p.z || 0) > myScore + 0.5;
            if (wasAhead === true && isAhead === false) opts.onPass(p, true);
            else if (wasAhead === false && isAhead === true) opts.onPass(p, false);
            passSeen.set(p.id, isAhead);
          }
        }
        const playerX = roadX(camZ) + steer * G_REACH;
        if (chart !== bLastChartRef) {
          bLastChartRef = chart; gChartAt = 0; gLastT = -99; gArrivals = 0;
        }
        if (chart) {
          while (gChartAt < chart.length && chart[gChartAt].t <= songTime + 0.05) {
            const n = chart[gChartAt++];
            // stale notes must not spawn — same batch-of-instant-misses bug
            // the river had, same fix
            if (n.t < songTime - 0.4) { gLastT = Math.max(gLastT, n.t); continue; }
            if (n.t - gLastT < G_SPACING * (1 - 0.4 * gHeat)) continue;
            gLastT = n.t; gArrivals++;

            // Every fourth arrival is a SLALOM: three gates in quick
            // succession swinging left-centre-right. A metronome of single
            // gates is a driving test; a slalom is the moment the round has
            // a shape — you either commit to the swing or you do not.
            const slalom = (gArrivals % 4) === 0;
            const count = slalom ? 3 : 1;
            for (let k = 0; k < count; k++) {
              const g = gates.find(x => !x.alive);
              if (!g) break;
              g.alive = true;
              g.z = camZ - G_AHEAD - k * 42;
              g.isBar = slalom ? false : (gArrivals % 2) !== 0;
              g.x = slalom
                ? [-1, 0, 1][k] * (G_REACH * 0.72) * ((gArrivals % 8) < 4 ? 1 : -1)
                : (((gChartAt * 48271) % 200) / 100 - 1) * (G_REACH * 0.8);
              g.mesh.visible = true;
              g.gate.visible = !g.isBar;
              g.barrier.visible = g.isBar;
            }
          }
        }
        for (const g of gates) {
          if (!g.alive) continue;
          const gx = roadX(g.z) + g.x;
          g.mesh.position.set(gx, 0, g.z);
          g.mesh.rotation.y = roadYaw(g.z);
          if (g.isBar) {
            // the warning breathes faster the closer it gets
            const near = Math.max(0, 1 - Math.abs(g.z - camZ) / G_AHEAD);
            const blink = 0.75 + Math.sin(time * (4 + near * 8)) * 0.25;
            const bd = g.barrier.userData;
            if (bd) {
              bd.topLight.material.color.setHSL(0.01, 1, 0.35 + blink * 0.35);
              bd.bGlow.material.opacity = 0.22 + near * 0.4 * blink;
              for (const lm of bd.lampMats) lm.color.setHSL(0.0, 1, 0.3 + blink * 0.45);
            }
          }
          if (!g.isBar) {
            // fixed signal green, not the theme hue — "drive through this"
            // has to survive every palette
            color.setHSL(0.36, 0.95, 0.5 + Math.sin(time * 5 + g.z) * 0.08 + audio.volume * 0.1);
            g.gMat.color.copy(color);
            g.glow.material.color.copy(color);
            g.glow.material.opacity = 0.35 + audio.volume * 0.2;
          }
          // ahead starts at -G_AHEAD and RISES toward zero as the car closes.
          // The first version of this test was inverted, which resolved every
          // gate on the frame it spawned — an empty road and a score of zero.
          const ahead = g.z - camZ;
          if (ahead < -4) continue;               // still up the road
          const through = Math.abs(gx - playerX) < G_HIT;
          if (through && !g.isBar) {
            // threading a gate while still surging pays double — keeping the
            // car fast IS the game, and a slalom held together is six points
            race.collect(gBoost > 0.35 ? 2 : 1);
            gBoost = Math.min(1, gBoost + 0.9);
            if (opts.impact) opts.impact(gBoost > 0.9 ? 0.8 : 0.55);
          } else if (through && g.isBar) {
            race.drop(2);
            gBoost = 0;
            if (opts.impact) opts.impact(1.0);
          } else if (!g.isBar) {
            race.drop(0);                         // a missed gate breaks the streak
          }
          g.alive = false;
          g.mesh.visible = false;
        }
      }

      // low racing camera hugging the asphalt
      const cx = roadX(camZ) + steer * 8;
      camera.position.set(cx, 2.6 + audio.bass * 0.4, camZ);
      camera.lookAt(roadX(camZ - 60), 2.2, camZ - 60);
      camera.rotation.z += steer * -0.09 + nitro * Math.sin(time * 40) * 0.006; // nitro judder

      // when the beam has YOU: lifted, spun, dropped back on the asphalt
      if (abduct.on && abduct.target === -1) {
        const lift = Math.sin(abduct.p2 * Math.PI) * 12;
        camera.position.y += lift;
        camera.rotation.z += Math.sin(time * 6) * 0.06 * (lift / 12);
        camera.rotation.y += Math.sin(abduct.p2 * 9) * 0.12 * (lift / 12);
      }

      // nitro discipline pays: +2 for every full second floored
      if (nitro > 0.7 && !attract) {
        nitroClock += dt;
        if (nitroClock >= 1) { nitroClock = 0; if (opts.addScore) opts.addScore(2); }
      } else nitroClock = 0;

      road.position.set(0, 0, camZ - SPAN / 2 + 40);
      // bend the road plane to the curve
      const rp = road.geometry.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        const wz = road.position.z + rp.getZ(i);
        rp.setX(i, roadX(wz) + ((i % 11) / 10 - 0.5) * (ROAD_W + 6));
      }
      rp.needsUpdate = true;

      // lane dashes scream past
      for (let i = 0; i < DASHES; i++) {
        if (dz[i] > camZ + 10) dz[i] -= SPAN;
        dummy.position.set(roadX(dz[i]) + dlane[i] * 4, 0.1, dz[i]);
        dummy.rotation.set(0, roadYaw(dz[i]), 0); // turn with the road
        dummy.scale.set(1, 1, 1 + speed * 0.012); // stretch with speed
        dummy.updateMatrix();
        dashes.setMatrixAt(i, dummy.matrix);
        themePaint(colorMode, hue / 360, 0.5 + dlane[i] * 0.2, dz[i] * 0.01, time, audio.volume, 0.5, tp);
        color.setHSL(tp[0], tp[1], Math.min(0.68, (0.4 + audio.volume * 0.25 + nitro * 0.2) * Math.min(1.4, tp[2])));
        dashes.setColorAt(i, color);
      }
      dashes.instanceMatrix.needsUpdate = true;
      dashes.instanceColor.needsUpdate = true;

      // rail segments hug the curve on both sides
      for (let i = 0; i < RAILSEGS; i++) {
        if (rlz[i] > camZ + 10) rlz[i] -= SPAN;
        const side = i % 2 ? 1 : -1;
        const z = rlz[i];
        dummy.position.set(roadX(z) + side * (ROAD_W / 2 + 1.4), 0.3, z);
        dummy.rotation.set(0, roadYaw(z), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        rails.setMatrixAt(i, dummy.matrix);
        themePaint(colorMode, hue / 360, side > 0 ? 0.8 : 0.2, z * 0.005, time, audio.mid, 0.4, tp);
        color.setHSL(tp[0], tp[1], Math.min(0.5, 0.2 + audio.mid * 0.2));
        rails.setColorAt(i, color);
      }
      rails.instanceMatrix.needsUpdate = true;
      rails.instanceColor.needsUpdate = true;

      // streetlights: poles + lamps that strobe on beats
      const lpn = lampGlow.geometry.attributes.position;
      const lcn = lampGlow.geometry.attributes.color;
      for (let i = 0; i < POLES; i++) {
        if (pz[i] > camZ + 12) pz[i] -= SPAN;
        const side = i % 2 ? 1 : -1;
        const x = roadX(pz[i]) + side * (ROAD_W / 2 + 2);
        dummy.position.set(x, 5.5, pz[i]);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);
        lpn.setXYZ(i, x - side * 2.4, 10.6, pz[i]);
        const flash = audio.beat ? 1.6 : 1;
        themePaint(colorMode, hue / 360, i / POLES, pz[i] * 0.008, time, audio.high, i / POLES, tp);
        color.setHSL(tp[0], tp[1] * 0.5, Math.min(0.7, (0.35 + audio.high * 0.3) * flash));
        lcn.setXYZ(i, color.r, color.g, color.b);
      }
      poles.instanceMatrix.needsUpdate = true;
      lpn.needsUpdate = true;
      lcn.needsUpdate = true;
      lampGlow.material.size = 8 + audio.beatIntensity * 5;

      // skyline crawls past slower (parallax) and lights with the bands
      for (let i = 0; i < BUILDINGS; i++) {
        if (bz[i] > camZ + 20) bz[i] -= SPAN;
        const level = audio[BANDS[bband[i]]];
        dummy.position.set(roadX(bz[i]) + bx[i], bh[i] / 2, bz[i]);
        dummy.scale.set(6 + (i % 4) * 2, bh[i], 7);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        buildings.setMatrixAt(i, dummy.matrix);
        const jitv = Math.abs(Math.sin(i * 12.99));
        themePaint(colorMode, (hue / 360 + bband[i] * 0.04) % 1, ((bx[i] / 140) + 0.5) % 1, bz[i] * 0.01, time, level, jitv, tp);
        color.setHSL(tp[0], tp[1] * 0.85, Math.min(0.6, (0.04 + level * 0.5) * Math.min(1.5, tp[2])));
        buildings.setColorAt(i, color);
      }
      buildings.instanceMatrix.needsUpdate = true;
      buildings.instanceColor.needsUpdate = true;

      // speed lines during nitro and hard beats
      if ((nitro > 0.25 || audio.beat) && Math.random() < dt * (6 + nitro * 20)) {
        const m = speedLines.find(x => !x.visible);
        if (m) {
          m.visible = true;
          m.userData.z = camZ - 90;
          m.userData.x = cx + (Math.random() - 0.5) * 26;
          m.userData.y = 1 + Math.random() * 7;
        }
      }
      for (const m of speedLines) {
        if (!m.visible) continue;
        m.userData.z += (speed + 160) * dt;
        if (m.userData.z > camZ + 6) { m.visible = false; continue; }
        m.position.set(m.userData.x, m.userData.y, m.userData.z);
        m.material.opacity = 0.8;
        color.setHSL(((hue / 360) + 0.5) % 1, 0.6, 0.7);
        color.multiplyScalar(1.4 + nitro);
        m.material.color.copy(color);
      }

      // ── the escort flies your speed and banks with you ──
      if (escortT < 0) {
        escortNext -= dt;
        if (escortNext <= 0) { escortT = 0; escort.visible = true; escort.userData.side = Math.random() < 0.5 ? -1 : 1; }
      } else {
        escortT += dt / 11;
        if (escortT >= 1) { escortT = -1; escort.visible = false; escortNext = 26 + Math.random() * 26; }
        else {
          const side = escort.userData.side;
          // slide in from off-road, hold formation, peel away
          const inOut = Math.sin(Math.min(1, escortT) * Math.PI);
          escort.children.forEach((sc, i) => {
            const d = sc.userData;
            const lead = -14 - i * 9;                        // a trailing V
            const z = camZ + lead;
            const off = side * (16 - inOut * 8 + i * 1.6);
            sc.position.set(roadX(z) + off + steer * 3, 5.5 + Math.sin(time * 2 + d.phase) * 0.7, z);
            sc.rotation.z = -steer * 0.5 + Math.sin(time * 1.6 + d.phase) * 0.1;
            sc.rotation.y = time * 0.6 + d.phase;
            color.setHSL(((hue / 360) + 0.42) % 1, 0.85, 0.5 + audio.volume * 0.2);
            d.body.material.color.copy(color);
            d.dome.material.color.setHSL(((hue / 360) + 0.5) % 1, 0.9, 0.75);
            d.gl.material.color.copy(color);
            d.gl.material.opacity = (0.25 + audio.volume * 0.3) * inOut;

            // ── the beam, and the dancing ──
            // They dance to the same track everyone is playing to, so the
            // saucers land on the beat with the room rather than idling
            // through their own animation.
            d.beam.material.color.copy(color);
            d.beam.material.opacity = (0.10 + audio.volume * 0.16) * inOut;
            d.disc.material.color.copy(color);
            d.disc.material.opacity = (0.14 + audio.bass * 0.3) * inOut;

            // classic little green man, regardless of palette — the joke does
            // not survive a purple alien
            d.alMat.color.setHSL(0.28, 0.85, 0.5 + audio.bass * 0.22);
            d.alGlow.material.color.setHSL(0.28, 0.9, 0.6);
            d.alGlow.material.opacity = (0.3 + audio.bass * 0.35) * inOut;

            const beat = time * 5.2 + d.phase;
            const bounce = Math.abs(Math.sin(beat)) * (0.35 + audio.bass * 0.5);
            d.al.position.y = -5.4 + bounce;
            d.al.rotation.y = beat * 0.5;
            d.al.rotation.z = Math.sin(beat * 0.5) * 0.16;   // a little sway

            // three routines so a formation is not one animation in triplicate
            if (d.move === 0) {                       // raise the roof
              d.armL.rotation.z = 1.1 + Math.sin(beat) * 0.7;
              d.armR.rotation.z = -1.1 - Math.sin(beat) * 0.7;
            } else if (d.move === 1) {                // the sprinkler
              d.armL.rotation.z = 0.3 + Math.sin(beat * 0.5) * 1.3;
              d.armR.rotation.z = 0.2;
            } else {                                  // disco point
              d.armL.rotation.z = -0.4 + Math.sin(beat) * 0.25;
              d.armR.rotation.z = -1.4 + Math.sin(beat + 1.6) * 0.9;
            }
            d.legL.rotation.x = Math.sin(beat) * 0.5;
            d.legR.rotation.x = -Math.sin(beat) * 0.5;
          });
        }
      }

      // ── crop circles burned into the road, rushing under you ──
      cropNext -= dt;
      if (cropNext <= 0) {
        cropNext = 14 + Math.random() * 20;
        const free = cropRings.filter(r => !r.visible).slice(0, 3);
        free.forEach((r, k) => {
          r.visible = true;
          r.userData = { z: camZ - 220 - k * 16, x: roadX(camZ - 220) + (k - 1) * 9, life: 1 };
          r.scale.setScalar(0.7 + k * 0.35);
        });
      }
      for (const r of cropRings) {
        if (!r.visible) continue;
        r.userData.z += speed * dt;
        if (r.userData.z > camZ + 10) { r.visible = false; continue; }
        r.position.set(r.userData.x, 0.12, r.userData.z);
        r.rotation.z += dt * 0.5;
        const near = 1 - Math.min(1, Math.abs(r.userData.z - camZ) / 220);
        color.setHSL(((hue / 360) + 0.45) % 1, 0.9, 0.55);
        r.material.color.copy(color);
        r.material.opacity = 0.10 + near * 0.4 + audio.volume * 0.15;
      }

      // UFO visits: swoops across the skyline, wobbles, slips away
      if (ufoT < 0) {
        ufoNext -= dt;
        if (ufoNext <= 0) {
          ufoT = 0; ufo.visible = true; ufo.userData.side = Math.random() < 0.5 ? -1 : 1;
          // who's getting taken this time? cow, a ghost, or YOU
          const ghosts = participants ? participants.length - 1 : 0;
          const r = Math.random();
          abduct.target = r < 0.4 ? -2 : ghosts > 0 ? Math.floor(Math.random() * ghosts) : -1;
          survived = false;
        }
      } else {
        ufoT += dt / 9; // ~9s visit
        if (ufoT >= 1) {
          ufoT = -1; ufo.visible = false; beam.visible = false; cow.visible = false; abduct.on = false;
          ufoNext = 14 + Math.random() * 22;
          if (survived && opts.addScore) opts.addScore(40); // rode the beam, lived to race
        }
        else {
          const side = ufo.userData.side;
          const swoop = Math.sin(ufoT * Math.PI); // in and out
          // mid-visit: STOP, beam, and take the cow
          const abducting = ufoT > 0.35 && ufoT < 0.78;
          if (abducting && !abduct.on) {
            abduct.on = true;
            abduct.z = camZ - 130;
            abduct.x = roadX(abduct.z) + side * 24;
          }
          if (!abducting) abduct.on = false;
          if (abducting) {
            const p2 = (ufoT - 0.35) / 0.43; // 0..1 through the abduction
            abduct.p2 = p2;
            if (abduct.target === -1) {
              // it's coming for YOU — the beam keeps pace with the car
              abduct.x = camera.position.x;
              abduct.z = camera.position.z - 6;
              survived = true;
            }
            ufo.position.set(
              abduct.x + Math.sin(time * 1.6) * 0.8,
              24 + Math.sin(time * 2.2) * 0.8,
              abduct.z
            );
            beam.visible = true;
            beam.position.set(abduct.x, 12.2, abduct.z);
            beam.scale.set(1, 23, 1);
            color.setHSL(0.28, 0.8, 0.6);
            beam.material.color.copy(color);
            beam.material.opacity = 0.14 + Math.sin(time * 9) * 0.04 + audio.beatIntensity * 0.08;
            cow.visible = abduct.target === -2; // ghosts and drivers rise via the beam instead
            if (cow.visible) {
              cow.position.set(abduct.x, 1.5 + p2 * 21, abduct.z);
              cow.rotation.y += dt * (1.5 + p2 * 6); // spins faster as it rises
              cow.rotation.z = Math.sin(time * 2.5) * 0.15;
              const shrink = p2 > 0.85 ? 1 - (p2 - 0.85) / 0.15 : 1;
              cow.scale.setScalar(Math.max(0.01, shrink));
            }
          } else {
            beam.visible = false;
            cow.visible = false;
            ufo.position.set(
              roadX(camZ - 120) + side * (70 - swoop * 55) + Math.sin(time * 1.3) * 4,
              26 + Math.sin(ufoT * Math.PI * 3) * 6 + Math.sin(time * 2.1) * 1.5,
              camZ - 150 + ufoT * 60
            );
          }
          ufo.rotation.z = Math.sin(time * 1.7) * 0.12;
          ufo.rotation.y += dt * 2.2; // spinning saucer
          // running lights chase around the rim, hue-tinted
          const lc2 = ufoLights.geometry.attributes.color;
          for (let i = 0; i < 10; i++) {
            const on = (Math.floor(time * 9) % 10) === i ? 2.2 : 0.35 + audio.high * 0.4;
            color.setHSL(((hue / 360) + i * 0.08) % 1, 0.9, 0.5);
            lc2.setXYZ(i, color.r * on, color.g * on, color.b * on);
          }
          lc2.needsUpdate = true;
          const dome2 = ufo.children[1];
          color.setHSL(((hue / 360) + 0.5) % 1, 0.7, 0.5 + audio.beatIntensity * 0.2);
          dome2.material.color.copy(color);
          ufo.children[2].material.color.copy(color);
        }
      }

      sky.position.copy(camera.position);
      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.energy, 0.5, tp);
      sky.material.color.setHSL(tp[0], tp[1] * 0.45, 0.2 + audio.energy * 0.12);

      const fovT = 78 + speed * 0.12 + nitro * 16;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      speedLines = [];
    },
  };
}
