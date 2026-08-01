// SURFER — infinite plane whose vertices displace from the frequency
// spectrum, so the terrain IS the waveform. One-button jump. Glowing wireframe.

import * as THREE from 'three';

const COLS = 64;            // one column per spectrum bin
const ROWS = 96;            // rows of spectrum history scrolling toward camera
const WIDTH = 170, DEPTH = 260;
const ROW_INTERVAL = 0.035; // seconds between history rows

export function createSurfer() {
  let scene, camera, group, mesh, sun, sunHalo, stars;
  let steer = 0, steerTarget = 0;
  let jumpY = 0, jumpVel = 0;
  let rowTimer = 0, scrollOff = 0;
  const history = [];       // ring of Float32Array(COLS), newest first
  for (let r = 0; r < ROWS; r++) history.push(new Float32Array(COLS));
  const color = new THREE.Color();

  return {
    name: 'SURFER',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x010208, 0.008);

      const geo = new THREE.PlaneGeometry(WIDTH, DEPTH, COLS - 1, ROWS - 1);
      geo.rotateX(-Math.PI / 2);
      const colors = new Float32Array(geo.attributes.position.count * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ wireframe: true, vertexColors: true, toneMapped: false })
      );
      group.add(mesh);

      // synthwave sun on the horizon — blooms hard, pulses with bass
      sun = new THREE.Mesh(
        new THREE.CircleGeometry(26, 48),
        new THREE.MeshBasicMaterial({ toneMapped: false, fog: false })
      );
      sun.position.set(0, 16, -230);
      group.add(sun);
      sunHalo = new THREE.Mesh(
        new THREE.RingGeometry(26, 44, 48),
        new THREE.MeshBasicMaterial({ toneMapped: false, fog: false, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
      );
      sunHalo.position.copy(sun.position);
      group.add(sunHalo);

      // stars above the horizon
      const sp = new Float32Array(400 * 3);
      for (let i = 0; i < 400; i++) {
        sp[i * 3] = (Math.random() - 0.5) * 500;
        sp[i * 3 + 1] = 20 + Math.random() * 160;
        sp[i * 3 + 2] = -260 + Math.random() * 60;
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.1, color: 0xaabbee, toneMapped: false, fog: false }));
      group.add(stars);

      camera.position.set(0, 10, 40);
      camera.rotation.set(0, 0, 0);
      camera.fov = 75;
      camera.updateProjectionMatrix();
    },

    setInput(x) { steerTarget = x; },

    onTap() {
      if (jumpY <= 0.01) jumpVel = 22; // one-button jump
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time } = opts;

      // push a new spectrum row at a fixed cadence; terrain scrolls between rows
      rowTimer += dt * (0.6 + audio.volume * 1.2); // music speeds the world up
      while (rowTimer >= ROW_INTERVAL) {
        rowTimer -= ROW_INTERVAL;
        const row = history.pop();
        const amp = (5 + audio.bass * 16 * reactivity);
        for (let c = 0; c < COLS; c++) {
          // mirror the spectrum so the lows rise at the road's edges and
          // the center stays surfable
          const bin = Math.min(63, Math.floor(Math.abs(c - COLS / 2) * 2));
          row[c] = audio.spectrum[bin] * amp * (0.35 + Math.abs(c - COLS / 2) / (COLS / 2));
        }
        history.unshift(row);
      }

      // steering / attract drift
      if (attract) steerTarget = Math.sin(time * 0.25) * 0.5;
      steer += (steerTarget - steer) * Math.min(1, dt * 3);

      // jump physics
      if (jumpY > 0 || jumpVel > 0) {
        jumpVel -= 60 * dt;
        jumpY = Math.max(0, jumpY + jumpVel * dt);
        if (jumpY === 0) jumpVel = 0;
      } else if (attract && audio.beat && audio.beatIntensity > 0.6) {
        jumpVel = 16 + audio.beatIntensity * 10; // auto-hop on hard beats
      }

      // write heights + colors
      const pos = mesh.geometry.attributes.position;
      const col = mesh.geometry.attributes.color;
      const rowScroll = rowTimer / ROW_INTERVAL;
      for (let r = 0; r < ROWS; r++) {
        const hRow = history[Math.min(ROWS - 1, r)];
        const hRowNext = history[Math.min(ROWS - 1, r + 1)];
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const h = hRow[c] * (1 - rowScroll) + hRowNext[c] * rowScroll;
          pos.setY(i, h);
          const t = Math.min(1, h / 14);
          // bright enough to cross the bloom threshold on peaks and beats
          const lum = 0.2 + t * 0.5 + audio.beatIntensity * 0.15;
          color.setHSL(((hue / 360) + t * 0.14 + r * 0.0008) % 1, 0.9, Math.min(0.72, lum));
          col.setXYZ(i, color.r, color.g, color.b);
        }
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;

      // sun pulses with bass, hue-complementary so it pops against the grid
      const sunScale = 1 + audio.bass * 0.35 * reactivity + audio.beatIntensity * 0.15;
      sun.scale.setScalar(sunScale);
      sunHalo.scale.setScalar(sunScale * (1.05 + audio.beatIntensity * 0.3));
      color.setHSL(((hue / 360) + 0.5) % 1, 0.9, 0.55 + audio.bass * 0.15);
      sun.material.color.copy(color);
      sunHalo.material.color.copy(color);
      sunHalo.material.opacity = 0.2 + audio.beatIntensity * 0.5;

      // camera rides the wave
      const camH = 9 + audio.volume * 5 * reactivity + jumpY;
      camera.position.set(steer * 40, camH, 40);
      camera.lookAt(steer * 30, 3 + jumpY * 0.4, -60);
      camera.rotation.z += steer * -0.1 + Math.sin(time * 0.4) * 0.015;
      const fovT = 75 + audio.volume * 10 * reactivity + audio.beatIntensity * 5;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
