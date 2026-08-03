// Note highway — the way rhythm games actually tell you when to press.
//
// The first attempt was an approach ring that closed over a single beat. That
// is only about half a second of warning, which is reaction time, not
// anticipation: you can never see what is coming, only what has arrived, so
// there is no moment where you are *ready*. Every real rhythm game solves this
// the same way — discrete notes, travelling a fixed distance over a fixed lead
// time, toward a stationary hit line. You read the pattern approaching, your
// hands prepare, and the press is confident.
//
// So: notes are scheduled onto the predicted beat grid ahead of the playhead,
// they slide toward the line, and you press when one arrives. Downbeats are
// accented so the bar structure is legible and you always know where you are.
//
// The lane is thin, letterspaced and low-contrast — a rhythm game's readability
// without a plastic Guitar Hero highway sitting on top of the world.

const LEAD = 2.0;          // seconds a note is visible before it must be hit
const PERFECT = 0.05;
const GOOD = 0.11;
const MISS_AFTER = 0.17;   // past this, the note is gone and counts as missed

// Keep the strongest notes until the density target is met, never letting two
// survivors sit closer than the spacing that target implies.
function thin(notes, duration, target) {
  if (!notes.length || !duration) return notes;
  const want = Math.round(duration * target);
  if (notes.length <= want) return notes;

  const gap = 1 / (target * 1.9);            // allows doubles, forbids runs
  const byStrength = [...notes].sort((a, b) => b.v - a.v);
  const kept = [];
  for (const n of byStrength) {
    if (kept.length >= want) break;
    let ok = true;
    for (const k of kept) {
      if (Math.abs(k.t - n.t) < gap) { ok = false; break; }
    }
    if (ok) kept.push(n);
  }
  kept.sort((a, b) => a.t - b.t);
  return kept;
}

