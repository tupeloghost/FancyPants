// SLINKY — a giant glowing slinky walking forever down an endless staircase.
// Coils compress with the bass, beats push it over the next step, and taps
// BOING it — a compression wave snaps down the whole spring.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=500';
import { themePaint } from '../lib/themes.js?v=500';
import { PALETTE } from '../net.js?v=500';

const RINGS = 84;           // coils
const RING_R = 4.2;
const STEP_H = 5, STEP_D = 8;
const STAIRS = 26;
const STAIR_W = 60;      // one wide flight — the whole field races on it
const CROWD = 6;            // other players' slinkies on the staircase
const CROWD_COILS = 26;     // fewer coils each — they read at a distance

export function createSlinky() {
  let scene, camera, group, coils, stairs, edges, sky, dustF, spot;
  let crowd = null;           // every other player's slinky, in their colour
  let impacts = [];
  let echo = null;           // motion-blur ghost of the spring
  let beatWave = 99;         // index of the brightness wave from the last beat
  let walk = 0, walkVel = 0;
  const RACE_START = 2;   // start on the stairs, not in mid-air
  let boing = 0, landPulse = 0, lastStep = 0;
  let stepPhase = 0;        // 0 at the lip, 1 at the slap — drives the gait
  const camPos = new THREE.Vector3(30, 0, 0);
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const P = new THREE.Vector3(), P2 = new THREE.Vector3(), TAN = new THREE.Vector3();
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion();
  let pointer = { x: 0, active: false };
  let beatBars = [], barChartAt = 0;
  let paceBar = null;          // the line you must stay ahead of
  let lastTier = 1;            // multiplier tier, for the tier-up moment
  let behindT = 0;             // seconds spent behind the pace
  let sLastChartRef = null;
  const BAR_LOOK = 2.0;    // seconds a bar is visible before its beat

  // where each player's slinky walks, fanned out either side of yours
  // Lanes must fit the flight: the old spread reached +/-35 on a 26-wide
  // staircase, so the outer two players were walking on empty space beside it.
  const laneX = i => (i % 2 ? 1 : -1) * (8 + Math.floor(i / 2) * 8);   // +/-8, 16, 24

  // slinky end-over-end path: each unit of p is one stair
  function pathAt(p, out) {
    const n = Math.floor(p);
    const f = p - n;
    out.set(
      0,
      -n * STEP_H - f * STEP_H + Math.sin(f * Math.PI) * (STEP_H * 1.15),
      -n * STEP_D - f * STEP_D
    );
    return out;
  }

  return {
    name: 'SLINKY',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x04030a, 0.011);

      const coilGeo = new THREE.TorusGeometry(RING_R, 0.34, 12, 48);
      {
        // top-lit gloss baked into the coil so it reads as shiny plastic
        const pa = coilGeo.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const t = 0.62 + (pa.getY(i) / (RING_R + 0.34) + 1) * 0.24;
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        coilGeo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      }
      coils = new THREE.InstancedMesh(
        coilGeo,
        new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true }),
        RINGS
      );
      coils.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * 3), 3);
      coils.frustumCulled = false;
      group.add(coils);

      // echo: a delayed ghost copy of the spring — motion made visible
      // The crowd material asks for vertexColors, so the geometry must carry a
      // `color` attribute — without one the shader reads an unbound attribute,
      // which comes back black and swallows the per-player instance colour
      // whole. That is why nobody could see which colour anyone had chosen.
      // Baking the same top-lit gloss the main spring uses fixes the colour
      // and makes their slinkies read as the same shiny plastic.
      const crowdGeo = new THREE.TorusGeometry(RING_R * 0.72, 0.26, 8, 30);
      {
        const pa = crowdGeo.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const t = 0.62 + (pa.getY(i) / (RING_R * 0.72 + 0.26) + 1) * 0.24;
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        crowdGeo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      }
      crowd = new THREE.InstancedMesh(
        crowdGeo,
        new THREE.MeshBasicMaterial({
          toneMapped: false, vertexColors: true, transparent: true, opacity: 0.92,
        }),
        CROWD * CROWD_COILS
      );
      crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      crowd.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CROWD * CROWD_COILS * 3), 3);
      crowd.frustumCulled = false;
      group.add(crowd);

      echo = new THREE.InstancedMesh(
        coils.geometry,
        new THREE.MeshBasicMaterial({
          toneMapped: false, vertexColors: true, transparent: true, opacity: 0.16,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
        RINGS
      );
      echo.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * 3), 3);
      echo.frustumCulled = false;
      echo.visible = !window.__LITE;   // the motion ghost is a desktop luxury
      group.add(echo);

      // the endless staircase
      stairs = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        STAIRS
      );
      stairs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STAIRS * 3), 3);
      stairs.frustumCulled = false;
      group.add(stairs);

      // glowing strip on every stair nose — the staircase becomes a light
      // sculpture instead of dark boxes
      edges = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 0.18, 0.35),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        STAIRS
      );
      edges.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STAIRS * 3), 3);
      edges.frustumCulled = false;
      group.add(edges);

      // landing impact rings on the stair tops
      impacts = [];
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1, 40),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        m.userData = { life: 0 };
        group.add(m);
        impacts.push(m);
      }

      // soft spotlight pool traveling with the slinky
      spot = glowSprite(30);
      spot.material.opacity = 0.2;
      group.add(spot);

      // drifting sparkle in the stairwell
      const dp = new Float32Array(200 * 3);
      for (let i = 0; i < 200; i++) {
        dp[i * 3] = (Math.random() - 0.5) * 70;
        dp[i * 3 + 1] = (Math.random() - 0.5) * 90;
        dp[i * 3 + 2] = (Math.random() - 0.5) * 160;
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      dustF = new THREE.Points(dg, glowPoints(0.6, 0.5));
      dustF.frustumCulled = false;
      group.add(dustF);

      // ── beat bars: the cue lives ON the staircase ──
      // A bar of light slides up the steps and into the spring; you tap the
      // moment they meet. The staircase is the note highway, the spring is
      // the hit line, and there is nothing to watch except the world.
      // ── the pace line ── a shimmering bar descending the stairs at the pace
      // that finishes with the song. Ahead of it you are winning time; behind
      // it the stairs cool and a slow heartbeat starts. Slinky finally has
      // something to LOSE.
      paceBar = new THREE.Mesh(
        new THREE.BoxGeometry(STAIR_W * 0.9, 0.35, 1.1),
        new THREE.MeshBasicMaterial({
          toneMapped: false, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      paceBar.visible = false;
      group.add(paceBar);
      lastTier = 1; behindT = 0;

      beatBars = [];
      for (let i = 0; i < 8; i++) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(STAIR_W * 0.62, 0.5, 1.6),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        bar.visible = false;
        group.add(bar);
        beatBars.push({ mesh: bar, t: 0, live: false });
      }
      barChartAt = 0;

      sky = skyDome(280);
      group.add(sky);

      walk = 2; walkVel = 0; boing = 0; barChartAt = 0;
      camera.fov = 66;
      camera.updateProjectionMatrix();
    },

    setInput(x) { pointer.x = x; pointer.active = true; },

    // where the timing rings should close: on the spring itself
    cueAnchor(out) {
      pathAt(walk - RINGS * 0.02, out);
      out.y += RING_R + 1.5;
    },

    // fellow slinkies-in-spirit: motes hopping down neighboring stair lines
    placeGhost(p, i, out) {
      if (i < CROWD) {
        pathAt(walk - 0.6 - (i + 1) * 0.55, out);   // their own head on the stairs
        out.x += laneX(i);
        out.y += RING_R + 4;
        return;
      }
      const gp = walk - 3 - (i % 5) * 1.3;
      pathAt(gp, out);
      out.x += (i % 2 ? 1 : -1) * (12 + (i % 4) * 3) + p.x * 4;
      out.y += 2;
    },

    // tap: BOING — a compression wave snaps through the spring
    onTap() {
      boing = 1;
      walkVel += 0.8;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow', race = null } = opts;
      const racing = !!(race && race.active);

      if (participants && participants[0]) {
        participants[0].x = pointer.active ? pointer.x : Math.sin(time * 0.3) * 0.3;
        participants[0].y = 0;
      }

      // the walk: a slinky doesn't glide — it hangs at the lip, tips, falls
      // fast under gravity, then slaps flat. The gait below is that rhythm.
      //
      // Racing, the descent is no longer the music's — it is yours. The race
      // owns the speed and this only spends it, so the gait still reads as a
      // slinky rather than a slider: it hangs, tips and slaps at whatever pace
      // your playing has earned.
      if (racing) {
        // Position comes STRAIGHT from the race, not integrated from its speed.
        // Integrating gives a second, slightly different answer to "where am I",
        // and since the wire carries race.progress the staircase and the
        // standings would slowly disagree — you would be shown in a place the
        // scoreboard does not think you are.
        walk = RACE_START + race.progress;
        walkVel = race.speed;
      } else {
        const targetVel = 0.35 + audio.volume * 0.9 * reactivity;
        walkVel += (targetVel - walkVel) * Math.min(1, dt * 2);
        if (audio.beat) { walkVel += audio.beatIntensity * 0.9 * reactivity; beatWave = 0; }
      }
      // ── the bars slide home, and the spring answers your press ──
      if (racing && opts.chart !== sLastChartRef) { sLastChartRef = opts.chart; barChartAt = 0; }
      if (racing && opts.chart) {
        const chart = opts.chart, songTime = opts.songTime || 0;
        while (barChartAt < chart.length && chart[barChartAt].t - BAR_LOOK <= songTime) {
          const n = chart[barChartAt++];
          if (n.t < songTime) continue;                  // stale — never behind the playhead
          const b = beatBars.find(x => !x.live);
          if (b) { b.live = true; b.t = n.t; b.accent = n.accent; b.mesh.visible = true; }
        }
        for (const b of beatBars) {
          if (!b.live) continue;
          const dtb = b.t - songTime;                    // seconds until it must be hit
          if (dtb < -0.18) { b.live = false; b.mesh.visible = false; continue; }
          const u = Math.max(0, dtb / BAR_LOOK);         // 1 far, 0 at the spring
          pathAt(walk + u * 4.4, P);                     // 4.4 stairs out, closing in
          b.mesh.position.set(0, P.y + 0.75, P.z);
          const near = 1 - u;
          const imm = Math.pow(Math.max(0, 1 - Math.abs(dtb) / 0.2), 2);
          themePaint(colorMode, hue / 360, 0.5, walk * 0.1, time, audio.bass, 0.5, tp);
          color.setHSL(tp[0], 0.85, 0.42 + near * 0.34 + imm * 0.2);
          b.mesh.material.color.copy(color);
          b.mesh.material.opacity = 0.14 + near * 0.6 + imm * 0.26;
          b.mesh.scale.set(1, 1 + imm * 1.6, 1 + (b.accent ? 0.8 : 0));
        }
        // the spring is the hit line — it answers the verdict, loudly
        if (opts.judge && opts.judgeAge < 0.12) {
          if (opts.judge.rank === 'perfect') { boing = Math.max(boing, 0.9); landPulse = 1; beatWave = 0; }
          else if (opts.judge.rank === 'good') { landPulse = Math.max(landPulse, 0.7); beatWave = 0; }
        }
      } else {
        for (const b of beatBars) { b.live = false; b.mesh.visible = false; }
      }

      // ── pace pressure and tier-up moments ──
      if (racing && opts.songDur) {
        const paceWalk = RACE_START + (opts.songTime / opts.songDur) * race.finish * 0.92;
        pathAt(paceWalk, P2);
        paceBar.visible = true;
        paceBar.position.set(0, P2.y + 0.6, P2.z);
        const ahead = walk - paceWalk;                 // >0 you lead the song
        behindT = ahead < -1.5 ? behindT + dt : 0;
        color.setHSL(ahead >= 0 ? 0.42 : 0.02, 0.9, 0.55 + Math.sin(time * 5) * 0.1);
        paceBar.material.color.copy(color);
        paceBar.material.opacity = ahead >= 0 ? 0.35 : 0.6 + Math.sin(time * 7) * 0.2;
        // a tier crossing is a MOMENT: the spring boings, the wave fires
        const tier = race.multiplier;
        if (tier > lastTier) { boing = 1; landPulse = 1; beatWave = 0; if (opts.impact) opts.impact(0.7); }
        lastTier = tier;
      } else if (paceBar) paceBar.visible = false;

      if (audio.beat) beatWave = 0;
      beatWave += dt * 90; // the pulse races down the spring
      stepPhase = walk - Math.floor(walk);
      // slow over the edge, quick through the drop, slow into the landing
      const gait = 0.28 + 1.72 * Math.sin(Math.PI * stepPhase) ** 1.4;
      if (!racing) walk += walkVel * gait * dt;
      boing *= Math.pow(0.04, dt);
      landPulse *= Math.pow(0.03, dt);
      if (Math.floor(walk) !== lastStep) {
        lastStep = Math.floor(walk);
        landPulse = 1; // the slap of the spring hitting the next step
        const m = impacts.find(x => !x.visible) || impacts[0];
        m.visible = true;
        m.userData.life = 1;
        m.position.set(0, -lastStep * STEP_H + 0.12, -lastStep * STEP_D - STEP_D / 2);
        m.scale.setScalar(1.5);
      }
      for (const m of impacts) {
        if (!m.visible) continue;
        m.userData.life -= dt * 1.4;
        if (m.userData.life <= 0) { m.visible = false; continue; }
        m.scale.addScalar(dt * 30);
        themePaint(colorMode, hue / 360, 0.5, walk * 0.1, time, 1, 0.5, tp);
        color.setHSL(tp[0], tp[1], 0.55);
        m.material.color.copy(color);
        m.material.opacity = m.userData.life * 0.8;
      }

      // ── everyone else walks the same staircase, in their own colour ──
      {
        const others = participants ? Math.min(CROWD, participants.length - 1) : 0;
        let n = 0;
        for (let g = 0; g < CROWD; g++) {
          const pt = others > g ? participants[g + 1] : null;
          for (let i = 0; i < CROWD_COILS; i++) {
            if (!pt) {
              dummy.position.set(0, -9999, 0);
              dummy.scale.setScalar(0.001);
              dummy.quaternion.identity();
              dummy.updateMatrix();
              crowd.setMatrixAt(n, dummy.matrix);
              n++;
              continue;
            }
            // each slinky walks its own step, staggered so the stairs stay busy
            // Racing, a rival's position is their real progress off the wire
            // (it rides on z), so the field on screen is the actual race.
            // Otherwise they amble on a decorative stagger as before.
            // A rival with no progress on the wire yet (sim peers, a guest
            // still on the PLAY card) pinned to stair 0 — behind you, uphill,
            // invisible. That is why the field vanished. No-progress rivals
            // amble on the old stagger instead, and real gaps are clamped so
            // a runaway leader stays on screen rather than teleporting off.
            const off = (racing && (pt.z || 0) > 0.01)
              ? Math.max(-6, Math.min(24, walk - pt.z))
              : (0.42 + g * 0.37);
            const gp = walk - off - i * 0.052 * (1 + Math.sin(Math.PI * stepPhase) * 0.4);
            pathAt(gp, P);
            pathAt(gp + 0.02, P2);
            TAN.subVectors(P2, P).normalize();
            quat.setFromUnitVectors(Z_AXIS, TAN);
            dummy.position.copy(P);
            dummy.position.x += laneX(g) + (pt.x || 0) * 3;
            dummy.position.y += RING_R * 0.72 + 0.4;
            dummy.quaternion.copy(quat);
            dummy.scale.setScalar(1 + audio.bass * 0.1 * reactivity
              + (pt.action === 'tap' ? 0.22 : 0));
            dummy.updateMatrix();
            crowd.setMatrixAt(n, dummy.matrix);

            color.setHex(PALETTE[(pt.color || 0) % PALETTE.length]);
            const fade = 1 - i / CROWD_COILS * 0.32;           // tail dims away
            const waveG = Math.max(0, 1 - Math.abs(i - beatWave * 0.4) * 0.16);
            color.multiplyScalar((0.95 + audio.volume * 0.35 + waveG * 0.55
              + (pt.action === 'tap' ? 0.8 : 0)) * fade);
            crowd.setColorAt(n, color);
            n++;
          }
        }
        crowd.instanceMatrix.needsUpdate = true;
        crowd.instanceColor.needsUpdate = true;
      }

      // coils: phase-offset copies along the path, compression waves running
      // through the spacing (bass breathes it, boing snaps it)
      // A spring is a running sum: every coil sits a positive distance behind
      // the one in front of it. Placing coil i at `i * its own local spacing`
      // is not the same thing — when the spacing varies along the spring (and
      // squeeze, lag and stretch all vary with i) the positions stop being
      // monotonic, coils overtake each other, and the spring folds back
      // through itself. That was the tangle.
      let acc = 0;
      for (let i = 0; i < RINGS; i++) {
        const squeeze =
          Math.sin(walk * 2.2 - i * 0.31) * (0.012 + audio.bass * 0.02 * reactivity) +
          Math.sin(time * 9 - i * 0.8) * boing * 0.028;
        // the spring pays out as it falls and gathers back in on the slap,
        // with the tail lagging the head — that's what makes it walk
        const lag = Math.min(1, i * 0.035);
        const stretch = 1 + Math.sin(Math.PI * stepPhase) * 0.5 * (1 - lag * 0.5) - landPulse * 0.3 * (1 - lag);
        const p = walk - acc - 0.0001;
        // coils may crowd together hard, but never pass through one another
        acc += Math.max(0.011, 0.052 * stretch + squeeze * 0.5);
        pathAt(p, P);
        pathAt(p + 0.02, P2);
        TAN.subVectors(P2, P).normalize();
        quat.setFromUnitVectors(Z_AXIS, TAN);
        dummy.position.copy(P);
        dummy.position.y += RING_R + 0.4;
        dummy.quaternion.copy(quat);
        const s = 1 + audio.bass * 0.12 * reactivity + boing * 0.15 * Math.sin(i * 0.8 - time * 9)
                + landPulse * 0.07 * Math.max(0, 1 - i * 0.06); // head squashes on landing
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        coils.setMatrixAt(i, dummy.matrix);

        // rainbow slinky by default; every theme paints the coil run
        const jitv = Math.abs(Math.sin(i * 12.9898));
        themePaint(colorMode, hue / 360, i / RINGS, walk * 0.1, time, audio.bass, jitv, tp);
        // beat wave: a flash racing coil-to-coil down the spring
        const wave = Math.max(0, 1 - Math.abs(i - beatWave) * 0.12);
        color.setHSL(tp[0], tp[1], Math.min(0.7, (0.3 + audio.volume * 0.25 + boing * 0.15 + landPulse * 0.08 + wave * 0.3) * Math.min(1.5, tp[2])));
        coils.setColorAt(i, color);

        // echo ghost: same coil, a beat behind, faint — skipped entirely on
        // lite, where its per-coil path math was pure heat
        if (echo.visible) {
          pathAt(p - 0.16, P);
          pathAt(p - 0.14, P2);
          TAN.subVectors(P2, P).normalize();
          quat.setFromUnitVectors(Z_AXIS, TAN);
          dummy.position.copy(P);
          dummy.position.y += RING_R + 0.4;
          dummy.quaternion.copy(quat);
          dummy.scale.setScalar(s * 1.04);
          dummy.updateMatrix();
          echo.setMatrixAt(i, dummy.matrix);
          echo.setColorAt(i, color);
        }
      }
      if (echo.visible) {
        echo.instanceMatrix.needsUpdate = true;
        echo.instanceColor.needsUpdate = true;
      }
      coils.instanceMatrix.needsUpdate = true;
      coils.instanceColor.needsUpdate = true;

      // stairs march under it; the landing step flashes
      const base = Math.floor(walk);
      for (let k = 0; k < STAIRS; k++) {
        const n = base - 6 + k;
        dummy.position.set(0, -n * STEP_H - STEP_H / 2, -n * STEP_D - STEP_D / 2);
        dummy.scale.set(STAIR_W, STEP_H, STEP_D);
        dummy.rotation.set(0, 0, 0);
        dummy.quaternion.setFromEuler(new THREE.Euler(0, 0, 0));
        dummy.updateMatrix();
        stairs.setMatrixAt(k, dummy.matrix);
        const jitv = Math.abs(Math.sin(n * 7.31));
        themePaint(colorMode, hue / 360, 0.15 + jitv * 0.2, n * 0.15, time, audio.mid, jitv, tp);
        const landing = n === base ? landPulse * 0.35 + audio.beatIntensity * 0.2 : 0;
        color.setHSL(tp[0], tp[1] * 0.7, Math.min(0.4, 0.045 + landing + audio.mid * 0.03));
        stairs.setColorAt(k, color);

        // the glowing nose strip on each step
        dummy.position.set(0, -n * STEP_H + 0.1, -n * STEP_D + 0.15);
        dummy.scale.set(STAIR_W, 1, 1);
        dummy.updateMatrix();
        edges.setMatrixAt(k, dummy.matrix);
        themePaint(colorMode, hue / 360, ((n % 7) / 7), n * 0.2, time, audio.mid, jitv, tp);
        color.setHSL(tp[0], tp[1], Math.min(0.62, (0.25 + audio.mid * 0.3 + landing) * Math.min(1.4, tp[2])));
        edges.setColorAt(k, color);
      }
      stairs.instanceMatrix.needsUpdate = true;
      stairs.instanceColor.needsUpdate = true;
      edges.instanceMatrix.needsUpdate = true;
      edges.instanceColor.needsUpdate = true;

      // Camera: stays uphill of the spring, looking down the descent. It used
      // to orbit the full circle, which meant half of every revolution sat
      // behind the staircase looking at the backs of the risers with the whole
      // flight between the lens and the slinkies. Now it swings within a
      // limited arc on the open side — enough movement to feel alive, never
      // enough to put the stairs in the way.
      // Racing, the camera has to hold the race, not just you. It frames a
      // point biased towards your spring but pulled towards the leader, and
      // backs off as the field spreads — so you can always see yourself AND
      // who you are chasing. Solo, or idling, it just watches your spring.
      let focus = walk - RINGS * 0.033;
      let spread = 0;
      if (racing && participants && participants.length > 1) {
        let lead = walk;
        for (let i = 1; i < participants.length; i++) {
          const z = participants[i].z || 0;
          if (z > lead) lead = z;
        }
        spread = Math.max(0, lead - walk);
        focus += Math.min(spread * 0.30, 7);   // lean towards the leader, never lose yourself
      }
      pathAt(focus, P);
      // The flight rises 5 units for every 8 it goes back, so any camera placed
      // uphill of the spring sits *under* the stairs above it — that is the
      // whole upper half of the old orbit, and it is why the view kept ending
      // up behind the staircase. Staying downhill is clear at every angle, and
      // it is the better shot anyway: the field descends towards the lens.
      const swing = (pointer.active && !attract)
        ? Math.max(-1, Math.min(1, pointer.x))
        : Math.sin(time * 0.08) * 0.55;
      const ang = -Math.PI / 2 + swing * 1.25;   // sweeps side to side, never uphill
      // back off as the field strings out, so nobody drops off the frame
      const orbitR = 62 + Math.min(spread * 0.9, 20);
      camPos.set(
        Math.cos(ang) * orbitR,
        P.y + 13 + Math.sin(time * 0.3) + landPulse * -1.2, // dip on landing
        P.z - 4 + Math.sin(ang) * orbitR
      );
      camera.position.lerp(camPos, Math.min(1, dt * 2.5));
      camera.lookAt(0, P.y + 4, P.z - 8);

      spot.position.set(0, P.y - 2, P.z - 4);
      spot.material.opacity = 0.14 + audio.volume * 0.12 + landPulse * 0.1;

      color.setHSL(((hue / 360) + 0.1) % 1, 0.6, 0.3 + audio.high * 0.3);
      dustF.material.color.copy(color);
      themePaint(colorMode, hue / 360, 0.3, walk * 0.1, time, audio.volume, 0.4, tp);
      spot.material.color.setHSL(tp[0], tp[1] * 0.7, 0.45);
      dustF.position.y = P.y;
      dustF.position.z = P.z;
      sky.position.copy(camera.position);
      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.energy, 0.5, tp);
      sky.material.color.setHSL(tp[0], tp[1] * 0.5, 0.22 + audio.energy * 0.15);

      const fovT = 66 + audio.volume * 8 * reactivity + boing * 6;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
