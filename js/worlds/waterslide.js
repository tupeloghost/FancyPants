// WATERSLIDE — a twisting open-top flume dropping forever downhill. Water
// rushes under you, the pipe banks through curves, beats splash. Tap for a
// splash burst + a shot of speed. Ghost riders slide the same flume.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=530';
import { themePaint } from '../lib/themes.js?v=530';
import { TUNE } from '../lib/tune.js?v=530';

const RINGS = 54;           // half-pipe rings alive at once
const SEGS = 14;            // arc segments per ring (lower half only)
const RING_SPACING = 5;
const DROP = 0.42;          // downhill slope per unit forward
const WATER_N = 240;

export function createWaterslide() {
  let scene, camera, group, wall, water, spray, sky;
  let travel = 0, boost = 0;
  // flume bought by one abstract race step
  const SLIDE_PER_STEP = 38;
  let steer = 0, steerTarget = 0;
  // ── HOOPS: the slide is steered now, not tapped ──
  // Tapping in a flume never worked — your eyes are on the tube, not a cue.
  // Rings of light hang in the pipe offset left or right; you lean through
  // them. Same chain logic as the river and the road: a hoop is a shot of
  // speed, a hoop taken while still surging pays double.
  const H_SPACING = 2.6;       // min seconds between hoops
  const MAX_HOOPS = 14;
  let hoops = [], hoopChartAt = 0, hoopLastT = -99, hoopBoost = 0;
  // THE THROTTLE — hold to drop steeper and faster. Hoops pay double flat
  // out and shaving a red one pays a close call; leaning into a red at
  // speed costs three and floods the run for a beat.
  let wThrottle = 0;
  let wStun = 0;
  let hoopCount = 0;           // arrivals, for the red cadence
  let bursts = [];             // golden rings left behind by a catch
  let wLastChartRef = null;
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const ringZ = new Float32Array(RINGS);
  const ringSeed = new Float32Array(RINGS);
  const waterLane = new Float32Array(WATER_N);
  const waterOff = new Float32Array(WATER_N);
  let sprayLife = 0;

  const R = 7;
  // ── the flume's wardrobe: a bender ring re-bends the whole pipe. Every
  // shape is pure sines so the morph between any two is butter. ──
  // each shape carries its own STEEPNESS too — a new pipe should feel like
  // a different ride, not a different wallpaper
  const SHAPES = [
    { slope: 1,    x: t => Math.sin(t * 0.03) * 14 + Math.sin(t * 0.011) * 20, y: t => Math.sin(t * 0.02) * 4 },   // the winding river
    { slope: 1.5,  x: t => Math.sin(t * 0.07) * 11,                            y: t => Math.sin(t * 0.05) * 7 },   // corkscrew: tight, fast, steep
    { slope: 0.55, x: t => Math.sin(t * 0.008) * 34,                           y: t => Math.sin(t * 0.03) * 10 },  // one giant lazy S, a near-flat glide
    { slope: 1.15, x: t => Math.sin(t * 0.04) * 28 + Math.sin(t * 0.013) * 10, y: t => Math.sin(t * 0.012) * 12 },// switchback canyon, wide and deep
  ];
  // and the SURFACE has a wardrobe of its own: what the pipe is tiled with,
  // and how far around you the wall wraps. The bender changes both.
  const SURFS = [
    { geo: 'box',  start: Math.PI,        span: Math.PI },        // classic half-pipe of tiles
    { geo: 'gem',  start: Math.PI * 1.1,  span: Math.PI * 0.8 },  // a trough of cut gems, steep walls
    { geo: 'slat', start: Math.PI * 1.22, span: Math.PI * 0.56 }, // a flat ribbon of planks, open air
    { geo: 'box',  start: Math.PI * 0.72, span: Math.PI * 1.56 }, // the storm drain: walls wrap overhead
  ];
  let surfA = 0, surfB = 0;
  let surfGeos = null;
  let shapeA = 0, shapeB = 0, shapeMix = 1;
  const curveX = t => { const a = SHAPES[shapeA].x(t), b = SHAPES[shapeB].x(t); return a + (b - a) * shapeMix; };
  const dropY = t => {
    const A = SHAPES[shapeA], B = SHAPES[shapeB];
    const slope = A.slope + (B.slope - A.slope) * shapeMix;
    return -t * DROP * slope + A.y(t) + (B.y(t) - A.y(t)) * shapeMix;
  };
  const bendWorld = () => {
    shapeA = shapeMix < 1 ? shapeB : shapeA;   // never snap mid-morph
    let next = (Math.random() * SHAPES.length) | 0;
    if (next === shapeA) next = (next + 1) % SHAPES.length;
    shapeB = next; shapeMix = 0;
    surfA = surfB;
    let ns = (Math.random() * SURFS.length) | 0;
    if (ns === surfA) ns = (ns + 1) % SURFS.length;
    surfB = ns;
  };
  let gulp = 0;   // the swallow's camera kick
  window.__slideBend = bendWorld;   // dev handle: audition surface+path changes

  return {
    name: 'SLIDE',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x02060a, 0.011);

      const shade = (geo, h) => {
        const pa = geo.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const t = 0.6 + (pa.getY(i) / h + 0.5) * 0.5;
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
        return geo;
      };
      surfGeos = {
        box: shade(new THREE.BoxGeometry(1, 0.4, RING_SPACING * 0.9), 0.4),
        gem: shade(new THREE.OctahedronGeometry(0.72), 1.44),
        slat: shade(new THREE.BoxGeometry(1, 0.1, RING_SPACING * 1.2), 0.1),
      };
      surfA = 0; surfB = 0;
      wall = new THREE.InstancedMesh(
        surfGeos.box,
        new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true }),
        RINGS * SEGS
      );
      wall.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      wall.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * SEGS * 3), 3);
      wall.instanceColor.setUsage(THREE.DynamicDrawUsage);
      wall.frustumCulled = false;
      group.add(wall);

      for (let r = 0; r < RINGS; r++) {
        ringZ[r] = -r * RING_SPACING;
        ringSeed[r] = Math.random();
      }

      // rushing water: streaks tearing down the flume floor
      const wp = new Float32Array(WATER_N * 3);
      const wc = new Float32Array(WATER_N * 3);
      for (let i = 0; i < WATER_N; i++) {
        waterLane[i] = (Math.random() - 0.5) * (R * 0.9);
        waterOff[i] = Math.random() * RINGS * RING_SPACING;
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(wp, 3).setUsage(THREE.DynamicDrawUsage));
      wg.setAttribute('color', new THREE.BufferAttribute(wc, 3).setUsage(THREE.DynamicDrawUsage));
      water = new THREE.Points(wg, glowPoints(0.9, 0.85));
      water.material.vertexColors = true;
      water.frustumCulled = false;
      group.add(water);

      // splash spray burst
      const sp = new Float32Array(80 * 3);
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
      spray = new THREE.Points(sg, glowPoints(1.0, 0));
      spray.frustumCulled = false;
      group.add(spray);
      sprayLife = 0;

      sky = skyDome(300);
      group.add(sky);

      travel = 0; boost = 0;
      camera.fov = 76;
      camera.updateProjectionMatrix();
    },

    setInput(x) { steerTarget = x; },

    _loopGeos() {
      if (this.__geos) return this.__geos;
      // shape is grammar: circle = pace, star = new look, diamond = new pipe.
      // Built from closed tubes so every loop reads as a ring, not a cutout.
      const tube = (pts, tension) => new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'catmullrom', tension),
        72, 0.22, 8, true);
      const star = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? 1.9 : 3.0;
        star.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      this.__geos = {
        circle: new THREE.TorusGeometry(2.6, 0.22, 10, 30),
        star: tube(star, 0.02),
        diamond: tube([[0, 2.9], [2.9, 0], [0, -2.9], [-2.9, 0]], 0.02),
        square: tube([[2.3, 2.3], [2.3, -2.3], [-2.3, -2.3], [-2.3, 2.3]], 0.02),
        slat: tube([[3.4, 1.2], [3.4, -1.2], [-3.4, -1.2], [-3.4, 1.2]], 0.02),
        // the bender is a TRIANGLE: no dealt look wears one, so it can never
        // be mistaken for a look door's shape preview
        tri: tube([[0, 3.1], [2.8, -2], [-2.8, -2]], 0.02),
      };
      return this.__geos;
    },

    _buildHoops() {
      if (hoops.length) return;
      for (let i = 0; i < MAX_HOOPS; i++) {
        const grp = new THREE.Group();
        const ring = new THREE.Mesh(
          this._loopGeos().circle,
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        const gl = glowSprite(7);
        // the accretion disk: a tilted hot ring spinning around the void —
        // only a black hole wears one
        const disk = new THREE.Mesh(
          new THREE.TorusGeometry(1.5, 0.09, 8, 40),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        disk.visible = false;
        // the void core: a black disc that eats the tube behind it — only
        // shown on hazard rings, where the torus becomes the accretion rim
        const core = new THREE.Mesh(
          new THREE.CircleGeometry(2.3, 28),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.94, side: THREE.DoubleSide })
        );
        core.visible = false;
        grp.add(ring, gl, core, disk);
        grp.visible = false;
        group.add(grp);
        hoops.push({ mesh: grp, ring, gl, core, disk, alive: false, t: 0, side: 0, red: false });
      }
      // catch-bursts: a golden ring blooms where you threaded a hoop
      bursts = [];
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(
          new THREE.TorusGeometry(2.6, 0.3, 8, 26),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        b.visible = false;
        b.userData = { life: 0 };
        group.add(b);
        bursts.push(b);
      }
    },

    // rings close on the flume ahead — where a rider is already looking
    cueAnchor(out) {
      const t = travel + 30;
      out.set(curveX(t), dropY(t) + 2.2, -t);
    },

    // ghost riders ahead in the same flume
    placeGhost(p, i, out) {
      const t = travel + 14 + (i % 6) * 9;
      out.set(curveX(t) + p.x * 3.5, dropY(t) + 1.4, -t);
    },

    // tap: splash burst + a shot of speed
    onTap() {
      boost = 1;
      sprayLife = 1;
      const pos = spray.geometry.attributes.position;
      const t = travel + 6;
      for (let i = 0; i < 80; i++) {
        pos.setXYZ(i,
          curveX(t) + (Math.random() - 0.5) * 5,
          dropY(t) + 1 + Math.random() * 2,
          -t + (Math.random() - 0.5) * 4
        );
      }
      pos.needsUpdate = true;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' , race = null } = opts;
      const racing = !!(race && race.active && race.mode === 'RACE');

      boost *= Math.pow(0.2, dt);
      // Racing, the flume runs at the pace you have earned and momentum is the
      // boost — the shot of speed a tap used to give is now a streak.
      let speed;
      const sliding = !!(race && race.active && race.mode === 'DODGE');
      if (sliding) {
        this._buildHoops();
        if (opts.chart !== wLastChartRef) { wLastChartRef = opts.chart; hoopChartAt = 0; hoopLastT = -99; }
        const wHeat = (opts.songDur ? Math.min(1, (opts.songTime || 0) / opts.songDur) : 0) * TUNE.heat;
        hoopBoost = Math.max(0, hoopBoost - dt * 0.42);
        wStun = Math.max(0, wStun - dt);
        const gasWanted = (opts.holding && wStun <= 0) ? 1 : 0;
        wThrottle += (gasWanted - wThrottle) * Math.min(1, dt * (gasWanted ? 5 : 2.6));
        boost = Math.max(hoopBoost, wThrottle * 0.85);
        speed = (14 + wThrottle * 24 + hoopBoost * 46) * (1 + 0.25 * Math.min(1, wHeat)) * TUNE.speed;
        travel += speed * dt;

        const songTime = opts.songTime || 0, chart = opts.chart;
        if (chart) {
          while (hoopChartAt < chart.length && chart[hoopChartAt].t <= songTime + 0.05) {
            const n = chart[hoopChartAt++];
            if (n.t < songTime - 0.4) { hoopLastT = Math.max(hoopLastT, n.t); continue; }
            if (n.t - hoopLastT < H_SPACING * (1 - 0.4 * Math.min(1, wHeat)) / TUNE.density) continue;
            const h = hoops.find(x => !x.alive);
            if (!h) continue;
            hoopLastT = n.t;
            hoopCount++;
            h.alive = true;
            h.t = travel + 130;                        // fixed distance down the pipe
            h.side = (((hoopChartAt * 48271) % 200) / 100 - 1) * 0.75;  // -0.75..0.75
            // every fourth hoop is RED: lean AWAY. Same signal grammar as the
            // whole game — green means through, red means never — and it gives
            // the flume the tension the green-only version had none of.
            h.red = (hoopCount % 4) === 0;
            // the wonder hole: rare, never where a black hole is, and a size
            // bigger — a swirling rainbow door. Enter it and the whole world
            // changes clothes.
            h.wonder = !h.red && (hoopCount % 16) === 13;
            // the bender: same rarity as the wonder door, offset half a lap —
            // enter it and the PIPE ITSELF re-bends into a new shape
            h.bend = !h.red && !h.wonder && (hoopCount % 16) === 5;
            const geos = this._loopGeos();
            // the look door's silhouette previews the tile shape it deals
            const dealtShape = window.__nextLook && window.__nextLook.cfg && geos[window.__nextLook.cfg.shape];
            h.ring.geometry = h.wonder ? (dealtShape || geos.star) : h.bend ? geos.tri : geos.circle;
            h.mesh.scale.setScalar(h.wonder || h.bend ? 1.18 : 1);
            h.mesh.visible = true;
          }
        }
        {
          const w = hoops.find(x => x.alive && x.wonder);
          window.__slideInfo = { hoops: hoops.filter(x => x.alive).length,
            wonderUp: !!w, wonderSide: w ? w.side : null,
            wonderAhead: w ? Math.round(w.t - travel) : null, count: hoopCount };
        }
        for (const h of hoops) {
          if (!h.alive) continue;
          const t = h.t;
          const hx = curveX(t) + h.side * (R * 0.55);
          h.mesh.position.set(hx, dropY(t) + 2.6, -t);
          h.mesh.rotation.y = Math.atan2(curveX(t - 6) - curveX(t + 6), 12);
          // green means through; a BLACK HOLE means around — dark core,
          // white-violet rim, slowly turning. unmistakable at speed
          if (h.bend) {
            // soap-film lens, electric white-cyan, tumbling slow — reads as
            // a doorway to somewhere with different walls
            color.setHSL(0.5 + Math.sin(time * 1.7 + t) * 0.06, 0.85, 0.68 + audio.volume * 0.15);
            h.core.visible = true;
            h.core.material.opacity = 0.3;
            h.core.material.color.setHSL(0.52, 0.7, 0.8);
            h.core.scale.setScalar(0.9 + Math.sin(time * 1.4 + t) * 0.08);
            h.disk.visible = false;
            h.mesh.rotation.z = Math.sin(time * 0.8) * 0.7;
            h.gl.material.opacity = 0.45 + audio.volume * 0.3;
          } else if (h.wonder) {
            // the star door wears the NEXT look's own color — the rim is the
            // preview. A rainbow destination gets the full-spectrum rim.
            const nl = window.__nextLook;
            const spectral = nl && (nl.colorMode === 'rainbow' || nl.colorMode === 'cycle' || nl.colorMode === 'random');
            if (nl && !spectral) {
              const nh = nl.hue / 360;
              color.setHSL(nh, 0.92, 0.55 + Math.sin(time * 2.6 + t) * 0.08 + audio.volume * 0.12);
              h.core.material.color.setHSL(nh, 0.65, 0.82);
            } else {
              color.setHSL((time * 0.22 + t * 0.03) % 1, 0.95, 0.6 + audio.volume * 0.12);
              h.core.material.color.setHSL((time * 0.22 + 0.5) % 1, 0.6, 0.82);
            }
            h.core.visible = true;
            h.core.material.opacity = 0.94;
            h.disk.visible = false;
            h.core.scale.setScalar(0.55 + Math.sin(time * 2.2 + t) * 0.12);
            h.mesh.rotation.z = -time * 0.55;
            h.gl.material.opacity = 0.5 + audio.volume * 0.3;
          } else if (h.red) {
            // ember accretion rim, flickering like it's feeding
            const flicker = Math.max(0, Math.sin(time * 13 + t * 7)) * 0.18 + audio.bass * 0.15;
            // the closer you get, the harder it feeds: rim spins up, the
            // disk glows white-hot, the void itself swells
            const feed = Math.min(1, Math.max(0, 1 - (t - travel) / 46));
            color.setHSL(0.04, 0.95, 0.42 + flicker + feed * 0.1);
            h.core.visible = true;
            h.core.material.opacity = 0.94;
            h.core.material.color.setHSL(0, 0, 0.02);
            h.core.scale.setScalar((1 + Math.sin(time * 3 + t) * 0.08) * (1 + feed * 0.35));
            h.disk.visible = true;
            h.disk.rotation.set(1.25, time * 0.35, time * 4.2);
            h.disk.scale.setScalar(1 + feed * 0.5 + audio.bass * 0.2);
            h.disk.material.color.setHSL(0.06 + feed * 0.05, 1, 0.45 + feed * 0.3 + flicker);
            h.mesh.rotation.z = time * (1.6 + feed * 3.4);
            h.gl.material.opacity = 0.1 + feed * 0.3;
          } else {
            color.setHSL(0.36, 0.95, 0.5 + Math.sin(time * 5 + t) * 0.08 + audio.volume * 0.12);
            h.core.visible = false;
            h.disk.visible = false;
            h.gl.material.opacity = 0.3 + audio.volume * 0.25;
          }
          h.ring.material.color.copy(color);
          h.gl.material.color.copy(color);

          const ahead = t - travel;
          if (ahead < 4) {
            const gap = Math.abs(h.side - steer);
            const through = gap < 0.42;
            const flooring = wThrottle > 0.6;
            if (through && h.bend) {
              // through the lens: the pipe re-bends under everyone at once
              race.collect(2);
              hoopBoost = 1;
              gulp = Math.max(gulp, 0.5);
              if (opts.impact) opts.impact(0.6);
              bendWorld();
              let ci = 0;
              for (const b of bursts) {
                if (b.visible || ci >= 3) continue;
                ci++;
                b.visible = true;
                b.userData.life = 1 + ci * 0.2;
                b.userData.inward = false;
                b.material.color.setHSL(0.52, 0.8, 0.72);
                b.position.copy(h.mesh.position);
                b.rotation.copy(h.mesh.rotation);
              }
            } else if (through && h.wonder) {
              // through the door: the whole world repaints (the same
              // ceremony a rainbow spark earns in surfer), and the ride pays
              race.collect(3);
              hoopBoost = 1;
              if (opts.impact) opts.impact(0.8);
              document.dispatchEvent(new CustomEvent('fp-lookspark'));
              let wi = 0;
              for (const b of bursts) {
                if (b.visible || wi >= 3) continue;
                wi++;
                b.visible = true;
                b.userData.life = 1 + wi * 0.2;
                b.userData.inward = false;
                b.material.color.setHSL((wi * 0.33) % 1, 0.9, 0.65);
                b.position.copy(h.mesh.position);
                b.rotation.copy(h.mesh.rotation);
              }
            } else if (through && h.red) {
              // SWALLOWED: no toll, no stun — the void's only price is the
              // LIGHT. The world goes black for a spell and that IS the event.
              gulp = 1.5; // the lens lurches — being eaten is a full-body event
              if (opts.impact) opts.impact(1.0);
              document.dispatchEvent(new CustomEvent('fp-swallowed', { detail: { n: 0 } }));
              // shockrings collapse INTO the hole — violet, staggered
              let bi = 0;
              for (const b of bursts) {
                if (b.visible || bi >= 3) continue;
                bi++;
                b.visible = true;
                b.userData.life = 1 + bi * 0.25;
                b.userData.inward = true;
                b.material.color.setHSL(0.75, 0.8, 0.6);
                b.position.copy(h.mesh.position);
                b.rotation.copy(h.mesh.rotation);
              }
            } else if (h.red && flooring && gap < 0.8) {
              // the close call: shave past a red flat out and the near-miss pays
              race.collect(1);
              if (opts.impact) opts.impact(0.35);
            } else if (through) {
              race.collect((hoopBoost > 0.35 ? 2 : 1) * (flooring ? 2 : 1));
              hoopBoost = Math.min(1, hoopBoost + 0.85);
              if (opts.impact) opts.impact(hoopBoost > 0.9 ? 0.75 : 0.5);
              // leave a golden bloom where the catch happened
              const b = bursts.find(x => !x.visible) || bursts[0];
              b.visible = true;
              b.userData.life = 1;
              // bursts share materials with the swallow and the wonder door:
              // claim the gold back or this bloom wears their leftovers
              b.material.color.setHSL(0.12, 0.9, 0.6);
              b.userData.inward = false;
              b.position.copy(h.mesh.position);
              b.rotation.copy(h.mesh.rotation);
            } else if (!h.red) {
              race.drop(0);                            // a missed hoop breaks the run
            }
            h.alive = false;
            h.mesh.visible = false;
          }
        }
      } else if (racing) {
        boost = race.momentum;
        speed = race.speed * SLIDE_PER_STEP;
        travel = race.progress * SLIDE_PER_STEP;
      } else {
        speed = 16 + audio.volume * 42 * reactivity + boost * 34;
        travel += speed * dt;
      }

      if (shapeMix < 1) shapeMix = Math.min(1, shapeMix + dt * 0.45);
      gulp *= Math.pow(0.05, dt);

      if (attract) steerTarget = Math.sin(time * 0.5) * 0.5;
      steer += (steerTarget - steer) * Math.min(1, dt * 9);   // snappy — the tube answers the hand
      if (participants && participants[0]) {
        participants[0].x = steer;
        participants[0].y = 0;
      }

      // bank into the curve like a rider would
      const ahead = curveX(travel + 30) - curveX(travel);
      const bank = ahead * 0.03 + steer * 0.35;
      // the lens widens as the throttle opens — speed you can SEE
      camera.fov += ((76 + wThrottle * 14 + boost * 4 + gulp * 24) - camera.fov) * Math.min(1, dt * 4);

      // camera rides low in the flume
      camera.position.set(
        curveX(travel) + steer * (R * 0.55),
        dropY(travel) + 2.6 + Math.abs(steer) * 1.4 + audio.bass * 0.3,
        -travel
      );
      camera.lookAt(curveX(travel + 34), dropY(travel + 34) + 1.6, -(travel + 34));
      camera.rotation.z += -bank + Math.sin(time * 34) * 0.06 * gulp;

      for (const b of bursts) {
        if (!b.visible) continue;
        b.userData.life -= dt * 2;
        if (b.userData.life <= 0) { b.visible = false; b.userData.inward = false; continue; }
        const e = 1 - Math.min(1, b.userData.life);
        if (b.userData.inward) {
          // swallowed: rings collapse INTO the void instead of blooming out
          b.scale.setScalar(Math.max(0.05, 2.6 - e * 2.4));
          b.material.opacity = Math.min(1, b.userData.life) * 0.9;
        } else {
          b.scale.setScalar(1 + e * 1.8);
          b.material.opacity = b.userData.life * 0.8;
          b.material.color.setHSL(0.12, 1, 0.6);
        }
      }

      // half-pipe rings recycle ahead. ringZ is the ring's ABSOLUTE world z
      // (camera lives at z = -travel), and -ringZ is its path parameter.
      // the wall's arc blends between the two surface styles as the bend
      // lands; the tiles themselves swap under cover of the halfway point
      const sfA = SURFS[surfA], sfB = SURFS[surfB];
      const arcStart = sfA.start + (sfB.start - sfA.start) * shapeMix;
      const arcSpan = sfA.span + (sfB.span - sfA.span) * shapeMix;
      const wantGeo = surfGeos[(shapeMix >= 0.5 ? sfB : sfA).geo];
      if (wall.geometry !== wantGeo) wall.geometry = wantGeo;
      let idx = 0;
      for (let r = 0; r < RINGS; r++) {
        // Recycle by however many spans it takes, not one per frame. Stepping
        // back once assumes travel only ever creeps forward; a seek, a rejoin
        // or a race correction can move it by thousands at once, and the flume
        // would then be left behind the rider entirely.
        const limit = -travel + RING_SPACING * 1.5;
        if (ringZ[r] > limit) {
          const span = RINGS * RING_SPACING;
          ringZ[r] -= Math.ceil((ringZ[r] - limit) / span) * span;
          ringSeed[r] = Math.random();
        }
        const t = -ringZ[r];              // distance along the flume
        const distAhead = t - travel;     // 0 at the camera
        const cx = curveX(t);
        const cy = dropY(t) + R; // ring center sits R above the floor

        for (let s2 = 0; s2 < SEGS; s2++) {
          const a = arcStart + (s2 / (SEGS - 1)) * arcSpan;
          const level = audio[['bass', 'lowMid', 'mid', 'high', 'treble'][s2 % 5]];
          dummy.position.set(cx + Math.cos(a) * R, cy + Math.sin(a) * R, ringZ[r]);
          dummy.rotation.set(0, 0, a + Math.PI / 2);
          const w = (Math.PI * R) / SEGS * 0.85;
          dummy.scale.set(w, 1 + level * 1.6 * reactivity, 1);
          dummy.updateMatrix();
          wall.setMatrixAt(idx, dummy.matrix);

          const jitv = Math.abs(Math.sin(ringSeed[r] * 43.7 + s2 * 12.9));
          themePaint(colorMode, hue / 360, s2 / (SEGS - 1), t * 0.012, time, level, jitv, tp);
          const wet = 0.16 + level * 0.4 * reactivity + boost * 0.12;
          color.setHSL(tp[0], tp[1], Math.min(0.5, wet * Math.min(1.4, tp[2])));
          color.multiplyScalar(Math.min(1, Math.max(0.08, distAhead / 22))); // dim right at the camera
          wall.setColorAt(idx, color);
          idx++;
        }
      }
      wall.instanceMatrix.needsUpdate = true;
      wall.instanceColor.needsUpdate = true;

      // water streaks race down the floor, faster than you
      const wpos = water.geometry.attributes.position;
      const wcol = water.geometry.attributes.color;
      const span = RINGS * RING_SPACING;
      for (let i = 0; i < WATER_N; i++) {
        waterOff[i] += (speed * 0.55 + 26) * dt;
        const t = travel + (waterOff[i] % span);
        const floorY = dropY(t) + 0.55 + Math.abs(waterLane[i]) * 0.06;
        wpos.setXYZ(i, curveX(t) + waterLane[i], floorY, -t);
        const froth = 0.5 + 0.5 * Math.sin(i * 3.7 + time * 14);
        // dim streaks near the camera so overlap never whites out the lens
        const distDim = Math.min(1, Math.max(0.06, ((waterOff[i] % span)) / 22));
        color.setHSL((hue / 360 + 0.5) % 1, 0.4, (0.16 + froth * 0.14 + audio.volume * 0.1) * distDim);
        wcol.setXYZ(i, color.r, color.g, color.b);
      }
      wpos.needsUpdate = true;
      wcol.needsUpdate = true;
      water.material.size = 0.5 + audio.volume * 0.3 + boost * 0.3;

      // splash spray
      if (sprayLife > 0.02) {
        sprayLife *= Math.pow(0.06, dt);
        spray.material.opacity = sprayLife;
        color.setHSL((hue / 360 + 0.5) % 1, 0.3, 0.75);
        spray.material.color.copy(color);
        const pos = spray.geometry.attributes.position;
        for (let i = 0; i < 80; i++) {
          pos.setY(i, pos.getY(i) + dt * (4 + (i % 5)));
          pos.setZ(i, pos.getZ(i) - dt * speed * 0.4);
        }
        pos.needsUpdate = true;
      } else {
        spray.material.opacity = 0;
      }

      sky.position.copy(camera.position);
      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.energy, 0.5, tp);
      sky.material.color.setHSL(tp[0], tp[1] * 0.5, 0.24 + audio.energy * 0.15);

      const fovT = 76 + speed * 0.16 + boost * 10 + gulp * 24;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      if (surfGeos) { for (const k in surfGeos) surfGeos[k].dispose(); surfGeos = null; }
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
