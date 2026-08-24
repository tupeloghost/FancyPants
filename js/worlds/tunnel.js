// TUNNEL — infinite tube flight.
// Radius pulses with bass, wall elements colored by frequency band,
// camera speed rides volume, beats spawn light rings rushing past.
// Shape option controls BOTH the wall elements and the tunnel's
// cross-section silhouette. Color modes are themed behaviors, not tints.

import * as THREE from 'three';
import { glowTexture } from '../lib/glow.js?v=631';

const RINGS = 60;           // rings alive at once
const SEGS = 30;            // wall elements per ring
const RING_SPACING = 4;     // world units between rings
const BEAT_RING_POOL = 12;

export function createTunnel() {
  let scene, group, camera;
  let wall;                  // InstancedMesh of all wall elements
  let beatRings = [];
  let travel = 0;
  let steer = { x: 0, y: 0 };
  let steerTarget = { x: 0, y: 0 };
  let currentShape = 'slat';
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const WHITE = new THREE.Color(1, 1, 1);

  const ringZ = new Float32Array(RINGS);
  const ringSeed = new Float32Array(RINGS);

  let tapFlash = 0;
  let tapQueued = false;

  // glitter sparkle layer: hundreds of tiny points hugging the wall
  const SPARKS = 700;
  let sparks = null;
  const sparkAngle = new Float32Array(SPARKS);
  const sparkDepth = new Float32Array(SPARKS);
  let meteors = [];          // shooting stars
  // ── the look door ── a star loop drifting in the tube, rim tinted with
  // the NEXT look (the preview). Thread it and the world changes clothes.
  let door = null, doorGeos = null, doorZ = 0, doorOn = false, doorNextAt = 500, doorPop = 0;
  // ── the rush ── shots of speed, same grammar as the slide: a tap surges,
  // a door SURGES, and every beat gives the tube a pulse of forward motion
  let rush = 0, baseFov = 70;
  let holdK = 0;            // the held finger: a sustained rush, the tube tightens
  let chorusArmed = false;  // one volley per chorus
  let rollT = 0;            // the vortex: a barrel roll through the throat
  let ripples = [];         // taps as physical bulges racing down the tube

  const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

  // classic curated palettes: [hue, sat, weight] stops, interpolated
  const PALETTES = {
    vapor:    [[0.88, 0.80, 1.0], [0.52, 0.85, 1.0], [0.72, 0.60, 0.9], [0.95, 0.70, 0.95], [0.60, 0.75, 0.85]],
    midnight: [[0.63, 0.95, 1.0], [0.68, 0.85, 0.85], [0.58, 1.00, 1.05], [0.72, 0.70, 0.75], [0.60, 0.40, 0.9]],
    coral:    [[0.02, 0.90, 1.05], [0.06, 0.85, 0.95], [0.48, 0.85, 0.95], [0.98, 0.80, 0.9], [0.52, 0.90, 0.85]],
  };

  function palLerp(pal, t, out) {
    const n = pal.length;
    const x = ((t % 1) + 1) % 1 * n;
    const i0 = Math.floor(x) % n, i1 = (i0 + 1) % n;
    const f = x - Math.floor(x);
    const a = pal[i0], b = pal[i1];
    let dh = b[0] - a[0];
    if (dh > 0.5) dh -= 1; else if (dh < -0.5) dh += 1;
    out[0] = ((a[0] + dh * f) % 1 + 1) % 1;
    out[1] = a[1] + (b[1] - a[1]) * f;
    out[2] = a[2] + (b[2] - a[2]) * f;
    return out;
  }
  const palOut = [0, 0, 0];

  // ── wall element geometry per shape ──
  function addVertexShading(geo, span) {
    const pa = geo.attributes.position;
    const vc = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const t = 0.6 + (pa.getY(i) / span + 0.5) * 0.5;
      vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
    return geo;
  }

  function starShape(points, outer, inner) {
    const shp = new THREE.Shape();
    for (let i = 0; i < points * 2; i++) {
      const rr = i % 2 === 0 ? outer : inner;
      const aa = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(aa) * rr, y = Math.sin(aa) * rr;
      i === 0 ? shp.moveTo(x, y) : shp.lineTo(x, y);
    }
    shp.closePath();
    return shp;
  }

  function makeShapeGeo(shape) {
    let geo;
    switch (shape) {
      case 'circle':
        geo = new THREE.CylinderGeometry(0.5, 0.5, 0.28, 24);
        break;
      case 'square':
        geo = new THREE.BoxGeometry(0.95, 0.28, 0.95);
        break;
      case 'diamond':
        geo = new THREE.BoxGeometry(0.75, 0.28, 0.75);
        geo.rotateY(Math.PI / 4);
        break;
      case 'star': {
        geo = new THREE.ExtrudeGeometry(starShape(5, 0.62, 0.26), { depth: 0.28, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); // lie flat, thickness along radial y
        break;
      }
      default: // slat
        geo = new THREE.BoxGeometry(1, 0.35, RING_SPACING * 0.82);
    }
    return addVertexShading(geo, shape === 'slat' ? 0.35 : 0.28);
  }

  // ── cross-section silhouette per shape: radius multiplier at angle a ──
  function silhouette(a, shape) {
    switch (shape) {
      case 'square': {
        const c = Math.abs(Math.cos(a)), s2 = Math.abs(Math.sin(a));
        return (1 / Math.max(c, s2)) / 1.18;
      }
      case 'diamond': {
        const a2 = a + Math.PI / 4;
        const c = Math.abs(Math.cos(a2)), s2 = Math.abs(Math.sin(a2));
        return (1 / Math.max(c, s2)) / 1.18;
      }
      case 'star': {
        // 5-point star: radius ping-pongs sharply between inner and outer
        const seg = (Math.PI * 2) / 5;
        const t = ((a % seg) + seg) % seg / seg;
        const tri = t < 0.5 ? t * 2 : 2 - t * 2;
        return 0.8 + 0.42 * tri;
      }
      default: return 1; // slat, circle
    }
  }

  function api() { return {
    name: 'TUNNEL',
    options: ['pattern', 'shape'],

    init(_scene, _camera) {
      scene = _scene;
      camera = _camera;
      group = new THREE.Group();
      scene.add(group);

      scene.fog = new THREE.FogExp2(0x000208, 0.016);

      currentShape = 'slat';
      const mat = new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true });
      wall = new THREE.InstancedMesh(makeShapeGeo(currentShape), mat, RINGS * SEGS);
      wall.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      wall.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * SEGS * 3), 3);
      wall.instanceColor.setUsage(THREE.DynamicDrawUsage);
      group.add(wall);

      for (let r = 0; r < RINGS; r++) {
        ringZ[r] = -r * RING_SPACING;
        ringSeed[r] = Math.random() * 1000;
      }

      const torusGeo = new THREE.TorusGeometry(1, 0.09, 8, 48);
      for (let i = 0; i < BEAT_RING_POOL; i++) {
        const m = new THREE.Mesh(
          torusGeo,
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.visible = false;
        m.userData = { life: 0, z: 0, fired: false };
        group.add(m);
        beatRings.push(m);
      }

      // sparkle points (visible only in glitter mode)
      {
        const pos = new Float32Array(SPARKS * 3);
        const col = new Float32Array(SPARKS * 3);
        for (let i = 0; i < SPARKS; i++) {
          sparkAngle[i] = Math.random() * Math.PI * 2;
          sparkDepth[i] = Math.random() * RINGS * RING_SPACING;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
        sparks = new THREE.Points(geo, new THREE.PointsMaterial({
          size: 0.55, map: glowTexture(), transparent: true, vertexColors: true,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }));
        sparks.frustumCulled = false;
        sparks.visible = false;
        group.add(sparks);
      }

      // shooting stars: thin bright streaks whipping down the tube
      meteors = [];
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.1, 9),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.visible = false;
        m.userData = { z: 0, angle: 0, rr: 0 };
        group.add(m);
        meteors.push(m);
      }

      {
        // the door's SILHOUETTE previews the tile shape it deals, the way
        // its rim previews the color — one loop per shape in the picker
        const tube = pts => new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'catmullrom', 0.02),
          72, 0.16, 8, true);
        const star = [];
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          const rr = i % 2 ? 1.5 : 2.4;
          star.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        doorGeos = {
          circle: new THREE.TorusGeometry(2.2, 0.16, 8, 40),
          star: tube(star),
          diamond: tube([[0, 2.6], [2.6, 0], [0, -2.6], [-2.6, 0]]),
          square: tube([[2.1, 2.1], [2.1, -2.1], [-2.1, -2.1], [-2.1, 2.1]]),
          slat: tube([[3.1, 1.1], [3.1, -1.1], [-3.1, -1.1], [-3.1, 1.1]]),
        };
        door = new THREE.Group();
        const rim = new THREE.Mesh(doorGeos.star, new THREE.MeshBasicMaterial({
          toneMapped: false, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        const heart = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        // the void: a black disc that eats the tube behind it — vortex duty only
        const voidDisc = new THREE.Mesh(new THREE.CircleGeometry(2.0, 28),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.94, side: THREE.DoubleSide }));
        voidDisc.visible = false;
        // the accretion disk: a tilted hot ring spinning around the void
        const disk = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.08, 8, 40),
          new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        disk.visible = false;
        door.add(rim, heart, voidDisc, disk);
        door.userData = { rim, heart, voidDisc, disk };
        door.visible = false;
        group.add(door);
      }
      doorOn = false; doorNextAt = 500; doorPop = 0;

      travel = 0; rush = 0;
      baseFov = camera.fov;
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
    },

    setInput(x, y) { steerTarget.x = x || 0; steerTarget.y = y || 0; },
    // dev: audition the vortex ride without steering into one
    _vortex() { rush = 2.0; rollT = 1; document.dispatchEvent(new CustomEvent('fp-swallowed', { detail: { n: 0 } })); },

    // ghosts: glowing motes flying the same tube, offset by their steer
    placeGhost(p, i, out) {
      out.set(p.x * 3.2, p.y * 2.4, -8 - (i % 8) * 3 - Math.sin(i * 2.7) * 1.5);
    },

    onTap() {
      tapFlash = 1;
      tapQueued = true;
      rush = Math.max(rush, 1);      // a tap is a shot of speed
      ripples.push({ at: performance.now() / 1000 });
      if (ripples.length > 4) ripples.shift();
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow', pattern = 'spiral', hdr = 1.0, shape = 'slat', stardust = true } = opts;

      // live shape swap
      if (shape !== currentShape) {
        currentShape = shape;
        wall.geometry.dispose();
        wall.geometry = makeShapeGeo(shape);
      }
      const isSlat = shape === 'slat';

      rush *= Math.pow(0.2, dt);
      if (audio.beat) rush = Math.max(rush, 0.3 + audio.beatIntensity * 0.35);
      // HOLD = go faster, same grammar as the slide: a sustained surge that
      // also pulls the walls in close, which is what speed looks like
      holdK += (((opts.holding && !attract) ? 1 : 0) - holdK) * Math.min(1, dt * 4);
      rush = Math.max(rush, holdK * 0.9, (opts.chorus || 0) * 0.75);   // the chorus carries you
      const speed = (10 + audio.volume * 55 * reactivity) + rush * 45;
      travel += speed * dt;
      // speed you can SEE: the lens opens with the rush
      camera.fov += ((baseFov + rush * 13) - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
      // the vortex roll: one eased full turn, fastest through the middle
      rollT = Math.max(0, rollT - dt / 1.5);
      // (roll the WORLD around the lens — main owns the camera's rotation)
      if (rollT > 0) { const k = 1 - rollT; group.rotation.z = Math.PI * 2 * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2); }
      else group.rotation.z = 0;

      // local participant state = our steer (what remotes render)
      if (participants && participants[0]) {
        participants[0].x = steer.x;
        participants[0].y = steer.y;
        participants[0].z = 0;
      }

      const curveX = Math.sin(travel * 0.02) * 3 + Math.sin(travel * 0.007) * 5;
      const curveY = Math.cos(travel * 0.016) * 2.2;

      if (attract) {
        steerTarget.x = Math.sin(time * 0.4) * 0.4;
        steerTarget.y = Math.cos(time * 0.31) * 0.3;
      }
      steer.x += (steerTarget.x - steer.x) * Math.min(1, dt * 4);
      steer.y += (steerTarget.y - steer.y) * Math.min(1, dt * 4);

      // ── the look door rides the tube toward you ──
      if (!doorOn && travel > doorNextAt) {
        doorOn = true;
        doorZ = -150;
        // one door in three is the DARE: a dark vortex, not a look — but never
        // in the first stretch, and never parked where an idle rider drifts
        door.userData.vortex = travel > 1600 && Math.random() < 0.34;
        const dealt = window.__nextLook && window.__nextLook.cfg && doorGeos[window.__nextLook.cfg.shape];
        door.userData.rim.geometry = door.userData.vortex ? doorGeos.circle : (dealt || doorGeos.star);
        door.userData.voidDisc.visible = door.userData.vortex;
        door.userData.disk.visible = door.userData.vortex;
        const a = Math.random() * Math.PI * 2;
        // a look door floats near the middle; a vortex hugs the wall, so
        // entering it is always a deliberate lean, never an accident
        door.userData.dx = Math.cos(a) * 2.2 * (door.userData.vortex ? 1.35 : 1);
        door.userData.dy = Math.sin(a) * 1.6 * (door.userData.vortex ? 1.35 : 1);
        door.visible = true;
      }
      if (doorOn) {
        doorZ += speed * dt;
        const zc = doorZ;
        const cx = Math.sin((travel - zc) * 0.02) * 3 + Math.sin((travel - zc) * 0.007) * 5 - curveX;
        const cy = Math.cos((travel - zc) * 0.016) * 2.2 - curveY;
        door.position.set(cx + door.userData.dx, cy + door.userData.dy, zc);
        const vx = door.userData.vortex;
        if (vx) {
          // the vortex: ember rim spinning up as it nears, white-hot disk, black heart
          const feed = Math.min(1, Math.max(0, 1 + doorZ / 60));
          const flicker = Math.max(0, Math.sin(time * 13)) * 0.18 + audio.bass * 0.15;
          door.rotation.z = time * (1.6 + feed * 3.4);
          color.setHSL(0.04, 0.95, 0.42 + flicker + feed * 0.1);
          door.userData.rim.material.color.copy(color);
          door.userData.heart.material.opacity = 0;
          door.userData.disk.rotation.set(1.25, time * 0.35, time * 4.2);
          door.userData.disk.scale.setScalar(1 + feed * 0.5 + audio.bass * 0.2);
          door.userData.disk.material.color.setHSL(0.06 + feed * 0.05, 1, 0.45 + feed * 0.3 + flicker);
          door.userData.voidDisc.scale.setScalar(1 + feed * 0.35);
        } else {
          door.rotation.z = -time * 0.55;
          const nl = window.__nextLook;
          const spectral = !nl || nl.colorMode === 'rainbow' || nl.colorMode === 'cycle' || nl.colorMode === 'random';
          if (spectral) color.setHSL((time * 0.22) % 1, 0.95, 0.6 + audio.volume * 0.12);
          else color.setHSL(nl.hue / 360, 0.92, 0.55 + Math.sin(time * 2.6) * 0.08 + audio.volume * 0.12);
          door.userData.rim.material.color.copy(color);
          door.userData.heart.material.color.copy(color);
          door.userData.heart.material.opacity = 0.22 + Math.sin(time * 2.2) * 0.08 + audio.volume * 0.15;
        }
        const pulse = 1 + Math.sin(time * 2.4) * 0.05;
        door.scale.setScalar(pulse * (doorPop > 0 ? 1 + (1 - doorPop) * 0 : 1));
        if (doorZ > -0.5) {
          const px = steer.x * 3.2, py = steer.y * 2.4;
          const hit = Math.hypot(door.position.x - px, door.position.y - py) < (door.userData.vortex ? 1.7 : 2.6);
          if (hit && door.userData.vortex) {
            // THE RIDE: horizon pull (main), barrel roll + meteor storm (here),
            // a random dark dimension (main), a bang out the other side (main)
            document.dispatchEvent(new CustomEvent('fp-swallowed', { detail: { n: 0 } }));
            if (opts.impact) opts.impact(1.0);
            rush = 2.0; rollT = 1;
            let fired = 0;
            for (const m of meteors) {
              if (m.visible || fired >= 6) continue;
              fired++; m.visible = true;
              m.userData.z = -RINGS * RING_SPACING * (0.5 + Math.random() * 0.5) - travel;
              m.userData.angle = Math.random() * Math.PI * 2; m.userData.rr = 0.2 + Math.random() * 0.6;
            }
            doorPop = 1;
          } else if (hit) {
            document.dispatchEvent(new CustomEvent('fp-lookspark'));
            if (opts.impact) opts.impact(0.7);
            rush = 1.6;              // the door flings you forward
            doorPop = 1;
          }
          doorOn = false;
          if (!hit) door.visible = false;
          doorNextAt = travel + 650 + Math.random() * 500;
        }
      } else if (doorPop > 0) {
        // the pop: the door blooms open around you as the new look floods in
        doorPop = Math.max(0, doorPop - dt * 1.6);
        door.position.z = 1.5;
        door.scale.setScalar(1 + (1 - doorPop) * 5);
        door.userData.rim.material.opacity = doorPop * 0.95;
        door.userData.heart.material.opacity = 0;
        if (doorPop === 0) { door.visible = false; door.userData.rim.material.opacity = 0.95; }
      }

      // the CATHEDRAL: on a chorus the tube swells to nearly double — walls fly
      // away into a hall of light, then close back down as the song settles
      const chorusK = opts.chorus || 0;
      const baseRadius = 6 * (1 - holdK * 0.14) * (1 + chorusK * 0.7);
      // a volley of shooting stars the instant a chorus lands
      if (chorusK > 0.55 && !chorusArmed) {
        chorusArmed = true;
        let fired = 0;
        for (const m of meteors) {
          if (m.visible || fired >= 6) continue;
          fired++;
          m.visible = true;
          m.userData.z = -RINGS * RING_SPACING * (0.6 + Math.random() * 0.4) - travel;
          m.userData.angle = Math.random() * Math.PI * 2;
          m.userData.rr = 0.25 + Math.random() * 0.6;
        }
      } else if (chorusK < 0.3) chorusArmed = false;
      const radius = baseRadius * (1 + audio.bass * 0.5 * reactivity + audio.beatIntensity * 0.25 * reactivity);
      // ripples live in world z: born at the lens, they race down the tube
      const nowS = performance.now() / 1000;
      ripples = ripples.filter(rp => nowS - rp.at < 2.6);
      const px = steer.x * 3.2, py = steer.y * 2.4;   // where the rider is in the tube
      const wv = opts.wave;
      let wvFront = Infinity, wvOldMode = null, wvOldHue = 0;
      if (wv) {
        const k = (performance.now() - wv.at) / wv.dur;
        if (k < 1) {
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // ease in-out
          wvFront = e * (RINGS * RING_SPACING + 30); wvOldMode = wv.from.colorMode; wvOldHue = wv.from.hue;
        }
      }

      for (let r = 0; r < RINGS; r++) {
        let z = ringZ[r] + travel;
        if (z > RING_SPACING * 2) {
          ringZ[r] -= RINGS * RING_SPACING;
          ringSeed[r] = Math.random() * 1000;
        }
      }

      let idx = 0;
      for (let r = 0; r < RINGS; r++) {
        const z = ringZ[r] + travel;
        const cx = Math.sin((travel - z) * 0.02) * 3 + Math.sin((travel - z) * 0.007) * 5 - curveX;
        const cy = Math.cos((travel - z) * 0.016) * 2.2 - curveY;

        let twist;
        switch (pattern) {
          case 'stripes': case 'plaid': case 'polka': twist = 0; break;
          case 'kaleido': twist = (r % 2 ? 1 : -1) * (travel * 0.03 + Math.sin(travel * 0.05) * 0.3); break;
          case 'checker': twist = (r % 2) * (Math.PI / SEGS); break;
          case 'paisley': twist = Math.sin((travel + ringZ[r]) * 0.03) * 0.6 + travel * 0.004; break;
          default:        twist = ringSeed[r] * 0.1 + travel * 0.006;
        }

        for (let s = 0; s < SEGS; s++) {
          const a = (s / SEGS) * Math.PI * 2 + twist;

          // smooth band blend around the ring
          const bt = (s / SEGS) * BANDS.length;
          const b0 = Math.floor(bt) % BANDS.length;
          const b1 = (b0 + 1) % BANDS.length;
          const bf = bt - Math.floor(bt);
          const level = audio[BANDS[b0]] * (1 - bf) + audio[BANDS[b1]] * bf;

          let segRadius = radius * silhouette(a, shape) * (1 + level * 0.18 * reactivity);
          for (let q = 0; q < ripples.length; q++) {
            const age = nowS - ripples[q].at;
            const rz = -age * 42;                               // the bulge's z right now
            const dz = (z - rz) / 5.5;
            segRadius *= 1 + Math.exp(-dz * dz) * 0.34 * Math.max(0, 1 - age / 2.6);
          }
          if (pattern === 'waves') {
            segRadius += Math.sin(a * 3 + travel * 0.12) * (1 + audio.mid * 2 * reactivity);
          } else if (pattern === 'checker' && (r + s) % 2) {
            segRadius *= 1.12;
          }

          dummy.position.set(
            cx + Math.cos(a) * segRadius + steer.x * z * 0.06,
            cy + Math.sin(a) * segRadius + steer.y * z * 0.06,
            z
          );
          dummy.rotation.set(0, 0, a + Math.PI / 2);
          const w = (Math.PI * 2 * segRadius) / SEGS * 0.6;
          if (isSlat) {
            dummy.scale.set(w, 1 + level * 2.5 * reactivity, 1);
          } else {
            // shaped elements keep their aspect; pulse size with their band
            const sz = w * (1.5 + level * 1.4 * reactivity);
            dummy.scale.set(sz, 1 + level * 2 * reactivity, sz);
          }
          dummy.updateMatrix();
          wall.setMatrixAt(idx, dummy.matrix);

          // ── themed color behaviors ──
          const jit = Math.abs(Math.sin(ringSeed[r] * 12.9898 + s * 78.233));
          const depthT = (travel - z) * 0.0022;
          const vert = Math.sin(a); // -1 bottom ... +1 top of the tube
          let h, sat = 1.0, boost = 1.0;

          // the paint wave: tiles beyond the front still wear the old look
          const past = wvOldMode && (-z) > wvFront;
          const cmHere = past ? wvOldMode : colorMode, hueHere = past ? wvOldHue : hue;
          const lip = wvOldMode ? Math.pow(Math.max(0, 1 - Math.abs((-z) - wvFront) / 18), 2) : 0;
          switch (cmHere) {
            case 'mono':
              h = ((hueHere / 360) + depthT * 0.3) % 1;
              break;
            case 'pastel':
              h = ((hueHere / 360) + (s / SEGS) * 0.5 + depthT * 0.4) % 1;
              sat = 0.45; boost = 0.85;
              break;
            case 'fire': {
              // flames: fast per-element flicker in hue and brightness,
              // burning hardest at the bottom of the tube
              const flick = 0.5 + 0.5 * Math.sin(time * 8 + jit * 60 + (travel - z) * 0.4);
              h = 0.012 + 0.075 * flick;
              boost = (0.65 + flick * 0.85) * (1 + 0.3 * Math.max(0, -vert));
              break;
            }
            case 'ocean': {
              // rolling swells of teal light sweeping through the tube
              const swell = Math.sin(a * 2 - time * 1.3 + (travel - z) * 0.06);
              h = 0.5 + 0.075 * swell;
              sat = 0.92;
              boost = 0.7 + 0.45 * Math.max(0, swell);
              break;
            }
            case 'sunset': {
              // vertical gradient: molten orange horizon below, violet above
              h = (0.82 + (1 - (vert + 1) / 2) * 0.2) % 1;
              boost = 0.85 + 0.3 * Math.max(0, -vert);
              break;
            }
            case 'aurora': {
              // green curtains waving against a violet night
              const curtain = Math.sin(a * 3 + Math.sin(time * 0.7 + (travel - z) * 0.12) * 2.4);
              if (curtain > 0) {
                h = 0.36 + 0.1 * curtain;
                boost = 0.55 + curtain * 0.9;
              } else {
                h = 0.75;
                sat = 0.8;
                boost = 0.3;
              }
              break;
            }
            case 'forest': {
              // deep green canopy with dappled sunlight breaking through
              if (jit > 0.87) { h = 0.125; sat = 0.85; boost = 1.35; }
              else { h = 0.3 + jit * 0.09 + depthT * 0.1; sat = 0.9; boost = 0.62; }
              break;
            }
            case 'gold': {
              // polished metal: a specular band sweeps around the tube
              const spec = Math.pow(Math.max(0, Math.cos(a - time * 0.9)), 6);
              h = 0.10 + 0.02 * jit;
              sat = 0.9 - spec * 0.55;
              boost = 0.55 + spec * 1.7 + level * 0.4;
              break;
            }
            case 'cosmos': {
              // actual space: near-black void, sharp white stars, faint nebula
              if (jit > 0.92) {
                h = 0.6; sat = 0.12;
                boost = 1.8 + 0.8 * Math.sin(time * 2.5 + jit * 90); // twinkle
              } else {
                h = ((hueHere / 360) + 0.16 * Math.sin((travel - z) * 0.05 + a * 0.8) + 1) % 1;
                sat = 0.85;
                boost = 0.18 + level * 0.25; // nebula stays dim
              }
              break;
            }
            case 'glitter': {
              // dark champagne field; the real sparkle is the particle layer.
              // A few elements still catch the light, briefly and sharply.
              const spark = Math.abs(Math.sin(ringSeed[r] * 91.7 + s * 57.31 + Math.floor(time * 30) * 7.7));
              if (spark > 0.965) { h = (hueHere / 360) % 1; sat = 0.25; boost = 3.2 + audio.volume; }
              else { h = ((hueHere / 360) + jit * 0.04) % 1; sat = 0.6; boost = 0.4; }
              break;
            }
            case 'candy': {
              // candy-cane: glossy diagonal stripes swirling down the tube
              const stripe = Math.floor(((a / (Math.PI * 2)) * 10 + (travel - z) * 0.16 + time * 0.25) % 4 + 4) % 4;
              if (stripe === 0)      { h = 0.93; sat = 1.0;  boost = 1.1; }  // hot pink
              else if (stripe === 1) { h = 0.0;  sat = 0.05; boost = 1.0; }  // white gloss
              else if (stripe === 2) { h = 0.50; sat = 0.95; boost = 1.0; }  // cyan
              else                   { h = 0.13; sat = 1.0;  boost = 1.05; } // lemon
              // wet-candy shine sweeping around
              boost += Math.pow(Math.max(0, Math.cos(a - time * 1.3)), 8) * 0.55;
              break;
            }
            // duo/triad/neon: colors alternate in bold ARCS around the tube,
            // never per-tile — every-other-tile complements read as static
            case 'duo':
              h = ((hueHere / 360) + (Math.floor(s / (SEGS / 4)) % 2) * 0.5 + depthT * 0.25) % 1;
              break;
            case 'triad':
              h = ((hueHere / 360) + (Math.floor(s / (SEGS / 3)) % 3) / 3 + depthT * 0.25) % 1;
              break;
            case 'neon':
              h = ((hueHere / 360) + (Math.floor(s / (SEGS / 3)) % 3) / 3 + depthT * 0.4) % 1;
              boost = 1.5;
              break;
            case 'cycle':
              h = ((hueHere / 360) + time * 0.03 + (s / SEGS) + depthT) % 1;
              break;
            case 'random':
              h = (ringSeed[r] * 7.13 + s * 0.618) % 1;
              break;
            case 'duotone': {
              // hue <-> complement gradient, anchored to the hue slider so
              // the pair is always YOUR choice
              const t2 = 0.5 - 0.5 * Math.cos(((s / SEGS) + depthT + time * 0.012) * Math.PI * 2);
              h = ((hueHere / 360) + t2 * 0.5) % 1;
              break;
            }
            default:
              if (PALETTES[cmHere]) {
                palLerp(PALETTES[cmHere], (s / SEGS) + depthT + time * 0.012, palOut);
                h = palOut[0]; sat = palOut[1]; boost = palOut[2];
              } else {
                // rainbow: full wheel around the tube + depth + energy drift
                h = ((hueHere / 360) + (s / SEGS) + depthT * 0.6 + audio.energy * 0.1) % 1;
              }
          }

          // music bends hue slightly; per-element jitter breaks flatness
          h = (h + (jit - 0.5) * 0.03 + level * 0.04 + audio.beatIntensity * 0.02 + 1) % 1;

          // pattern weaves modulate brightness fields. Themed modes own
          // their colors: patterns only texture them gently, never recolor.
          const themed = colorMode === 'fire' || colorMode === 'ocean' || colorMode === 'sunset' ||
                         colorMode === 'aurora' || colorMode === 'forest' || colorMode === 'gold' ||
                         colorMode === 'cosmos' || colorMode === 'glitter';
          let weave = 1;
          if (pattern === 'paisley') {
            const swirl = Math.sin(a * 2 + Math.sin((travel - z) * 0.045) * 2.6 + travel * 0.015);
            weave = swirl > 0.25 ? 1.4 : (swirl > -0.35 ? 0.75 : 0.42);
            if (!themed) {
              if (swirl > 0.25) h = (h + 0.07) % 1;
              else if (swirl < -0.35) h = (h + 0.18) % 1;
            }
          } else if (pattern === 'polka') {
            const arc = a * 6.2;
            const along = travel - z;
            const rowIdx = Math.floor(along / 13);
            const stagger = (rowIdx % 2) * 6.5;
            const dx = ((arc + stagger) % 13 + 13) % 13 - 6.5;
            const dz2 = (along % 13 + 13) % 13 - 6.5;
            const d = Math.sqrt(dx * dx + dz2 * dz2);
            const edge = Math.min(1, Math.max(0, 1 - (d - 3.1) / 1.2));
            weave = 0.55 + 0.75 * edge;   // dots: brighter, not a different world
            if (edge > 0.4 && !themed) h = (h + 0.16) % 1;   // a shift, not a complement — no blotches
          } else if (pattern === 'plaid') {
            const ringBand = (r % 6) < 3;
            const segBand = (s % 4) < 2;
            weave = ringBand && segBand ? 1.5 : (ringBand || segBand ? 0.85 : 0.45);
            if (ringBand !== segBand && !themed) h = (h + 0.06) % 1;
          }
          else if (pattern === 'checker') {
            weave = (r + s) % 2 ? 1.3 : 0.55;
          } else if (pattern === 'stripes') {
            weave = s % 2 ? 1.25 : 0.5;
          }
          if (themed) weave = 1 + (weave - 1) * 0.45; // gentle texture only

          const drive = level * 0.55 * Math.sqrt(reactivity) + audio.beatIntensity * 0.1 + tapFlash * 0.15;
          // candy is a glossy rope — its stripes need to stay lit even on
          // quiet frequencies, or the cane looks broken. Other looks keep
          // their full contrast.
          // quiet bands must still read as tiles: a 3% floor went black under any weave
          const lum = (colorMode === 'candy' ? 0.12 : 0.05) + 0.34 * (1 - Math.exp(-2.2 * drive));
          color.setHSL(h, sat, colorMode === 'pastel' ? lum + 0.12 : lum);

          const proximityDim = Math.min(1, Math.max(0.12, -z / 16));
          const rawDrive = Math.min(1.55, (0.5 + level * 1.6 * reactivity + audio.beatIntensity * 0.6 + tapFlash * 0.45) * boost * (0.82 + jit * 0.36));
          const drive2 = 1 + (rawDrive - 1) * hdr;
          // weave lives OUTSIDE the clamp — patterns keep their contrast
          color.multiplyScalar(Math.max(0.12, drive2) * proximityDim * weave * (1 + lip * 0.55));
          if (lip > 0) color.lerp(WHITE, lip * 0.18);   // the rim warms toward white, softly
          if (colorMode === 'candy') {
            const peak = Math.max(color.r, color.g, color.b);
            if (peak > 0 && peak < 0.18) color.multiplyScalar(0.18 / peak);
          }
          if (z > -14) {
            // brushing the wall: the tiles you graze light up white-hot
            const dx = (cx + Math.cos(a) * segRadius + steer.x * z * 0.06) - px;
            const dy = (cy + Math.sin(a) * segRadius + steer.y * z * 0.06) - py;
            const d = Math.hypot(dx, dy);
            const brush = Math.max(0, 1 - d / 3.4) * Math.max(0, 1 + z / 14);
            if (brush > 0) { color.multiplyScalar(1 + brush * 0.9); color.lerp(WHITE, brush * 0.3); }
          }
          wall.setColorAt(idx, color);
          idx++;
        }
      }
      wall.instanceMatrix.needsUpdate = true;
      wall.instanceColor.needsUpdate = true;

      // glitter sparkle layer: tiny points strewn on the wall, a scattered
      // handful flashing white-hot every frame — actual glitter dust
      const glitterMode = colorMode === 'glitter';
      sparks.visible = glitterMode || stardust;
      if (sparks.visible) {
        const pos = sparks.geometry.attributes.position;
        const col = sparks.geometry.attributes.color;
        const span = RINGS * RING_SPACING;
        const frame = Math.floor(time * 30);
        for (let i = 0; i < SPARKS; i++) {
          const zRing = -(((sparkDepth[i] + travel * 0.0) % span)); // fixed in ring space
          const z = ((sparkDepth[i] - travel) % span + span) % span * -1 + RING_SPACING;
          const aa = sparkAngle[i];
          const rr = radius * silhouette(aa, shape) * 0.985;
          pos.setXYZ(i,
            Math.sin((travel - z) * 0.02) * 3 + Math.sin((travel - z) * 0.007) * 5 - curveX + Math.cos(aa) * rr + steer.x * z * 0.06,
            Math.cos((travel - z) * 0.016) * 2.2 - curveY + Math.sin(aa) * rr + steer.y * z * 0.06,
            z
          );
          const tw = Math.abs(Math.sin(i * 12.9898 + frame * 78.233));
          if (!glitterMode) {
            // stardust: calmer, cooler, sparser twinkle in any color mode
            if (tw > 0.93) {
              const heat = 0.9 + audio.volume * 0.8 + (tw - 0.93) * 8;
              col.setXYZ(i, heat * 0.85, heat * 0.9, heat);
            } else {
              col.setXYZ(i, 0.03, 0.035, 0.05);
            }
            continue;
          }
          if (tw > 0.86) {
            const heat = 1.6 + audio.volume * 1.4 + (tw - 0.86) * 12;
            // flash = white core tinted toward the chosen hue
            color.setHSL((hue / 360) % 1, 0.55, 0.5);
            col.setXYZ(i, heat * (0.6 + color.r * 0.4), heat * (0.6 + color.g * 0.4), heat * (0.6 + color.b * 0.4));
          } else {
            color.setHSL((hue / 360) % 1, 0.6, 0.05);
            col.setXYZ(i, color.r, color.g, color.b); // dust barely there
          }
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        sparks.material.size = (glitterMode ? 0.45 : 0.34) + audio.volume * 0.35;
      }

      // shooting stars: rare in quiet, frequent on loud passages
      if ((stardust || glitterMode || colorMode === 'cosmos') &&
          Math.random() < dt * (0.25 + audio.volume * 1.6 + (audio.beat ? 0.8 : 0))) {
        const m = meteors.find(x => !x.visible);
        if (m) {
          m.visible = true;
          m.userData.z = -RINGS * RING_SPACING - travel;
          m.userData.angle = Math.random() * Math.PI * 2;
          m.userData.rr = 0.25 + Math.random() * 0.6; // inside the tube
        }
      }
      for (const m of meteors) {
        if (!m.visible) continue;
        m.userData.z += 190 * dt; // much faster than the walls
        const z = m.userData.z + travel;
        if (z > 4) { m.visible = false; continue; }
        const rr = radius * m.userData.rr;
        m.position.set(
          Math.sin((travel - z) * 0.02) * 3 + Math.sin((travel - z) * 0.007) * 5 - curveX + Math.cos(m.userData.angle) * rr + steer.x * z * 0.06,
          Math.cos((travel - z) * 0.016) * 2.2 - curveY + Math.sin(m.userData.angle) * rr + steer.y * z * 0.06,
          z
        );
        const prox = 1 - Math.abs(z) / (RINGS * RING_SPACING);
        m.material.opacity = Math.min(1, prox * 1.8);
        color.setHSL(((hue / 360) + 0.05) % 1, 0.25, 0.8);
        color.multiplyScalar(1.6);
        m.material.color.copy(color);
      }

      if (audio.beat) {
        const m = beatRings.find(b => !b.visible) || beatRings[0];
        m.visible = true;
        m.userData.fired = false;
        m.userData.z = -RINGS * RING_SPACING * 0.85 - travel;
        m.material.opacity = 1;
        color.setHSL(((hue / 360) + 0.5) % 1, 1.0, 0.55);
        color.multiplyScalar(1.4 + audio.beatIntensity * 1.2);
        m.material.color.copy(color);
      }

      if (tapQueued) {
        tapQueued = false;
        const m = beatRings.find(b => !b.visible) || beatRings[0];
        m.visible = true;
        m.userData.fired = true;
        m.userData.z = -1 - travel;
        m.material.opacity = 1;
        color.setHSL(((hue / 360) + 0.12) % 1, 1.0, 0.55);
        color.multiplyScalar(2.0);
        m.material.color.copy(color);
      }
      tapFlash *= Math.pow(0.02, dt);

      for (const m of beatRings) {
        if (!m.visible) continue;
        if (m.userData.fired) m.userData.z -= 140 * dt;
        const z = m.userData.z + travel;
        if (z > 6 || z < -RINGS * RING_SPACING) { m.visible = false; continue; }
        m.position.set(
          Math.sin((travel - z) * 0.02) * 3 + Math.sin((travel - z) * 0.007) * 5 - curveX + steer.x * z * 0.06,
          Math.cos((travel - z) * 0.016) * 2.2 - curveY + steer.y * z * 0.06,
          z
        );
        const prox = 1 - Math.abs(z) / (RINGS * RING_SPACING);
        m.scale.setScalar(radius * 1.15);
        m.material.opacity = Math.min(1, prox * 1.6);
      }

      camera.position.x = steer.x * 1.6;
      camera.position.y = steer.y * 1.2;
      camera.position.z = 0;
      camera.rotation.z = steer.x * -0.15 + Math.sin(time * 0.3) * 0.02;
      camera.rotation.x = steer.y * 0.06;
      camera.rotation.y = steer.x * -0.06;
      const fovTarget = 75 + audio.volume * 12 * reactivity + audio.beatIntensity * 6;
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      scene.remove(group);
      beatRings = [];
    },
  }; }

  return api();
}
