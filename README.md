# SOUNDWORLDS

Browser-based multiplayer audio-reactive visual playground for livestreams.
Vanilla JS + Three.js (CDN import map), no build step. Deployable to any
static host (GitHub Pages / Cloudflare Pages).

**Current status: Phase 3** — all six worlds + multiplayer presence layer.

Multiplayer is presence-only (no shared physics, no authority): every client
simulates locally and broadcasts a tiny state blob at ~15Hz; everyone else
renders those as glowing ghosts with styled names. If the socket drops, the
world keeps running single-player with no error state.

Fourteen worlds: TUNNEL (tube flight), SURFER (spectrum-terrain canyon),
ORBIT (core + beat rings), BLOOM (persistent music-grown garden),
TRAIL (persistent ribbon comet), SIGNAL (monolith corridor + bowling),
RIVER (lazy river with real current), BALL PIT (physics pit — taps rain
more balls), LAVA LAMP (raymarched metaball wax), PLASMA (lightning globe),
CHERRY LAND (shake the trees), SLINKY (walks downstairs forever, tap to
boing), BLACKTOP (night street racing, tap = nitro), SLIDE (open-top
luge flume, tap = splash + speed).

All ten share the theme engine (`js/lib/themes.js`): every color mode,
pattern-agnostic, drives every world.

## Run locally

Any static server from this directory works:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Open `http://localhost:8000`, click once (unlocks the AudioContext), then
pick a track from the dropdown or load a local file.

## Test tracks

Drop audio files into `/audio/` and list their filenames in
`audio/manifest.json`, e.g.:

```json
["track1.mp3", "track2.m4a"]
```

They'll appear in the panel's track dropdown. The local-file picker works
without any manifest.

## Controls

| Key | Action |
| --- | --- |
| `H` | hide/show the whole panel (clean recording) |
| `C` | collapse/expand the panel |
| `Space` | play / pause |
| `S` | export a PNG of the canvas |

Panel: track picker, play/pause/scrub/volume, world selector (live switch),
reactivity, beat sensitivity, smoothing, hue, ATTRACT vs INTERACTIVE mode,
FPS + participant count.

In INTERACTIVE mode, steer with the mouse (desktop) or tilt (mobile).

URL params: `?world=tunnel|surfer|orbit|bloom|trail|signal` (`room` and `names` are reserved for the
multiplayer phase).

## Architecture

- `js/audio-engine.js` — Web Audio AnalyserNode → one normalized object per
  frame: `bass, lowMid, mid, high, treble, volume, beat, beatIntensity,
  energy`. Beat detection is rolling-average bass with tunable threshold,
  smoothing, and cooldown.
- `js/worlds/*.js` — each world exports a factory returning
  `{ init(scene, camera), update(dt, audio, participants, opts), dispose() }`,
  plus optional `setInput(x, y)` (steer) and `onTap(x, y)` (click/tap
  interaction — every world should implement it).
  Worlds never analyze audio or touch the network.
- `js/worlds/registry.js` — adding a world = one file + one entry here.
- `js/main.js` — shared shell: renderer, loop, panel, world switcher,
  participants array (stubbed at 1 for now).

## Multiplayer

Join flow: the streamer clicks HOST (a 4-char room code appears in-world,
top-left); viewers open the site on their phone, enter the code + a name,
and their name materializes in the world with a flare and a chime.

- Names: 3-14 chars `[a-zA-Z0-9_]`, validated server-side (NFKC normalize,
  leetspeak collapse, profanity wordlist, owner-impersonation block, rename
  rate limit 30s). Rejections just say "pick another name".
- Max 120 active participants; later joiners become spectators (receive,
  never send). Peers are dropped after 5s of silence.
- Colors come from a fixed 12-color palette assigned on join.

Streamer hotkeys (all take effect within one frame):

| Key | Action |
| --- | --- |
| `B` | broadcast mode — hide UI, widen camera to frame the crowd |
| `N` | all names -> color-only, instantly |
| `P` | participants list — click a name to hide just that name |

URL params: `?world=…&room=CODE&names=off&sim=8` (`sim` spawns fake
participants for testing/attract).

## PartyKit server

Lives in `/partykit`. To run it:

```bash
cd partykit
npm install
npx partykit dev        # local dev server
npx partykit deploy     # deploys to <name>.<user>.partykit.dev
```

Then point the client at it — set the host before `js/main.js` loads,
e.g. in `index.html`:

```html
<script>window.FANCYPANTS_HOST = 'fancy-pants.YOURUSER.partykit.dev';</script>
```

With no host configured, JOIN/HOST still work visually but the session is
solo — by design, the show must go on.
