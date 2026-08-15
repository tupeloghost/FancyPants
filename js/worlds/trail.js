// TRAIL — you ARE a comet. Close chase-cam behind a glowing head whose
// speed rides the music; it leaves a persistent ribbon (width from volume,
// hue from the dominant band) that never fades. PNG export: press S.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js?v=409';
import { themePaint } from '../lib/themes.js?v=409';


const MAX_POINTS = 14000;   // capped total segment count
const MIN_DIST = 0.22;
const WAKE = 140;           // continuous particle wake behind the head

const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];
const BAND_HUE_SHIFT = [0, 0.09, 0.18, 0.3, 0.42];

export function createTrail() {
  let scene, camera, group, ribbon, ribbonMirror, headOrb, headHalo, stars, sky, wake;
  let nPoints = 0;
  let phase = 0;                       // path parameter — advances with the music
  const head = new THREE.Vector3();
  const headTarget = new THREE.Vector3();
  const headDir = new THREE.Vector3(0, 0, -1);
  const prev = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const steer = new THREE.Vector3();   // smoothed steering offset — no teleports
  let pointer = { x: 0, y: 0, active: false };
  let kick = 0;
  let tapRings = [];                   // expanding light rings on tap
  const wakeVel = new Float32Array(WAKE * 3);
  const wakeLife = new Float32Array(WAKE);
  let wakePhase = 0;
  let clickHue = 0;   // advances on every tap — the ribbon keeps each color
  const up = new THREE.Vector3(), u = new THREE.Vector3(), v2 = new THREE.Vector3();
  const color = new THREE.Color();
  const tmpDir = new THREE.Vector3();
  const tmpSide = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  // the camera aims along THIS — a continuously-smoothed path tangent.
  // headDir only stepped when a ribbon point appended, so the lens twitched
  // on every append; this one glides every frame regardless.
  const smoothDir = new THREE.Vector3(0, 0, -1);
  const pathA = new THREE.Vector3(), pathB = new THREE.Vector3();
  const camLift = new THREE.Vector3(0, 3.5, 0);
  let spd = 0;

  function pathAt(p, out) {
    out.set(
      Math.sin(p * 0.34) * 20 + Math.sin(p * 0.11) * 9,
      Math.sin(p * 0.27) * 11 + Math.cos(p * 0.07) * 4,
      Math.cos(p * 0.19) * 16 - p * 2.2   // net forward drift — never stalls
    );
  }

  return {
    name: 'TRAIL',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;

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
        new THREE.MeshBasicMaterial({
          vertexColors: true, side: THREE.DoubleSide, toneMapped: false,
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      ribbon.frustumCulled = false;
      group.add(ribbon);

      // mirror reflection below — shares the geometry, so it's free to update
      ribbonMirror = new THREE.Mesh(ribbon.geometry, ribbon.material.clone());
      ribbonMirror.material.opacity = 0.3;
      ribbonMirror.scale.y = -1;
      ribbonMirror.position.y = -34;
      ribbonMirror.frustumCulled = false;
      group.add(ribbonMirror);

      // tap ring pool — camera-facing rings that expand and fade
      const tapRingGeo = new THREE.RingGeometry(0.92, 1, 48);
      tapRings = [];
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(
          tapRingGeo,
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.visible = false;
        m.userData = { life: 0 };
        group.add(m);
        tapRings.push(m);
      }

      headOrb = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 14, 14),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      );
      group.add(headOrb);
      headHalo = glowSprite(6);
      group.add(headHalo);

      // continuous wake: particles respawn at the head, drift off, fade
      const wkp = new Float32Array(WAKE * 3);
      const wkg = new THREE.BufferGeometry();
      wkg.setAttribute('position', new THREE.BufferAttribute(wkp, 3).setUsage(THREE.DynamicDrawUsage));
      wake = new THREE.Points(wkg, glowPoints(1.0, 0.85));
      wake.frustumCulled = false;
      group.add(wake);
      for (let i = 0; i < WAKE; i++) wakeLife[i] = Math.random();

      const sp = new Float32Array(700 * 3);
      for (let i = 0; i < 700; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(90 + Math.random() * 140);
        sp.set([v.x, v.y, v.z], i * 3);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      stars = new THREE.Points(sg, glowPoints(1.4, 0.65));
      stars.material.color.set(0x66779a);
      group.add(stars);

      sky = skyDome(300);
      group.add(sky);

      nPoints = 0;
      phase = 0;
      pathAt(0, head);
      prev.copy(head);
      camera.position.copy(head).add(new THREE.Vector3(0, 4, 14));
      camera.fov = 74;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    // fellow comets swim alongside the head
    placeGhost(p, i, out) {
      out.set(
        head.x + p.x * 10 + Math.cos(i * 2.1) * 7,
        head.y + p.y * 6 + Math.sin(i * 1.7) * 4,
        head.z + Math.sin(i * 2.9) * 6 - 4
      );
    },

    // tap: jump to a fresh color (the ribbon behind keeps the old ones —
    // look back and it's a rainbow of your clicks) + surge + ring
    onTap() {
      kick = 1;
      clickHue = (clickHue + 0.31) % 1; // golden-angle-ish: consecutive clicks contrast
      const ring = tapRings.find(r => !r.visible) || tapRings[0];
      ring.visible = true;
      ring.userData.life = 1;
      ring.position.copy(head);
      ring.scale.setScalar(0.5);
      for (let i = 0; i < WAKE; i++) {
        if (Math.random() < 0.5) continue;
        wakeLife[i] = 1;
        const pos = wake.geometry.attributes.position;
        pos.setXYZ(i, head.x, head.y, head.z);
        const v = new THREE.Vector3().randomDirection().multiplyScalar(10 + Math.random() * 20);
        wakeVel[i * 3] = v.x; wakeVel[i * 3 + 1] = v.y; wakeVel[i * 3 + 2] = v.z;
      }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      const tp = this._tp || (this._tp = [0, 0, 0]);

      // the head's speed IS the music — but eased, not raw: per-frame volume
      // wobbles read as stutter when they drive position directly
      const spdT = 0.25 + audio.volume * 2.6 * reactivity + audio.beatIntensity * 1.2;
      spd += (spdT - spd) * Math.min(1, dt * 3);
      phase += dt * spd;
      kick *= Math.pow(0.05, dt);
      // the smooth tangent: where the path is going, sampled symmetrically
      pathAt(phase + 0.06, pathA);
      pathAt(phase - 0.06, pathB);
      tmpDir.subVectors(pathA, pathB).normalize();
      smoothDir.lerp(tmpDir, Math.min(1, dt * 4)).normalize();

      // steering is a SMOOTHED offset — raw pointer deltas were teleporting
      // the head every frame and scribbling the ribbon in play mode
      if (!attract && pointer.active) {
        steer.x += (pointer.x * 14 - steer.x) * Math.min(1, dt * 2.5);
        steer.y += (pointer.y * 9 - steer.y) * Math.min(1, dt * 2.5);
      } else {
        steer.multiplyScalar(Math.max(0, 1 - dt * 1.5));
      }
      pathAt(phase, headTarget);
      headTarget.add(steer);
      head.lerp(headTarget, Math.min(1, dt * 5));

      if (participants && participants[0]) {
        participants[0].x = pointer.active ? pointer.x : Math.sin(time * 0.34) * 0.5;
        participants[0].y = pointer.active ? pointer.y : Math.sin(time * 0.27) * 0.4;
      }

      // append ribbon points as the head moves
      if (nPoints < MAX_POINTS && head.distanceTo(prev) > MIN_DIST) {
        tmpDir.subVectors(head, prev).normalize();
        headDir.lerp(tmpDir, 0.25).normalize();
        toCam.subVectors(camera.position, head).normalize();
        tmpSide.crossVectors(tmpDir, toCam).normalize();

        let domIdx = 0, domVal = -1;
        for (let i = 0; i < BANDS.length; i++) {
          if (audio[BANDS[i]] > domVal) { domVal = audio[BANDS[i]]; domIdx = i; }
        }
        const width = (0.28 + audio.volume * 1.6 * reactivity) * (1 + kick * 1.4);
        // base color = panel hue + the click-cycled offset, so every tap
        // starts a new color segment; a slow drift keeps it alive between taps
        themePaint(colorMode, hue / 360, domIdx / 5, phase * 0.12, time, audio.volume,
          Math.abs(Math.sin(nPoints * 0.37)), tp);
        color.setHSL((tp[0] + clickHue) % 1, tp[1], 0.5);
        // HDR drive, scaled by the theme's own brightness
        color.multiplyScalar((0.7 + audio.volume * 1.6 + kick * 1.4 + audio.beatIntensity * 0.5) * Math.min(1.4, tp[2]));

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

      // wake particles: respawn at the head, drift, fade
      {
        const pos = wake.geometry.attributes.position;
        let domIdx = 0, domVal = -1;
        for (let i = 0; i < BANDS.length; i++) {
          if (audio[BANDS[i]] > domVal) { domVal = audio[BANDS[i]]; domIdx = i; }
        }
        // helix vortex: particles spawn on a spiral around the flight
        // direction and stream backward — the camera flies inside the swirl
        wakePhase += dt * (4 + audio.volume * 12);
        up.set(0, 1, 0);
        u.crossVectors(headDir, up).normalize();
        v2.crossVectors(headDir, u).normalize();
        for (let i = 0; i < WAKE; i++) {
          wakeLife[i] -= dt * 0.9;
          if (wakeLife[i] <= 0) {
            wakeLife[i] = 0.6 + Math.random() * 0.4;
            const a = wakePhase + i * 0.45;
            const rad = 2.2 + audio.volume * 3 + Math.random() * 0.8;
            pos.setXYZ(i,
              head.x + u.x * Math.cos(a) * rad + v2.x * Math.sin(a) * rad,
              head.y + u.y * Math.cos(a) * rad + v2.y * Math.sin(a) * rad,
              head.z + u.z * Math.cos(a) * rad + v2.z * Math.sin(a) * rad
            );
            const back = -5 - audio.volume * 9;
            wakeVel[i * 3] = headDir.x * back + u.x * Math.cos(a) * 1.5;
            wakeVel[i * 3 + 1] = headDir.y * back + u.y * Math.cos(a) * 1.5;
            wakeVel[i * 3 + 2] = headDir.z * back + u.z * Math.cos(a) * 1.5;
          } else {
            pos.setXYZ(i,
              pos.getX(i) + wakeVel[i * 3] * dt,
              pos.getY(i) + wakeVel[i * 3 + 1] * dt,
              pos.getZ(i) + wakeVel[i * 3 + 2] * dt
            );
          }
        }
        pos.needsUpdate = true;
        themePaint(colorMode, hue / 360, domIdx / 5, phase * 0.12, time, audio.volume, 0.5, tp);
        color.setHSL((tp[0] + clickHue) % 1, tp[1], 0.5);
        color.multiplyScalar((0.9 + audio.volume * 1.4) * Math.min(1.3, tp[2]));
        wake.material.color.copy(color);
        wake.material.size = 0.8 + audio.volume * 1.2;
      }

      // tap rings expand and fade, always facing the camera
      for (const r of tapRings) {
        if (!r.visible) continue;
        r.userData.life -= dt * 1.6;
        if (r.userData.life <= 0) { r.visible = false; continue; }
        r.scale.addScalar(dt * 55);
        r.quaternion.copy(camera.quaternion);
        color.setHSL(((hue / 360) + clickHue + 0.5) % 1, 1.0, 0.5);
        color.multiplyScalar(1 + r.userData.life * 2);
        r.material.color.copy(color);
        r.material.opacity = r.userData.life * 0.8;
      }

      // head orb + halo
      headOrb.position.copy(head);
      headOrb.scale.setScalar(1 + audio.volume * 0.9 * reactivity + kick * 1.2);
      color.setHSL(((hue / 360) + clickHue) % 1, 1.0, 0.55);
      color.multiplyScalar(1.2 + audio.volume * 1.2 + audio.beatIntensity * 0.8);
      headOrb.material.color.copy(color);
      headHalo.position.copy(head);
      headHalo.scale.setScalar(3.5 * (1 + audio.volume * 0.8 + kick * 1.2));
      headHalo.material.color.copy(color);
      headHalo.material.opacity = 0.3 + audio.volume * 0.25;

      // chase-cam: sit behind and above the head, look past it
      camTarget.copy(head).addScaledVector(smoothDir, -13).add(camLift);
      camera.position.lerp(camTarget, Math.min(1, dt * 4));
      lookTarget.copy(head).addScaledVector(smoothDir, 10);
      camera.lookAt(lookTarget);
      camera.rotation.z += Math.sin(time * 0.5) * 0.02 + kick * 0.05;
      const fovT = 74 + audio.volume * 12 * reactivity + audio.beatIntensity * 6;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();

      // sky + stars follow so the dome never runs out
      sky.position.copy(camera.position);
      stars.position.copy(camera.position);
      color.setHSL((hue / 360) % 1, 0.65, 0.4 + audio.energy * 0.25);
      sky.material.color.copy(color);
    },

    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
