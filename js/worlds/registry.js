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
import { createTunnel } from './tunnel.js?v=559';
import { createSurfer } from './surfer.js?v=559';
import { createOrbit } from './orbit.js?v=559';
import { createBloom } from './bloom.js?v=559';
import { createTrail } from './trail.js?v=559';
import { createSignal } from './signal.js?v=559';
import { createRiver } from './river.js?v=559';
import { createFunhouse } from './funhouse.js?v=559';
import { createLavaLamp } from './lavalamp.js?v=559';
import { createPlasma } from './plasma.js?v=559';
import { createCherryLand } from './cherryland.js?v=559';
import { createSlinky } from './slinky.js?v=559';
import { createBlacktop } from './blacktop.js?v=559';
import { createWaterslide } from './waterslide.js?v=559';
import { createGarden } from './garden.js?v=559';
import { createPaint } from './paint.js?v=559';
import { createComets } from './comets.js?v=559';

export const WORLDS = {
  tunnel: { pulse: 0.55, quietPoints: true, goal: 'float and vibe. clicks send shockwaves', label: 'TUNNEL',
            teach: ['tap anywhere. shockwaves, and a shot of speed',
                    'a glowing door drifts by now and then. fly through it for new colors'],
            create: createTunnel },
  surfer: { pulse: 0.9, goal: 'catch sparks, tap to jump, HOLD to surge. shimmering ones repaint the world.', label: 'SURFER', create: createSurfer },
  orbit:  { pulse: 1.0, rhythm: true, autoRound: true, mode: 'DODGE', unit: 'FLARES',
            rules: 'Steer in and out with the mouse or arrows. When the CENTER glows, swing wide. When the OUTER sky glows, tuck in close. Dodge the most flares to win.',
            goal: 'circle the core, dodge the flares', label: 'ORBIT',  create: createOrbit },
  bloom:  { pulse: 0.7, goal: 'fly the garden. clicks ripple through everything', label: 'BLOOM',  create: createBloom },
  trail:  { pulse: 0.45, goal: 'paint the sky. every click is a new color', label: 'TRAIL',  create: createTrail },
  signal: { pulse: 0.5, goal: 'bowl the towers: one throw, five columns', label: 'SIGNAL', create: createSignal },
  river:  { pulse: 0.8, rhythm: true, mode: 'DODGE', unit: 'RAMPS',
            rules: 'Steer with the mouse or arrows. HOLD to speed up, which counts double. Ride the green ramps, dodge the dark rocks. Most ramps wins.', goal: 'ride the rapids, hold to open the throttle', label: 'RIVER',  create: createRiver },
  funhouse: { pulse: 0.85, goal: 'swim the pit: click to lunge, slider adds balls', label: 'BALL PIT', create: createFunhouse },
  lava:   { pulse: 0.7, goal: 'stir the wax, pop the blobs that reach the top', label: 'LAVA LAMP', create: createLavaLamp },
  plasma: { pulse: 0.35, goal: 'tame the lightning. it leaps to your finger', label: 'PLASMA', create: createPlasma },
  cherry: { pulse: 0.8, rhythm: true, mode: 'CATCH', unit: 'CAUGHT',
            rules: 'Swipe to move the basket. Catch the cherries, gold ones count five. Let the dark bombs fall. Most caught wins.', goal: 'snipe cherries or shake whole trees loose', label: 'CHERRY LAND', create: createCherryLand },
  slinky: { pulse: 0.6, rhythm: true, feetPerStep: 3, mode: 'RACE', cue: 'world',
            rules: 'A bar of light climbs the stairs toward your slinky. Tap the moment it arrives. Good taps make it hustle. First to the bottom wins.', goal: 'swipe to circle the spring. it never stops falling', label: 'SLINKY', create: createSlinky },
  blacktop: { pulse: 0.85, rhythm: true, feetPerStep: 42, mode: 'DODGE', unit: 'GATES',
            rules: 'Steer with the mouse or arrows. HOLD to speed up, which counts double. Drive the green gates, miss the striped walls. Most gates wins.', goal: 'run the midnight road, hold to open the throttle', label: 'BLACKTOP', create: createBlacktop },
  comets: { pulse: 0.9, rhythm: true, mode: 'DODGE', unit: 'STARS',
            rules: 'Steer with the mouse or arrows. HOLD to fly faster. Catch the silver stars, five in a row pays extra. Avoid the big red ones. Most stars wins.',
            goal: 'chase the comets, hold to burn', label: 'COMETS', create: createComets },
  slide: { pulse: 0.8, rhythm: true, autoRound: true, feetPerStep: 20, mode: 'DODGE', unit: 'RINGS',
            rules: 'Steer with the mouse or arrows. HOLD to speed up, which counts double. Thread the green rings. Black holes eat the lights for a spell. Most rings wins.',
            // the tutor speaks these over the ghost-hand demo, one at a time
            teach: ['steer through the green rings', 'hold down to go faster',
                    'red is a black hole. it eats the light for a bit',
                    'a ring glowing in new colors brings those colors',
                    'the wobbling ring reshapes the whole slide'],
            goal: 'ride the slide. hold down to go faster', label: 'SLIDE', create: createWaterslide },
  paint:  { pulse: 0.3, goal: 'spray the dead neon alight before it fades', label: 'PAINT', create: createPaint },
  garden: { pulse: 0.45, goal: 'sweep up the runes. three alike fuse', label: 'LUMEN', create: createGarden },
};
