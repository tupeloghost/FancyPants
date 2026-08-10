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
import { createTunnel } from './tunnel.js?v=248';
import { createSurfer } from './surfer.js?v=248';
import { createOrbit } from './orbit.js?v=248';
import { createBloom } from './bloom.js?v=248';
import { createTrail } from './trail.js?v=248';
import { createSignal } from './signal.js?v=248';
import { createRiver } from './river.js?v=248';
import { createFunhouse } from './funhouse.js?v=248';
import { createLavaLamp } from './lavalamp.js?v=248';
import { createPlasma } from './plasma.js?v=248';
import { createCherryLand } from './cherryland.js?v=248';
import { createSlinky } from './slinky.js?v=248';
import { createBlacktop } from './blacktop.js?v=248';
import { createWaterslide } from './waterslide.js?v=248';
import { createGarden } from './garden.js?v=248';
import { createPaint } from './paint.js?v=248';
import { createComets } from './comets.js?v=248';

export const WORLDS = {
  tunnel: { pulse: 0.55, goal: 'float and vibe — clicks send shockwaves', label: 'TUNNEL', create: createTunnel },
  surfer: { pulse: 0.9, goal: 'carve the canyon — clicks quake the ground', label: 'SURFER', create: createSurfer },
  orbit:  { pulse: 1.0, goal: 'conduct the swarm with your cursor', label: 'ORBIT',  create: createOrbit },
  bloom:  { pulse: 0.7, goal: 'fly the garden — clicks ripple through everything', label: 'BLOOM',  create: createBloom },
  trail:  { pulse: 0.45, goal: 'paint the sky — every click is a new color', label: 'TRAIL',  create: createTrail },
  signal: { pulse: 0.5, goal: 'BOWL the towers — one throw, five columns, big points', label: 'SIGNAL', create: createSignal },
  river:  { pulse: 0.8, rhythm: true, mode: 'DODGE', unit: 'RAMPS',
            rules: 'Steer with the mouse or arrows — and HOLD (press down, or space) to open the throttle. Flooring it doubles every ramp and shaving past a rock pays a bonus, but a rock at speed costs three and floods your engine. Ease off to play it safe. Most ramps wins, sugar.', goal: 'ride the rapids — hold to open the throttle', label: 'RIVER',  create: createRiver },
  funhouse: { pulse: 0.85, goal: 'swim the pit — click to lunge, slider adds balls', label: 'BALL PIT', create: createFunhouse },
  lava:   { pulse: 0.7, goal: 'stir the wax — pop blobs at the top for +10', label: 'LAVA LAMP', create: createLavaLamp },
  plasma: { pulse: 0.35, goal: 'tame the lightning — it leaps to your finger', label: 'PLASMA', create: createPlasma },
  cherry: { pulse: 0.8, rhythm: true, mode: 'CATCH', unit: 'CAUGHT',
            rules: 'Swipe the basket to catch falling cherries \u2014 golden ones are worth five. Fill the basket to the brim and it pays a bonus and empties. Dark ones are bombs: let them fall. Biggest total wins.', goal: 'snipe cherries (+15) or shake whole trees loose', label: 'CHERRY LAND', create: createCherryLand },
  slinky: { pulse: 0.6, rhythm: true, feetPerStep: 3, mode: 'RACE', cue: 'world',
            rules: 'Bars of light slide up the stairs \u2014 tap the moment one reaches your slinky. Hits build momentum and the spring walks faster. First one to the bottom wins.', goal: 'swipe to circle the spring — it never stops falling', label: 'SLINKY', create: createSlinky },
  blacktop: { pulse: 0.85, rhythm: true, feetPerStep: 42, mode: 'DODGE', unit: 'GATES',
            rules: 'Steer with the mouse or arrows — and HOLD (press down, or space) to open the throttle. Flat out, gates pay double and shaving past a wall pays a close-call bonus, but hitting one costs three and floods your engine. Ease off to play it safe. Most gates wins, darlin’.', goal: 'run the midnight road — hold to open the throttle', label: 'BLACKTOP', create: createBlacktop },
  comets: { pulse: 0.9, rhythm: true, mode: 'DODGE', unit: 'STARS',
            rules: 'Steer with the mouse or arrows — and HOLD (press down, or space) to burn. Thread the silver stars — each one joins your constellation, and every fifth completes it for a bonus. Red giants are trouble: shave past one at full burn for a close call, but hit one and it costs three and snuffs your flame. Most stars wins, sugar.',
            goal: 'chase the comets — hold to burn', label: 'COMETS', create: createComets },
  slide: { pulse: 0.8, rhythm: true, feetPerStep: 20, mode: 'DODGE', unit: 'HOOPS',
            rules: 'Steer with the mouse or arrows — and HOLD (press down, or space) to open the throttle. Flat out, green hoops pay double and shaving past a red one pays a close-call bonus, but leaning into a red at speed costs three and floods your run. Ease off to play it safe. Most hoops wins, easy as that.', goal: 'ride the flume — hold to open the throttle', label: 'SLIDE', create: createWaterslide },
  paint:  { pulse: 0.3, goal: 'the world arrives gray — hold and sweep, and everything you touch turns to colour', label: 'PAINT', create: createPaint },
  garden: { pulse: 0.45, goal: 'hold and sweep to gather the floating runes — three alike fuse into a brighter one. Set them in the board to light it up', label: 'LUMEN', create: createGarden },
};
