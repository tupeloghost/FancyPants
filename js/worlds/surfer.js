// SURFER — infinite plane whose vertices displace from the frequency
// spectrum, so the terrain IS the waveform. One-button jump. Glowing wireframe.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=240';
import { themePaint } from '../lib/themes.js?v=240';


const COLS = 64;            // one column per spectrum bin
const ROWS = 96;            // rows of spectrum history scrolling toward camera
const WIDTH = 170, DEPTH = 260;
const ROW_INTERVAL = 0.035; // seconds between history rows

export function createSurfer() {
  let scene, camera, group, mesh, ceiling, sun, sunHalo, stars, sky;
  let steer = 0, steerTarget = 0;
  let jumpY = 0, jumpVel = 0;
  let rowTimer = 0, scrollOff = 0;
  let waveR = -1;             // tap shockwave position in row units (-1 = off)
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
      mesh.frustumCulled = false; // heights are rewritten every frame
      group.add(mesh);

      // mirrored ceiling — the same waveform hangs overhead, so the frame
      // is enclosed top and bottom like the tunnel. Shares geometry: free.
      ceiling = new THREE.Mesh(geo, mesh.material);
      ceiling.frustumCulled = false;
      ceiling.scale.y = -1;
      ceiling.position.y = 30;
      group.add(ceiling);

      // synthwave sun on the horizon — blooms hard, pulses with bass
      sun = new THREE.Mesh(
        new THREE.CircleGeometry(26, 48),
        new THREE.MeshBasicMaterial({ toneMapped: false, fog: false })
      );
      sun.position.set(0, 16, -230);
      group.add(sun);
      sunHalo = glowSprite(190);
      sunHalo.material.fog = false;
      sunHalo.position.copy(sun.position);
      sunHalo.position.z += 2;
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
      stars = new THREE.Points(sg, glowPoints(2.4, 0.8));
      stars.material.color.set(0xaabbee);
      stars.material.fog = false;
      group.add(stars);

      sky = skyDome(320);
      group.add(sky);

      camera.position.set(0, 10, 40);
      camera.rotation.set(0, 0, 0);
      camera.fov = 75;
      camera.updateProjectionMatrix();
    },

    setInput(x) { steerTarget = x; },

    // ghost riders share the terrain, staggered ahead of the camera
    placeGhost(p, i, out) {
      out.set(p.x * 42, 7 + p.y * 4 + Math.sin(i * 3.1) * 1.5, 18 - (i % 5) * 8);
    },

    onTap() {
      if (jumpY <= 0.01) jumpVel = 22; // one-button jump
      waveR = 0;                        // + a shockwave ridge racing to the horizon
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      const tp = this._tp || (this._tp = [0, 0, 0]);

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

      if (participants && participants[0]) {
        participants[0].x = steer;
        participants[0].y = jumpY / 12;
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
      // tap shockwave: a ridge of light racing from the camera to the horizon
      if (waveR >= 0) {
        waveR += dt * 90;
        if (waveR > ROWS + 8) waveR = -1;
      }

      const pos = mesh.geometry.attributes.position;
      const col = mesh.geometry.attributes.color;
      const rowScroll = rowTimer / ROW_INTERVAL;
      for (let r = 0; r < ROWS; r++) {
        const hRow = history[Math.min(ROWS - 1, r)];
        const hRowNext = history[Math.min(ROWS - 1, r + 1)];
        // row ROWS-1 is nearest the camera; the wave travels toward row 0
        let rowBump = 0;
        if (waveR >= 0) {
          const d = (ROWS - 1 - r) - waveR;
          rowBump = 8 * Math.exp(-(d * d) / 12) * (1 - waveR / (ROWS + 8));
        }
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const h = hRow[c] * (1 - rowScroll) + hRowNext[c] * rowScroll + rowBump;
          pos.setY(i, h);
          const t = Math.min(1, h / 14);
          // bright enough to cross the bloom threshold on peaks and beats;
          // the center "road" columns glow so the path reads
          const road = Math.exp(-Math.pow(c - COLS / 2, 2) / 16) * (0.1 + audio.volume * 0.12);
          const lum = 0.2 + t * 0.5 + audio.beatIntensity * 0.15 + road;
          // theme paints the terrain: u = height (sunset stacks correctly),
          // v = depth so themes flow toward the horizon
          const jitv = Math.abs(Math.sin(c * 12.9898 + r * 78.233));
          themePaint(colorMode, hue / 360, t, r * 0.08 + time * 0.15, time, t, jitv, tp);
          color.setHSL(tp[0], 0.9 * tp[1] + 0.1, Math.min(0.72, lum * Math.min(1.5, tp[2])));
          col.setXYZ(i, color.r, color.g, color.b);
        }
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;

      color.setHSL(((hue / 360) + 0.5) % 1, 0.6, 0.4 + audio.energy * 0.25);
      sky.material.color.copy(color);

      // sun pulses with bass, hue-complementary so it pops against the grid
      const sunScale = 1 + audio.bass * 0.35 * reactivity + audio.beatIntensity * 0.15;
      sun.scale.setScalar(sunScale);
      sunHalo.scale.setScalar(190 * sunScale * (1 + audio.beatIntensity * 0.25));
      color.setHSL(((hue / 360) + 0.5) % 1, 0.9, 0.55 + audio.bass * 0.15);
      sun.material.color.copy(color);
      sunHalo.material.color.copy(color);
      sunHalo.material.opacity = 0.55 + audio.beatIntensity * 0.4;

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
