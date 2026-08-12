// Presence layer — remote participants render as glowing motes in the scene,
// with crisp screen-space nameplates projected on top as DOM (never touched
// by bloom or texture filtering, so they stay razor sharp at stream size).
// Worlds only supply placeGhost(participant, index, outVector3).

import * as THREE from 'three';
import { glowSprite, glowPoints } from './glow.js?v=291';
import { PALETTE } from '../net.js?v=291';

const RANK_MARK = ['', '\u2022', '\u2022\u2022', '\u2666', '\u2666\u2666'];
const RANK_AT = [0, 120, 350, 800, 1600];
function rankOf(score) {
  let r = 0;
  for (let i = 1; i < RANK_AT.length; i++) if ((score || 0) >= RANK_AT[i]) r = i;
  return r;
}

const MAX_GHOSTS = 64; // rendered ghosts; beyond this, presence is ambient
const TAIL = 14;       // trail samples behind each person

export class Presence {
  constructor() {
    this.namesVisible = true;
    this.hiddenNames = new Set(); // per-participant kill switch
    this.group = null;
    this._ghosts = [];   // {core, halo, tag, dot, txt, id, flare}
    this._color = new THREE.Color();
    this._pos = new THREE.Vector3();
    this._proj = new THREE.Vector3();
    this._layer = null;
  }

  init(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this._layer = document.createElement('div');
    this._layer.id = 'name-layer';
    document.body.appendChild(this._layer);

    for (let i = 0; i < MAX_GHOSTS; i++) {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.46, 14, 14),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      );
      const halo = glowSprite(2.6);
      core.visible = halo.visible = false;
      this.group.add(core, halo);

