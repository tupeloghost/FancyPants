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
import { createTunnel } from './tunnel.js?v=167';
import { createSurfer } from './surfer.js?v=167';
import { createOrbit } from './orbit.js?v=167';
import { createBloom } from './bloom.js?v=167';
import { createTrail } from './trail.js?v=167';
import { createSignal } from './signal.js?v=167';
import { createRiver } from './river.js?v=167';
import { createFunhouse } from './funhouse.js?v=167';
import { createLavaLamp } from './lavalamp.js?v=167';
import { createPlasma } from './plasma.js?v=167';
import { createCherryLand } from './cherryland.js?v=167';
import { createSlinky } from './slinky.js?v=167';
import { createBlacktop } from './blacktop.js?v=167';
import { createWaterslide } from './waterslide.js?v=167';
import { createGarden } from './garden.js?v=167';
import { createPaint } from './paint.js?v=167';

export const WORLDS = {
  tunnel: { pulse: 0.55, goal: 'float and vibe — clicks send shockwaves', label: 'TUNNEL', create: createTunnel },
  surfer: { pulse: 0.9, goal: 'carve the canyon — clicks quake the ground', label: 'SURFER', create: createSurfer },
  orbit:  { pulse: 1.0, goal: 'conduct the swarm with your cursor', label: 'ORBIT',  create: createOrbit },
  bloom:  { pulse: 0.7, goal: 'fly the garden — clicks ripple through everything', label: 'BLOOM',  create: createBloom },
  trail:  { pulse: 0.45, goal: 'paint the sky — every click is a new color', label: 'TRAIL',  create: createTrail },
  signal: { pulse: 0.5, goal: 'BOWL the towers — one throw, five columns, big points', label: 'SIGNAL', create: createSignal },
  river:  { pulse: 0.8, rhythm: true, mode: 'DODGE', unit: 'RAMPS',
            rules: 'Steer with the mouse or the arrow keys. Hit the glowing green ramps, miss the dark rocks \u2014 a rock costs you two. Most ramps when the song ends takes it.', goal: 'ride the rapids — click for a surge of speed', label: 'RIVER',  create: createRiver },
  funhouse: { pulse: 0.85, goal: 'swim the pit — click to lunge, slider adds balls', label: 'BALL PIT', create: createFunhouse },
  lava:   { pulse: 0.7, goal: 'stir the wax — pop blobs at the top for +10', label: 'LAVA LAMP', create: createLavaLamp },
  plasma: { pulse: 0.35, goal: 'tame the lightning — it leaps to your finger', label: 'PLASMA', create: createPlasma },
  cherry: { pulse: 0.8, rhythm: true, mode: 'CATCH', unit: 'CAUGHT',
            rules: 'Swipe the basket left and right. Cherries drop on the beat \u2014 catch them. Dark ones are bombs and cost you four, so let those fall. Biggest basket takes it.', goal: 'snipe cherries (+15) or shake whole trees loose', label: 'CHERRY LAND', create: createCherryLand },
  slinky: { pulse: 0.6, rhythm: true, feetPerStep: 3, mode: 'RACE',
            rules: 'Tap when a ring reaches the orb. Hits build momentum and the spring walks faster \u2014 first to the foot of the stairs takes it.', goal: 'swipe to circle the spring — it never stops falling', label: 'SLINKY', create: createSlinky },
  blacktop: { pulse: 0.85, rhythm: true, feetPerStep: 42, mode: 'RACE',
            rules: 'Tap when a ring reaches the orb. A streak is your nitro \u2014 furthest down the road when the music stops takes it.', goal: 'hold for NITRO — survive the UFO for +40', label: 'BLACKTOP', create: createBlacktop },
  waterslide: { pulse: 0.8, rhythm: true, feetPerStep: 20, mode: 'RACE',
            rules: 'Tap when a ring reaches the orb. Keep the streak alive and the flume never slows \u2014 furthest down takes it.', goal: 'lean into the flume and never slow down', label: 'SLIDE', create: createWaterslide },
  paint:  { pulse: 0.3, goal: 'load a colour · fill every cell wearing its number', label: 'PAINT BY NUMBERS', create: createPaint },
  garden: { pulse: 0.45, goal: 'gather runes · fuse three alike · set each cell its number', label: 'LUMEN', create: createGarden },
};
