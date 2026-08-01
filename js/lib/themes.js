// Shared theme engine — the tunnel's color-mode system, generalized so every
// world can speak the same visual language.
//
// themePaint(mode, hue01, u, v, time, level, jit, out)
//   u:     primary spatial coordinate 0-1 (angle around / height / lane)
//   v:     secondary coordinate, unbounded (depth / length / travel)
//   level: 0-1 audio drive for this element
//   jit:   stable per-element random 0-1
//   out:   [h, s, boost] — hue 0-1, saturation 0-1, brightness multiplier
//
// Worlds apply: color.setHSL(out[0], out[1], baseLum * clamp(out[2]))
// or fold out[2] into their own drive math.

const PALETTES = {
  vapor:    [[0.88, 0.80, 1.0], [0.52, 0.85, 1.0], [0.72, 0.60, 0.9], [0.95, 0.70, 0.95], [0.60, 0.75, 0.85]],
  midnight: [[0.63, 0.95, 1.0], [0.68, 0.85, 0.85], [0.58, 1.00, 1.05], [0.72, 0.70, 0.75], [0.60, 0.40, 0.9]],
  coral:    [[0.02, 0.90, 1.05], [0.06, 0.85, 0.95], [0.48, 0.85, 0.95], [0.98, 0.80, 0.9], [0.52, 0.90, 0.85]],
};

function palLerp(pal, t, out) {
  const n = pal.length;
  const x = ((t % 1) + 1) % 1 * n;
  const i0 = Math.floor(x) % n, i1 = (i0 + 1) % n;
  const f = x - Math.floor(x);
  const a = pal[i0], b = pal[i1];
  let dh = b[0] - a[0];
  if (dh > 0.5) dh -= 1; else if (dh < -0.5) dh += 1;
  out[0] = ((a[0] + dh * f) % 1 + 1) % 1;
  out[1] = a[1] + (b[1] - a[1]) * f;
  out[2] = a[2] + (b[2] - a[2]) * f;
}

export function themePaint(mode, hue, u, v, time, level, jit, out) {
  out[1] = 1.0; out[2] = 1.0;
  switch (mode) {
    case 'mono':
      out[0] = (hue + v * 0.03 + 1) % 1;
      break;
    case 'pastel':
      out[0] = (hue + u * 0.5 + v * 0.06 + 1) % 1;
      out[1] = 0.45; out[2] = 0.85;
      break;
    case 'duotone': {
      const t2 = 0.5 - 0.5 * Math.cos((u + v * 0.12 + time * 0.012) * Math.PI * 2);
      out[0] = (hue + t2 * 0.5) % 1;
      break;
    }
    case 'cycle':
      out[0] = (hue + time * 0.03 + u + v * 0.08) % 1;
      break;
    case 'duo':
      out[0] = (hue + (u > 0.5 ? 0.5 : 0) + v * 0.02) % 1;
      break;
    case 'triad':
      out[0] = (hue + Math.floor(((u % 1) + 1) % 1 * 3) / 3) % 1;
      break;
    case 'neon':
      out[0] = (hue + Math.floor(((u % 1) + 1) % 1 * 3) / 3) % 1;
      out[2] = 1.5;
      break;
    case 'random':
      out[0] = jit;
      break;
    case 'vapor': case 'midnight': case 'coral':
      palLerp(PALETTES[mode], u + v * 0.08 + time * 0.012, out);
      break;
    case 'fire': {
      const flick = 0.5 + 0.5 * Math.sin(time * 8 + jit * 60 + v * 4);
      out[0] = 0.012 + 0.075 * flick;
      out[2] = (0.65 + flick * 0.85) * (1 + level * 0.3);
      break;
    }
    case 'ocean': {
      const swell = Math.sin(u * Math.PI * 4 - time * 1.3 + v * 0.6);
      out[0] = 0.5 + 0.075 * swell;
      out[1] = 0.92;
      out[2] = 0.7 + 0.45 * Math.max(0, swell);
      break;
    }
    case 'sunset':
      // u = verticalness: 0 = horizon (molten orange), 1 = zenith (violet)
      out[0] = (0.82 + (1 - Math.min(1, Math.max(0, u))) * 0.2) % 1;
      out[2] = 0.85 + 0.3 * (1 - u);
      break;
    case 'aurora': {
      const curtain = Math.sin(u * Math.PI * 6 + Math.sin(time * 0.7 + v * 1.2) * 2.4);
      if (curtain > 0) { out[0] = 0.36 + 0.1 * curtain; out[2] = 0.55 + curtain * 0.9; }
      else { out[0] = 0.75; out[1] = 0.8; out[2] = 0.3; }
      break;
    }
    case 'forest':
      if (jit > 0.87) { out[0] = 0.125; out[1] = 0.85; out[2] = 1.35; }
      else { out[0] = 0.3 + jit * 0.09 + v * 0.01; out[1] = 0.9; out[2] = 0.62; }
      break;
    case 'gold': {
      const spec = Math.pow(Math.max(0, Math.cos(u * Math.PI * 2 - time * 0.9)), 6);
      out[0] = 0.10 + 0.02 * jit;
      out[1] = 0.9 - spec * 0.55;
      out[2] = 0.55 + spec * 1.7 + level * 0.4;
      break;
    }
    case 'cosmos':
      if (jit > 0.92) {
        out[0] = 0.6; out[1] = 0.12;
        out[2] = 1.8 + 0.8 * Math.sin(time * 2.5 + jit * 90);
      } else {
        out[0] = (hue + 0.16 * Math.sin(v * 2.5 + u * 5) + 1) % 1;
        out[1] = 0.85;
        out[2] = 0.18 + level * 0.25;
      }
      break;
    case 'glitter': {
      const spark = Math.abs(Math.sin(jit * 997 + Math.floor(time * 30) * 7.7));
      if (spark > 0.9) { out[0] = hue; out[1] = 0.2; out[2] = 3.0; }
      else { out[0] = (hue + jit * 0.04) % 1; out[1] = 0.6; out[2] = 0.42; }
      break;
    }
    case 'candy': {
      const stripe = Math.floor(((u * 10 + v * 1.6 + time * 0.25) % 4 + 4) % 4);
      if (stripe === 0)      { out[0] = 0.93; out[1] = 1.0;  out[2] = 1.1; }
      else if (stripe === 1) { out[0] = 0.0;  out[1] = 0.05; out[2] = 1.0; }
      else if (stripe === 2) { out[0] = 0.50; out[1] = 0.95; out[2] = 1.0; }
      else                   { out[0] = 0.13; out[1] = 1.0;  out[2] = 1.05; }
      out[2] += Math.pow(Math.max(0, Math.cos(u * Math.PI * 2 - time * 1.3)), 8) * 0.55;
      break;
    }
    default: // rainbow
      out[0] = (hue + u + v * 0.06 + 1) % 1;
  }
}
