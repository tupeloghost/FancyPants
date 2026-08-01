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

// Inverted sky sphere with a horizon glow baked into vertex colors.
// Tint it per-frame via material.color — kills the raw-black-void look.
export function skyDome(radius = 320) {
  const geo = new THREE.SphereGeometry(radius, 24, 16);
  const n = geo.attributes.position.count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = geo.attributes.position.getY(i) / radius; // -1..1
    const horizon = Math.max(0, 1 - Math.abs(y) * 1.7);
    const v = 0.03 + horizon * horizon * 0.30;
    cols[i * 3] = v; cols[i * 3 + 1] = v; cols[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    side: THREE.BackSide, vertexColors: true,
    toneMapped: false, fog: false, depthWrite: false,
  }));
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
