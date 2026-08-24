// CHERRY LAND — a dusk orchard of glowing cherry trees. Cherries pulse with
// the frequency bands, giant cherries bounce on beats, blossom petals drift
// down with the highs. Tap a cherry to POP it — juice everywhere.

import * as THREE from 'three';
import { glowSprite, glowPoints, glowTexture, skyDome } from '../lib/glow.js?v=644';
import { themePaint } from '../lib/themes.js?v=644';

const TREES = 30;
const CHERRIES_PER = 6;
const NCHERRY = TREES * CHERRIES_PER;
const SPAN = 420;
const HEROES = 5;           // giant bouncing cherries
const PETALS = 320;
const BANDS = ['bass', 'lowMid', 'mid', 'high', 'treble'];

export function createCherryLand() {
  let scene, camera, group, ground, trunks, canopies, cherries, cherryGlow, petals, sky, sun;
  let travel = 0;
  const tp = [0, 0, 0];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let pointer = { x: 0, active: false };

  // ── CATCH: the orchard becomes a game of hands, not timing alone ──
  // Cherries drop from the canopy on the chart's own beats and you swipe the
  // basket under them. A bomb costs you what you have already gathered, so the
  // skill is choosing what NOT to catch as much as what to catch — which is a
  // different pleasure from pressing in time, and the whole point of it being
  // a different game.
  const FALL_T = 1.5;          // seconds from canopy to basket
  // NOT `SPAN` — that is the module's orchard length (420) and shadowing it
  // here silently re-laid the trees, the ground, the hero cherries and the
  // petals over 15 units instead of 420, emptying the world.
  const REACH = 15;            // how far the basket can travel either side
  const CATCH_W = 2.9;         // forgiveness, in world units
  const MAX_FALLERS = 40;
  let basket = null, basketX = 0, basketLip = null;
  let catchTree = null, catchCanopy = null, basketPool = null;
  let pile = [];               // cherries visibly stacking in the basket
  let pileN = 0;               // how many the pile currently shows
  let overflowFlash = 0;       // the basket just paid out
  let fallers = [];            // {x, t0, bomb, alive, mesh}
  let chartAt = 0;             // read head into the chart
  let lastChartRef = null;
  let catchFlash = 0, bombFlash = 0;
  let steer = 0;

  const tx = new Float32Array(TREES), tz = new Float32Array(TREES);
  const th = new Float32Array(TREES), tseed = new Float32Array(TREES);
  const cPop = new Float32Array(NCHERRY);   // rest timer while on the ground
  const cFall = new Uint8Array(NCHERRY);    // 0 hanging, 1 falling, 2 resting
  const cfx = new Float32Array(NCHERRY), cfy = new Float32Array(NCHERRY);
  const cfz = new Float32Array(NCHERRY), cfvy = new Float32Array(NCHERRY);
  const cfvx = new Float32Array(NCHERRY), cfvz = new Float32Array(NCHERRY);
  const treeShake = new Float32Array(TREES);
  const heroes = [];
  let bursts = [];
  let juice = null;
  const juiceVel = new Float32Array(26 * 3);
  let juiceLife = 0;
  let scoreQueue = 0, scoreQX = 0, scoreQY = 0; // taps bank points; update() pays out

  const pathX = z => Math.sin(z * 0.012) * 18;
  const hillY = (x, z) => Math.sin(x * 0.045 + 1) * 1.6 + Math.sin(z * 0.03) * 1.9;

  function resetTree(i, z) {
    tz[i] = z;
    const side = (i % 2 ? 1 : -1);
    tx[i] = pathX(z) + side * (10 + Math.abs(Math.sin(i * 7.3)) * 12);
    th[i] = 9 + Math.abs(Math.sin(i * 3.1)) * 6;
    tseed[i] = Math.abs(Math.sin(i * 12.9898)) ;
  }

  return {
    name: 'CHERRY LAND',

    init(_scene, _camera) {
      scene = _scene; camera = _camera;
      group = new THREE.Group();
      scene.add(group);
      scene.fog = new THREE.FogExp2(0x0a0308, 0.008);

      // rolling ground
      const gg = new THREE.PlaneGeometry(240, SPAN + 80, 30, 60);
      gg.rotateX(-Math.PI / 2);
      gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 3), 3));
      ground = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      ground.frustumCulled = false;
      group.add(ground);

      // trunks + canopies
      trunks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.35, 0.7, 1, 7),
        new THREE.MeshBasicMaterial({ color: 0x1a0d12, toneMapped: false }),
        TREES
      );
      canopies = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        TREES
      );
      canopies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TREES * 3), 3);
      trunks.frustumCulled = canopies.frustumCulled = false;
      group.add(trunks, canopies);

      // cherries hanging under the canopies — glossy little spheres
      const cg = new THREE.SphereGeometry(0.55, 12, 12);
      {
        const pa = cg.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const t = 0.62 + (pa.getY(i) / 0.55 + 1) * 0.28; // top highlight = gloss
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        cg.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      }
      cherries = new THREE.InstancedMesh(
        cg,
        new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true }),
        NCHERRY
      );
      cherries.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NCHERRY * 3), 3);
      cherries.frustumCulled = false;
      group.add(cherries);

      for (let i = 0; i < TREES; i++) resetTree(i, -i * (SPAN / TREES));
      cPop.fill(0);

      // giant hero cherries that bounce on the beat: body + partner + stem
      heroes.length = 0;
      for (let i = 0; i < HEROES; i++) {
        const body = new THREE.Mesh(new THREE.SphereGeometry(1.7, 18, 18),
          new THREE.MeshBasicMaterial({ toneMapped: false }));
        const pal = new THREE.Mesh(new THREE.SphereGeometry(1.35, 16, 16), body.material.clone());
        const halo = glowSprite(7);
        group.add(body, pal, halo);
        heroes.push({ body, pal, halo, z: -30 - i * (SPAN / HEROES), y: 0, vy: 0, seed: Math.random() * 10 });
      }

      // blossom petals drifting down
      const pp = new Float32Array(PETALS * 3);
      for (let i = 0; i < PETALS; i++) {
        pp[i * 3] = (Math.random() - 0.5) * 140;
        pp[i * 3 + 1] = Math.random() * 26;
        pp[i * 3 + 2] = -Math.random() * SPAN;
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pp, 3).setUsage(THREE.DynamicDrawUsage));
      petals = new THREE.Points(pg, glowPoints(0.8, 0.75));
      petals.frustumCulled = false;
      group.add(petals);

      // pop burst rings
      bursts = [];
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1, 40),
          new THREE.MeshBasicMaterial({
            toneMapped: false, transparent: true, opacity: 0, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        m.visible = false;
        m.userData = { life: 0 };
        group.add(m);
        bursts.push(m);
      }

      // juice splash for direct cherry pops
      {
        const jp = new Float32Array(26 * 3);
        const jg = new THREE.BufferGeometry();
        jg.setAttribute('position', new THREE.BufferAttribute(jp, 3).setUsage(THREE.DynamicDrawUsage));
        juice = new THREE.Points(jg, glowPoints(1.1, 0));
        juice.frustumCulled = false;
        group.add(juice);
      }

      sun = glowSprite(60);
      sun.material.fog = false;
      group.add(sun);

      sky = skyDome(340);
      group.add(sky);

      travel = 0;
      camera.fov = 70;
      camera.updateProjectionMatrix();
    },

    setInput(x) { pointer.x = x; pointer.active = true; },

    // ── the catch rig, built lazily the first time a CATCH round runs ──
    _buildCatch() {
      if (basket) return;
      chartAt = 0;
      basket = new THREE.Group();

      // A near-black cup on near-black ground is a ring floating in a void.
      // Woven willow, lit warm, so it reads as an object sitting somewhere.
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(3.0, 2.0, 2.2, 22, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x8a5a2c, toneMapped: false, side: THREE.DoubleSide,
        })
      );
      basket.add(cup);
      // weave: three hoops around the cup, so it is basketwork and not a tube
      for (let i = 0; i < 3; i++) {
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(2.98 - i * 0.33, 0.09, 6, 26),
          new THREE.MeshBasicMaterial({ color: 0xb07a3e, toneMapped: false })
        );
        band.rotation.x = Math.PI / 2;
        band.position.y = 0.75 - i * 0.72;
        basket.add(band);
      }
      // the pool of light it stands in — this is what makes it a place
      // Additive, or the sprite's quad shows as a hard rectangle against the
      // dark orchard floor — which read as a blue box under the basket rather
      // than light pooling on the ground.
      basketPool = glowSprite(20);
      basketPool.material.blending = THREE.AdditiveBlending;
      basketPool.material.depthWrite = false;
      basketPool.material.opacity = 0.2;
      basket.add(basketPool);
      basketPool.position.y = -0.8;

      // ── the pile ── caught cherries visibly stack in the cup. THIS is the
      // "almost there" the round was missing: you can see the basket getting
      // full, and a full basket pays out and empties. Ten little spheres,
      // pre-placed, revealed one per catch.
      pile = [];
      const pileMat = new THREE.MeshBasicMaterial({ toneMapped: false });
      for (let i = 0; i < 10; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.46, 10, 8), pileMat.clone());
        const a = i * 2.39996;                       // golden-angle scatter
        const rr = 0.55 + (i % 3) * 0.45;
        b.position.set(Math.cos(a) * rr, 0.55 + Math.floor(i / 5) * 0.5, Math.sin(a) * rr);
        b.visible = false;
        basket.add(b);
        pile.push(b);
      }
      pileN = 0; overflowFlash = 0;
      basketLip = new THREE.Mesh(
        new THREE.TorusGeometry(3.0, 0.2, 8, 34),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      );
      basketLip.rotation.x = Math.PI / 2;
      basketLip.position.y = 1.1;
      basket.add(basketLip);
      group.add(basket);

      // ── the tree the fruit falls from ──
      // A basket in an open field is not a scene. The round happens under a
      // canopy, so the cherries have somewhere to fall FROM.
      catchTree = new THREE.Group();
      // Sized to the shot, not to a real tree. At 21 units ahead a 30-unit
      // canopy sits 51 degrees above the horizon — entirely out of frame. This
      // one fills the top of the picture, so you are plainly standing under it.
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.9, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x2a1409, toneMapped: false })
      );
      trunk.position.y = 8;
      const canopy = new THREE.Mesh(
        new THREE.SphereGeometry(13, 20, 14),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      );
      canopy.position.y = 19;
      canopy.scale.set(1.25, 0.55, 1.0);
      catchCanopy = canopy;
      catchTree.add(trunk, canopy);
      group.add(catchTree);

      // ── a cherry that looks like a cherry: a glossy pair on a stem ──
      const berry = new THREE.SphereGeometry(0.66, 14, 14);
      {
        const pa = berry.attributes.position;
        const vc = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const t = 0.55 + (pa.getY(i) / 0.66 + 1) * 0.3;   // top-lit gloss
          vc[i * 3] = t; vc[i * 3 + 1] = t; vc[i * 3 + 2] = t;
        }
        berry.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      }
      const stemGeo = new THREE.CylinderGeometry(0.075, 0.055, 2.1, 6);
      const bombGeo = new THREE.SphereGeometry(0.86, 16, 16);
      const fuseGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6);

      for (let i = 0; i < MAX_FALLERS; i++) {
        const g = new THREE.Group();

        // cherry: two berries hanging off a forked stem
        const fruit = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true });
        const b1 = new THREE.Mesh(berry, mat);
        const b2 = new THREE.Mesh(berry, mat);
        b1.position.set(-0.52, 0, 0);
        b2.position.set(0.5, -0.16, 0.1);
        b2.scale.setScalar(0.88);
        const stemMat = new THREE.MeshBasicMaterial({ color: 0x4f7a24, toneMapped: false });
        const s1 = new THREE.Mesh(stemGeo, stemMat);
        s1.position.set(-0.3, 0.95, 0); s1.rotation.z = 0.28;
        const s2 = new THREE.Mesh(stemGeo, stemMat);
        s2.position.set(0.3, 0.9, 0.05); s2.rotation.z = -0.24;
        const fruitGlow = glowSprite(4.2);
        fruit.add(b1, b2, s1, s2, fruitGlow);

        // bomb: a matte black ball with a fuse and a live spark
        const bomb = new THREE.Group();
        const shell = new THREE.Mesh(bombGeo, new THREE.MeshBasicMaterial({
          color: 0x0a0a0c, toneMapped: false,
        }));
        const collar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.34, 0.34, 10),
          new THREE.MeshBasicMaterial({ color: 0x241f22, toneMapped: false })
        );
        collar.position.y = 0.82;
        const fuse = new THREE.Mesh(fuseGeo, new THREE.MeshBasicMaterial({ color: 0x7a6a4a, toneMapped: false }));
        fuse.position.set(0.16, 1.4, 0); fuse.rotation.z = -0.42;
        const spark = glowSprite(2.4);
        spark.position.set(0.42, 1.9, 0);
        bomb.add(shell, collar, fuse, spark);

        g.add(fruit, bomb);
        g.visible = false;
        group.add(g);
        fallers.push({ mesh: g, fruit, bomb, spark, mat, fruitGlow, alive: false, x: 0, t0: 0, isBomb: false });
      }
    },

    // fellow wanderers float through the orchard as cherry-fireflies
    placeGhost(p, i, out) {
      const z = camera.position.z - 20 - (i % 6) * 10;
      out.set(pathX(z) + p.x * 10 + Math.sin(i * 2.9) * 6, 4 + Math.sin(i * 1.7) * 2, z);
    },

    // tap a CHERRY: it POPS — juice everywhere. Tap a tree: shake-down.
    onTap(x, y) {
      const v = new THREE.Vector3(x, y, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const cp = new THREE.Vector3();
      const m4 = new THREE.Matrix4();

      // direct cherry hit first — the juicy interaction
      let bestC = -1, bestCD = 1e9;
      for (let i = 0; i < NCHERRY; i++) {
        if (cFall[i] !== 0) continue;
        cherries.getMatrixAt(i, m4);
        cp.setFromMatrixPosition(m4).sub(camera.position);
        const along = cp.dot(dir);
        if (along < 3 || along > 110) continue;
        const d = cp.clone().cross(dir).length() / Math.max(1, along * 0.05);
        if (d < bestCD) { bestCD = d; bestC = i; }
      }
      if (bestC >= 0 && bestCD < 14) {
        cherries.getMatrixAt(bestC, m4);
        cp.setFromMatrixPosition(m4);
        // knock it loose: it drops, bounces on the hills, rests, regrows
        cFall[bestC] = 1;
        cfx[bestC] = cp.x; cfy[bestC] = cp.y; cfz[bestC] = cp.z;
        cfvy[bestC] = 3.5;                       // pops up off the stem first
        cfvx[bestC] = (Math.random() - 0.5) * 6;
        cfvz[bestC] = (Math.random() - 0.5) * 6;
        // burst ring + juice spray
        const b = bursts.find(x2 => !x2.visible) || bursts[0];
        b.visible = true;
        b.userData.life = 1;
        b.position.copy(cp);
        b.scale.setScalar(0.6);
        b.quaternion.copy(camera.quaternion);
        juiceLife = 1;
        const jpos = juice.geometry.attributes.position;
        for (let k = 0; k < 26; k++) {
          jpos.setXYZ(k, cp.x, cp.y, cp.z);
          juiceVel[k * 3] = (Math.random() - 0.5) * 14;
          juiceVel[k * 3 + 1] = 2 + Math.random() * 9;
          juiceVel[k * 3 + 2] = (Math.random() - 0.5) * 14;
        }
        jpos.needsUpdate = true;
        scoreQueue += 15; scoreQX = x; scoreQY = y; // clean pick — a direct hit
        return;
      }

      let best = -1, bestD = 1e9;
      for (let i = 0; i < TREES; i++) {
        cp.set(tx[i], hillY(tx[i], tz[i]) + th[i], tz[i]).sub(camera.position);
        const along = cp.dot(dir);
        if (along < 4 || along > 160) continue;
        const d = cp.clone().cross(dir).length() / Math.max(1, along * 0.05);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0 || bestD > 60) return;
      treeShake[best] = 1;
      // shake this tree's cherries loose from wherever they hang right now
      for (let c2 = 0; c2 < CHERRIES_PER; c2++) {
        const ci = best * CHERRIES_PER + c2;
        if (cFall[ci] !== 0) continue;
        cherries.getMatrixAt(ci, m4);
        cp.setFromMatrixPosition(m4);
        cFall[ci] = 1;
        cfx[ci] = cp.x; cfy[ci] = cp.y; cfz[ci] = cp.z;
        cfvy[ci] = 1 + Math.random() * 2;
        cfvx[ci] = (Math.random() - 0.5) * 4;
        cfvz[ci] = (Math.random() - 0.5) * 4;
        scoreQueue += 5; scoreQX = x; scoreQY = y; // shaken loose — bulk harvest
        const b = bursts.find(x2 => !x2.visible);
        if (b && c2 === 0) {
          b.visible = true;
          b.userData.life = 1;
          b.position.copy(cp);
          b.scale.setScalar(0.6);
          b.quaternion.copy(camera.quaternion);
        }
      }
    },

    update(dt, audio, participants, opts) {
      const { reactivity, hue, attract, time, colorMode = 'rainbow', race = null, chart = null, songTime = 0 } = opts;
      const catching = !!(race && race.active && race.mode === 'CATCH');
      if (catching) {
        this._buildCatch();
        // Stand somewhere with trees. Frozen at the path's origin the orchard
        // is behind you and the round plays against an empty field.
        if (travel < 40) travel = 90;
      }
      if (basket) basket.visible = catching;

      if (scoreQueue && opts.addScore) { opts.addScore(scoreQueue, scoreQX, scoreQY); scoreQueue = 0; }

      // Catching, the orchard holds still: you cannot judge where a cherry will
      // land while the ground is sliding past you. Drifting is for VIBE.
      if (!catching) travel += dt * (4 + audio.volume * 9 + audio.energy * 4);
      const camZ = -travel;
      if (attract || !pointer.active) steer += (Math.sin(time * 0.22) * 0.4 - steer) * Math.min(1, dt);
      else steer += (pointer.x - steer) * Math.min(1, dt * 1.5);

      if (catching) {
        catchFlash *= Math.pow(0.02, dt);
        bombFlash *= Math.pow(0.05, dt);

        // the basket follows your thumb, and stays on the orchard floor
        const want = (pointer.active ? pointer.x : Math.sin(time * 0.5) * 0.4) * REACH;
        basketX += (want - basketX) * Math.min(1, dt * 9);
        // camZ is authoritative now that the catch shot is derived from it too
        const bz = camZ - 21;
        basket.position.set(pathX(bz) + basketX, hillY(pathX(bz) + basketX, bz) + 1.2, bz);
        // the pile shows what you hold; overflow flashes the whole basket gold
        overflowFlash = Math.max(0, overflowFlash - dt * 1.4);
        for (let i = 0; i < pile.length; i++) {
          pile[i].visible = i < pileN;
          if (pile[i].visible) {
            pile[i].material.color.setHSL(0.99, 0.85, 0.42 + overflowFlash * 0.4);
            const wob = Math.sin(time * 3 + i) * 0.03;
            pile[i].scale.setScalar(1 + wob + overflowFlash * 0.3);
          }
        }
        // The basket answers what just happened to it: bright on a catch, an
        // angry red on a bomb. Before this, catching a bomb changed a number
        // somewhere and nothing else — an event you could entirely miss.
        if (bombFlash > 0.03) {
          color.setHSL(0.01, 0.95, 0.35 + bombFlash * 0.35);
        } else {
          color.setHSL((hue / 360 + 0.02) % 1, 0.7, 0.5 + catchFlash * 0.4);
        }
        basketLip.material.color.copy(color);
        basketPool.material.color.copy(color);
        basketPool.material.opacity = 0.18 + catchFlash * 0.3 + bombFlash * 0.4 + audio.volume * 0.06;

        // the tree the fruit falls out of, standing right over the basket
        // The trunk stands well BEHIND the basket's travel line, and does not
        // slide with the basket. Three units back, it sat in the sweep and the
        // basket passed straight through it — the canopy still reads as
        // overhead from the camera's angle, but the wood is out of the lane.
        catchTree.position.set(pathX(bz), hillY(pathX(bz), bz), bz - 11);
        // A leaf canopy is green, like every other tree in this orchard.
        // Theme-painting it turned it blue under a cool palette, which made
        // the one tree you play under the one tree that looks wrong.
        color.setHSL(0.29, 0.55, 0.20 + audio.volume * 0.08);
        catchCanopy.material.color.copy(color);
        catchCanopy.scale.set(1.25 + audio.bass * 0.05, 0.55 + audio.bass * 0.03, 1.0);

        // Drop a cherry for every note, timed so it ARRIVES on the beat — the
        // music still writes the round, the hands just answer it differently.
        if (chart !== lastChartRef) { lastChartRef = chart; chartAt = 0; }
        if (chart) {
          while (chartAt < chart.length && chart[chartAt].t - FALL_T <= songTime) {
            const n = chart[chartAt++];
            if (n.t < songTime) continue;      // stale — never spawn behind the playhead                  // seeked past
            const f = fallers.find(x => !x.alive);
            if (!f) continue;
            f.alive = true;
            f.t0 = n.t;                                    // when it lands
            // bombs on the weakest beats, so the fruit rides the music
            f.isBomb = !n.accent && ((chartAt * 7919) % 100) < 18;
            // The drop follows PHRASES, not dice. Eight-note stretches take a
            // shape — a sweep across the lane, a zigzag, a tight cluster —
            // so you read where the next few will land and move early. Pure
            // hash placement never varies in character, which is why it
            // played as too easy: every catch was the same catch.
            const phrase = Math.floor(chartAt / 8) % 3;
            const step = chartAt % 8;
            if (phrase === 0)      f.x = (step / 7 * 2 - 1) * REACH * ((Math.floor(chartAt / 8) % 2) ? -1 : 1);
            else if (phrase === 1) f.x = (step % 2 ? 0.75 : -0.75) * REACH * (1 - step * 0.07);
            else                   f.x = (Math.sin(chartAt * 1.7) * 0.3 + ((chartAt % 16) < 8 ? 0.55 : -0.55)) * REACH;
            // accented notes fall FAST — a third quicker, the ones that catch
            // you flat-footed and make a clean phrase feel earned
            f.fast = n.accent && !f.isBomb;
            // one cherry in twelve is GOLDEN: faster, brighter, worth five.
            // Rare enough to be an event, common enough to be chased.
            f.gold = !f.isBomb && ((chartAt * 104729) % 100) < 8;
            f.spin = ((chartAt * 37) % 100) / 100 * 6.28;
            f.mesh.visible = true;
            f.fruit.visible = !f.isBomb;
            f.bomb.visible = f.isBomb;
          }
        }

        for (const f of fallers) {
          if (!f.alive) continue;
          const left = f.t0 - songTime;                    // seconds until it lands
          const fallT = (f.fast || f.gold) ? FALL_T * 0.62 : FALL_T;
          const u = 1 - Math.max(0, Math.min(1, left / fallT));
          const fz = camZ - 21;
          const fx = pathX(fz) + f.x;
          const groundY = hillY(fx, fz) + 1.2;
          f.mesh.position.set(fx, groundY + (1 - u) * 16.5, fz);   // out of the canopy
          // Stale from the sphere version: `f.mesh` is a Group now and Groups
          // have no material, and `f.bomb` is the bomb Group (always truthy)
          // rather than the flag. It threw every frame, which killed the whole
          // render loop — the app did not slow down, it stopped.
          if (!f.isBomb) {
            // a cherry is red whatever the palette says; the entire game is
            // telling fruit from bomb at a glance
            // PURPLE, deliberately — the orchard is full of red cherries on
            // trees and hills, and red falling fruit vanished into them. The
            // one thing you can catch is the one thing in this colour.
            if (f.gold) {
              color.setHSL(0.12, 1, 0.55 + Math.sin(songTime * 9) * 0.12);
              f.mat.color.copy(color);
              f.fruitGlow.material.color.setHSL(0.12, 1, 0.6);
              f.fruitGlow.material.opacity = 0.55 + u * 0.4;
            } else {
              color.setHSL(0.78, 0.85, 0.48 + u * 0.14);
              f.mat.color.copy(color);
              f.fruitGlow.material.color.setHSL(0.78, 0.9, 0.58);
              f.fruitGlow.material.opacity = 0.35 + u * 0.4;
            }
          } else {
            // the fuse burns brighter the closer it gets, so a bomb reads as a
            // decision rather than a colour
            f.spark.material.color.setHSL(0.09, 1, 0.55 + u * 0.25);
            f.spark.material.opacity = 0.7 + u * 0.3;
            f.spark.scale.setScalar(0.5 + u * 0.9 + audio.volume * 0.3);
          }
          f.mesh.rotation.z = Math.sin(songTime * 2.2 + f.spin) * 0.3;
          f.mesh.rotation.y = f.spin + songTime * (f.isBomb ? 1.1 : 2.0);
          f.mesh.scale.setScalar(f.isBomb ? 1.15 : 1);

          if (left <= 0) {
            const caught = Math.abs(f.x - basketX) < CATCH_W;
            if (caught && f.isBomb) {
              race.drop(4); bombFlash = 1;
              if (opts.impact) opts.impact(1.0);
            } else if (caught) {
              race.collect(f.gold ? 5 : 1); catchFlash = 1;
              if (opts.impact) opts.impact(f.gold ? 0.7 : 0.28);
              // the pile grows — and a FULL basket pays out and empties
              pileN = Math.min(10, pileN + (f.gold ? 3 : 1));
              if (pileN >= 10) {
                pileN = 0;
                overflowFlash = 1;
                race.collect(5);               // the overflow bonus
                if (opts.impact) opts.impact(0.9);
              }
            } else if (!f.isBomb) {
              race.drop(0);            // a fumble breaks the streak, costs nothing
            }
            f.alive = false;
            f.mesh.visible = false;
          }
        }
      }

      if (participants && participants[0]) {
        participants[0].x = steer;
        participants[0].y = 0;
      }

      if (catching) {
        // A catching game needs its own shot: the basket low in the frame with
        // clear air above it for the fruit to fall through, and the canopy
        // overhead. The wandering orchard camera looks UP and puts the basket
        // on the horizon, which is unplayable.
        // Pull back and sit lower: from close and high the canopy swallowed the
        // top third of the frame and everything under it went black. From here
        // you see the trunk, the fall, the basket and the orchard behind — a
        // place rather than a green ceiling over a dark field.
        const bx = pathX(camZ - 21);
        camera.position.set(bx + basketX * 0.3, 8.0, camZ + 9);
        camera.lookAt(bx + basketX * 0.55, 5.2, camZ - 21);
      } else {
        camera.position.set(pathX(camZ) + steer * 9, 4.8 + Math.sin(time * 0.4) * 0.5, camZ);
        camera.lookAt(pathX(camZ - 50), 7.5, camZ - 50);
      }
      camera.rotation.z += steer * -0.04;

      // ground: themed dusk meadow
      ground.position.z = camZ - SPAN / 2 + 50;
      const gp = ground.geometry.attributes.position;
      const gc = ground.geometry.attributes.color;
      const gCols = 31, gRows = 61;
      for (let r = 0; r < gRows; r++) {
        for (let c2 = 0; c2 < gCols; c2++) {
          const i = r * gCols + c2;
          const wz = ground.position.z + (r / (gRows - 1) - 0.5) * (SPAN + 80);
          const wx = (c2 / (gCols - 1) - 0.5) * 240;
          gp.setY(i, hillY(wx, wz));
          const jitv = Math.abs(Math.sin(c2 * 12.99 + r * 78.23));
          const crest = Math.max(0, hillY(wx, wz)) * 0.18; // crests catch the dusk light
          themePaint(colorMode, hue / 360, 0.08, wz * 0.01, time, audio.volume * 0.5, jitv, tp);
          color.setHSL(tp[0], tp[1] * 0.12, Math.min(0.055, 0.015 + crest * 0.3 + audio.volume * 0.012));
          gc.setXYZ(i, color.r, color.g, color.b);
        }
      }
      gp.needsUpdate = true;
      gc.needsUpdate = true;

      // trees recycle down the orchard rows
      let ci = 0;
      for (let i = 0; i < TREES; i++) {
        if (tz[i] > camZ + 25) {
          resetTree(i, tz[i] - SPAN);
          for (let c2 = 0; c2 < CHERRIES_PER; c2++) { cFall[i * CHERRIES_PER + c2] = 0; cPop[i * CHERRIES_PER + c2] = 0; }
        }
        const gy = hillY(tx[i], tz[i]);
        const sway = Math.sin(time * 0.6 + tseed[i] * 9) * 0.05;

        dummy.position.set(tx[i], gy + th[i] / 2, tz[i]);
        dummy.scale.set(1, th[i], 1);
        dummy.rotation.set(0, 0, sway * 0.4);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);

        treeShake[i] *= Math.pow(0.04, dt);
        const canopyR = th[i] * 0.55 * (1 + audio.bass * 0.08 * reactivity + treeShake[i] * 0.12 * Math.sin(time * 28));
        dummy.position.set(tx[i], gy + th[i] + canopyR * 0.4, tz[i]);
        dummy.scale.setScalar(canopyR);
        dummy.rotation.set(sway, tseed[i] * 6, sway);
        dummy.updateMatrix();
        canopies.setMatrixAt(i, dummy.matrix);
        themePaint(colorMode, hue / 360, 0.55 + tseed[i] * 0.3, tz[i] * 0.01, time, audio.mid, tseed[i], tp);
        color.setHSL(tp[0], tp[1] * 0.8, Math.min(0.3, 0.12 + audio.mid * 0.12 * Math.min(1.4, tp[2])));
        canopies.setColorAt(i, color);

        // cherries hang under the canopy rim — or fall, bounce, and rest
        const shake = treeShake[i];
        for (let c2 = 0; c2 < CHERRIES_PER; c2++, ci++) {
          const a = (c2 / CHERRIES_PER) * Math.PI * 2 + tseed[i] * 7;
          const level = audio[BANDS[(i + c2) % BANDS.length]];
          if (cFall[ci] === 1) {
            // falling: gravity + bounce off the hills
            cfvy[ci] -= 28 * dt;
            cfx[ci] += cfvx[ci] * dt;
            cfy[ci] += cfvy[ci] * dt;
            cfz[ci] += cfvz[ci] * dt;
            const gnd = hillY(cfx[ci], cfz[ci]) + 0.55;
            if (cfy[ci] < gnd) {
              cfy[ci] = gnd;
              if (Math.abs(cfvy[ci]) > 2.2) {
                cfvy[ci] = Math.abs(cfvy[ci]) * 0.55; // bounce!
                cfvx[ci] *= 0.7; cfvz[ci] *= 0.7;
              } else {
                cFall[ci] = 2; cPop[ci] = 3; // rest, then regrow
              }
            }
            dummy.position.set(cfx[ci], cfy[ci], cfz[ci]);
            dummy.scale.setScalar(1 + level * 0.6);
          } else if (cFall[ci] === 2) {
            cPop[ci] -= dt;
            if (cPop[ci] <= 0) cFall[ci] = 0; // back on the branch
            if (cfy[ci] < -100) {
              dummy.position.set(0, -999, 0); // popped clean away
              dummy.scale.setScalar(0.001);
            } else {
              dummy.position.set(cfx[ci], hillY(cfx[ci], cfz[ci]) + 0.55, cfz[ci]);
              dummy.scale.setScalar(Math.max(0.001, 1 + level * 0.4) * Math.min(1, cPop[ci]));
            }
          } else {
            const swing = Math.sin(time * 1.1 + ci) * 0.25 + shake * Math.sin(time * 30 + ci) * 1.1;
            dummy.position.set(
              tx[i] + Math.cos(a) * canopyR * 0.75 + swing,
              gy + th[i] + canopyR * 0.4 - canopyR * 0.8 - Math.abs(Math.sin(ci * 3.3)) * 1.2,
              tz[i] + Math.sin(a) * canopyR * 0.75
            );
            dummy.scale.setScalar(1 + level * 1.1 * reactivity + audio.beatIntensity * 0.15);
          }
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          cherries.setMatrixAt(ci, dummy.matrix);
          // cherry red, warmed toward the hue in follow-hue modes
          const cherryHue = 0.975 + level * 0.03;
          color.setHSL(cherryHue % 1, 0.95, Math.min(0.68, 0.3 + level * 0.4 * reactivity + audio.beatIntensity * 0.1 + shake * 0.25));
          cherries.setColorAt(ci, color);
        }
      }
      trunks.instanceMatrix.needsUpdate = true;
      canopies.instanceMatrix.needsUpdate = true;
      canopies.instanceColor.needsUpdate = true;
      cherries.instanceMatrix.needsUpdate = true;
      cherries.instanceColor.needsUpdate = true;

      // hero cherries bounce down the path on beats
      for (const hcherry of heroes) {
        if (hcherry.z > camZ + 20) hcherry.z -= SPAN;
        const gx = pathX(hcherry.z) + Math.sin(hcherry.seed * 9) * 8;
        const gy = hillY(gx, hcherry.z) + 1.7;
        hcherry.vy -= 34 * dt;
        if (audio.beat && hcherry.y <= gy + 0.2) hcherry.vy = 9 + audio.beatIntensity * 14 * reactivity;
        hcherry.y = Math.max(gy, hcherry.y + hcherry.vy * dt);
        if (hcherry.y === gy && hcherry.vy < 0) hcherry.vy = 0;

        const squash = hcherry.y <= gy + 0.1 && Math.abs(hcherry.vy) < 1 ? 0.92 : 1.05;
        hcherry.body.position.set(gx, hcherry.y, hcherry.z);
        hcherry.body.scale.set(1 / squash, squash, 1 / squash);
        hcherry.pal.position.set(gx + 2.1, hcherry.y - 0.4, hcherry.z + 0.4);
        color.setHSL(0.978, 0.95, 0.42 + audio.bass * 0.15);
        hcherry.body.material.color.copy(color);
        hcherry.pal.material.color.copy(color).multiplyScalar(0.9);
        hcherry.halo.position.set(gx + 1, hcherry.y, hcherry.z);
        hcherry.halo.material.color.copy(color);
        hcherry.halo.material.opacity = 0.3 + audio.bass * 0.25;
      }

      // petals fall with the highs, drift, wrap
      const ppos = petals.geometry.attributes.position;
      for (let i = 0; i < PETALS; i++) {
        let y = ppos.getY(i) - dt * (0.8 + audio.high * 3);
        if (y < 0) y = 24 + Math.random() * 4;
        ppos.setY(i, y);
        ppos.setX(i, ppos.getX(i) + Math.sin(time * 0.8 + i) * dt * 1.5);
        const z = ppos.getZ(i);
        if (z > camZ + 15) ppos.setZ(i, z - SPAN);
      }
      ppos.needsUpdate = true;
      color.setHSL(0.93, 0.7, 0.5 + audio.high * 0.2);
      petals.material.color.copy(color);
      petals.material.size = 0.8 + audio.high * 0.5;

      // juice spray: arcs out, falls, fades
      if (juiceLife > 0.02) {
        juiceLife *= Math.pow(0.1, dt);
        const jpos = juice.geometry.attributes.position;
        for (let k = 0; k < 26; k++) {
          juiceVel[k * 3 + 1] -= 22 * dt;
          jpos.setXYZ(k,
            jpos.getX(k) + juiceVel[k * 3] * dt,
            Math.max(0.3, jpos.getY(k) + juiceVel[k * 3 + 1] * dt),
            jpos.getZ(k) + juiceVel[k * 3 + 2] * dt
          );
        }
        jpos.needsUpdate = true;
        juice.material.opacity = juiceLife;
        color.setHSL(0.97, 0.95, 0.55);
        juice.material.color.copy(color);
        juice.material.size = 1 + (1 - juiceLife) * 0.8;
      } else {
        juice.material.opacity = 0;
      }

      // pop bursts
      for (const b of bursts) {
        if (!b.visible) continue;
        b.userData.life -= dt * 2.2;
        if (b.userData.life <= 0) { b.visible = false; continue; }
        b.scale.addScalar(dt * 30);
        b.quaternion.copy(camera.quaternion);
        color.setHSL(0.97, 0.95, 0.6);
        b.material.color.copy(color);
        b.material.opacity = b.userData.life * 0.9;
      }

      // dusk sun + themed sky
      sun.position.set(pathX(camZ - 280) - 30, 30, camZ - 300);
      color.setHSL(0.05, 0.85, 0.6);
      sun.material.color.copy(color);
      sun.material.opacity = 0.5 + audio.energy * 0.2;
      sky.position.copy(camera.position);
      themePaint(colorMode, hue / 360, 0.5, 0, time, audio.energy, 0.5, tp);
      sky.material.color.setHSL(tp[0], tp[1] * 0.5, 0.24 + audio.energy * 0.15);

      const fovT = 70 + audio.volume * 6 * reactivity + audio.beatIntensity * 3;
      camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.fog = null;
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.remove(group);
      heroes.length = 0;
      bursts = [];
    },
  };
}
