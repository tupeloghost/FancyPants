// TUNNEL — infinite tube flight.
// Radius pulses with bass, wall elements colored by frequency band,
// camera speed rides volume, beats spawn light rings rushing past.
// Shape option controls BOTH the wall elements and the tunnel's
// cross-section silhouette. Color modes are themed behaviors, not tints.

import * as THREE from 'three';

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

  const ringZ = new Float32Array(RINGS);
  const ringSeed = new Float32Array(RINGS);

  let tapFlash = 0;
  let tapQueued = false;

  const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

  // complementary duotone gradients: [hue, sat, weight] stops, interpolated
  const PALETTES = {
    'blue-orange':  [[0.58, 1.00, 1.0], [0.08, 1.00, 1.05]],
    'violet-gold':  [[0.75, 0.95, 1.0], [0.12, 1.00, 1.05]],
    'teal-coral':   [[0.48, 0.95, 1.0], [0.02, 0.90, 1.0]],
    'lime-magenta': [[0.33, 1.00, 1.0], [0.87, 0.95, 1.05]],
    'ice-fire':     [[0.55, 0.90, 1.05], [0.00, 1.00, 1.1]],
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

      travel = 0;
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
    },

    setInput(x, y) { steerTarget.x = x; steerTarget.y = y; },

    onTap() {
      tapFlash = 1;
      tapQueued = true;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow', pattern = 'spiral', hdr = 1.0, shape = 'slat' } = opts;

      // live shape swap
      if (shape !== currentShape) {
        currentShape = shape;
        wall.geometry.dispose();
        wall.geometry = makeShapeGeo(shape);
      }
      const isSlat = shape === 'slat';

      const speed = (10 + audio.volume * 55 * reactivity);
      travel += speed * dt;

      const curveX = Math.sin(travel * 0.02) * 3 + Math.sin(travel * 0.007) * 5;
      const curveY = Math.cos(travel * 0.016) * 2.2;

      if (attract) {
        steerTarget.x = Math.sin(time * 0.4) * 0.4;
        steerTarget.y = Math.cos(time * 0.31) * 0.3;
      }
      steer.x += (steerTarget.x - steer.x) * Math.min(1, dt * 4);
      steer.y += (steerTarget.y - steer.y) * Math.min(1, dt * 4);

      const baseRadius = 6;
      const radius = baseRadius * (1 + audio.bass * 0.5 * reactivity + audio.beatIntensity * 0.25 * reactivity);

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
          case 'kaleido': twist = (r % 2 ? 1 : -1) * travel * 0.012; break;
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

          switch (colorMode) {
            case 'mono':
              h = ((hue / 360) + depthT * 0.3) % 1;
              break;
            case 'pastel':
              h = ((hue / 360) + (s / SEGS) * 0.5 + depthT * 0.4) % 1;
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
                h = (0.72 + 0.16 * Math.sin((travel - z) * 0.05 + a * 0.8)) % 1;
                sat = 0.85;
                boost = 0.18 + level * 0.25; // nebula stays dim
              }
              break;
            }
            case 'glitter': {
              // sequins: dark champagne field, small subset flashing white-hot
              const spark = Math.abs(Math.sin(ringSeed[r] * 91.7 + s * 57.31 + Math.floor(time * 24) * 7.7));
              if (spark > 0.9) { h = 0.11; sat = 0.15; boost = 3.0 + audio.volume; }
              else { h = 0.10 + jit * 0.03; sat = 0.7; boost = 0.42; }
              break;
            }
            default:
              if (PALETTES[colorMode]) {
                palLerp(PALETTES[colorMode], (s / SEGS) + depthT + time * 0.012, palOut);
                h = palOut[0]; sat = palOut[1]; boost = palOut[2];
              } else {
                // rainbow: full wheel around the tube + depth + energy drift
                h = ((hue / 360) + (s / SEGS) + depthT * 0.6 + audio.energy * 0.1) % 1;
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
            weave = swirl > 0.25 ? 1.25 : (swirl > -0.35 ? 0.75 : 0.35);
            if (!themed) {
              if (swirl > 0.25) h = (h + 0.07) % 1;
              else if (swirl < -0.35) h = (h + 0.5) % 1;
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
            weave = 0.15 + 1.25 * edge;
            if (edge > 0.4 && !themed) h = (h + 0.5) % 1;
          } else if (pattern === 'plaid') {
            const ringBand = (r % 6) < 3;
            const segBand = (s % 4) < 2;
            weave = ringBand && segBand ? 1.25 : (ringBand || segBand ? 0.85 : 0.45);
            if (ringBand !== segBand && !themed) h = (h + 0.06) % 1;
          }
          if (themed) weave = 1 + (weave - 1) * 0.35; // gentle texture only

          const drive = level * 0.55 * Math.sqrt(reactivity) + audio.beatIntensity * 0.1 + tapFlash * 0.15;
          const lum = 0.03 + 0.4 * (1 - Math.exp(-2.2 * drive));
          color.setHSL(h, sat, colorMode === 'pastel' ? lum + 0.12 : lum);

          const proximityDim = Math.min(1, Math.max(0.12, -z / 16));
          const rawDrive = Math.min(1.9, (0.55 + level * 1.9 * reactivity + audio.beatIntensity * 0.7 + tapFlash * 0.5) * boost * weave * (0.82 + jit * 0.36));
          const drive2 = 1 + (rawDrive - 1) * hdr;
          color.multiplyScalar(Math.max(0.15, drive2) * proximityDim);
          wall.setColorAt(idx, color);
          idx++;
        }
      }
      wall.instanceMatrix.needsUpdate = true;
      wall.instanceColor.needsUpdate = true;

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
