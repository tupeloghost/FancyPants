// Pulse layer — when anyone taps, a ring of light opens in the world at the
// point they touched, in their own colour. It lives in the scene rather than
// on top of it, so the bloom pass catches it and it reads as light rather
// than as a circle drawn over the picture.
//
// Everything is billboarded and sized by distance, so a pulse subtends the
// same angle on screen in every world regardless of that world's scale, and
// depth testing is off so a pulse is never swallowed by solid geometry.

import * as THREE from 'three';

const POOL = 40;        // concurrent pulses; a busy room recycles the oldest
const LIFE = 0.95;      // seconds
const DEPTH = 18;       // how far in front of the camera a pulse is placed

// A soft ring, drawn once into a canvas — no hard edges anywhere, which is
// the whole difference between "light" and "a circle".
function ringTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, S * 0.30, S / 2, S / 2, S * 0.5);
  grad.addColorStop(0.00, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.30)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function coreTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.5);
  grad.addColorStop(0.00, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.62)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ease-out cubic — bursts open, then glides to a stop. Linear expansion is
// what makes this kind of effect look mechanical.
const easeOut = t => 1 - Math.pow(1 - t, 3);

export class Pulses {
  constructor() {
    this.group = null;
    this._items = [];
    this._at = 0;
    this._v = new THREE.Vector3();
  }

  init(scene) {
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    this.group.renderOrder = 900;
    scene.add(this.group);

    const ringTex = ringTexture();
    const coreTex = coreTexture();

    for (let i = 0; i < POOL; i++) {
      const mk = (tex, order) => {
        const m = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,   // let it run hot so the bloom pass blooms it
          opacity: 0,
        }));
        m.visible = false;
        m.renderOrder = order;
        this.group.add(m);
        return m;
      };
      // two rings offset in time read as a swell rather than a single pop
      this._items.push({
        ring: mk(ringTex, 901),
        echo: mk(ringTex, 900),
        core: mk(coreTex, 902),
        t: LIFE + 1,
        size: 1,
        color: new THREE.Color(0xffffff),
      });
    }
  }

  // x, y are clip space (-1..1); colorHex is the tapper's palette colour.
  // strength scales the whole thing — a big moment opens wider and brighter.
  spawn(camera, x, y, colorHex = 0xffffff, strength = 1) {
    if (!this.group) return;
    const p = this._items[this._at];
    this._at = (this._at + 1) % POOL;

    this._v.set(x, y, 0.5).unproject(camera);
    this._v.sub(camera.position).normalize().multiplyScalar(DEPTH).add(camera.position);

    for (const s of [p.ring, p.echo, p.core]) {
      s.position.copy(this._v);
      s.visible = true;
    }
    p.t = 0;
    // sized off the framing so it looks the same at any field of view
    p.size = DEPTH * Math.tan((camera.fov * Math.PI / 180) / 2) * 0.30 * (0.75 + strength * 0.45);
    p.color.setHex(colorHex);
  }

  update(dt, beatIntensity = 0) {
    if (!this.group) return;
    const swell = 1 + beatIntensity * 0.22;   // pulses breathe with the track

    // Additive light accumulates. One pulse should read as a bright event; a
    // roomful arriving at once must not wash the world out to white, so the
    // whole layer eases down as it gets busy. Twenty people tapping together
    // should look like weather, not like a blown exposure.
    let live = 0;
    for (const p of this._items) if (p.t <= LIFE) live++;
    const crowd = 1 / (1 + Math.max(0, live - 1) * 0.16);

    for (const p of this._items) {
      if (p.t > LIFE) continue;
      p.t += dt;
      const t = Math.min(1, p.t / LIFE);
      if (t >= 1) {
        p.ring.visible = p.echo.visible = p.core.visible = false;
        continue;
      }

      const e = easeOut(t);
      const fade = Math.pow(1 - t, 1.7);

      // leading ring: opens wide and thins out
      p.ring.scale.setScalar(p.size * (0.30 + e * 2.6) * swell);
      p.ring.material.opacity = fade * 0.52 * crowd;
      p.ring.material.color.copy(p.color).multiplyScalar(1.0 + fade * 0.7);

      // echo trails a beat behind, softer and wider — this is what gives it depth
      const te = Math.max(0, t - 0.16) / (1 - 0.16);
      const ee = easeOut(te);
      p.echo.scale.setScalar(p.size * (0.30 + ee * 3.5) * swell);
      p.echo.material.opacity = Math.pow(1 - te, 2.2) * 0.22 * crowd;
      p.echo.material.color.copy(p.color).multiplyScalar(0.9);

      // core flares instantly, then collapses — the part that reads as a hit.
      // It stays close to the tapper's own colour rather than going white,
      // which is what keeps it identifiably *theirs*.
      const cf = Math.pow(1 - t, 3.4);
      p.core.scale.setScalar(p.size * (0.62 * cf + 0.13) * swell);
      p.core.material.opacity = cf * 0.6 * crowd;
      p.core.material.color.copy(p.color).lerp(new THREE.Color(0xffffff), 0.28).multiplyScalar(1.15 + cf * 0.85);
    }
  }

  dispose(scene) {
    if (!this.group) return;
    for (const p of this._items) {
      for (const s of [p.ring, p.echo, p.core]) s.material.dispose();
    }
    scene.remove(this.group);
    this.group = null;
    this._items = [];
  }
}
