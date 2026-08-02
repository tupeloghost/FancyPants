// World registry. Adding a world = one file in /worlds/ + one entry here.
import { createTunnel } from './tunnel.js';
import { createSurfer } from './surfer.js';
import { createOrbit } from './orbit.js';
import { createBloom } from './bloom.js';
import { createTrail } from './trail.js';
import { createSignal } from './signal.js';
import { createRiver } from './river.js';
import { createFunhouse } from './funhouse.js';
import { createLavaLamp } from './lavalamp.js';
import { createPlasma } from './plasma.js';
import { createCherryLand } from './cherryland.js';
import { createSlinky } from './slinky.js';
import { createBlacktop } from './blacktop.js';
import { createWaterslide } from './waterslide.js';
import { createGarden } from './garden.js';

export const WORLDS = {
  tunnel: { goal: 'float and vibe — clicks send shockwaves', label: 'TUNNEL', create: createTunnel },
  surfer: { goal: 'carve the canyon — clicks quake the ground', label: 'SURFER', create: createSurfer },
  orbit:  { goal: 'conduct the swarm with your cursor', label: 'ORBIT',  create: createOrbit },
  bloom:  { goal: 'fly the garden — clicks ripple through everything', label: 'BLOOM',  create: createBloom },
  trail:  { goal: 'paint the sky — every click is a new color', label: 'TRAIL',  create: createTrail },
  signal: { goal: 'BOWL the towers — one throw, five columns, big points', label: 'SIGNAL', create: createSignal },
  river:  { goal: 'ride the rapids — click for a surge of speed', label: 'RIVER',  create: createRiver },
  funhouse: { goal: 'swim the pit — click to lunge, slider adds balls', label: 'BALL PIT', create: createFunhouse },
  lava:   { goal: 'stir the wax — pop blobs at the top for +10', label: 'LAVA LAMP', create: createLavaLamp },
  plasma: { goal: 'tame the lightning — it leaps to your finger', label: 'PLASMA', create: createPlasma },
  cherry: { goal: 'snipe cherries (+15) or shake whole trees loose', label: 'CHERRY LAND', create: createCherryLand },
  slinky: { goal: 'swipe to circle the spring — it never stops falling', label: 'SLINKY', create: createSlinky },
  blacktop: { goal: 'hold for NITRO — survive the UFO for +40', label: 'BLACKTOP', create: createBlacktop },
  waterslide: { goal: 'lean into the flume and never slow down', label: 'SLIDE', create: createWaterslide },
  garden: { goal: 'gather runes · fuse three alike · set each cell its number', label: 'LUMEN', create: createGarden },
};
