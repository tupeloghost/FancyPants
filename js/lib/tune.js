// TUNE — the feel of the game as eight live dials.
//
// The iteration loop this replaces: Claude guesses a constant, Stephanie
// plays alone, reports "boring", repeat. Feel cannot be tuned by proxy. These
// multipliers are read live by every system, the panel (backtick key) drags
// them mid-game, and values persist — so the numbers that feel right get
// FOUND at the controls and then reported, not guessed at.

export const TUNE = {
  speed: 1,      // how fast every world moves
  density: 1,    // how often things arrive (gates, ramps, hoops, fruit)
  hitstop: 1,    // the freeze on a hit
  punch: 1,      // the lens kick on a hit
  sfx: 1,        // action-sound volume
  rubber: 1,     // comeback strength when behind
  hunger: 1,     // how fast the gray eats back (paint)
  heat: 1,       // how hard songs escalate toward the end
};

const KEY = 'fb_tune';
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  for (const k of Object.keys(TUNE)) if (typeof saved[k] === 'number') TUNE[k] = saved[k];
} catch {}

export function saveTune() { localStorage.setItem(KEY, JSON.stringify(TUNE)); }
export function resetTune() {
  for (const k of Object.keys(TUNE)) TUNE[k] = 1;
  saveTune();
}
