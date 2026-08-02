// MAGIC GARDEN — three makes the magic number. Every tap plants a bloom in
// the vivid dirt (magenta for me, cyan for you, player three's electric
// blue); chain three blooms fast and the combo ladder climbs 3 → 9 → 12 → 15.
// Friends' taps plant in YOUR garden too, and the canopy overhead only
// blooms in when the room holds three or more — you can't build it alone.

import * as THREE from 'three';
import { glowSprite, glowPoints, skyDome } from '../lib/glow.js';
import { themePaint } from '../lib/themes.js';

const FLOWERS = 72;          // planted bloom pool (oldest recycles)
const TRIO = [0.86, 0.5, 0.62]; // magenta / cyan / electric blue hues
const DEW = 320;

export function createGarden() {
  let scene, camera, group, sky, stems, petals, halos, dew, ground, canopy = [], vine;
  const rings = [];
  let travel = 0, nextFlower = 0, planted = 0;
  let chain = 0, chainT = 0;   // combo ladder state
  let comboFlash = 0;
  let scoreQueue = 0, scoreQX = 0, scoreQY = 0;
  const tp = [0, 0, 0];
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  let pointer = { x: 0, y: 0, active: false };

  // flower state
  const fx = new Float32Array(FLOWERS), fz = new Float32Array(FLOWERS);
  const fh = new Float32Array(FLOWERS);   // grown height
  const fage = new Float32Array(FLOWERS); // seconds since planting
  const fhue = new Float32Array(FLOWERS);
  const falive = new Uint8Array(FLOWERS);
  const last3 = [];                       // indices of the newest blooms (vine hops between them)

  const groundY = (x, z) => Math.sin(x * 0.07) * 1.1 + Math.cos(z * 0.05 + x * 0.02) * 1.4;

  return {
    name: 'MAGIC GARDEN',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x020408, 0.012);

      // the vivid dirt — a dark rolling floor lit by everything above it
      const gg = new THREE.PlaneGeometry(240, 240, 48, 48);
      gg.rotateX(-Math.PI / 2);
      {
        const pa = gg.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          pa.setY(i, groundY(pa.getX(i), pa.getZ(i)));
          const t = 0.5 + Math.random() * 0.5;
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        gg.setAttribute('color', new THREE.BufferAttribute(vc, 3));
        gg.computeVertexNormals();
      }
      ground = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      ground.frustumCulled = false;
      group.add(ground);

      // dew — tiny lights scattered in the dirt, shimmering with the highs
      const dp = new Float32Array(DEW * 3);
      for (let i = 0; i < DEW; i++) {
        const x = (Math.random() - 0.5) * 200, z = (Math.random() - 0.5) * 200;
        dp[i * 3] = x; dp[i * 3 + 1] = groundY(x, z) + 0.15; dp[i * 3 + 2] = z;
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      dew = new THREE.Points(dg, glowPoints(0.5, 0.5));
      dew.frustumCulled = false;
      group.add(dew);

      // flower pool: instanced stems + point sprite heads (core + halo)
      stems = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.16, 1, 0.16),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        FLOWERS
      );
      stems.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      stems.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FLOWERS * 3), 3);
      stems.frustumCulled = false;
      group.add(stems);

      const mkPts = (size, op) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLOWERS * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FLOWERS * 3), 3).setUsage(THREE.DynamicDrawUsage));
        const p = new THREE.Points(g, glowPoints(size, op));
        p.material.vertexColors = true;
        p.frustumCulled = false;
        group.add(p);
        return p;
      };
      petals = mkPts(2.6, 0.95);
      halos = mkPts(6.5, 0.35);

      // plant-burst rings
      for (let i = 0; i < 6; i++) {
        const r = new THREE.Mesh(
          new THREE.RingGeometry(0.7, 1, 40),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        r.rotation.x = -Math.PI / 2;
        group.add(r);
        rings.push(r);
      }

      // combo vine — a glowing thread hopping between the last three blooms
      vine = new THREE.Line(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 3), 3).setUsage(THREE.DynamicDrawUsage)),
        new THREE.LineBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, blending: THREE.AdditiveBlending })
      );
      vine.frustumCulled = false;
      group.add(vine);

      // the canopy — only blooms in when the room has three or more
      canopy = [];
      for (let i = 0; i < 22; i++) {
        const c = glowSprite(14 + Math.random() * 14);
        c.position.set((Math.random() - 0.5) * 150, 22 + Math.random() * 10, (Math.random() - 0.5) * 150);
        c.material.opacity = 0;
        group.add(c);
        canopy.push(c);
      }

      sky = skyDome(260);
      group.add(sky);

      for (let i = 0; i < FLOWERS; i++) falive[i] = 0;
      travel = 0; nextFlower = 0; planted = 0; chain = 0; chainT = 0; comboFlash = 0;
      last3.length = 0;

      // wild blooms — the garden is already alive when you arrive
      for (let k = 0; k < 20; k++) {
        const i = nextFlower++ % FLOWERS;
        fx[i] = (Math.random() - 0.5) * 90;
        fz[i] = -10 - Math.random() * 120;
        fh[i] = 0; fage[i] = Math.random() * 3; falive[i] = 1;
        fhue[i] = TRIO[k % 3];
      }
      planted = 0; // wild ones don't advance your color rotation

      camera.fov = 66;
      camera.updateProjectionMatrix();
    },

    setInput(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; },

    placeGhost(p, i, out) {
      const a = i * 2.1 + (this._t || 0) * 0.12;
      const x = Math.sin(a) * (13 + (i % 3) * 5) + p.x * 3;
      const z = camera.position.z - 16 - (i % 5) * 9;
      out.set(x, groundY(x, z) + 2.2, z);
    },

    // tap = plant a bloom where the dirt was touched
    onTap(x, y) {
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      if (dir.y > -0.02) dir.y = -0.02; // always find the ground
      const t = Math.min(90, Math.max(16, -(camera.position.y - 1) / dir.y)); // plant ahead of your stride
      const px = camera.position.x + dir.x * t;
      const pz = camera.position.z + dir.z * t;

      const i = nextFlower++ % FLOWERS;
      fx[i] = px; fz[i] = pz;
      fh[i] = 0; fage[i] = 0; falive[i] = 1;
      fhue[i] = TRIO[planted % 3]; // magenta for me, cyan for you, electric blue
      planted++;
      last3.push(i);
      if (last3.length > 3) last3.shift();

      // ring burst where the petal ignites
      const r = rings.find(q => q.material.opacity <= 0.01) || rings[0];
      r.position.set(px, groundY(px, pz) + 0.25, pz);
      r.scale.setScalar(1);
      r.material.opacity = 0.9;
      color.setHSL(fhue[i], 0.95, 0.6);
      r.material.color.copy(color);

      // the ladder: 3 for the bloom, then 9, 12, 15 as the chain climbs
      chainT = 4; // keep the combo alive for 4s
      chain++;
      const ladder = [3, 9, 12, 15];
      const bonus = ladder[Math.min(chain - 1, 3)];
      scoreQueue += bonus; scoreQX = x; scoreQY = y;
      if (chain >= 3) comboFlash = 1; // magic number!
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow' } = opts;
      this._t = time;

      if (scoreQueue && opts.addScore) { opts.addScore(scoreQueue, scoreQX, scoreQY); scoreQueue = 0; }

      // combo window
      chainT -= dt;
      if (chainT <= 0) chain = 0;
      comboFlash = Math.max(0, comboFlash - dt * 0.7);

      // footsteps: drift through the garden, a bass hum in every step
      travel += dt * (2.2 + audio.energy * 5 + audio.volume * 2.5);
      const camZ = -travel;
      const sway = Math.sin(time * 0.24) * 5;
      camera.position.set(
        sway + (attract ? 0 : pointer.x * 6),
        4.2 + Math.sin(time * 0.4) * 0.4 + audio.bass * 0.6,
        camZ
      );
      camera.lookAt(sway * 0.4, 2.6 + (attract ? 0 : pointer.y * 3), camZ - 26);

      // grow + render the flowers
      const pp = petals.geometry.attributes.position;
      const pc = petals.geometry.attributes.color;
      const hp = halos.geometry.attributes.position;
      const hc = halos.geometry.attributes.color;
      const beatPulse = 1 + audio.beatIntensity * 0.55 * reactivity;
      for (let i = 0; i < FLOWERS; i++) {
        if (!falive[i]) {
          dummy.position.set(0, -999, 0); dummy.scale.setScalar(0.001);
          dummy.updateMatrix(); stems.setMatrixAt(i, dummy.matrix);
          pp.setXYZ(i, 0, -999, 0); hp.setXYZ(i, 0, -999, 0);
          continue;
        }
        fage[i] += dt;
        // blooms you've walked past replant themselves ahead — endless garden
        if (fz[i] > camera.position.z + 14) {
          fx[i] = camera.position.x + (Math.random() - 0.5) * 90;
          fz[i] = camera.position.z - 50 - Math.random() * 90;
          fh[i] = 0; fage[i] = 0;
        }
        // vines grow rapidly as players sync up
        const target = 2.6 + Math.sin(i * 7.3) * 1.1;
        fh[i] += (target - fh[i]) * Math.min(1, dt * (2.2 + audio.energy * 3));
        const gy = groundY(fx[i], fz[i]);
        const wob = Math.sin(time * 1.6 + i) * 0.08;

        dummy.position.set(fx[i], gy + fh[i] / 2, fz[i]);
        dummy.scale.set(1, Math.max(0.05, fh[i]), 1);
        dummy.rotation.set(wob, 0, wob * 1.3);
        dummy.updateMatrix();
        stems.setMatrixAt(i, dummy.matrix);
        themePaint(colorMode, fhue[i], 0.3, 0.5, time, audio.energy, i / FLOWERS, tp);
        color.setHSL(fhue[i], 0.85, 0.32).multiplyScalar(0.8 + audio.bass * 0.5);
        stems.setColorAt(i, color);

        const head = gy + fh[i] + 0.3;
        pp.setXYZ(i, fx[i], head, fz[i]);
        hp.setXYZ(i, fx[i], head, fz[i]);
        const fresh = Math.min(1, fage[i] * 1.4);
        color.setHSL(fhue[i], 0.95, 0.5 + 0.16 * Math.sin(time * 2 + i)).multiplyScalar((0.7 + fresh * 0.9) * beatPulse);
        pc.setXYZ(i, color.r, color.g, color.b);
        color.multiplyScalar(0.5);
        hc.setXYZ(i, color.r, color.g, color.b);
      }
      stems.instanceMatrix.needsUpdate = true;
      stems.instanceColor.needsUpdate = true;
      pp.needsUpdate = true; pc.needsUpdate = true;
      hp.needsUpdate = true; hc.needsUpdate = true;
      petals.material.size = 2.6 * beatPulse;
      halos.material.size = 6.5 * (1 + comboFlash * 0.8) * beatPulse;

      // burst rings breathe out
      for (const r of rings) {
        if (r.material.opacity <= 0.01) continue;
        r.material.opacity *= Math.pow(0.12, dt);
        r.scale.multiplyScalar(1 + dt * 7);
      }

      // the vine threads the last three blooms while the combo is alive
      const alive3 = last3.filter(i => falive[i]);
      if (alive3.length === 3 && chain >= 3 && chainT > 0) {
        const vp = vine.geometry.attributes.position;
        alive3.forEach((fi, k) => {
          vp.setXYZ(k, fx[fi], groundY(fx[fi], fz[fi]) + fh[fi] + 0.3, fz[fi]);
        });
        vp.needsUpdate = true;
        color.setHSL((time * 0.25) % 1, 0.95, 0.62).multiplyScalar(1.4);
        vine.material.color.copy(color);
        vine.material.opacity = 0.5 + comboFlash * 0.5 + audio.beatIntensity * 0.3;
      } else {
        vine.material.opacity *= Math.pow(0.05, dt);
      }

      // canopy: needs THREE — root, sprout, and wild bloom
      const souls = participants ? participants.length : 1;
      const canopyIn = Math.min(1, souls / 3) * (souls >= 3 ? 1 : 0.25);
      canopy.forEach((c, i) => {
        themePaint(colorMode, TRIO[i % 3], 0.7, 0.8, time, audio.energy, i / canopy.length, tp);
        c.material.color.setHSL(TRIO[i % 3], 0.8, 0.4);
        c.material.opacity = canopyIn * (0.1 + 0.08 * Math.sin(time * 0.5 + i * 2)) * (1 + audio.energy * 0.8);
        c.position.z += Math.sin(time * 0.1 + i) * dt * 2;
      });

      // dirt + dew answer the music
      themePaint(colorMode, hue / 360, 0.1, 0, time, audio.energy, 0.4, tp);
      ground.material.color.setHSL(tp[0], tp[1] * 0.7, 0.028 + audio.bass * 0.03 + comboFlash * 0.05);
      dew.material.color.setHSL((hue / 360 + 0.45) % 1, 0.8, 0.55 + audio.high * 0.3);
      dew.material.size = 0.9 + audio.high * 1.0 + comboFlash * 0.6;

      sky.position.copy(camera.position);
      sky.material.color.setHSL(tp[0], tp[1] * 0.5, 0.16 + audio.energy * 0.1 + comboFlash * 0.12);

      // recycle the ground and dew under the endless walk
      if (ground.position.z > camZ + 60) ground.position.z = camZ;
      ground.position.z += ((camZ) - ground.position.z) * Math.min(1, dt * 0.5);
      dew.position.z = ground.position.z;

      const fovT = 66 + audio.volume * 6 * reactivity + comboFlash * 6;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();

      if (participants && participants[0]) {
        participants[0].x = attract ? Math.sin(time * 0.3) * 0.4 : pointer.x;
        participants[0].y = 0;
      }
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
    },
  };
}
