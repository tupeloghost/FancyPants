// Presence layer — renders remote participants as glowing motes with styled
// name sprites, plus the join-moment flare. Owned by the shell; each world
// only supplies a placeGhost(participant, index, outVector3) mapping, so
// adding presence to a new world is trivial.

import * as THREE from 'three';
import { glowSprite } from './glow.js';
import { PALETTE } from '../net.js';

const MAX_GHOSTS = 64; // rendered ghosts; beyond this, presence is ambient

function makeNameTexture(name, colorHex) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  const col = '#' + colorHex.toString(16).padStart(6, '0');
  g.font = '800 132px "SF Mono", Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // dark plate behind the letters — contrast is what reads, not glow
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 24;
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(name, 512, 128);
  g.shadowBlur = 0;
  // slim color halo, then a crisp white core with no blur on it
  g.shadowColor = col;
  g.shadowBlur = 14;
  g.fillStyle = col;
  g.fillText(name, 512, 128);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.fillText(name, 512, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

export class Presence {
  constructor() {
    this.namesVisible = true;
    this.hiddenNames = new Set(); // per-participant kill switch
    this.group = null;
    this._ghosts = [];   // {core, halo, nameSprite, id, name}
    this._byId = new Map();
    this._nameTexCache = new Map();
    this._color = new THREE.Color();
  }

  init(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    for (let i = 0; i < MAX_GHOSTS; i++) {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 12),
        new THREE.MeshBasicMaterial({ toneMapped: false })
      );
      const halo = glowSprite(2.6);
      const nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, depthWrite: false, toneMapped: false,
      }));
      nameSprite.scale.set(4.6, 1.15, 1);
      nameSprite.center.set(0.5, -0.6); // floats above the mote
      core.visible = halo.visible = nameSprite.visible = false;
      this.group.add(core, halo, nameSprite);
      this._ghosts.push({ core, halo, nameSprite, id: null, flare: 0 });
    }
  }

  _nameTex(name, colorHex) {
    const key = name + '|' + colorHex;
    if (!this._nameTexCache.has(key)) this._nameTexCache.set(key, makeNameTexture(name, colorHex));
    return this._nameTexCache.get(key);
  }

  // world calls this once per frame after moving its own scene.
  // placeGhost(p, i, out) maps a participant to a world position.
  update(dt, participants, placeGhost, opts) {
    const { beatIntensity = 0, time = 0 } = opts || {};
    const pos = new THREE.Vector3();
    let gi = 0;

    for (let i = 1; i < participants.length && gi < MAX_GHOSTS; i++) {
      const p = participants[i];
      const g = this._ghosts[gi++];
      const colorHex = PALETTE[p.color % PALETTE.length];

      if (g.id !== p.id) {
        g.id = p.id;
        g.flare = 1.6; // join flare — the payoff moment
        g.nameSprite.material.map = this._nameTex(p.name, colorHex);
        g.nameSprite.material.needsUpdate = true;
      }
      g.flare = Math.max(0, g.flare - dt);

      placeGhost(p, i - 1, pos);
      g.core.visible = true;
      g.core.position.copy(pos);
      const pulse = 1 + beatIntensity * 0.35 + (p.action === 'pulse' ? 0.5 : 0);
      const flareBoost = 1 + g.flare * 2.2;
      g.core.scale.setScalar(pulse * flareBoost);
      this._color.setHex(colorHex);
      if (g.flare > 1.0) this._color.lerp(new THREE.Color(0xffffff), (g.flare - 1.0) / 0.6);
      this._color.multiplyScalar(1.2 + beatIntensity * 0.5);
      g.core.material.color.copy(this._color);

      g.halo.visible = true;
      g.halo.position.copy(pos);
      g.halo.scale.setScalar(2.6 * pulse * flareBoost);
      g.halo.material.color.setHex(colorHex);
      g.halo.material.opacity = 0.5 + beatIntensity * 0.3 + g.flare * 0.4;

      const showName = this.namesVisible && !this.hiddenNames.has(p.name);
      g.nameSprite.visible = showName;
      if (showName) {
        g.nameSprite.position.copy(pos);
        // names breathe with the beat and bloom in hard on join
        const ns = (1 + beatIntensity * 0.12) * Math.min(1, 0.2 + (1.6 - Math.min(1.6, g.flare)) );
        g.nameSprite.scale.set(4.6 * ns, 1.15 * ns, 1);
        g.nameSprite.material.opacity = Math.min(1, 0.85 + g.flare);
      }
    }

    // park unused ghosts
    for (; gi < MAX_GHOSTS; gi++) {
      const g = this._ghosts[gi];
      if (!g.core.visible) break;
      g.core.visible = g.halo.visible = g.nameSprite.visible = false;
      g.id = null;
    }
  }

  dispose(scene) {
    if (this.group) scene.remove(this.group);
  }
}
