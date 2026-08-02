// ORBIT — participants circle a central core. Shapes spawn on beats and
// expand outward; you steer through the gaps with a single axis (radius).

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=91';
import { themePaint } from '../lib/themes.js?v=91';


const SHAPE_POOL = 24;
const STARS = 600;

export function createOrbit() {
  let scene, camera, group;
  let core, coreWire, coreHot, coreHalo, stars, player, swarm, trail, dome, sky;
  let shapes = [];
  let trailPts = [];
  let scatter = 0;    // tap: swarm blasts outward, dome flashes
  let angle = 0;
  let radius = 12, radiusTarget = 12;
  let corePulse = 0;
  const color = new THREE.Color();

  return {
    name: 'ORBIT',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;

      core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(3, 1),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      );
      coreWire = new THREE.Mesh(
        new THREE.IcosahedronGeometry(3.6, 1),
        new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.5, toneMapped: false })
      );
      // white-hot center that blooms
      coreHot = new THREE.Mesh(
        new THREE.SphereGeometry(1.4, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
      );
      coreHalo = glowSprite(24);
      group.add(core, coreWire, coreHot, coreHalo);

      // enveloping dome — the world has walls that breathe with the music
      dome = new THREE.Mesh(
        new THREE.IcosahedronGeometry(40, 2),
        new THREE.MeshBasicMaterial({
          wireframe: true, transparent: true, opacity: 0.16,
          toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      group.add(dome);

      sky = skyDome(280);
      group.add(sky);

      // particle swarm around the core
      const swp = new Float32Array(700 * 3);
      for (let i = 0; i < 700; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(5 + Math.random() * 6);
        swp.set([v.x, v.y * 0.5, v.z], i * 3);
      }
      const swg = new THREE.BufferGeometry();
      swg.setAttribute('position', new THREE.BufferAttribute(swp, 3));
      swarm = new THREE.Points(swg, glowPoints(0.7, 0.85));
      group.add(swarm);

      // player trail
      const tp = new Float32Array(80 * 3);
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(tp, 3).setUsage(THREE.DynamicDrawUsage));
      tg.setDrawRange(0, 0);
      trail = new THREE.Line(tg, new THREE.LineBasicMaterial({
        transparent: true, opacity: 0.85, toneMapped: false,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      trail.frustumCulled = false;
      group.add(trail);
      trailPts = [];

      // beat shapes: expanding rings in random orientations
      // thin tube relative to radius — rings are uniform-scaled up to ~40x,
      // so the tube must stay proportionally hairline or they become donuts
      const ringGeo = new THREE.TorusGeometry(1, 0.02, 6, 64);
      for (let i = 0; i < SHAPE_POOL; i++) {
        const m = new THREE.Mesh(
          ringGeo,
          new THREE.MeshBasicMaterial({
            transparent: true, opacity: 0, toneMapped: false,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.visible = false;
        m.userData = { r: 0, speed: 0 };
        group.add(m);
        shapes.push(m);
      }

      // starfield
      const sp = new Float32Array(STARS * 3);
      for (let i = 0; i < STARS; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(90 + Math.random() * 120);
        sp.set([v.x, v.y, v.z], i * 3);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      stars = new THREE.Points(sg, glowPoints(1.6, 0.7));
      stars.material.color.set(0x8899bb);
      group.add(stars);

      // local player mote
      player = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 12, 12),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      );
      group.add(player);

      camera.position.set(0, 14, 34);
      camera.lookAt(0, 0, 0);
      camera.fov = 70;
      camera.updateProjectionMatrix();
    },

    // single-axis input: x steers orbit radius
    setInput(x) { radiusTarget = 13 + x * 7; },

    // everyone circles the same core; their steer picks the orbit radius
    placeGhost(p, i, out) {
      const rad = 13 + p.x * 7;
      const ang = (this._t || 0) * (0.4 + (i % 3) * 0.1) + i * 1.7;
      out.set(Math.cos(ang) * rad, Math.sin(ang * 0.7 + i) * 2.5, Math.sin(ang) * rad);
    },

    onTap() { corePulse = 1; scatter = 1; this._spawn = true; },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      const tp = this._tp || (this._tp = [0, 0, 0]);
      const paint = (u, lvl) => { themePaint(colorMode, hue / 360, u, time * 0.15, time, lvl, (u * 7.13) % 1, tp); return tp; };

      this._t = time;
      if (participants && participants[0]) {
        participants[0].x = (radius - 13) / 7;
        participants[0].y = 0;
      }
      if (attract) radiusTarget = 13 + Math.sin(time * 0.5) * 5;
      radius += (radiusTarget - radius) * Math.min(1, dt * 4);
      angle += dt * (0.5 + audio.volume * 1.6 * reactivity);

      // core throbs with bass
      const s = 1 + audio.bass * 0.8 * reactivity + corePulse * 0.5;
      core.scale.setScalar(s);
      coreWire.scale.setScalar(s * (1.05 + audio.beatIntensity * 0.2));
      coreWire.rotation.y += dt * 0.4;
      coreWire.rotation.x += dt * 0.13;
      corePulse *= Math.pow(0.01, dt);

      paint(0.12, audio.bass);
      color.setHSL(tp[0], tp[1], Math.min(0.7, (0.3 + audio.bass * 0.4 + corePulse * 0.3) * Math.min(1.3, tp[2])));
      core.material.color.copy(color);
      paint(0.4, audio.mid);
      color.setHSL(tp[0], tp[1], Math.min(0.72, (0.6 + audio.beatIntensity * 0.1) * Math.min(1.2, tp[2])));
      coreWire.material.color.copy(color);
      coreHot.scale.setScalar(s * (0.9 + audio.bass * 0.5 + corePulse * 0.6));
      coreHalo.scale.setScalar(11 * (1 + audio.bass * 0.3 + corePulse * 0.4));
      color.setHSL((hue / 360) % 1, 0.85, 0.4);
      coreHalo.material.color.copy(color);
      coreHalo.material.opacity = 0.3 + audio.bass * 0.25 + corePulse * 0.25;

      // swarm breathes with the mids, spins, and blasts outward on taps
      scatter *= Math.pow(0.02, dt);
      swarm.rotation.y += dt * (0.15 + audio.mid * 0.8 * reactivity + scatter * 3);
      swarm.rotation.z += dt * 0.05;
      swarm.scale.setScalar(1 + audio.mid * 0.35 * reactivity + audio.beatIntensity * 0.15 + scatter * 1.4);

      color.setHSL((hue / 360) % 1, 0.7, 0.5 + audio.energy * 0.3);
      sky.material.color.copy(color);

      // dome breathes; flashes on beats and taps
      dome.rotation.y += dt * 0.02;
      dome.rotation.x += dt * 0.008;
      dome.scale.setScalar(1 + audio.bass * 0.05 * reactivity + scatter * 0.06);
      paint(0.92, audio.mid);
      color.setHSL(tp[0], tp[1] * 0.7, Math.min(0.6, (0.3 + audio.mid * 0.25) * Math.min(1.2, tp[2])));
      dome.material.color.copy(color);
      dome.material.opacity = 0.12 + audio.mid * 0.2 + audio.beatIntensity * 0.15 + scatter * 0.3;
      paint(0.7, audio.mid);
      color.setHSL(tp[0], tp[1], Math.min(0.72, (0.5 + audio.mid * 0.25) * Math.min(1.3, tp[2])));
      swarm.material.color.copy(color);
      swarm.material.size = 0.22 + audio.high * 0.3;

      // beats (and taps) spawn expanding rings
      if (audio.beat || this._spawn) {
        this._spawn = false;
        const m = shapes.find(x => !x.visible) || shapes[0];
        m.visible = true;
        m.userData.r = 3.5;
        m.userData.speed = 9 + (audio.beatIntensity || 0.5) * 18 * reactivity;
        m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        color.setHSL(((hue / 360) + 0.5 + Math.random() * 0.1) % 1, 0.9, 0.42);
        m.material.color.copy(color);
      }
      for (const m of shapes) {
        if (!m.visible) continue;
        m.userData.r += m.userData.speed * dt;
        if (m.userData.r > 55) { m.visible = false; continue; }
        m.scale.setScalar(m.userData.r);
        m.material.opacity = Math.max(0, 0.55 * (1 - m.userData.r / 42));
      }

      // player orbits, dragging a glowing trail
      player.position.set(Math.cos(angle) * radius, Math.sin(angle * 0.7) * 2, Math.sin(angle) * radius);
      color.setHSL(((hue / 360) + 0.35) % 1, 0.9, 0.65 + audio.beatIntensity * 0.2);
      player.material.color.copy(color);
      trail.material.color.copy(color);

      trailPts.push(player.position.clone());
      if (trailPts.length > 80) trailPts.shift();
      const tPos = trail.geometry.attributes.position;
      for (let i = 0; i < trailPts.length; i++) tPos.setXYZ(i, trailPts[i].x, trailPts[i].y, trailPts[i].z);
      tPos.needsUpdate = true;
      trail.geometry.setDrawRange(0, trailPts.length);

      // camera orbits slowly opposite the player
      const camR = 27 - audio.bass * 3 * reactivity;
      camera.position.set(Math.sin(time * 0.07) * camR, 10 + Math.sin(time * 0.11) * 4, Math.cos(time * 0.07) * camR);
      camera.lookAt(0, 0, 0);
      const fovTarget = 70 + audio.volume * 8 * reactivity;
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    },

    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      shapes = [];
    },
  };
}
