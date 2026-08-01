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

export const WORLDS = {
  tunnel: { label: 'TUNNEL', create: createTunnel },
  surfer: { label: 'SURFER', create: createSurfer },
  orbit:  { label: 'ORBIT',  create: createOrbit },
  bloom:  { label: 'BLOOM',  create: createBloom },
  trail:  { label: 'TRAIL',  create: createTrail },
  signal: { label: 'SIGNAL', create: createSignal },
  river:  { label: 'RIVER',  create: createRiver },
  funhouse: { label: 'BALL PIT', create: createFunhouse },
  lava:   { label: 'LAVA LAMP', create: createLavaLamp },
  plasma: { label: 'PLASMA', create: createPlasma },
};
