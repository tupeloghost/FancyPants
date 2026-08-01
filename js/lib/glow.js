// Shared glow assets: a radial-gradient texture and additive glow sprites.
// This is what makes particles and halos read as light instead of geometry.

import * as THREE from 'three';

let _tex = null;

export function glowTexture() {
  if (_tex) return _tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _tex = new THREE.CanvasTexture(c);
  return _tex;
}

// Big soft halo. Additive, no depth write — safe to overlap everything.
export function glowSprite(scale = 10) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }));
  s.scale.setScalar(scale);
  return s;
}

// Standard material recipe for glowing point clouds.
export function glowPoints(size, opacity = 0.9) {
  return new THREE.PointsMaterial({
    size,
    map: glowTexture(),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}
