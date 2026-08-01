// LAVA LAMP — raymarched metaball wax. The blobs are a single continuous
// liquid field rendered in a fragment shader: they genuinely merge, neck
// off the pool, and split like real wax. Bass = heat. Tap pokes a blob.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const BLOBS = 9;            // moving blobs (+1 pool blob in the field)
const H = 34;
const R_BOT = 9.5, R_TOP = 5;
const MAX_FIELD = 12;       // shader uniform slots

export function createLavaLamp() {
  let scene, camera, group, sky, glass, bulbGlow, motes, roomGlow, glassShine, wax;
  const blobs = [];
  const tp = [0, 0, 0];
  const colBot = new THREE.Color(), colTop = new THREE.Color(), colRim = new THREE.Color();
  let pointer = { x: 0, y: 0, active: false };

  const profile = y => R_BOT + (R_TOP - R_BOT) * ((y + H / 2) / H);

  return {
    name: 'LAVA LAMP',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = null;

      // ── the wax: one raymarched metaball field inside a bounding box ──
      const uniforms = {
        uBlobs: { value: Array.from({ length: MAX_FIELD }, () => new THREE.Vector4(0, -99, 0, 0.001)) },
        uCount: { value: 0 },
        uColBot: { value: colBot },
        uColTop: { value: colTop },
        uRim: { value: colRim },
        uHeat: { value: 0 },
        uH: { value: H },
        uRBot: { value: R_BOT },
        uRTop: { value: R_TOP },
      };
      wax = new THREE.Mesh(
        new THREE.BoxGeometry(R_BOT * 2 + 2, H + 6, R_BOT * 2 + 2),
        new THREE.ShaderMaterial({
          uniforms,
          vertexShader: `
            varying vec3 vWorld;
            void main() {
              vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec4 uBlobs[${MAX_FIELD}];
            uniform int uCount;
            uniform vec3 uColBot, uColTop, uRim;
            uniform float uHeat, uH, uRBot, uRTop;
            varying vec3 vWorld;

            // polynomial smooth-min: THE metaball merge
            float smin(float a, float b, float k) {
              float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
              return mix(b, a, h) - k * h * (1.0 - h);
            }

            float field(vec3 p) {
              float d = 1e5;
              for (int i = 0; i < ${MAX_FIELD}; i++) {
                if (i >= uCount) break;
                vec4 b = uBlobs[i];
                d = smin(d, length(p - b.xyz) - b.w, 2.8);
              }
              // confine the wax to the tapered vessel
              float prof = mix(uRBot, uRTop, clamp((p.y + uH * 0.5) / uH, 0.0, 1.0)) - 0.35;
              d = max(d, length(p.xz) - prof);
              d = max(d, p.y - uH * 0.5);
              d = max(d, -(p.y + uH * 0.5 + 0.6)); // floor: wax never leaks below the vessel
              return d;
            }

            vec3 fnormal(vec3 p) {
              vec2 e = vec2(0.06, 0.0);
              return normalize(vec3(
                field(p + e.xyy) - field(p - e.xyy),
                field(p + e.yxy) - field(p - e.yxy),
                field(p + e.yyx) - field(p - e.yyx)
              ));
            }

            void main() {
              vec3 ro = cameraPosition;
              vec3 rd = normalize(vWorld - ro);
              float t = length(vWorld - ro);
              float tMax = t + uRBot * 2.0 + uH + 8.0;
              float hit = -1.0;
              for (int i = 0; i < 64; i++) {
                vec3 p = ro + rd * t;
                float d = field(p);
                if (d < 0.035) { hit = t; break; }
                t += max(d * 0.9, 0.025);
                if (t > tMax) break;
              }
              if (hit < 0.0) discard;
              vec3 p = ro + rd * hit;
              vec3 n = fnormal(p);
              float h01 = clamp((p.y + uH * 0.5) / uH, 0.0, 1.0);
              vec3 base = mix(uColBot, uColTop, h01);
              // lit from the bulb below, rim glow at the silhouette
              float below = clamp(1.15 - h01 * 1.25, 0.0, 1.2);
              float fres = pow(1.0 - abs(dot(n, rd)), 2.0);
              float topLight = max(0.0, n.y) * 0.12;
              vec3 col = base * (0.32 + below * 0.85 + uHeat * 0.2 + topLight)
                       + uRim * fres * (0.4 + uHeat * 0.35);
              gl_FragColor = vec4(col, 1.0);
            }
          `,
        })
      );
      group.add(wax);

      // glass vessel + silhouette hardware
      glass = new THREE.Mesh(
        new THREE.CylinderGeometry(R_TOP + 0.6, R_BOT + 0.6, H, 36, 1, true),
        new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0.07, toneMapped: false,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      const dark = new THREE.MeshBasicMaterial({ color: 0x0a0b14, toneMapped: false });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(R_BOT + 0.8, R_BOT + 4.5, 9, 36), dark);
      base.position.y = -H / 2 - 4.5;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.6, R_TOP + 0.7, 6, 36), dark);
      cap.position.y = H / 2 + 3;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 12), dark);
      knob.position.y = H / 2 + 6.2;
      group.add(glass, base, cap, knob);

      bulbGlow = glowSprite(20);
      bulbGlow.position.y = -H / 2 - 1;
      group.add(bulbGlow);

      roomGlow = glowSprite(120);
      roomGlow.position.z = -30;
      group.add(roomGlow);

      glassShine = glowSprite(1);
      glassShine.scale.set(3.5, H * 1.05, 1);
      glassShine.position.set(R_BOT * 0.55, 0, R_BOT * 0.8);
      glassShine.material.opacity = 0.1;
      group.add(glassShine);

      // blob physics state (rendered only through the field)
      blobs.length = 0;
      for (let i = 0; i < BLOBS; i++) {
        const size = i < 3 ? 2.6 + Math.random() * 1.3 : 1.1 + Math.random() * 1.4;
        blobs.push({
          y: -H / 2 + 1 + Math.random() * 3,
          vy: 0,
          size,
          phase: Math.random() * 100,
          lane: (i / BLOBS) * Math.PI * 2,
          laneR: 0.25 + (i % 3) * 0.3,
          spin: (i % 2 ? 1 : -1) * (0.02 + Math.random() * 0.03),
          poke: 0,
          x: 0, z: 0,
        });
      }

      // motes in the fluid
      const mp = new Float32Array(120 * 3);
      for (let i = 0; i < 120; i++) {
        const y = (Math.random() - 0.5) * H * 0.9;
        const r = Math.random() * (profile(y) - 1);
        const a = Math.random() * Math.PI * 2;
        mp[i * 3] = Math.cos(a) * r; mp[i * 3 + 1] = y; mp[i * 3 + 2] = Math.sin(a) * r;
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      motes = new THREE.Points(mg, glowPoints(0.4, 0.4));
      group.add(motes);

      sky = skyDome(200);
      group.add(sky);

      camera.fov = 60;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    placeGhost(p, i, out) {
      const a = (this._t || 0) * 0.25 + i * 1.9;
      out.set(Math.cos(a) * (19 + p.x * 4), Math.sin(a * 0.7 + i) * H * 0.4, Math.sin(a) * (19 + p.x * 4));
    },

    onTap(x, y) {
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      let best = null, bestD = 1e9;
      const bp = new THREE.Vector3();
      for (const b of blobs) {
        bp.set(b.x, b.y, b.z).sub(camera.position);
        const d = bp.cross(dir).length();
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best) { best.poke = 1; best.vy += 6; }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      this._t = time;

      if (participants && participants[0]) {
        participants[0].x = pointer.active ? pointer.x : Math.sin(time * 0.3) * 0.4;
        participants[0].y = 0;
      }

      const heat = Math.min(1, audio.bass * 0.9 * reactivity + audio.energy * 0.4);

      // wax physics — slow, viscous, cyclical
      const u = wax.material.uniforms;
      let slot = 0;
      // slot 0: the pool — a big blob sunk below the floor; risers neck off
      // it through the smooth-min for free
      u.uBlobs.value[slot++].set(0, -H / 2 - 3.2 + heat * 0.8, 0, 6.8);

      for (let i = 0; i < blobs.length && slot < MAX_FIELD; i++) {
        const b = blobs[i];
        const nearBottom = b.y < -H / 2 + 4;
        const altitude = (b.y + H / 2) / H;
        const warmth = (nearBottom ? heat * 2.2 : heat) - altitude * 1.1;
        const buoy = warmth * 2.6 + Math.sin(time * 0.13 + b.phase) * 0.35 - 0.35;
        b.vy += (buoy - b.vy) * Math.min(1, dt * 0.22);
        b.y += b.vy * dt * (1.1 + heat * 0.8);
        if (b.y > H / 2 - b.size - 0.5) { b.y = H / 2 - b.size - 0.5; b.vy = -0.25; }
        if (b.y < -H / 2 + 0.5) { b.y = -H / 2 + 0.5; b.vy = Math.max(0, b.vy); }
        b.poke *= Math.pow(0.05, dt);

        const maxOff = Math.max(0.3, profile(b.y) - b.size - 0.6);
        const ang = b.lane + time * b.spin;
        b.x = Math.cos(ang) * maxOff * b.laneR;
        b.z = Math.sin(ang) * maxOff * b.laneR;

        const wob = 1 + Math.sin(time * 1.4 + b.phase * 3) * 0.05 + b.poke * 0.2 + audio.bass * 0.08;
        u.uBlobs.value[slot++].set(b.x, b.y, b.z, b.size * wob);
      }
      u.uCount.value = slot;
      u.uHeat.value = heat;

      // theme colors: bottom of the wax vs top, rim from the hot end
      themePaint(colorMode, hue / 360, 0.06, 0, time, heat, 0.35, tp);
      colBot.setHSL(tp[0], Math.max(0.75, tp[1]), Math.min(0.5, Math.max(0.2, 0.34 * Math.min(1.4, tp[2])) + heat * 0.08));
      colRim.copy(colBot).multiplyScalar(1.7);
      themePaint(colorMode, hue / 360, 0.92, 0.3, time, heat, 0.7, tp);
      colTop.setHSL(tp[0], Math.max(0.7, tp[1]), Math.min(0.42, Math.max(0.13, 0.26 * Math.min(1.3, tp[2]))));

      // lamp hardware breathes with the heat
      bulbGlow.scale.setScalar(20 * (1 + heat * 0.5 + audio.beatIntensity * 0.25));
      bulbGlow.material.color.copy(colBot);
      bulbGlow.material.opacity = 0.3 + heat * 0.28;
      glass.material.color.copy(colBot);
      glass.material.opacity = 0.025 + heat * 0.03;
      roomGlow.material.color.copy(colBot);
      roomGlow.material.opacity = 0.06 + heat * 0.1 + audio.beatIntensity * 0.04;
      glassShine.material.opacity = 0.08 + heat * 0.05;
      motes.material.color.copy(colBot);
      motes.material.size = 0.4 + audio.high * 0.4;
      motes.rotation.y += dt * 0.03;
      sky.position.copy(camera.position);
      sky.material.color.copy(colBot).multiplyScalar(0.3);

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
