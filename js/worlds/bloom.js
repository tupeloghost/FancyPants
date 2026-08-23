// BLOOM — you fly slowly through dark space; the garden grows around your
// path and persists. Every crystal is tuned to a frequency band and pulses
// with it, so the whole forest plays the track. Quiet = delicate, loud =
// explosive. No fail state.

import * as THREE from 'three';
import { glowSprite, glowPoints, glowTexture, skyDome } from '../lib/glow.js?v=578';
import { themePaint } from '../lib/themes.js?v=578';


const MAX_CRYSTALS = 3200;
const MAX_STEMS = 3200;
const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

export function createBloom() {
  let scene, camera, group;
  let crystals, stems, spores, ground, growerLight, tapFlashSprite, sky;
  let nCrystals = 0, nStems = 0;
  let spawnTimer = 0;
  let path = 0;                       // distance flown
  const camPos = new THREE.Vector3();
  const grower = new THREE.Vector3();
  const growerTarget = new THREE.Vector3();
  let pointer = { x: 0, y: 0, active: false };
  let burst = 0;
  const tapPoint = new THREE.Vector3();
  let tapFlash = 0, tapPlant = 0;
  const growing = [];                 // {idx, t, pos, size, rot}
  // per-crystal state for band pulsing (ring buffer at MAX)
  const cBand = new Uint8Array(MAX_CRYSTALS);
  const cHue = new Float32Array(MAX_CRYSTALS);
  const cSat = new Float32Array(MAX_CRYSTALS);
  const tpS = [0, 0, 0];
  const cLum = new Float32Array(MAX_CRYSTALS);
  const cPx = new Float32Array(MAX_CRYSTALS);
  const cPy = new Float32Array(MAX_CRYSTALS);
  const cPz = new Float32Array(MAX_CRYSTALS);
  const wave = { r: -1, x: 0, y: 0, z: 0 };  // tap shockwave through the garden
  let bubbles = [];                           // beat-emitted light bubbles
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  function place(pos, audio, hue, reactivity, big, colorMode, time) {
    const loud = audio.energy;
    const size = (0.22 + loud * 1.9 * reactivity) * (big ? 1.7 : 1) * (0.6 + Math.random() * 0.9);

    // stems only under the flight axis — overhead crystals float free
    if (pos.y < 0) {
    const si = nStems % MAX_STEMS;
    const h = size * (2.5 + Math.random() * 2);
    dummy.position.set(pos.x, pos.y - h / 2, pos.z);
    dummy.scale.set(size * 0.12, h, size * 0.12);
    dummy.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.35);
    dummy.updateMatrix();
    stems.setMatrixAt(si, dummy.matrix);
    color.setHSL(((hue / 360) + 0.32 + loud * 0.1) % 1, 0.7, 0.16 + loud * 0.25);
    stems.setColorAt(si, color);
    nStems++;
    stems.count = Math.min(nStems, MAX_STEMS);
    stems.instanceMatrix.needsUpdate = true;
    stems.instanceColor.needsUpdate = true;
    }

    const ci = nCrystals % MAX_CRYSTALS;
    const rot = [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI];
    dummy.position.copy(pos);
    dummy.scale.setScalar(0.01);
    dummy.rotation.set(rot[0], rot[1], rot[2]);
    dummy.updateMatrix();
    crystals.setMatrixAt(ci, dummy.matrix);
    cBand[ci] = Math.floor(Math.random() * BANDS.length);
    themePaint(colorMode || 'rainbow', hue / 360, Math.random(), pos.z * 0.015, time || 0, loud, Math.random(), tpS);
    cHue[ci] = tpS[0];
    cSat[ci] = tpS[1];
    cLum[ci] = (0.2 + loud * 0.25) * Math.min(1.4, tpS[2]);
    cPx[ci] = pos.x; cPy[ci] = pos.y; cPz[ci] = pos.z;
    growing.push({ idx: ci, t: 0, pos: pos.clone(), size, rot });
    nCrystals++;
    crystals.count = Math.min(nCrystals, MAX_CRYSTALS);
    crystals.instanceMatrix.needsUpdate = true;
  }

  return {
    name: 'BLOOM',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x030208, 0.012);

      const crysGeo = new THREE.IcosahedronGeometry(1, 0);
      const cvc = new Float32Array(crysGeo.attributes.position.count * 3);
      for (let i = 0; i < crysGeo.attributes.position.count; i++) {
        const t = 0.45 + (crysGeo.attributes.position.getY(i) + 1) * 0.35;
        cvc[i * 3] = t; cvc[i * 3 + 1] = t; cvc[i * 3 + 2] = t;
      }
      crysGeo.setAttribute('color', new THREE.BufferAttribute(cvc, 3));
      crystals = new THREE.InstancedMesh(
        crysGeo,
        new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true }),
        MAX_CRYSTALS
      );
      stems = new THREE.InstancedMesh(
        new THREE.ConeGeometry(1, 1, 5),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        MAX_STEMS
      );
      crystals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CRYSTALS * 3), 3);
      crystals.instanceColor.setUsage(THREE.DynamicDrawUsage);
      stems.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STEMS * 3), 3);
      crystals.count = 0; stems.count = 0;
      crystals.frustumCulled = false;
      stems.frustumCulled = false;
      nCrystals = 0; nStems = 0;
      growing.length = 0;
      group.add(crystals, stems);

      // spore field streams past the camera
      const spp = new Float32Array(800 * 3);
      for (let i = 0; i < 800; i++) {
        spp[i * 3] = (Math.random() - 0.5) * 90;
        spp[i * 3 + 1] = (Math.random() - 0.5) * 44;
        spp[i * 3 + 2] = (Math.random() - 0.5) * 160;
      }
      const spg = new THREE.BufferGeometry();
      spg.setAttribute('position', new THREE.BufferAttribute(spp, 3));
      spores = new THREE.Points(spg, glowPoints(0.9, 0.7));
      spores.frustumCulled = false;
      group.add(spores);

      growerLight = glowSprite(9);
      group.add(growerLight);
      tapFlashSprite = glowSprite(14);
      tapFlashSprite.material.opacity = 0;
      group.add(tapFlashSprite);

      // light bubbles the grower exhales on beats
      bubbles = [];
      for (let i = 0; i < 10; i++) {
        const b = glowSprite(2);
        b.material.opacity = 0;
        b.userData = { life: 0, vel: new THREE.Vector3() };
        group.add(b);
        bubbles.push(b);
      }
      wave.r = -1;

      ground = new THREE.Mesh(
        new THREE.CircleGeometry(180, 48),
        new THREE.MeshBasicMaterial({
          map: glowTexture(), toneMapped: false, transparent: true, opacity: 0.3,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -16;
      group.add(ground);

      sky = skyDome(300);
      group.add(sky);

      path = 0;
      camPos.set(0, 0, 0);
      grower.set(0, 0, -30);
      camera.fov = 72;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    // fellow gardeners drift around the flight path ahead
    placeGhost(p, i, out) {
      out.set(
        camPos.x + p.x * 12 + Math.cos(i * 2.4) * 9,
        camPos.y + p.y * 7 + Math.sin(i * 3.7) * 5,
        camPos.z - 28 - (i % 6) * 7
      );
    },

    onTap(x, y) {
      tapPoint.set(x, y, 0.5).unproject(camera);
      tapPoint.sub(camera.position).normalize().multiplyScalar(40).add(camera.position);
      tapFlash = 1;
      tapPlant = 12;
      // shockwave rolls out from the tap through everything already grown
      wave.r = 0;
      wave.x = tapPoint.x; wave.y = tapPoint.y; wave.z = tapPoint.z;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;

      // fly forward — speed rides the music, always moving
      path += dt * (4 + audio.volume * 16 * reactivity + audio.energy * 6);
      camPos.set(
        Math.sin(path * 0.02) * 16,
        2 + Math.sin(path * 0.013) * 5,
        -path
      );
      camera.position.lerp(camPos, Math.min(1, dt * 3));
      const lookAhead = new THREE.Vector3(
        Math.sin((path + 40) * 0.02) * 16 + (pointer.active && !attract ? pointer.x * 14 : 0),
        2 + Math.sin((path + 40) * 0.013) * 5 + (pointer.active && !attract ? pointer.y * 8 : 0),
        -path - 40
      );
      camera.lookAt(lookAhead);
      camera.rotation.z += Math.sin(path * 0.02) * -0.05; // gentle bank
      const fovT = 72 + audio.volume * 9 * reactivity + audio.beatIntensity * 5;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();

      if (participants && participants[0]) {
        participants[0].x = pointer.active ? pointer.x : Math.sin(time * 0.7) * 0.4;
        participants[0].y = pointer.active ? pointer.y : Math.sin(time * 0.5) * 0.3;
      }

      // grower rides ahead on the path axis; growth rings form around it
      growerTarget.set(
        camPos.x + Math.sin(time * 0.7) * 4,
        camPos.y + Math.sin(time * 0.5) * 3,
        camPos.z - 45
      );
      grower.lerp(growerTarget, Math.min(1, dt * 2));

      // growth cadence rides the music; silence grows nothing
      spawnTimer += dt;
      const interval = 0.28 - Math.min(0.22, audio.volume * 0.26 + audio.beatIntensity * 0.08);
      if ((spawnTimer >= interval && audio.volume > 0.03) || burst > 0) {
        spawnTimer = 0;
        const n = burst > 0 ? burst : (audio.beat ? 4 : 2);
        burst = 0;
        for (let i = 0; i < n; i++) {
          // grow in a loose cylinder AROUND the flight path — the garden
          // becomes a tunnel that assembles itself, walls and ceiling too
          const ang = Math.random() * Math.PI * 2;
          const rad = 10 + Math.random() * 9 + audio.volume * 6;
          const jitter = new THREE.Vector3(
            Math.cos(ang) * rad,
            Math.sin(ang) * rad * 0.75,
            (Math.random() - 0.5) * (6 + audio.volume * 14)
          );
          place(jitter.add(grower), audio, hue, reactivity, n > 3, colorMode, time);
        }
      }

      // tap planting
      if (tapPlant > 0) {
        for (let i = 0; i < tapPlant; i++) {
          const jitter = new THREE.Vector3(
            (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 7
          );
          place(jitter.add(tapPoint), audio, hue, reactivity, true, colorMode, time);
        }
        tapPlant = 0;
      }
      if (tapFlash > 0.01) {
        tapFlash *= Math.pow(0.03, dt);
        tapFlashSprite.position.copy(tapPoint);
        tapFlashSprite.scale.setScalar(14 * (1.6 - tapFlash * 0.6));
        color.setHSL(((hue / 360) + 0.1) % 1, 0.9, 0.6);
        tapFlashSprite.material.color.copy(color);
        tapFlashSprite.material.opacity = tapFlash * 0.85;
      } else {
        tapFlashSprite.material.opacity = 0;
      }

      // grow-in: pop past full size with a spin, then settle
      if (growing.length) {
        for (let i = growing.length - 1; i >= 0; i--) {
          const g = growing[i];
          g.t += dt * 2.4;
          const t = Math.min(1, g.t);
          const s = g.size * (t < 0.7 ? (t / 0.7) * 1.2 : 1.2 - 0.2 * ((t - 0.7) / 0.3));
          dummy.position.copy(g.pos);
          dummy.scale.setScalar(Math.max(0.01, s));
          dummy.rotation.set(g.rot[0], g.rot[1] + (1 - t) * 2.5, g.rot[2]);
          dummy.updateMatrix();
          crystals.setMatrixAt(g.idx, dummy.matrix);
          if (g.t >= 1) growing.splice(i, 1);
        }
        crystals.instanceMatrix.needsUpdate = true;
      }

      // tap shockwave sweeps outward
      if (wave.r >= 0) {
        wave.r += dt * 55;
        if (wave.r > 160) wave.r = -1;
      }

      // EVERY crystal pulses with its band — the forest plays the track —
      // and flares white-hot as the tap shockwave passes through it
      const nLive = Math.min(nCrystals, MAX_CRYSTALS);
      for (let i = 0; i < nLive; i++) {
        const level = audio[BANDS[cBand[i]]];
        let lum = cLum[i] + level * 0.4 * reactivity + audio.beatIntensity * 0.06;
        let sat = 0.85;
        if (wave.r >= 0) {
          const d = Math.abs(Math.sqrt(
            (cPx[i] - wave.x) ** 2 + (cPy[i] - wave.y) ** 2 + (cPz[i] - wave.z) ** 2
          ) - wave.r);
          if (d < 7) {
            const f = 1 - d / 7;
            lum += f * 0.45 * (1 - wave.r / 160);
            sat -= f * 0.4; // flare toward white
          }
        }
        color.setHSL(cHue[i], Math.max(0.3, Math.min(sat, cSat[i] + 0.1)), Math.min(0.75, lum));
        crystals.setColorAt(i, color);
      }
      if (nLive) crystals.instanceColor.needsUpdate = true;

      // grower exhales a light bubble on beats
      if (audio.beat) {
        const b = bubbles.find(x => x.userData.life <= 0);
        if (b) {
          b.userData.life = 1;
          b.position.copy(grower);
          b.userData.vel.set((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
        }
      }
      for (const b of bubbles) {
        if (b.userData.life <= 0) { b.material.opacity = 0; continue; }
        b.userData.life -= dt * 0.35;
        b.position.addScaledVector(b.userData.vel, dt);
        b.scale.setScalar(2 + (1 - b.userData.life) * 7);
        color.setHSL(((hue / 360) + 0.12) % 1, 0.85, 0.55);
        b.material.color.copy(color);
        b.material.opacity = Math.max(0, b.userData.life * 0.5);
      }

      // grower light leads the way
      growerLight.position.copy(grower);
      growerLight.scale.setScalar(9 * (1 + audio.volume * 1.4 * reactivity + audio.beatIntensity * 0.8));
      color.setHSL(((hue / 360) + 0.05) % 1, 0.85, 0.6);
      growerLight.material.color.copy(color);
      growerLight.material.opacity = 0.45 + audio.volume * 0.4 + audio.beatIntensity * 0.3;

      // spores stream past (wrap around the camera in z)
      const sp = spores.geometry.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        let z = sp.getZ(i);
        if (z > camPos.z + 20) sp.setZ(i, z - 160);
        else if (z < camPos.z - 140) sp.setZ(i, z + 160);
      }
      sp.needsUpdate = true;
      color.setHSL(((hue / 360) + 0.4) % 1, 0.7, 0.35 + audio.high * 0.35);
      spores.material.color.copy(color);
      spores.material.size = 0.9 + audio.high * 0.5;

      // sky, ground pool follow the flight
      sky.position.copy(camera.position);
      color.setHSL(((hue / 360) + 0.35) % 1, 0.6, 0.3 + audio.energy * 0.25);
      sky.material.color.copy(color);
      ground.position.x = camPos.x;
      ground.position.z = camPos.z - 40;
      color.setHSL((hue / 360) % 1, 0.7, 0.3 + audio.bass * 0.2);
      ground.material.color.copy(color);
      ground.material.opacity = 0.22 + audio.volume * 0.2;
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
