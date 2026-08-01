// LAVA LAMP — slow blobs of light rising and sinking in a warm column.
// Bass heats the lamp (blobs rise faster, swell); quiet lets them settle.
// Tap pokes the nearest blob. The most patient world in the set.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const BLOBS = 13;
const HEIGHT = 26;          // travel range of the blobs

export function createLavaLamp() {
  let scene, camera, group, sky, glassGlow, motes;
  const blobs = [];          // {mesh, halo, y, vy, size, phase, poke}
  const tp = [0, 0, 0];
  const color = new THREE.Color();
  let pointer = { x: 0, y: 0, active: false };

  return {
    name: 'LAVA LAMP',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;

      blobs.length = 0;
      for (let i = 0; i < BLOBS; i++) {
        const size = 2.2 + Math.random() * 3.4;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(1, 24, 24),
          new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.92 })
        );
        const halo = glowSprite(size * 3.4);
        group.add(mesh, halo);
        blobs.push({
          mesh, halo,
          y: -HEIGHT / 2 + Math.random() * HEIGHT,
          vy: 0,
          size,
          phase: Math.random() * 100,
          poke: 0,
        });
      }

      // faint columns of light suggest the glass
      glassGlow = glowSprite(70);
      glassGlow.material.opacity = 0.1;
      group.add(glassGlow);

      // tiny motes suspended in the fluid
      const mp = new Float32Array(160 * 3);
      for (let i = 0; i < 160; i++) {
        mp[i * 3] = (Math.random() - 0.5) * 22;
        mp[i * 3 + 1] = (Math.random() - 0.5) * HEIGHT * 1.2;
        mp[i * 3 + 2] = (Math.random() - 0.5) * 22;
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      motes = new THREE.Points(mg, glowPoints(0.5, 0.5));
      group.add(motes);

      sky = skyDome(200);
      group.add(sky);

      camera.fov = 66;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    // fellow watchers drift as small bubbles around the lamp
    placeGhost(p, i, out) {
      const a = (this._t || 0) * 0.25 + i * 1.9;
      out.set(Math.cos(a) * (20 + p.x * 5), (p.y * 0.5 + Math.sin(a * 0.7)) * HEIGHT * 0.45, Math.sin(a) * (20 + p.x * 5));
    },

    // tap: poke the blob nearest the click ray — it wobbles and dives
    onTap(x, y) {
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      let best = null, bestD = 1e9;
      for (const b of blobs) {
        const toB = new THREE.Vector3(b.mesh.position.x, b.y, b.mesh.position.z).sub(camera.position);
        const d = toB.clone().cross(dir).length(); // distance from ray
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best) { best.poke = 1; best.vy += (Math.random() > 0.5 ? 8 : -8); }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      this._t = time;

      if (participants && participants[0]) {
        participants[0].x = pointer.active ? pointer.x : Math.sin(time * 0.3) * 0.4;
        participants[0].y = pointer.active ? pointer.y : 0;
      }

      // heat = bass. Hot blobs rise, cool ones sink — classic lamp physics
      const heat = audio.bass * reactivity;
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        const buoy = Math.sin(time * 0.11 + b.phase) * 1.4 + heat * 3.2 - 1.1;
        b.vy += (buoy - b.vy) * Math.min(1, dt * 0.5);
        b.y += b.vy * dt;
        if (b.y > HEIGHT / 2) { b.y = HEIGHT / 2; b.vy = -Math.abs(b.vy) * 0.4; }
        if (b.y < -HEIGHT / 2) { b.y = -HEIGHT / 2; b.vy = Math.abs(b.vy) * 0.4; }
        b.poke *= Math.pow(0.05, dt);

        const wob = 1 + Math.sin(time * 1.7 + b.phase * 3) * 0.08 + audio.bass * 0.25 * reactivity + b.poke * 0.35;
        const x = Math.sin(time * 0.13 + b.phase) * 7;
        const z = Math.cos(time * 0.1 + b.phase * 1.7) * 7;
        b.mesh.position.set(x, b.y, z);
        // blobs stretch vertically as they move — lava, not balloons
        b.mesh.scale.set(b.size * wob, b.size * wob * (1 + Math.abs(b.vy) * 0.05 + b.poke * 0.3), b.size * wob);
        b.halo.position.copy(b.mesh.position);
        b.halo.scale.setScalar(b.size * 3.4 * wob);

        // color: u = height (sunset stacks beautifully), themed like everything
        const uy = (b.y + HEIGHT / 2) / HEIGHT;
        themePaint(colorMode, hue / 360, uy, i * 0.4, time, heat, (b.phase % 1), tp);
        color.setHSL(tp[0], tp[1], Math.min(0.68, (0.3 + heat * 0.3 + b.poke * 0.2) * Math.min(1.5, tp[2])));
        b.mesh.material.color.copy(color);
        b.halo.material.color.copy(color);
        b.halo.material.opacity = 0.3 + heat * 0.3 + b.poke * 0.3;
      }

      // fluid glow + motes
      themePaint(colorMode, hue / 360, 0.5, 0, time, heat, 0.5, tp);
      color.setHSL(tp[0], tp[1] * 0.7, 0.35);
      glassGlow.material.color.copy(color);
      glassGlow.material.opacity = 0.07 + heat * 0.1;
      motes.material.color.copy(color);
      motes.material.size = 0.5 + audio.high * 0.5;
      motes.rotation.y += dt * 0.04;
      sky.position.copy(camera.position);
      color.setHSL(tp[0], tp[1] * 0.5, 0.16 + audio.energy * 0.12);
      sky.material.color.copy(color);

      // slow orbit, gentle breathing zoom
      const r = 34 - audio.bass * 4;
      camera.position.set(Math.sin(time * 0.05) * r, Math.sin(time * 0.07) * 6, Math.cos(time * 0.05) * r);
      camera.lookAt(0, 0, 0);
      const fovT = 66 + audio.volume * 6 * reactivity;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    },

    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      blobs.length = 0;
    },
  };
}
