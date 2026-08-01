// ORBIT — participants circle a central core. Shapes spawn on beats and
// expand outward; you steer through the gaps with a single axis (radius).

import * as THREE from 'three';

const SHAPE_POOL = 24;
const STARS = 600;

export function createOrbit() {
  let scene, camera, group;
  let core, coreWire, stars, player;
  let shapes = [];
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
      group.add(core, coreWire);

      // beat shapes: expanding rings in random orientations
      const ringGeo = new THREE.TorusGeometry(1, 0.05, 6, 64);
      for (let i = 0; i < SHAPE_POOL; i++) {
        const m = new THREE.Mesh(
          ringGeo,
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false })
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
      stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.6, color: 0x8899bb, toneMapped: false }));
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

    onTap() { corePulse = 1; this._spawn = true; },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time } = opts;

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

      color.setHSL((opts.hue / 360) % 1, 0.8, 0.25 + audio.bass * 0.4 + corePulse * 0.3);
      core.material.color.copy(color);
      color.setHSL(((opts.hue / 360) + 0.08) % 1, 0.9, 0.55);
      coreWire.material.color.copy(color);

      // beats (and taps) spawn expanding rings
      if (audio.beat || this._spawn) {
        this._spawn = false;
        const m = shapes.find(x => !x.visible) || shapes[0];
        m.visible = true;
        m.userData.r = 3.5;
        m.userData.speed = 9 + (audio.beatIntensity || 0.5) * 18 * reactivity;
        m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        color.setHSL(((hue / 360) + 0.5 + Math.random() * 0.1) % 1, 0.9, 0.6);
        m.material.color.copy(color);
      }
      for (const m of shapes) {
        if (!m.visible) continue;
        m.userData.r += m.userData.speed * dt;
        if (m.userData.r > 55) { m.visible = false; continue; }
        m.scale.setScalar(m.userData.r);
        m.material.opacity = Math.max(0, 1 - m.userData.r / 50);
      }

      // player orbits
      player.position.set(Math.cos(angle) * radius, Math.sin(angle * 0.7) * 2, Math.sin(angle) * radius);
      color.setHSL(((hue / 360) + 0.35) % 1, 0.9, 0.65 + audio.beatIntensity * 0.2);
      player.material.color.copy(color);

      // camera orbits slowly opposite the player
      camera.position.set(Math.sin(time * 0.07) * 34, 13 + Math.sin(time * 0.11) * 4, Math.cos(time * 0.07) * 34);
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
