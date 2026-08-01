// LAVA LAMP — an actual lamp: tapered glass vessel, glowing bulb in the
// base, wax that pools at the bottom and breaks off into rising blobs when
// the music heats it. Bass = heat. Tap pokes a blob.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const BLOBS = 11;
const H = 34;               // interior height of the glass
const R_BOT = 9.5, R_TOP = 5;

export function createLavaLamp() {
  let scene, camera, group, sky, glass, baseCone, capCone, bulbGlow, pool, motes, roomGlow, glassShine, liquid;
  const blobs = [];          // {mesh, halo, y, vy, size, phase, poke}
  const tp = [0, 0, 0];
  const color = new THREE.Color();
  let pointer = { x: 0, y: 0, active: false };

  // interior radius of the vessel at height y (y in [-H/2, H/2])
  const profile = y => R_BOT + (R_TOP - R_BOT) * ((y + H / 2) / H);

  return {
    name: 'LAVA LAMP',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;

      // the glass: a tapered, faintly luminous vessel
      glass = new THREE.Mesh(
        new THREE.CylinderGeometry(R_TOP + 0.6, R_BOT + 0.6, H, 36, 1, true),
        new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0.08, toneMapped: false,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      group.add(glass);

      // metal base and cap silhouettes — the thing reads as an OBJECT
      baseCone = new THREE.Mesh(
        new THREE.CylinderGeometry(R_BOT + 0.8, R_BOT + 4.5, 9, 36),
        new THREE.MeshBasicMaterial({ color: 0x0a0b14, toneMapped: false })
      );
      baseCone.position.y = -H / 2 - 4.5;
      capCone = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, R_TOP + 0.7, 6, 36),
        new THREE.MeshBasicMaterial({ color: 0x0a0b14, toneMapped: false })
      );
      capCone.position.y = H / 2 + 3;
      group.add(baseCone, capCone);

      // the liquid: interior column, bright at the bulb fading upward
      {
        const lg = new THREE.CylinderGeometry(R_TOP + 0.2, R_BOT + 0.2, H, 28, 24, true);
        const pa = lg.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const t = Math.pow(1 - (pa.getY(i) / H + 0.5), 2.2); // hot at bottom
          const v2 = 0.04 + t * 0.5;
          vc[i * 3] = v2; vc[i * 3 + 1] = v2; vc[i * 3 + 2] = v2;
        }
        lg.setAttribute('color', new THREE.BufferAttribute(vc, 3));
        liquid = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({
          vertexColors: true, transparent: true, opacity: 0.55, toneMapped: false,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
        }));
        group.add(liquid);
      }

      // the bulb: a hot glow in the base shining up through the wax
      bulbGlow = glowSprite(26);
      bulbGlow.position.y = -H / 2 - 1;
      group.add(bulbGlow);

      // the wax pool at the bottom that blobs sink back into
      pool = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 16),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      );
      pool.position.y = -H / 2 + 0.5;
      group.add(pool);

      blobs.length = 0;
      for (let i = 0; i < BLOBS; i++) {
        // size variety: a few big slugs, several small beads
        const size = i < 3 ? 3.2 + Math.random() * 1.6 : 1.2 + Math.random() * 1.8;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(1, 24, 24),
          new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.95 })
        );
        const halo = glowSprite(size * 2.6);
        group.add(mesh, halo);
        blobs.push({
          mesh, halo,
          y: -H / 2 + 1 + Math.random() * 3, // start in the pool
          vy: 0,
          size,
          phase: Math.random() * 100,
          lane: (i / BLOBS) * Math.PI * 2,   // own angular lane in the vessel
          laneR: 0.25 + (i % 3) * 0.3,       // own distance from the axis
          spin: (i % 2 ? 1 : -1) * (0.02 + Math.random() * 0.03),
          poke: 0,
          merge: 0,
        });
      }

      // motes suspended in the fluid
      const mp = new Float32Array(120 * 3);
      for (let i = 0; i < 120; i++) {
        const y = (Math.random() - 0.5) * H * 0.9;
        const r = Math.random() * (profile(y) - 1);
        const a = Math.random() * Math.PI * 2;
        mp[i * 3] = Math.cos(a) * r;
        mp[i * 3 + 1] = y;
        mp[i * 3 + 2] = Math.sin(a) * r;
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      motes = new THREE.Points(mg, glowPoints(0.4, 0.45));
      group.add(motes);

      // the lamp lights the room — a big soft wash behind it
      roomGlow = glowSprite(120);
      roomGlow.position.z = -30;
      group.add(roomGlow);

      // vertical highlight streak on the glass, like a window reflection
      glassShine = glowSprite(1);
      glassShine.scale.set(3.5, H * 1.05, 1);
      glassShine.position.set(R_BOT * 0.55, 0, R_BOT * 0.8);
      glassShine.material.opacity = 0.12;
      group.add(glassShine);

      // little knob on the cap — the finishing silhouette touch
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x0a0b14, toneMapped: false })
      );
      knob.position.y = H / 2 + 6.2;
      group.add(knob);

      sky = skyDome(200);
      group.add(sky);

      camera.fov = 60;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    // fellow watchers drift as small bubbles around the lamp
    placeGhost(p, i, out) {
      const a = (this._t || 0) * 0.25 + i * 1.9;
      out.set(Math.cos(a) * (19 + p.x * 4), Math.sin(a * 0.7 + i) * H * 0.4, Math.sin(a) * (19 + p.x * 4));
    },

    // tap: poke the blob nearest the click ray
    onTap(x, y) {
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      let best = null, bestD = 1e9;
      for (const b of blobs) {
        const toB = b.mesh.position.clone().sub(camera.position);
        const d = toB.cross(dir).length();
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best) { best.poke = 1; best.vy += 7; }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      this._t = time;

      if (participants && participants[0]) {
        participants[0].x = pointer.active ? pointer.x : Math.sin(time * 0.3) * 0.4;
        participants[0].y = 0;
      }

      // heat rises from the bulb: bass + slow-burn energy
      const heat = Math.min(1, audio.bass * 0.8 * reactivity + audio.energy * 0.5);

      let inPool = 0;
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        // wax physics: heat lifts blobs near the bottom; they cool with
        // altitude and sink back — the endless lamp cycle
        const nearBottom = b.y < -H / 2 + 4;
        const altitude = (b.y + H / 2) / H;              // 0 bottom, 1 top
        const warmth = (nearBottom ? heat * 2.2 : heat) - altitude * 1.1;
        const buoy = warmth * 2.6 + Math.sin(time * 0.13 + b.phase) * 0.35 - 0.35;
        b.vy += (buoy - b.vy) * Math.min(1, dt * 0.22); // wax, not water
        b.y += b.vy * dt * (1.1 + heat * 0.8);
        if (b.y > H / 2 - b.size) { b.y = H / 2 - b.size; b.vy = -0.3; }
        if (b.y < -H / 2 + 1) { b.y = -H / 2 + 1; b.vy = Math.max(0, b.vy); inPool++; }
        b.poke *= Math.pow(0.05, dt);
        if (b.y < -H / 2 + 2.2) inPool += 0; // (counted above)

        // each blob keeps to its own slow lane inside the tapered glass
        const maxOff = Math.max(0.3, profile(b.y) - b.size - 0.5);
        const ang = b.lane + time * b.spin;
        const off = maxOff * b.laneR;
        const x = Math.cos(ang) * off;
        const z = Math.sin(ang) * off;
        b.mesh.position.set(x, b.y, z);

        // teardrop when rising, flattened when sinking, wobble from poke.
        // Near the pool, blobs NECK: stretch down toward the wax they're
        // pulling away from — the signature lava-lamp move.
        const rising = b.vy > 0.3, sinking = b.vy < -0.3;
        let stretch = rising ? 1.25 + Math.min(0.4, b.vy * 0.15)
                    : sinking ? 0.85 : 1;
        const poolDist = b.y - (-H / 2 + 1);
        if (rising && poolDist < b.size * 2.2) {
          stretch += (1 - poolDist / (b.size * 2.2)) * 0.7; // pulled taffy
        }
        // merge swell: blobs touching each other fatten and brighten
        b.merge = 0;
        for (let j = 0; j < blobs.length; j++) {
          if (j === i) continue;
          const o = blobs[j];
          const d = b.mesh.position.distanceTo(o.mesh.position);
          const overlap = (b.size + o.size) * 0.9 - d;
          if (overlap > 0) b.merge = Math.min(1, b.merge + overlap / (b.size + o.size));
        }
        // out-of-phase xz wobble — jelly, not marble
        const wobX = 1 + Math.sin(time * 1.6 + b.phase * 3) * 0.07 + b.poke * 0.25 + b.merge * 0.15;
        const wobZ = 1 + Math.sin(time * 1.6 + b.phase * 3 + 2.1) * 0.07 + b.poke * 0.25 + b.merge * 0.15;
        const wob = (wobX + wobZ) / 2;
        b.mesh.scale.set(b.size * wobX / Math.sqrt(stretch), b.size * wob * stretch, b.size * wobZ / Math.sqrt(stretch));
        b.halo.position.copy(b.mesh.position);

        const uy = (b.y + H / 2) / H;
        themePaint(colorMode, hue / 360, uy, i * 0.4, time, heat, (b.phase % 1), tp);
        // lit from below: blobs glow hotter the lower they are — but capped
        // well under white so they stay WAX, not lightbulbs
        const glow = 0.24 + heat * 0.18 + (1 - uy) * 0.14 + b.poke * 0.15 + b.merge * 0.08;
        color.setHSL(tp[0], Math.max(0.8, tp[1]), Math.min(0.55, glow * Math.min(1.25, tp[2])));
        b.mesh.material.color.copy(color);
        b.halo.material.color.copy(color);
        b.halo.material.opacity = 0.12 + heat * 0.1 + b.merge * 0.1;
        b.halo.scale.setScalar(b.size * 1.9 * wob);
      }

      // the pool breathes: swells when blobs are home, glows with the bulb
      themePaint(colorMode, hue / 360, 0.02, 0, time, heat, 0.3, tp);
      const poolR = R_BOT - 1 + Math.sin(time * 0.8) * 0.2;
      pool.scale.set(poolR, 1.6 + inPool * 0.35 + heat * 0.8, poolR);
      color.setHSL(tp[0], Math.max(0.75, tp[1]), Math.min(0.48, (0.3 + heat * 0.18) * Math.min(1.2, tp[2])));
      pool.material.color.copy(color);
      liquid.material.color.copy(color);
      liquid.material.opacity = 0.4 + heat * 0.3;

      // bulb: the heart of the lamp — burns with the bass
      bulbGlow.scale.setScalar(20 * (1 + heat * 0.5 + audio.beatIntensity * 0.25));
      bulbGlow.material.color.copy(color);
      bulbGlow.material.opacity = 0.32 + heat * 0.3;

      // glass catches the wax light faintly
      glass.material.color.copy(color);
      glass.material.opacity = 0.05 + heat * 0.07;

      motes.material.color.copy(color);
      motes.material.size = 0.4 + audio.high * 0.4;
      motes.rotation.y += dt * 0.03;

      // the room breathes with the lamp
      roomGlow.material.color.copy(color);
      roomGlow.material.opacity = 0.06 + heat * 0.1 + audio.beatIntensity * 0.04;
      glassShine.material.opacity = 0.09 + heat * 0.06;
      sky.position.copy(camera.position);
      color.setHSL(tp[0], tp[1] * 0.4, 0.1 + audio.energy * 0.1);
      sky.material.color.copy(color);

      // mostly front-on, gentle sway — you're watching a lamp on a shelf
      camera.position.set(Math.sin(time * 0.04) * 14, 2 + Math.sin(time * 0.06) * 5, 44 - audio.bass * 3);
      camera.lookAt(0, 0, 0);
      const fovT = 60 + audio.volume * 5 * reactivity;
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
