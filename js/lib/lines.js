// LINES — the archetype engine. Reads a world's lines.json, matches the
// end-of-run record against that world's archetypes (first match wins, so
// rarer/weirder archetypes are listed first in the file), then draws a line
// by weight — big weights common, small weights rare, so the unhinged ones
// stay special. Copy lives in /worlds/{id}/lines.json, editable without
// touching code. A world with no file falls back to the shared pool inside
// whatever file DID load, or to the tiny built-in pool below, so a card
// never renders empty.

const cache = new Map();

const BUILTIN_FALLBACK = [
  { t: 'you were there. the song was there. something happened between y’all.', c: 'go make it clearer →', w: 10 },
  { t: '{seconds} seconds of pure something-or-other.', c: 'one more song settles it →', w: 10 },
  { t: 'the world kept spinnin’ and so did you, more or less.', c: 'less or more, your call →', w: 10 },
];

export async function loadLines(worldId, version = '') {
  if (cache.has(worldId)) return cache.get(worldId);
  let spec = null;
  try {
    const r = await fetch(`worlds/${worldId}/lines.json${version ? '?v=' + version : ''}`);
    if (r.ok) spec = await r.json();
  } catch (e) { /* no file, no problem — fallback covers it */ }
  cache.set(worldId, spec);
  return spec;
}

// conditions: { field: [op, value] } — every entry must hold.
// ops: '>', '>=', '<', '<=', '==', '!='
function matches(when, run) {
  if (!when) return true;
  for (const [field, [op, val]] of Object.entries(when)) {
    const v = run[field];
    if (v === null || v === undefined) return false;
    if (op === '>' && !(v > val)) return false;
    if (op === '>=' && !(v >= val)) return false;
    if (op === '<' && !(v < val)) return false;
    if (op === '<=' && !(v <= val)) return false;
    if (op === '==' && !(v === val)) return false;
    if (op === '!=' && !(v !== val)) return false;
  }
  return true;
}

function weightedPick(pool) {
  const total = pool.reduce((a, l) => a + (l.w || 1), 0);
  let roll = Math.random() * total;
  for (const l of pool) { roll -= (l.w || 1); if (roll <= 0) return l; }
  return pool[pool.length - 1];
}

// numbers folded into the copy — real details, per the house style
function fill(text, run) {
  const subs = {
    seconds: run.runSeconds ?? 0,
    minutes: Math.max(1, Math.round((run.sessionSeconds ?? 0) / 60)),
    move: Math.round((run.movementRatio ?? 0) * 100),
    tweaks: run.tweakCount ?? 0,
    worlds: run.worldsVisited ?? 0,
    songs: run.songsPlayed ?? 0,
    feet: (run.feet ?? 0).toLocaleString(),
    pct: Math.round((run.accuracy ?? 0) * 100),
    streak: run.bestStreak ?? 0,
    points: (run.pointsGained ?? 0).toLocaleString(),
    room: run.roomSize ?? 0,
    song: run.songTitle || 'that song',
    artist: run.artistName || 'the artist',
  };
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in subs ? String(subs[k]) : m));
}

// the one call the share card makes. force = archetype id override (dev).
export async function pickShareLine(run, version = '', force = null) {
  const spec = run && run.worldId ? await loadLines(run.worldId, version) : null;
  let arch = null;
  if (spec && Array.isArray(spec.archetypes)) {
    arch = force
      ? spec.archetypes.find(a => a.id === force) || null
      : spec.archetypes.find(a => matches(a.when, run)) || null;
  }
  const pool = (arch && arch.lines && arch.lines.length ? arch.lines : null)
    || (spec && spec.fallback && spec.fallback.length ? spec.fallback : null)
    || BUILTIN_FALLBACK;
  const line = weightedPick(pool);
  return {
    archetype: arch ? arch.id : 'fallback',
    text: fill(line.t, run || {}),
    cta: fill(line.c || 'go on then →', run || {}),
    why: arch ? arch.when : 'no archetype matched',
  };
}
