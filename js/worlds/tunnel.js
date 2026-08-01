// TUNNEL — infinite tube flight.
// Radius pulses with bass, wall segments colored by frequency band,
// camera speed rides volume, beats spawn light rings rushing past.

import * as THREE from 'three';

const RINGS = 60;           // rings alive at once
const SEGS = 30;            // wall segments per ring — slim slats, not squares
const RING_SPACING = 4;     // world units between rings
const BEAT_RING_POOL = 12;

export function createTunnel() {
  let scene, group, camera;
  let rings = [];            // { mesh: InstancedMesh row via group of boxes } — we use one InstancedMesh
  let wall;                  // InstancedMesh of all wall segments
  let beatRings = [];        // pooled torus meshes
  let travel = 0;            // distance flown
  let steer = { x: 0, y: 0 };
  let steerTarget = { x: 0, y: 0 };
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // per-ring state
  const ringZ = new Float32Array(RINGS);      // base z of each ring (negative = ahead)
  const ringSeed = new Float32Array(RINGS);

  // tap interaction state
  let tapFlash = 0;      // wall brightness kick, decays
  let tapQueued = false; // spawn a fired ring on the next update

  // which frequency band drives each wall segment (by angle sector)
  const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

  // fixed-mood palettes: [hue, saturation, brightness-weight] stops dealt
  // around the tube (hue slider ignored). Sat/weight per stop is what makes
  // them read as designed palettes rather than tinted rainbows.
  const PALETTES = {
    fire:     [[0.00, 1.00, 1.05], [0.04, 0.98, 1.0], [0.08, 0.95, 1.1], [0.12, 0.90, 0.9], [0.02, 1.00, 0.8]],
    ocean:    [[0.50, 0.95, 1.0], [0.55, 0.90, 0.95], [0.60, 0.85, 1.05], [0.47, 1.00, 0.9], [0.64, 0.80, 0.8]],
    sunset:   [[0.83, 0.90, 0.95], [0.93, 0.95, 1.0], [0.02, 1.00, 1.05], [0.07, 0.95, 1.0], [0.75, 0.85, 0.8]],
    candy:    [[0.90, 1.00, 1.05], [0.50, 0.95, 1.0], [0.14, 1.00, 1.0], [0.82, 0.90, 0.9], [0.45, 0.85, 0.85]],
    forest:   [[0.28, 0.90, 1.0], [0.35, 0.85, 0.9], [0.22, 0.95, 1.05], [0.40, 0.80, 0.85], [0.31, 1.00, 0.95]],
    aurora:   [[0.42, 1.00, 1.1], [0.50, 0.90, 0.95], [0.75, 0.85, 0.9], [0.36, 0.95, 1.0], [0.58, 0.70, 0.75]],
    vapor:    [[0.88, 0.80, 1.0], [0.52, 0.85, 1.0], [0.72, 0.60, 0.9], [0.95, 0.70, 0.95], [0.60, 0.75, 0.85]],
    gold:     [[0.11, 0.90, 1.1], [0.09, 0.70, 0.95], [0.13, 1.00, 1.0], [0.07, 0.55, 0.85], [0.10, 0.85, 0.9]],
    midnight: [[0.63, 0.95, 1.0], [0.68, 0.85, 0.85], [0.58, 1.00, 1.05], [0.72, 0.70, 0.75], [0.60, 0.40, 0.9]],
    coral:    [[0.02, 0.90, 1.05], [0.06, 0.85, 0.95], [0.48, 0.85, 0.95], [0.98, 0.80, 0.9], [0.52, 0.90, 0.85]],
    cosmos:   [[0.78, 0.95, 1.0], [0.65, 1.00, 0.95], [0.90, 0.90, 1.05], [0.12, 0.85, 0.9], [0.70, 0.80, 0.8]],
  };

  function api() { return {
    name: 'TUNNEL',

    init(_scene, _camera) {
      scene = _scene;
      camera = _camera;
      group = new THREE.Group();
      scene.add(group);

      scene.fog = new THREE.FogExp2(0x000208, 0.016);

      const geo = new THREE.BoxGeometry(1, 0.35, RING_SPACING * 0.82);
      // radial shading gradient baked into vertex colors (multiplies the
      // per-instance color): inner edge darker, outer edge brighter — the
      // segments read as lit, beveled material instead of flat paint
      {
        const pa = geo.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const t = 0.5 + (pa.getY(i) / 0.35 + 0.5) * 0.62;
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      }
      const mat = new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true });
      wall = new THREE.InstancedMesh(geo, mat, RINGS * SEGS);
      wall.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      wall.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * SEGS * 3), 3);
      wall.instanceColor.setUsage(THREE.DynamicDrawUsage);
      group.add(wall);

      for (let r = 0; r < RINGS; r++) {
        ringZ[r] = -r * RING_SPACING;
        ringSeed[r] = Math.random() * 1000;
      }

      // beat ring pool
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

      travel = 0;
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
    },

    // input: {x: -1..1, y: -1..1} from pointer/touch, only used in interactive mode
    setInput(x, y) { steerTarget.x = x; steerTarget.y = y; },

    // click/tap: fire a shockwave ring down the tube + flash the walls
    onTap() {
      tapFlash = 1;
      tapQueued = true;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow', pattern = 'spiral', hdr = 1.0 } = opts;

      // speed rides volume
      const speed = (10 + audio.volume * 55 * reactivity);
      travel += speed * dt;

      // tunnel path curves gently; attract mode drifts on its own
      const curveX = Math.sin(travel * 0.02) * 3 + Math.sin(travel * 0.007) * 5;
      const curveY = Math.cos(travel * 0.016) * 2.2;

      if (attract) {
        steerTarget.x = Math.sin(time * 0.4) * 0.4;
        steerTarget.y = Math.cos(time * 0.31) * 0.3;
      }
      steer.x += (steerTarget.x - steer.x) * Math.min(1, dt * 4);
      steer.y += (steerTarget.y - steer.y) * Math.min(1, dt * 4);

      // radius pulses with bass
      const baseRadius = 6;
      const radius = baseRadius * (1 + audio.bass * 0.5 * reactivity + audio.beatIntensity * 0.25 * reactivity);

      // recycle rings that passed behind the camera
      for (let r = 0; r < RINGS; r++) {
        let z = ringZ[r] + travel;
        if (z > RING_SPACING * 2) {
          ringZ[r] -= RINGS * RING_SPACING;
          ringSeed[r] = Math.random() * 1000;
          z = ringZ[r] + travel;
        }
      }

      // lay out wall segments
      let idx = 0;
      for (let r = 0; r < RINGS; r++) {
        const z = ringZ[r] + travel;
        const t = travel + ringZ[r]; // stable per-ring phase for curve offset
        const cx = Math.sin((travel - z) * 0.02) * 3 + Math.sin((travel - z) * 0.007) * 5 - curveX;
        const cy = Math.cos((travel - z) * 0.016) * 2.2 - curveY;
        // pattern controls how the rings lay out
        let twist;
        switch (pattern) {
          case 'stripes': twist = 0; break;                                   // aligned lanes
          case 'plaid':   twist = 0; break;                                   // aligned grid for crossing stripes
          case 'polka':   twist = 0; break;                                   // aligned grid for round dots
          case 'paisley': twist = Math.sin((travel + ringZ[r]) * 0.03) * 0.6 + travel * 0.004; break; // organic swirl
          case 'kaleido': twist = (r % 2 ? 1 : -1) * travel * 0.012; break;   // counter-rotating rings
          case 'checker': twist = (r % 2) * (Math.PI / SEGS); break;          // offset alternate rings
          default:        twist = ringSeed[r] * 0.1 + travel * 0.006;         // spiral (and waves)
        }

        for (let s = 0; s < SEGS; s++) {
          const a = (s / SEGS) * Math.PI * 2 + twist;
          // each sector driven by a band — blended with its neighbor so the
          // levels (and colors) flow around the ring instead of hard-stepping
          const bt = (s / SEGS) * BANDS.length;
          const b0 = Math.floor(bt) % BANDS.length;
          const b1 = (b0 + 1) % BANDS.length;
          const bf = bt - Math.floor(bt);
          const level = audio[BANDS[b0]] * (1 - bf) + audio[BANDS[b1]] * bf;
          let segRadius = radius * (1 + level * 0.18 * reactivity);
          if (pattern === 'waves') {
            segRadius += Math.sin(a * 3 + travel * 0.12) * (1 + audio.mid * 2 * reactivity);
          } else if (pattern === 'checker' && (r + s) % 2) {
            segRadius *= 1.12; // alternate segments sit proud of the wall
          }

          dummy.position.set(
            cx + Math.cos(a) * segRadius + steer.x * z * 0.06,
            cy + Math.sin(a) * segRadius + steer.y * z * 0.06,
            z
          );
          dummy.rotation.set(0, 0, a + Math.PI / 2);
          const w = (Math.PI * 2 * segRadius) / SEGS * 0.6;
          dummy.scale.set(w, 1 + level * 2.5 * reactivity, 1);
          dummy.updateMatrix();
          wall.setMatrixAt(idx, dummy.matrix);

          // color: hue base shifted per band, brightness from level.
          // Brightness compresses as reactivity rises (soft-clip) so cranking
          // the slider adds punch and motion without washing the scene white.
          // color mode controls how hue is dealt around the tube, plus the
          // color character (saturation + HDR boost)
          let h, sat = 1.0, boost = 1.0;
          switch (colorMode) {
            case 'mono':    h = (hue / 360) % 1; break;
            case 'duo':     h = ((hue / 360) + (s % 2) * 0.5) % 1; break;
            case 'triad':   h = ((hue / 360) + (s % 3) / 3) % 1; break;
            case 'cycle':   h = ((hue / 360) + time * 0.03 + (s % BANDS.length) * 0.045) % 1; break;
            case 'pastel':  h = ((hue / 360) + (s % BANDS.length) * 0.045) % 1; sat = 0.45; boost = 0.8; break;
            case 'neon':    h = ((hue / 360) + (s % 3) / 3) % 1; boost = 1.5; break;
            case 'random':  h = (ringSeed[r] * 7.13 + s * 0.618) % 1; break; // stable per ring/segment
            case 'glitter-gold': case 'glitter-silver': case 'glitter-rainbow': {
              if (colorMode === 'glitter-gold') { h = 0.10 + (s % 3) * 0.015; sat = 0.85; }
              else if (colorMode === 'glitter-silver') { h = 0.58; sat = 0.14; }
              else { h = (ringSeed[r] * 7.13 + s * 0.618) % 1; sat = 1.0; }
              // sequin flash: time-hashed sparkle — random slats catch the light
              const spark = Math.abs(Math.sin(ringSeed[r] * 91.7 + s * 57.31 + Math.floor(time * 14) * 13.7));
              if (spark > 0.84) {
                boost = 2.4 + audio.volume * 1.2;
                sat *= 0.45; // flash toward white-hot
              } else {
                boost = 0.75;
              }
              break;
            }
            default:
              if (PALETTES[colorMode]) {
                const stop = PALETTES[colorMode][(r + s) % PALETTES[colorMode].length];
                h = stop[0]; sat = stop[1]; boost = stop[2];
                break;
              }        h = ((hue / 360) + (s / SEGS) * 0.24 + audio.energy * 0.08) % 1; // rainbow, continuous
          }
          const drive = level * 0.55 * Math.sqrt(reactivity) + audio.beatIntensity * 0.1 + tapFlash * 0.15;
          // deep jewel-tone base: paper is light and opaque, glass is dark
          // until lit — keep quiet slats near-black so loud ones glow
          const lum = 0.03 + 0.4 * (1 - Math.exp(-2.2 * drive));
          // stable per-slat jitter so no two neighbors are the same flat swatch
          const jit = Math.abs(Math.sin(ringSeed[r] * 12.9898 + s * 78.233)) ;
          h = (h + (jit - 0.5) * 0.035 + 1) % 1;
          // HDR: full saturation, then push past 1.0 with the band level so
          // bloom glows in the segment's own color instead of washing white
          let weave = 1;
          if (pattern === 'paisley') {
            // curling bands: a swirl field over (angle, depth) — organic
            // teardrop-ish flow instead of straight stripes
            const swirl = Math.sin(a * 2 + Math.sin((travel - z) * 0.045) * 2.6 + travel * 0.015);
            weave = swirl > 0.25 ? 1.25 : (swirl > -0.35 ? 0.75 : 0.35);
            if (swirl > 0.25) h = (h + 0.07) % 1;
            else if (swirl < -0.35) h = (h + 0.5) % 1; // deep gaps flip complementary
          } else if (pattern === 'polka') {
            // round dots on a dark field, dot centers every 5x5 slats
            const dr = (r % 5) - 2, ds = (s % 5) - 2;
            const inDot = dr * dr + ds * ds <= 2.5;
            weave = inDot ? 1.35 : 0.22;
            if (inDot) h = (h + 0.5) % 1; // dots pop complementary to the field
          } else if (pattern === 'plaid') {
            const ringBand = (r % 6) < 3;          // stripes along the tube
            const segBand = (s % 4) < 2;           // stripes around the tube
            weave = ringBand && segBand ? 1.25 : (ringBand || segBand ? 0.85 : 0.45);
            if (ringBand !== segBand) h = (h + 0.06) % 1; // crossings shift hue like thread-over-thread
          }
          color.setHSL(h, sat, colorMode === 'pastel' ? lum + 0.12 : lum);
          // slats dim as they pass the camera so close walls never flood
          // the lens with bloom
          const proximityDim = Math.min(1, Math.max(0.12, -z / 16));
          // cap the HDR drive so peaks bloom in color instead of bleaching white
          // hdr scales how far colors are driven past standard range:
          // 0 = flat SDR, 1 = default, 2 = full superbright
          const rawDrive = Math.min(1.9, (0.55 + level * 1.9 * reactivity + audio.beatIntensity * 0.7 + tapFlash * 0.5) * boost * weave * (0.82 + jit * 0.36));
          const drive2 = 1 + (rawDrive - 1) * hdr;
          color.multiplyScalar(Math.max(0.15, drive2) * proximityDim);
          wall.setColorAt(idx, color);
          idx++;
        }
      }
      wall.instanceMatrix.needsUpdate = true;
      wall.instanceColor.needsUpdate = true;

      // beats spawn light rings ahead that rush past
      if (audio.beat) {
        const m = beatRings.find(b => !b.visible) || beatRings[0];
        m.visible = true;
        m.userData.fired = false;
        m.userData.z = -RINGS * RING_SPACING * 0.85 - travel; // spawn far ahead (in ring space)
        m.material.opacity = 1;
        color.setHSL(((hue / 360) + 0.5) % 1, 1.0, 0.55);
        color.multiplyScalar(1.4 + audio.beatIntensity * 1.2);
        m.material.color.copy(color);
      }

      // taps fire a shockwave ring from the camera down the tube
      if (tapQueued) {
        tapQueued = false;
        const m = beatRings.find(b => !b.visible) || beatRings[0];
        m.visible = true;
        m.userData.fired = true;
        m.userData.z = -1 - travel; // spawn just ahead of the camera
        m.material.opacity = 1;
        color.setHSL(((hue / 360) + 0.12) % 1, 1.0, 0.55);
        color.multiplyScalar(2.0);
        m.material.color.copy(color);
      }
      tapFlash *= Math.pow(0.02, dt); // fast decay

      for (const m of beatRings) {
        if (!m.visible) continue;
        if (m.userData.fired) m.userData.z -= 140 * dt; // race away from camera
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

      // camera: gentle sway + beat kick
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
      rings = []; beatRings = [];
    },
  }; }

  return api();
}
