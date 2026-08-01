// BLOOM — dark space, no fail state. Moving through it grows procedural
// crystals whose scale and color ride the music. Quiet = delicate, loud =
// explosive. Growth persists for the whole session (until world switch).

import * as THREE from 'three';
import { glowSprite, glowPoints } from '../lib/glow.js';

const MAX_CRYSTALS = 2600;
const MAX_STEMS = 2600;

export function createBloom() {
  let scene, camera, group;
  let crystals, stems, spores, ground, growerLight;
  let nCrystals = 0, nStems = 0;
  const recentIdx = [];      // most recent crystals pulse with the beat
  const recentHue = [];
  let spawnTimer = 0;
  let grower = new THREE.Vector3();
  let growerTarget = new THREE.Vector3();
  let pointer = { x: 0, y: 0, active: false };
  let burst = 0;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  function place(pos, audio, hue, reactivity, big) {
    const loud = audio.energy;
    const size = (0.14 + loud * 1.6 * reactivity) * (big ? 1.6 : 1) * (0.6 + Math.random() * 0.8);

    if (nStems < MAX_STEMS) {
      // stem: thin cone reaching up to the bloom
      const h = size * (2.5 + Math.random() * 2);
      dummy.position.set(pos.x, pos.y - h / 2, pos.z);
      dummy.scale.set(size * 0.12, h, size * 0.12);
      dummy.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.35);
      dummy.updateMatrix();
      stems.setMatrixAt(nStems, dummy.matrix);
      color.setHSL(((hue / 360) + 0.32 + loud * 0.1) % 1, 0.7, 0.16 + loud * 0.25);
      stems.setColorAt(nStems, color);
      nStems++;
      stems.count = nStems;
      stems.instanceMatrix.needsUpdate = true;
      stems.instanceColor.needsUpdate = true;
    }

    if (nCrystals < MAX_CRYSTALS) {
      dummy.position.copy(pos);
      dummy.scale.setScalar(size);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.updateMatrix();
      crystals.setMatrixAt(nCrystals, dummy.matrix);
      // quiet passages → cool dim tones; loud → hot bright shifted hue
      const crystalHue = ((hue / 360) + audio.mid * 0.25 + Math.random() * 0.06) % 1;
      color.setHSL(crystalHue, 0.85, 0.3 + loud * 0.42);
      crystals.setColorAt(nCrystals, color);
      recentIdx.push(nCrystals);
      recentHue.push(crystalHue);
      if (recentIdx.length > 24) { recentIdx.shift(); recentHue.shift(); }
      nCrystals++;
      crystals.count = nCrystals;
      crystals.instanceMatrix.needsUpdate = true;
      crystals.instanceColor.needsUpdate = true;
    }
  }

  return {
    name: 'BLOOM',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x010104, 0.02);

      crystals = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        MAX_CRYSTALS
      );
      stems = new THREE.InstancedMesh(
        new THREE.ConeGeometry(1, 1, 5),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        MAX_STEMS
      );
      crystals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CRYSTALS * 3), 3);
      stems.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STEMS * 3), 3);
      crystals.count = 0; stems.count = 0;
      nCrystals = 0; nStems = 0;
      recentIdx.length = 0; recentHue.length = 0;
      group.add(crystals, stems);

      // drifting spores fill the dark
      const spp = new Float32Array(500 * 3);
      for (let i = 0; i < 500; i++) {
        spp[i * 3] = (Math.random() - 0.5) * 70;
        spp[i * 3 + 1] = (Math.random() - 0.5) * 34;
        spp[i * 3 + 2] = (Math.random() - 0.5) * 70;
      }
      const spg = new THREE.BufferGeometry();
      spg.setAttribute('position', new THREE.BufferAttribute(spp, 3));
      spores = new THREE.Points(spg, glowPoints(0.9, 0.7));
      group.add(spores);

      // the grower is a visible wandering light — the world's focal point
      growerLight = glowSprite(9);
      group.add(growerLight);

      // faint ground disc so the garden sits somewhere
      ground = new THREE.Mesh(
        new THREE.CircleGeometry(75, 48),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -15;
      group.add(ground);

      grower.set(0, 0, 0);
      camera.fov = 70;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    onTap() { burst = 8; }, // plant a burst wherever the grower is

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time } = opts;

      // grower drifts on its own in attract mode, follows pointer otherwise
      if (attract || !pointer.active) {
        growerTarget.set(
          Math.sin(time * 0.21) * 22 + Math.sin(time * 0.07) * 8,
          Math.sin(time * 0.16) * 9,
          Math.cos(time * 0.13) * 22
        );
      } else {
        growerTarget.set(pointer.x * 26, pointer.y * 12, Math.sin(time * 0.1) * 12);
      }
      grower.lerp(growerTarget, Math.min(1, dt * 1.5));

      // growth cadence rides the music; silence grows nothing
      spawnTimer += dt;
      const interval = 0.4 - Math.min(0.32, audio.volume * 0.36 + audio.beatIntensity * 0.1);
      if ((spawnTimer >= interval && audio.volume > 0.03) || burst > 0) {
        spawnTimer = 0;
        const n = burst > 0 ? burst : (audio.beat ? 3 : 1);
        burst = 0;
        for (let i = 0; i < n; i++) {
          const jitter = new THREE.Vector3(
            (Math.random() - 0.5) * (2 + audio.volume * 9),
            (Math.random() - 0.5) * (2 + audio.volume * 6),
            (Math.random() - 0.5) * (2 + audio.volume * 9)
          );
          place(jitter.add(grower), audio, hue, reactivity, n > 2);
        }
      }

      // recent growth pulses with the beat — the garden feels alive
      if (recentIdx.length) {
        const boost = audio.beatIntensity * 0.3 + audio.bass * 0.12;
        for (let i = 0; i < recentIdx.length; i++) {
          const age = i / recentIdx.length; // older → dimmer pulse
          color.setHSL(recentHue[i], 0.85, Math.min(0.75, 0.32 + audio.energy * 0.4 + boost * age));
          crystals.setColorAt(recentIdx[i], color);
        }
        crystals.instanceColor.needsUpdate = true;
      }

      // grower light breathes with the music and flares on beats
      growerLight.position.copy(grower);
      growerLight.scale.setScalar(9 * (1 + audio.volume * 1.4 * reactivity + audio.beatIntensity * 0.8));
      color.setHSL(((hue / 360) + 0.05) % 1, 0.85, 0.6);
      growerLight.material.color.copy(color);
      growerLight.material.opacity = 0.45 + audio.volume * 0.4 + audio.beatIntensity * 0.3;

      // spores drift up and shimmer with the highs
      spores.rotation.y += dt * 0.03;
      spores.position.y = Math.sin(time * 0.1) * 2;
      color.setHSL(((hue / 360) + 0.4) % 1, 0.7, 0.35 + audio.high * 0.35);
      spores.material.color.copy(color);
      spores.material.size = 0.28 + audio.high * 0.35;

      color.setHSL((hue / 360) % 1, 0.5, 0.02 + audio.bass * 0.03);
      ground.material.color.copy(color);

      // slow orbit camera around the garden
      const r = 44 + Math.sin(time * 0.05) * 8;
      camera.position.set(Math.sin(time * 0.045) * r, 10 + Math.sin(time * 0.08) * 5, Math.cos(time * 0.045) * r);
      camera.lookAt(0, 0, 0);
      const fovTarget = 70 + audio.bass * 6 * reactivity;
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