      // a short tail, so a person reads as moving rather than hovering
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TAIL * 3), 3).setUsage(THREE.DynamicDrawUsage));
      tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TAIL * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const tail = new THREE.Points(tg, glowPoints(1.5, 0.55));
      tail.material.vertexColors = true;
      tail.frustumCulled = false;
      tail.visible = false;
      this.group.add(tail);

      const tag = document.createElement('div');
      tag.className = 'ptag';
      const dot = document.createElement('i');
      const txt = document.createElement('span');
      tag.append(dot, txt);
      this._layer.appendChild(tag);

      this._ghosts.push({ core, halo, tail, tag, dot, txt, id: null, flare: 0, seeded: false });
    }
  }

  // world calls this once per frame after moving its own scene.
  // placeGhost(p, i, out) maps a participant to a world position.
  update(dt, participants, placeGhost, opts) {
    const { beatIntensity = 0, camera = null } = opts || {};
    const pos = this._pos, proj = this._proj;
    const W = window.innerWidth, H = window.innerHeight;
    let gi = 0;

    for (let i = 1; i < participants.length && gi < MAX_GHOSTS; i++) {
      const p = participants[i];
      const g = this._ghosts[gi++];
      const colorHex = PALETTE[p.color % PALETTE.length];

      const rk = rankOf(p.score);
      if (g.id !== p.id || g.rank !== rk) {
        g.rank = rk;
        const css = '#' + colorHex.toString(16).padStart(6, '0');
        g.txt.textContent = (RANK_MARK[rk] ? RANK_MARK[rk] + ' ' : '') + p.name;
        g.dot.style.background = css;
        g.dot.style.boxShadow = `0 0 9px ${css}, 0 0 3px ${css}`;
        g.tag.style.borderColor = css + (rk >= 3 ? 'cc' : '66');
      }
      if (g.id !== p.id) {
        g.id = p.id;
        g.seeded = false;              // a new person starts a fresh trail
        g.flare = 1.6; // join flare — the payoff moment
        const css = '#' + colorHex.toString(16).padStart(6, '0');
        g.txt.textContent = (RANK_MARK[rk] ? RANK_MARK[rk] + ' ' : '') + p.name;
        g.dot.style.background = css;
        g.dot.style.boxShadow = `0 0 9px ${css}, 0 0 3px ${css}`;
        g.tag.style.borderColor = css + '66';
        g.tag.classList.remove('pop');
        void g.tag.offsetWidth; // restart the entrance animation
        g.tag.classList.add('pop');
      }
      g.flare = Math.max(0, g.flare - dt);

      placeGhost(p, i - 1, pos);
      g.core.visible = true;
      g.core.position.copy(pos);
      const pulse = 1 + beatIntensity * 0.35 + (p.action === 'pulse' || p.action === 'tap' ? 1.1 : 0) + rk * 0.08;
      const flareBoost = 1 + g.flare * 2.2;
      g.core.scale.setScalar(pulse * flareBoost);
      this._color.setHex(colorHex);
      if (g.flare > 1.0) this._color.lerp(new THREE.Color(0xffffff), (g.flare - 1.0) / 0.6);
      this._color.multiplyScalar(1.2 + beatIntensity * 0.5 + rk * 0.14 + (p.action === 'tap' ? 0.8 : 0));
      g.core.material.color.copy(this._color);

      // shuffle the tail along, newest first
      {
        const tp2 = g.tail.geometry.attributes.position;
        const tc = g.tail.geometry.attributes.color;
        if (!g.seeded) {
          for (let k = 0; k < TAIL; k++) tp2.setXYZ(k, pos.x, pos.y, pos.z);
          g.seeded = true;
        } else {
          for (let k = TAIL - 1; k > 0; k--) {
            tp2.setXYZ(k, tp2.getX(k - 1), tp2.getY(k - 1), tp2.getZ(k - 1));
          }
          tp2.setXYZ(0, pos.x, pos.y, pos.z);
        }
        this._color.setHex(colorHex);
        for (let k = 0; k < TAIL; k++) {
          const f = (1 - k / TAIL) * 0.85;
          tc.setXYZ(k, this._color.r * f, this._color.g * f, this._color.b * f);
        }
        tp2.needsUpdate = true; tc.needsUpdate = true;
        g.tail.visible = true;
        g.tail.material.size = 1.5 * (1 + beatIntensity * 0.3);
      }

      g.halo.visible = true;
      g.halo.position.copy(pos);
      g.halo.scale.setScalar(3.4 * pulse * flareBoost);
      g.halo.material.color.setHex(colorHex);
      g.halo.material.opacity = 0.62 + beatIntensity * 0.3 + g.flare * 0.4 + (p.action === 'tap' ? 0.3 : 0);

      // nameplate: project into screen space, sized by distance
      const showName = this.namesVisible && camera && !this.hiddenNames.has(p.name);
      if (showName) {
        proj.copy(pos).project(camera);
        const behind = proj.z > 1 || proj.z < -1;
        if (behind) { g.tag.style.display = 'none'; }
        else {
          const x = (proj.x * 0.5 + 0.5) * W;
          const y = (-proj.y * 0.5 + 0.5) * H - 26;
          const dist = camera.position.distanceTo(pos);
          const s = Math.max(0.75, Math.min(1.25, 1.3 - dist * 0.01)) * (1 + beatIntensity * 0.05);
          g.tag.style.display = 'flex';
          g.tag.style.opacity = Math.max(0.55, Math.min(1, 1.3 - dist * 0.006));
          g.tag.style.transform =
            `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${s.toFixed(3)})`;
        }
      } else {
        g.tag.style.display = 'none';
      }
    }

    // park unused ghosts
    for (; gi < MAX_GHOSTS; gi++) {
      const g = this._ghosts[gi];
      if (!g.core.visible && g.tag.style.display === 'none') break;
      g.core.visible = g.halo.visible = false;
      if (g.tail) g.tail.visible = false;
      g.tag.style.display = 'none';
      g.id = null;
      g.seeded = false;
    }
  }

  dispose(scene) {
    if (this.group) scene.remove(this.group);
    if (this._layer) this._layer.remove();
  }
}
