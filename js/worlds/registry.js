// World registry. Adding a world = one file in /worlds/ + one entry here.
//
// `mode` is what KIND of round this world holds and `rules` is how it is won,
// in the player's words — both are shown on the round card before play, because
// a player who does not know the rules cannot enjoy the world.
//
// `rhythm` marks a world that can hold a race round. `feetPerStep` is how far
// one abstract race step carries there — a slinky covers a few feet a stair, a
// car on a highway covers tens, and the player is told feet either way.
//
// `pulse` is how much of the shared tap-ring a world can carry (1 full, 0 off).
// Dark sparse worlds take it happily; worlds drawn from fine lines, or already
// dense with colour, get swamped by one and ask for less.
import { createTunnel } from './tunnel.js?v=266';
import { createSurfer } from './surfer.js?v=266';
import { createOrbit } from './orbit.js?v=266';
import { createBloom } from './bloom.js?v=266';
import { createTrail } from './trail.js?v=266';
import { createSignal } from './signal.js?v=266';
import { createRiver } from './river.js?v=266';
import { createFunhouse } from './funhouse.js?v=266';
import { createLavaLamp } from './lavalamp.js?v=266';
import { createPlasma } from './plasma.js?v=266';
import { createCherryLand } from './cherryland.js?v=266';
import { createSlinky } from './slinky.js?v=266';
import { createBlacktop } from './blacktop.js?v=266';
import { createWaterslide } from './waterslide.js?v=266';
import { createGarden } from './garden.js?v=266';
import { createPaint } from './paint.js?v=266';
import { createComets } from './comets.js?v=266';

export const WORLDS = {
  tunnel: { pulse: 0.55, goal: 'float and vibe — clicks send shockwaves', label: 'TUNNEL', create: createTunnel },
  surfer: { pulse: 0.9, goal: 'carve the canyon — clicks quake the ground', label: 'SURFER', create: createSurfer },
  orbit:  { pulse: 1.0, goal: 'conduct the swarm with your cursor', label: 'ORBIT',  create: createOrbit },
  bloom:  { pulse: 0.7, goal: 'fly the garden — clicks ripple through everything', label: 'BLOOM',  create: createBloom },
  trail:  { pulse: 0.45, goal: 'paint the sky — every click is a new color', label: 'TRAIL',  create: createTrail },
  signal: { pulse: 0.5, goal: 'BOWL the towers — one throw, five columns, big points', label: 'SIGNAL', create: createSignal },
  river:  { pulse: 0.8, rhythm: true, mode: 'DODGE', unit: 'RAMPS',
            rules: 'Steer with the mouse or arrows — HOLD to speed up. Green ramps pay, double at full speed. Dark rocks cost you. Most ramps wins, sugar.', goal: 'ride the rapids — hold to open the throttle', label: 'RIVER',  create: createRiver },
  funhouse: { pulse: 0.85, goal: 'swim the pit — click to lunge, slider adds balls', label: 'BALL PIT', create: createFunhouse },
  lava:   { pulse: 0.7, goal: 'stir the wax — pop blobs at the top for +10', label: 'LAVA LAMP', create: createLavaLamp },
  plasma: { pulse: 0.35, goal: 'tame the lightning — it leaps to your finger', label: 'PLASMA', create: createPlasma },
  cherry: { pulse: 0.8, rhythm: true, mode: 'CATCH', unit: 'CAUGHT',
            rules: 'Swipe the basket. Catch cherries — golden ones pay five, dark ones are bombs. Biggest haul wins.', goal: 'snipe cherries (+15) or shake whole trees loose', label: 'CHERRY LAND', create: createCherryLand },
  slinky: { pulse: 0.6, rhythm: true, feetPerStep: 3, mode: 'RACE', cue: 'world',
            rules: 'Tap the moment a light bar reaches your slinky. Hits build speed. First to the bottom wins.', goal: 'swipe to circle the spring — it never stops falling', label: 'SLINKY', create: createSlinky },
  blacktop: { pulse: 0.85, rhythm: true, feetPerStep: 42, mode: 'DODGE', unit: 'GATES',
            rules: 'Steer with the mouse or arrows — HOLD to speed up. Thread the green gates, miss the striped walls. Most gates wins, darlin’.', goal: 'run the midnight road — hold to open the throttle', label: 'BLACKTOP', create: createBlacktop },
  comets: { pulse: 0.9, rhythm: true, mode: 'DODGE', unit: 'STARS',
            rules: 'Steer with the mouse or arrows — HOLD to burn. Thread silver stars to draw constellations. Dodge the red giants. Most stars wins, sugar.',
            goal: 'chase the comets — hold to burn', label: 'COMETS', create: createComets },
  slide: { pulse: 0.8, rhythm: true, feetPerStep: 20, mode: 'DODGE', unit: 'HOOPS',
            rules: 'Steer with the mouse or arrows — HOLD to speed up. Green hoops pay, red ones bite. Most hoops wins.', goal: 'ride the flume — hold to open the throttle', label: 'SLIDE', create: createWaterslide },
  paint:  { pulse: 0.3, goal: 'dead neon flickers on the walls — spray the signs alight before they go dark', label: 'PAINT', create: createPaint },
  garden: { pulse: 0.45, goal: 'sweep up the runes — three alike fuse. Light the whole picture', label: 'LUMEN', create: createGarden },
};
