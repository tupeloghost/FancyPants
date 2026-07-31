# SOUNDWORLDS

Browser-based multiplayer audio-reactive visual playground for livestreams.
Vanilla JS + Three.js (CDN import map), no build step. Deployable to any
static host (GitHub Pages / Cloudflare Pages).

**Current status: Phase 1** — audio engine + TUNNEL world + controls panel,
single-player only. Multiplayer (PartyKit), join flow, and the remaining
five worlds come after this phase is approved.

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

Panel: track picker, play/pause/scrub/volume, world selector (live switch),
reactivity, beat sensitivity, smoothing, hue, ATTRACT vs INTERACTIVE mode,
FPS + participant count.

In INTERACTIVE mode, steer with the mouse (desktop) or tilt (mobile).

URL params: `?world=tunnel` (`room` and `names` are reserved for the
multiplayer phase).

## Architecture

- `js/audio-engine.js` — Web Audio AnalyserNode → one normalized object per
  frame: `bass, lowMid, mid, high, treble, volume, beat, beatIntensity,
  energy`. Beat detection is rolling-average bass with tunable threshold,
  smoothing, and cooldown.
- `js/worlds/*.js` — each world exports a factory returning
  `{ init(scene, camera), update(dt, audio, participants, opts), dispose() }`.
  Worlds never analyze audio or touch the network.
- `js/worlds/registry.js` — adding a world = one file + one entry here.
- `js/main.js` — shared shell: renderer, loop, panel, world switcher,
  participants array (stubbed at 1 for now).

## PartyKit server

Not built yet — arrives with the multiplayer phase.
