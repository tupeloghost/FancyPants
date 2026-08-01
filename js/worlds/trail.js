// TRAIL — you leave a persistent glowing ribbon. Width from volume, hue from
// the dominant frequency band. Never fades. (PNG export: press S — shell-level.)

import * as THREE from 'three';

const MAX_POINTS = 14000;   // capped total segment count
const MIN_DIST = 0.22;

const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];
const BAND_HUE_SHIFT = [0, 0.09, 0.18, 0.3, 0.42];

export function createTrail() {
  let scene, camera, group, ribbon;
  let nPoints = 0;
  let head = new THREE.Vector3();
  let headTarget = new THREE.Vector3();
  let prev = new THREE.Vector3();
  let pointer = { x: 0, y: 0, active: false };
  let kick = 0;
  const color = new THREE.Color();
  const tmpDir = new THREE.Vector3();
  const tmpSide = new THREE.Vector3();
  const toCam = new THREE.Vector3();

  return {
    name: 'TRAIL',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;

      // ribbon as a triangle strip: 2 verts per path point
      const pos = new Float32Array(MAX_POINTS * 2 * 3);
      const col = new Float32Array(MAX_POINTS * 2 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
      const index = [];
      for (let i = 0; i < MAX_POINTS - 1; i++) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        index.push(a, b, c, b, d, c);
      }
      geo.setIndex(index);
      geo.setDrawRange(0, 0);
      ribbon = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false })
      );
      ribbon.frustumCulled = false;
      group.add(ribbon);

      nPoints = 0;
      head.set(0, 0, 0);
      prev.copy(head);
      camera.fov = 70;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    onTap() { kick = 1; }, // width surge rides down the next stretch

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time } = opts;

      // head path: lissajous drift in attract, pointer-driven otherwise
      if (attract || !pointer.active) {
        headTarget.set(
          Math.sin(time * 0.34) * 20 + Math.sin(time * 0.11) * 9,
          Math.sin(time * 0.27) * 11 + Math.cos(time * 0.07) * 4,
          Math.cos(time * 0.19) * 16
        );
      } else {
        headTarget.set(pointer.x * 24, pointer.y * 13, Math.sin(time * 0.15) * 10);
      }
      head.lerp(headTarget, Math.min(1, dt * (attract ? 1.2 : 3.5)));
      kick *= Math.pow(0.05, dt);

      // append ribbon points as the head moves
      if (nPoints < MAX_POINTS && head.distanceTo(prev) > MIN_DIST) {
        tmpDir.subVectors(head, prev).normalize();
        toCam.subVectors(camera.position, head).normalize();
        tmpSide.crossVectors(tmpDir, toCam).normalize();

        // dominant band picks the hue
        let domIdx = 0, domVal = -1;
        for (let i = 0; i < BANDS.length; i++) {
          if (audio[BANDS[i]] > domVal) { domVal = audio[BANDS[i]]; domIdx = i; }
        }
        const width = (0.12 + audio.volume * 1.7 * reactivity) * (1 + kick * 2.2);
        color.setHSL(((hue / 360) + BAND_HUE_SHIFT[domIdx]) % 1, 0.9, 0.3 + audio.volume * 0.4 + kick * 0.2);

        const pos = ribbon.geometry.attributes.position;
        const col = ribbon.geometry.attributes.color;
        const i2 = nPoints * 2;
        pos.setXYZ(i2, head.x + tmpSide.x * width, head.y + tmpSide.y * width, head.z + tmpSide.z * width);
        pos.setXYZ(i2 + 1, head.x - tmpSide.x * width, head.y - tmpSide.y * width, head.z - tmpSide.z * width);
        col.setXYZ(i2, color.r, color.g, color.b);
        col.setXYZ(i2 + 1, color.r, color.g, color.b);
        pos.needsUpdate = true;
        col.needsUpdate = true;
        nPoints++;
        ribbon.geometry.setDrawRange(0, Math.max(0, (nPoints - 1) * 6));
        prev.copy(head);
      }

      // slow orbit camera
      const r = 42 + Math.sin(time * 0.06) * 6;
      camera.position.set(Math.sin(time * 0.05) * r, 8 + Math.sin(time * 0.09) * 6, Math.cos(time * 0.05) * r);
      camera.lookAt(0, 0, 0);
    },

    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
