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
import { createTunnel } from './tunnel.js?v=286';
import { createSurfer } from './surfer.js?v=286';
import { createOrbit } from './orbit.js?v=286';
import { createBloom } from './bloom.js?v=286';
import { createTrail } from './trail.js?v=286';
import { createSignal } from './signal.js?v=286';
import { createRiver } from './river.js?v=286';
import { createFunhouse } from './funhouse.js?v=286';
import { createLavaLamp } from './lavalamp.js?v=286';
import { createPlasma } from './plasma.js?v=286';
import { createCherryLand } from './cherryland.js?v=286';
import { createSlinky } from './slinky.js?v=286';
import { createBlacktop } from './blacktop.js?v=286';
import { createWaterslide } from './waterslide.js?v=286';
import { createGarden } from './garden.js?v=286';
import { createPaint } from './paint.js?v=286';
import { createComets } from './comets.js?v=286';

export const WORLDS = {
  tunnel: { pulse: 0.55, goal: 'float and vibe — clicks send shockwaves', label: 'TUNNEL', create: createTunnel },
  surfer: { pulse: 0.9, goal: 'tap to jump — hang time pays, beats crossed mid-air pay triple', label: 'SURFER', create: createSurfer },
  orbit:  { pulse: 1.0, rhythm: true, mode: 'DODGE', unit: 'FLARES',
            rules: 'Your light circles the core. Steer in and out with the mouse or arrows. When the CENTER glows, swing wide; when the OUTER sky glows, tuck in close — the fire always tells you first. Dodge a flare and it’s a point; get caught and it costs you. Whoever rides out the most flares when the song ends wins.',
            goal: 'circle the core — dodge the flares', label: 'ORBIT',  create: createOrbit },
  bloom:  { pulse: 0.7, goal: 'fly the garden — clicks ripple through everything', label: 'BLOOM',  create: createBloom },
  trail:  { pulse: 0.45, goal: 'paint the sky — every click is a new color', label: 'TRAIL',  create: createTrail },
  signal: { pulse: 0.5, goal: 'BOWL the towers — one throw, five columns, big points', label: 'SIGNAL', create: createSignal },
  river:  { pulse: 0.8, rhythm: true, mode: 'DODGE', unit: 'RAMPS',
            rules: 'Steer with the mouse or arrows. Press and HOLD to speed up. Ride over the glowing green ramps — each one’s a point, worth double at full speed. Steer around the dark rocks — they take points away, and they don’t apologize. Whoever has the most ramps when the song ends wins.', goal: 'ride the rapids — hold to open the throttle', label: 'RIVER',  create: createRiver },
  funhouse: { pulse: 0.85, goal: 'swim the pit — click to lunge, slider adds balls', label: 'BALL PIT', create: createFunhouse },
  lava:   { pulse: 0.7, goal: 'stir the wax — pop blobs at the top for +10', label: 'LAVA LAMP', create: createLavaLamp },
  plasma: { pulse: 0.35, goal: 'tame the lightning — it leaps to your finger', label: 'PLASMA', create: createPlasma },
  cherry: { pulse: 0.8, rhythm: true, mode: 'CATCH', unit: 'CAUGHT',
            rules: 'Swipe to move the basket. Catch the falling cherries — each one’s a point, and the golden ones are worth five. Let the dark bombs fall on past — nothing inside a bomb worth catching. Whoever catches the most when the song ends wins.', goal: 'snipe cherries (+15) or shake whole trees loose', label: 'CHERRY LAND', create: createCherryLand },
  slinky: { pulse: 0.6, rhythm: true, feetPerStep: 3, mode: 'RACE', cue: 'world',
            rules: 'A bar of light climbs the stairs toward your slinky. Tap the very moment it arrives — good taps make your slinky hustle. Whoever reaches the bottom of the stairs first wins, and gravity does half the work.', goal: 'swipe to circle the spring — it never stops falling', label: 'SLINKY', create: createSlinky },
  blacktop: { pulse: 0.85, rhythm: true, feetPerStep: 42, mode: 'DODGE', unit: 'GATES',
            rules: 'Steer with the mouse or arrows. Press and HOLD to speed up. Drive through the green gates — each one’s a point, worth double at full speed. Miss the striped walls — they take points away, and they’ve never once moved for anybody. Whoever has the most gates when the song ends wins.', goal: 'run the midnight road — hold to open the throttle', label: 'BLACKTOP', create: createBlacktop },
  comets: { pulse: 0.9, rhythm: true, mode: 'DODGE', unit: 'STARS',
            rules: 'Steer with the mouse or arrows. Press and HOLD to fly faster. Fly through the silver stars — each one’s a point, and five in a row makes a constellation worth extra. Stay away from the big red stars — they’re not the friendly kind. Whoever has the most stars when the song ends wins.',
            goal: 'chase the comets — hold to burn', label: 'COMETS', create: createComets },
  slide: { pulse: 0.8, rhythm: true, feetPerStep: 20, mode: 'DODGE', unit: 'HOOPS',
            rules: 'Steer with the mouse or arrows. Press and HOLD to speed up. Lean through the green hoops — each one’s a point, worth double at full speed. The red hoops take points away — pretty, but so is poison ivy. Whoever has the most hoops when the song ends wins.', goal: 'ride the flume — hold to open the throttle', label: 'SLIDE', create: createWaterslide },
  paint:  { pulse: 0.3, goal: 'dead neon flickers on the walls — spray the signs alight before they go dark', label: 'PAINT', create: createPaint },
  garden: { pulse: 0.45, goal: 'sweep up the runes — three alike fuse. Light the whole picture', label: 'LUMEN', create: createGarden },
};
