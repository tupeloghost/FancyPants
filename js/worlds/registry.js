// World registry. Adding a world = one file in /worlds/ + one entry here.
//
// `pulse` is how much of the shared tap-ring a world can carry (1 full, 0 off).
// Dark sparse worlds take it happily; worlds drawn from fine lines, or already
// dense with colour, get swamped by one and ask for less.
import { createTunnel } from './tunnel.js?v=126';
import { createSurfer } from './surfer.js?v=126';
import { createOrbit } from './orbit.js?v=126';
import { createBloom } from './bloom.js?v=126';
import { createTrail } from './trail.js?v=126';
import { createSignal } from './signal.js?v=126';
import { createRiver } from './river.js?v=126';
import { createFunhouse } from './funhouse.js?v=126';
import { createLavaLamp } from './lavalamp.js?v=126';
import { createPlasma } from './plasma.js?v=126';
import { createCherryLand } from './cherryland.js?v=126';
import { createSlinky } from './slinky.js?v=126';
import { createBlacktop } from './blacktop.js?v=126';
import { createWaterslide } from './waterslide.js?v=126';
import { createGarden } from './garden.js?v=126';
import { createPaint } from './paint.js?v=126';

export const WORLDS = {
  tunnel: { pulse: 0.55, goal: 'float and vibe — clicks send shockwaves', label: 'TUNNEL', create: createTunnel },
  surfer: { pulse: 0.9, goal: 'carve the canyon — clicks quake the ground', label: 'SURFER', create: createSurfer },
  orbit:  { pulse: 1.0, goal: 'conduct the swarm with your cursor', label: 'ORBIT',  create: createOrbit },
  bloom:  { pulse: 0.7, goal: 'fly the garden — clicks ripple through everything', label: 'BLOOM',  create: createBloom },
  trail:  { pulse: 0.45, goal: 'paint the sky — every click is a new color', label: 'TRAIL',  create: createTrail },
  signal: { pulse: 0.5, goal: 'BOWL the towers — one throw, five columns, big points', label: 'SIGNAL', create: createSignal },
  river:  { pulse: 0.8, goal: 'ride the rapids — click for a surge of speed', label: 'RIVER',  create: createRiver },
  funhouse: { pulse: 0.85, goal: 'swim the pit — click to lunge, slider adds balls', label: 'BALL PIT', create: createFunhouse },
  lava:   { pulse: 0.7, goal: 'stir the wax — pop blobs at the top for +10', label: 'LAVA LAMP', create: createLavaLamp },
  plasma: { pulse: 0.35, goal: 'tame the lightning — it leaps to your finger', label: 'PLASMA', create: createPlasma },
  cherry: { pulse: 0.8, goal: 'snipe cherries (+15) or shake whole trees loose', label: 'CHERRY LAND', create: createCherryLand },
  slinky: { pulse: 0.6, rhythm: true, goal: 'swipe to circle the spring — it never stops falling', label: 'SLINKY', create: createSlinky },
  blacktop: { pulse: 0.85, goal: 'hold for NITRO — survive the UFO for +40', label: 'BLACKTOP', create: createBlacktop },
  waterslide: { pulse: 0.8, goal: 'lean into the flume and never slow down', label: 'SLIDE', create: createWaterslide },
  paint:  { pulse: 0.3, goal: 'load a colour · fill every cell wearing its number', label: 'PAINT BY NUMBERS', create: createPaint },
  garden: { pulse: 0.45, goal: 'gather runes · fuse three alike · set each cell its number', label: 'LUMEN', create: createGarden },
};
