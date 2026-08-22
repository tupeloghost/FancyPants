// PLASMA — a plasma globe. Lightning tendrils arc from a burning core to
// the glass shell, dancing with the treble and striking hard on beats.
// Tap the glass and a tendril leaps to your finger — just like the real toy.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=527';
import { themePaint } from '../lib/themes.js?v=527';

const TENDRILS = 9;
const PTS = 22;             // points per tendril
const SHELL = 21;

export function createPlasma() {
  let scene, camera, group, core, coreHalo, shell, sky, dust;
  const tendrils = [];       // {line, dir(Vector3), drift, flash}
  const tp = [0, 0, 0];
  const color = new THREE.Color();
  const tapDir = new THREE.Vector3();
  let tapFlash = 0;

  return {
    name: 'PLASMA',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;

      core = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 20, 20),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      );
      coreHalo = glowSprite(14);
      group.add(core, coreHalo);

      shell = new THREE.Mesh(
        new THREE.SphereGeometry(SHELL, 32, 24),
        new THREE.MeshBasicMaterial({
          wireframe: true, transparent: true, opacity: 0.05,
          toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      group.add(shell);

      tendrils.length = 0;
      for (let i = 0; i < TENDRILS; i++) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
          transparent: true, opacity: 0.9, toneMapped: false,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        line.frustumCulled = false;
        group.add(line);
        tendrils.push({
          line,
          dir: new THREE.Vector3().randomDirection(),
          drift: new THREE.Vector3().randomDirection().multiplyScalar(0.4),
          flash: 0,
          seed: Math.random() * 100,
        });
      }

      // charged dust inside the globe
      const dp = new Float32Array(300 * 3);
      for (let i = 0; i < 300; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * (SHELL - 6));
        dp.set([v.x, v.y, v.z], i * 3);
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      dust = new THREE.Points(dg, glowPoints(0.5, 0.5));
      group.add(dust);

      sky = skyDome(200);
      group.add(sky);

      camera.fov = 64;
      camera.updateProjectionMatrix();
    },

    // fellow hands on the globe: sparks crawling the outside of the glass
    placeGhost(p, i, out) {
      const a = (this._t || 0) * 0.3 + i * 1.4;
      out.set(
        Math.cos(a) * (SHELL + 2.5),
        Math.sin(a * 0.6 + i) * (SHELL * 0.6) + p.y * 4,
        Math.sin(a) * (SHELL + 2.5)
      );
    },

    // tap the glass: a tendril leaps to your finger
    onTap(x, y) {
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      tapDir.copy(v.sub(camera.position).normalize());
      // aim at the point where the ray meets the shell (closest approach to center)
      const oc = camera.position.clone();
      const b = oc.dot(tapDir);
      const hit = oc.clone().addScaledVector(tapDir, -b).normalize();
      let best = tendrils[0], bd = 1e9;
      for (const t of tendrils) {
        const d = t.dir.distanceTo(hit);
        if (d < bd) { bd = d; best = t; }
      }
      best.dir.copy(hit);
      best.flash = 1;
      tapFlash = 1;
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      this._t = time;

      if (participants && participants[0]) {
        participants[0].x = Math.sin(time * 0.3);
        participants[0].y = Math.cos(time * 0.22);
      }
      tapFlash *= Math.pow(0.03, dt);

      // core burns with the bass
      const burn = 1 + audio.bass * 0.6 * reactivity + audio.beatIntensity * 0.4 + tapFlash * 0.3;
      core.scale.setScalar(burn);
      themePaint(colorMode, hue / 360, 0.1, time * 0.1, time, audio.bass, 0.3, tp);
      color.setHSL(tp[0], tp[1] * 0.5, Math.min(0.75, 0.55 * Math.min(1.5, tp[2]) + audio.bass * 0.15));
      core.material.color.copy(color);
      coreHalo.scale.setScalar(14 * burn);
      coreHalo.material.color.copy(color);
      coreHalo.material.opacity = 0.4 + audio.bass * 0.3;

      // tendrils: jagged arcs core -> shell, rebuilt every frame (alive!),
      // retargeting on beats like the real thing
      for (let ti = 0; ti < tendrils.length; ti++) {
        const t = tendrils[ti];
        t.flash *= Math.pow(0.04, dt);
        if (audio.beat && Math.random() < 0.4) {
          t.dir.randomDirection();
          t.flash = Math.max(t.flash, audio.beatIntensity);
        }
        // slow wander across the glass
        t.dir.addScaledVector(t.drift, dt * 0.25).normalize();

        const pos = t.line.geometry.attributes.position;
        for (let i = 0; i < PTS; i++) {
          const f = i / (PTS - 1);
          const r = 2.6 + f * (SHELL - 2.8);
          // jitter window: zero at both ends, wild in the middle
          const wild = Math.sin(f * Math.PI) * (1.2 + audio.treble * 5 * reactivity + t.flash * 3);
          pos.setXYZ(i,
            t.dir.x * r + Math.sin(time * 31 + t.seed + i * 2.7) * wild,
            t.dir.y * r + Math.sin(time * 27 + t.seed * 2 + i * 3.1) * wild,
            t.dir.z * r + Math.cos(time * 29 + t.seed * 3 + i * 2.3) * wild
          );
        }
        pos.needsUpdate = true;

        themePaint(colorMode, hue / 360, ti / TENDRILS, time * 0.1, time, audio.treble, (t.seed % 1), tp);
        color.setHSL(tp[0], tp[1] * 0.7, 0.6);
        color.multiplyScalar((0.8 + audio.treble * 1.6 + t.flash * 1.8) * Math.min(1.4, tp[2]));
        t.line.material.color.copy(color);
        t.line.material.opacity = 0.35 + audio.treble * 0.5 + t.flash * 0.6;
      }

      // shell breathes faintly; charged dust swirls
      themePaint(colorMode, hue / 360, 0.8, time * 0.05, time, audio.mid, 0.7, tp);
      color.setHSL(tp[0], tp[1] * 0.6, 0.4);
      shell.material.color.copy(color);
      shell.material.opacity = 0.035 + audio.mid * 0.05 + audio.beatIntensity * 0.04;
      dust.rotation.y += dt * (0.05 + audio.mid * 0.3);
      dust.material.color.copy(color);
      dust.material.size = 0.5 + audio.high * 0.5;
      sky.position.copy(camera.position);
      color.setHSL(tp[0], tp[1] * 0.4, 0.12 + audio.energy * 0.1);
      sky.material.color.copy(color);

      // orbit close — the globe should fill the frame
      const r = 33 - audio.bass * 3;
      camera.position.set(Math.sin(time * 0.055) * r, Math.sin(time * 0.08) * 8, Math.cos(time * 0.055) * r);
      camera.lookAt(0, 0, 0);
      const fovT = 64 + audio.volume * 7 * reactivity + audio.beatIntensity * 4;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    },

    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      tendrils.length = 0;
    },
  };
}