export class BeatCue {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.notes = [];          // working set: {t, v, accent, state, flash, rank}
    this.chart = null;        // the whole track, analysed up front
    this._at = 0;             // read head into chart.notes
    this.lineFlash = 0;
    this.tick = 0;        // the beat landing, independent of you
    this.lastRank = null;
    this.stats = { perfect: 0, good: 0, missed: 0, streak: 0, bestStreak: 0 };
  }

  // How you did, and by how much. A rhythm game that will not tell you whether
  // you were early or late is one you cannot get better at, and getting better
  // is the entire pleasure.
  _verdict(rank, offset, pressed = true) {
    this.verdict = { rank, offset, age: 0, pressed };
    // Only a real press belongs in the scatter. A note that timed out has no
    // timing error — recording it as 0 would read as "dead on the beat", which
    // is the opposite of what happened.
    if (!pressed) return;
    this.scatter.push(offset);
    if (this.scatter.length > 9) this.scatter.shift();
  }

  reset() {
    this.verdict = null;
    this.scatter = [];
    this.notes = [];
    this._at = 0;
    this.stats = { perfect: 0, good: 0, missed: 0, streak: 0, bestStreak: 0 };
    this.hint = 1;   // teaches the press, then gets out of the way
    this.verdict = null;
    this.scatter = [];   // signed timing errors of recent presses
  }

  // A chart is the analysed track: every note, where the music actually put
  // it. Charting up front is the only way notes can be on screen before they
  // are played, and it guarantees every player in the room plays the same
  // chart rather than one derived from their own machine's listening.
  // `target` is notes per second. A raw onset chart follows the music exactly,
  // which on a busy track means three and a half presses a second — a genuinely
  // hard chart, and this has to be playable by anyone who joins a stream. So
  // the chart is thinned to a target density by keeping the strongest hits and
  // spacing them out. It self-tunes: a sparse ballad keeps everything, a dense
  // track loses its weakest filler, and both land somewhere playable.
  setChart(chart, target = 2.2) {
    if (!chart) { this.chart = null; this.reset(); return; }
    this.chart = { ...chart, notes: thin(chart.notes, chart.duration, target) };
    this.reset();
  }

  // Put notes on the grid ahead of the playhead. Only beats, and every beat —
  // a chart with holes would need musical structure we do not have yet, and an
  // even pulse is honest about what the clock actually knows.
  // Reveal the notes the player should be able to see, from the chart.
  _reveal(songTime) {
    const c = this.chart;
    if (!c) return;
    const horizon = songTime + LEAD + 0.2;
    while (this._at < c.notes.length && c.notes[this._at].t <= horizon) {
      const n = c.notes[this._at++];
      if (n.t < songTime - 0.5) continue;      // seeked past it
      this.notes.push({ t: n.t, v: n.v, accent: n.accent, state: 'live', flash: 0, rank: null });
    }
  }

  // Seeking or replaying has to re-find the read head, or the chart and the
  // audio silently disagree for the rest of the track.
  seek(songTime) {
    this.notes = [];
    const c = this.chart;
    this._at = 0;
    if (!c) return;
    while (this._at < c.notes.length && c.notes[this._at].t < songTime) this._at++;
  }

  _schedule(clock, songTime) {
    // Guard the arithmetic before trusting it. A zero or missing period makes
    // every beat index Infinity, and `for (i = Infinity; i <= Infinity; i++)`
    // never advances — the loop hangs the whole app, not just the cue. Cheap
    // to prevent, catastrophic to hit.
    if (!clock.locked) return;
    if (!Number.isFinite(clock.period) || clock.period < 0.05) return;
    if (!Number.isFinite(songTime) || !Number.isFinite(clock.anchor)) return;

    const horizon = songTime + LEAD + 0.4;
    let k = Math.floor((songTime - clock.anchor) / clock.period);
    if (!Number.isFinite(k)) return;
    if (this._scheduledTo < k) this._scheduledTo = k;
    const kEnd = Math.floor((horizon - clock.anchor) / clock.period);
    if (!Number.isFinite(kEnd)) return;
    // a hard ceiling as well, so a bad clock can never spin here
    const limit = Math.min(kEnd, this._scheduledTo + 64);
    for (let i = this._scheduledTo + 1; i <= limit; i++) {
      this.notes.push({
        t: clock.anchor + i * clock.period,
        accent: ((i % 4) + 4) % 4 === 0,   // downbeat every four
        state: 'live', flash: 0, rank: null,
      });
      this._scheduledTo = i;
    }
  }

  // The player pressed. Take the nearest live note — that is what a rhythm
  // game judges, not the raw grid, so a press between notes cannot be scored
  // against a beat the player was not aiming at.
  press(songTime) {
    let best = null, bestD = Infinity;
    for (const n of this.notes) {
      if (n.state !== 'live') continue;
      const d = Math.abs(n.t - songTime);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (!best || bestD > GOOD) {
      this.lastRank = 'miss';
      this.stats.streak = 0;
      const lateM = best ? songTime > best.t : false;
      this._verdict('miss', best ? songTime - best.t : 0);
      return { rank: 'miss', q: 0, late: lateM };
    }
    const late = songTime > best.t;
    const rank = bestD <= PERFECT ? 'perfect' : 'good';
    this._verdict(rank, songTime - best.t);
    best.state = 'hit'; best.flash = 1; best.rank = rank;
    this.lineFlash = 1;
    this.lastRank = rank;
    this.hint = Math.max(0, this.hint - 0.34);   // three good presses and it goes
    this.stats[rank === 'perfect' ? 'perfect' : 'good']++;
    this.stats.streak++;
    if (this.stats.streak > this.stats.bestStreak) this.stats.bestStreak = this.stats.streak;
    return { rank, q: rank === 'perfect' ? 1 - bestD / PERFECT * 0.3 : 0.55, late };
  }

  update(clock, songTime) {
    if (this.verdict) this.verdict.age += 1 / 60;

    // The orb answered only YOUR press, which means there was no ground truth
    // to learn the timing from — if you were wrong you had nothing to be wrong
    // against. It now ticks on every note as it lands, played or not, so the
    // beat is visible on the target itself and you can simply watch it.
    for (const n of this.notes) {
      if (!n.ticked && songTime >= n.t) { n.ticked = true; this.tick = 1; }
    }
    if (this.chart) this._reveal(songTime);
    else this._schedule(clock, songTime);
    for (const n of this.notes) {
      if (n.state === 'live' && songTime - n.t > MISS_AFTER) {
        n.state = 'miss'; n.flash = 1;
        this.stats.missed++;
        this.stats.streak = 0;
        this._verdict('miss', 0, false);
      }
      if (n.flash) n.flash *= 0.9;
    }
    // drop notes once they are well behind the line
    this.notes = this.notes.filter(n => songTime - n.t < 0.9);
    this.lineFlash *= 0.88;
  }

  // ── The cue lives in the world, not under it ──
  //
  // A lane along the bottom of the frame works, but it costs you the world:
  // your eyes lock to the bar and the thing you came to look at goes unwatched.
  // In every one of these worlds the eye is already at the vanishing point, so
  // the cue belongs there — an orb at the centre with rings closing onto it.
  //
  // Crucially this keeps the anticipation that made the highway work. Every
  // note within the lead time has its own ring, so several are on screen at
  // once and you read the pattern approaching exactly as you read notes
  // sliding down a lane. Rings are thin and the orb is translucent, so the
  // world stays visible through the whole thing.

  // the race, kept small and out of the way in a corner — it is information
  // you glance at, not something you play
  drawField(field, hue, W, H) {
    if (!field) return;
    const { ctx } = this;
    const x0 = 34, y = H - 46, wide = Math.min(360, W * 0.28);

    ctx.textAlign = 'left';
    ctx.font = "600 21px 'Didot', 'Bodoni 72', Georgia, serif";
    ctx.fillStyle = `hsla(${hue}, 55%, 92%, 0.85)`;
    ctx.fillText(field.feet.toLocaleString() + ' ' + (field.unit || 'FT'), x0, y);
    ctx.font = "11px 'SF Mono', ui-monospace, Menlo, monospace";
    ctx.fillStyle = `hsla(${hue}, 30%, 76%, 0.45)`;
    // a race has a distance left to run; a tally has no destination, so say
    // what it is instead of inventing one
    ctx.fillText(field.collect ? 'cherries shaken loose'
                               : field.feetLeft.toLocaleString() + ' to go', x0, y + 16);

    // the field, as a hairline with everyone on it
    const ry = y + 30;
    ctx.strokeStyle = `hsla(${hue}, 40%, 62%, 0.22)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, ry); ctx.lineTo(x0 + wide, ry); ctx.stroke();
    const at = f => x0 + Math.max(0, Math.min(1, f)) * wide;
    for (const r of field.rivals || []) {
      const c = '#' + (r.color >>> 0).toString(16).padStart(6, '0');
      ctx.fillStyle = c; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.arc(at(r.f), ry, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = `hsl(${hue}, 90%, 90%)`;
    ctx.beginPath(); ctx.arc(at(field.fraction), ry, 4.2, 0, Math.PI * 2); ctx.fill();

    if (field.mult > 1) {
      ctx.font = "600 17px 'SF Mono', ui-monospace, Menlo, monospace";
      ctx.fillStyle = `hsla(${hue}, 85%, 82%, 0.9)`;
      ctx.fillText('\u00d7' + field.mult.toFixed(2).replace(/0$/, ''), x0, y - 26);
    }
  }

  draw(clock, songTime, hue, field) {
    const { ctx, cv } = this;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    this.lineFlash *= 0.90;
    this.tick *= 0.86;

    // Slightly above centre: the vanishing point in these worlds sits a little
    // high, and it keeps the orb clear of the world's own title text.
    const cx = W / 2, cy = H * 0.46;
    const rOrb = Math.max(30, Math.min(64, Math.min(W, H) * 0.062));
    const rFar = Math.min(W, H) * 0.42;

    if (!this.chart && !clock.locked) {
      ctx.strokeStyle = `hsla(${hue}, 25%, 65%, 0.16)`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 7]);
      ctx.beginPath(); ctx.arc(cx, cy, rOrb, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      this.drawField(field, hue, W, H);
      return;
    }

    // ── the rings, one per upcoming note ──
    // Radius falls linearly with time, so a constant approach speed reads as
    // constant — the same reason a note highway scrolls at a fixed rate.
    for (const n of this.notes) {
      const dt = n.t - songTime;

      if (n.state === 'hit') {
        // consumed: a shockwave leaving the orb
        const f = n.flash;
        const r = rOrb * (1 + (1 - f) * 1.5);
        ctx.strokeStyle = n.rank === 'perfect'
          ? `hsla(${hue}, 95%, 92%, ${(f * 0.9).toFixed(3)})`
          : `hsla(${hue}, 70%, 80%, ${(f * 0.5).toFixed(3)})`;
        ctx.lineWidth = n.rank === 'perfect' ? 3 : 2;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      if (n.state === 'miss') {
        ctx.strokeStyle = `hsla(${hue}, 12%, 58%, ${(n.flash * 0.28).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(cx, cy, rOrb * 0.82, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      if (dt > LEAD + 0.05 || dt < -MISS_AFTER) continue;

      const u = Math.max(0, dt / LEAD);              // 1 far out, 0 at the orb
      const r = rOrb + u * (rFar - rOrb);
      const near = 1 - u;
      const imminent = Math.pow(Math.max(0, 1 - Math.abs(dt) / 0.20), 2);

      // Distant rings stay quiet so the NEXT one is never in doubt. Reading a
      // crowd of equally bright circles is what made this hard.
      const dim = u > 0.55 ? 0.45 : 1;
      ctx.strokeStyle = `hsla(${hue}, ${72 + near * 24}%, ${62 + near * 26}%, ${((0.16 + near * 0.5 + imminent * 0.3) * dim).toFixed(3)})`;
      ctx.lineWidth = (n.accent ? 3.2 : 2) + imminent * 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

      // Four marks riding the ring, closing on four fixed notches at the orb.
      // A ring merging with a ring has no moment of arrival — the eye cannot
      // judge when two concentric circles coincide. Two small marks meeting is
      // a crossing you can see to the frame, which is what a note highway gets
      // for free from its hit line.
      ctx.lineWidth = 2 + imminent * 2.5;
      ctx.strokeStyle = `hsla(${hue}, 90%, ${74 + imminent * 22}%, ${((0.3 + near * 0.5 + imminent * 0.2) * dim).toFixed(3)})`;
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        const ca = Math.cos(a), sa = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(cx + ca * (r - 7), cy + sa * (r - 7));
        ctx.lineTo(cx + ca * r, cy + sa * r);
        ctx.stroke();
      }
    }

    // ── the orb: what the rings are closing onto, and what you press ──
    const lf = this.lineFlash;
    const g = ctx.createRadialGradient(cx, cy, rOrb * 0.1, cx, cy, rOrb * (2.1 + lf));
    g.addColorStop(0, `hsla(${hue}, 90%, 82%, ${(0.24 + lf * 0.4).toFixed(3)})`);
    g.addColorStop(0.5, `hsla(${hue}, 90%, 75%, ${(0.08 + lf * 0.16).toFixed(3)})`);
    g.addColorStop(1, `hsla(${hue}, 90%, 75%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, rOrb * (2.1 + lf), 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = `hsla(${hue}, 90%, ${80 + lf * 18}%, ${(0.72 + lf * 0.28).toFixed(3)})`;
    ctx.lineWidth = 2.6 + lf * 3;
    ctx.beginPath(); ctx.arc(cx, cy, rOrb, 0, Math.PI * 2); ctx.stroke();

    // an inner rule, so it reads as an instrument rather than a blob
    ctx.strokeStyle = `hsla(${hue}, 70%, 88%, ${(0.20 + lf * 0.3).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, rOrb - 7, 0, Math.PI * 2); ctx.stroke();

    // The four notches the incoming marks are aiming at. They light on the
    // beat itself — this is the ground truth the player learns from.
    const tk = this.tick;
    ctx.lineWidth = 2.4 + tk * 3;
    ctx.strokeStyle = `hsla(${hue}, 92%, ${78 + tk * 20}%, ${(0.5 + tk * 0.5).toFixed(3)})`;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      const ca = Math.cos(a), sa = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx + ca * rOrb, cy + sa * rOrb);
      ctx.lineTo(cx + ca * (rOrb + 9 + tk * 6), cy + sa * (rOrb + 9 + tk * 6));
      ctx.stroke();
    }

    // and the orb outline pulses on the beat too, so the tick reads even if
    // you are watching the middle rather than the edge
    if (tk > 0.02) {
      ctx.strokeStyle = `hsla(${hue}, 95%, 92%, ${(tk * 0.55).toFixed(3)})`;
      ctx.lineWidth = 1.5 + tk * 2;
      ctx.beginPath(); ctx.arc(cx, cy, rOrb + 3 + tk * 4, 0, Math.PI * 2); ctx.stroke();
    }

    // ── the verdict ──
    // Rhythm games all show this because it is the only way to improve: not
    // just hit or miss, but which side of the beat you were on. Restrained
    // typography and a fast fade, so it informs without becoming a pop-up.
    const v = this.verdict;
    if (v && v.age < 0.75) {
      const f = 1 - v.age / 0.75;
      const perfect = v.rank === 'perfect', miss = v.rank === 'miss';
      const ms = Math.round(v.offset * 1000);
      const side = miss ? '' : (Math.abs(ms) < 12 ? '' : (ms > 0 ? '  LATE' : '  EARLY'));

      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, f * 1.6);
      ctx.font = "600 13px 'SF Mono', ui-monospace, Menlo, monospace";
      ctx.fillStyle = perfect ? `hsl(${hue}, 70%, 96%)`
        : miss ? `hsla(${hue}, 10%, 62%, 0.75)`
               : `hsl(${hue}, 60%, 84%)`;
      const word = perfect ? 'P E R F E C T' : miss ? 'M I S S' : 'G O O D';
      ctx.fillText(word + side.split('').join(' '), cx, cy + rOrb + 34);
      ctx.globalAlpha = 1;
    }

    // ── the scatter ──
    // Your last few presses as ticks either side of the beat. A drift to one
    // side is a habit you can correct, which a per-hit verdict alone never
    // reveals.
    if (this.scatter.length) {
      const sw = rOrb * 2.4, sy = cy + rOrb + 52;
      ctx.strokeStyle = `hsla(${hue}, 40%, 65%, 0.20)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - sw, sy); ctx.lineTo(cx + sw, sy); ctx.stroke();
      // the beat itself
      ctx.strokeStyle = `hsla(${hue}, 80%, 85%, 0.55)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, sy - 5); ctx.lineTo(cx, sy + 5); ctx.stroke();

      for (let i = 0; i < this.scatter.length; i++) {
        const off = this.scatter[i];
        const age = (this.scatter.length - i) / this.scatter.length;
        const x = cx + Math.max(-1, Math.min(1, off / GOOD)) * sw;
        ctx.strokeStyle = `hsla(${hue}, 75%, 82%, ${(0.15 + age * 0.6).toFixed(3)})`;
        ctx.lineWidth = i === this.scatter.length - 1 ? 2.4 : 1.4;
        ctx.beginPath(); ctx.moveTo(x, sy - 4); ctx.lineTo(x, sy + 4); ctx.stroke();
      }
    }

    this.drawField(field, hue, W, H);
  }
}
