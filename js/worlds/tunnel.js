// TUNNEL — infinite tube flight.
// Radius pulses with bass, wall segments colored by frequency band,
// camera speed rides volume, beats spawn light rings rushing past.

import * as THREE from 'three';

const RINGS = 60;           // rings alive at once
const SEGS = 18;            // wall segments per ring
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

  function api() { return {
    name: 'TUNNEL',

    init(_scene, _camera) {
      scene = _scene;
      camera = _camera;
      group = new THREE.Group();
      scene.add(group);

      scene.fog = new THREE.FogExp2(0x000208, 0.016);

      const geo = new THREE.BoxGeometry(1, 0.35, RING_SPACING * 0.82);
      const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
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
      const { reactivity, hue, attract, time } = opts;

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
        const twist = ringSeed[r] * 0.1 + travel * 0.006;

        for (let s = 0; s < SEGS; s++) {
          const a = (s / SEGS) * Math.PI * 2 + twist;
          // each sector driven by a band
          const band = BANDS[s % BANDS.length];
          const level = audio[band];
          const segRadius = radius * (1 + level * 0.18 * reactivity);

          dummy.position.set(
            cx + Math.cos(a) * segRadius + steer.x * z * 0.06,
            cy + Math.sin(a) * segRadius + steer.y * z * 0.06,
            z
          );
          dummy.rotation.set(0, 0, a + Math.PI / 2);
          const w = (Math.PI * 2 * segRadius) / SEGS * 0.78;
          dummy.scale.set(w, 1 + level * 2.5 * reactivity, 1);
          dummy.updateMatrix();
          wall.setMatrixAt(idx, dummy.matrix);

          // color: hue base shifted per band, brightness from level.
          // Brightness compresses as reactivity rises (soft-clip) so cranking
          // the slider adds punch and motion without washing the scene white.
          const bandShift = (s % BANDS.length) * 0.045;
          const h = ((hue / 360) + bandShift + audio.energy * 0.08) % 1;
          const drive = level * 0.55 * Math.sqrt(reactivity) + audio.beatIntensity * 0.1 + tapFlash * 0.15;
          const lum = 0.05 + 0.58 * (1 - Math.exp(-2.2 * drive));
          color.setHSL(h, 0.85, lum);
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
        color.setHSL(((hue / 360) + 0.5) % 1, 0.9, 0.6 + audio.beatIntensity * 0.2);
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
        color.setHSL(((hue / 360) + 0.12) % 1, 0.95, 0.7);
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
