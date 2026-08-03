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
    this.lastRank = null;
    this.stats = { perfect: 0, good: 0, missed: 0, streak: 0, bestStreak: 0 };
  }

  reset() {
    this.notes = [];
    this._at = 0;
    this.stats = { perfect: 0, good: 0, missed: 0, streak: 0, bestStreak: 0 };
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
      return { rank: 'miss', q: 0, late: best ? songTime > best.t : false };
    }
    const late = songTime > best.t;
    const rank = bestD <= PERFECT ? 'perfect' : 'good';
    best.state = 'hit'; best.flash = 1; best.rank = rank;
    this.lineFlash = 1;
    this.lastRank = rank;
    this.stats[rank === 'perfect' ? 'perfect' : 'good']++;
    this.stats.streak++;
    if (this.stats.streak > this.stats.bestStreak) this.stats.bestStreak = this.stats.streak;
    return { rank, q: rank === 'perfect' ? 1 - bestD / PERFECT * 0.3 : 0.55, late };
  }

  update(clock, songTime) {
    if (this.chart) this._reveal(songTime);
    else this._schedule(clock, songTime);
    for (const n of this.notes) {
      if (n.state === 'live' && songTime - n.t > MISS_AFTER) {
        n.state = 'miss'; n.flash = 1;
        this.stats.missed++;
        this.stats.streak = 0;
      }
      if (n.flash) n.flash *= 0.9;
    }
    // drop notes once they are well behind the line
    this.notes = this.notes.filter(n => songTime - n.t < 0.9);
    this.lineFlash *= 0.88;
  }

  // `field` is the race: {fraction, rivals:[{f, color}], place, streak, mult}.
  // A race with no visible finish line is just tapping, so the rail above the
  // lane is where you are, where everyone else is, and how far is left.
  drawField(field, hue) {
    const { ctx, cv } = this;
    if (!field) return;
    const W = cv.width, y = 9, x0 = 6, x1 = W - 6;
    const at = f => x0 + Math.max(0, Math.min(1, f)) * (x1 - x0);

    ctx.strokeStyle = `hsla(${hue}, 40%, 60%, 0.20)`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();

    // the bottom of the stairs
    ctx.strokeStyle = `hsla(${hue}, 80%, 78%, 0.45)`;
    ctx.beginPath(); ctx.moveTo(x1, y - 6); ctx.lineTo(x1, y + 6); ctx.stroke();

    for (const r of field.rivals || []) {
      const c = '#' + (r.color >>> 0).toString(16).padStart(6, '0');
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.75;
      ctx.beginPath(); ctx.arc(at(r.f), y, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // you, always on top and always brighter
    ctx.fillStyle = `hsl(${hue}, 90%, 88%)`;
    ctx.beginPath(); ctx.arc(at(field.fraction), y, 4.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `hsla(${hue}, 90%, 95%, 0.9)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(at(field.fraction), y, 6.6, 0, Math.PI * 2); ctx.stroke();

    // a streak worth having announces itself, quietly
    if (field.mult > 1) {
      ctx.fillStyle = `hsla(${hue}, 85%, 80%, 0.85)`;
      ctx.font = "600 15px 'SF Mono', ui-monospace, Menlo, monospace";
      ctx.textAlign = 'right';
      ctx.fillText('\u00d7' + field.mult.toFixed(2).replace(/0$/, ''), x1, y + 30);
    }
  }

  draw(clock, songTime, hue, field) {
    const { ctx, cv } = this;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    const hitX = W * 0.18;
    const midY = H * 0.5;
    const laneH = H * 0.42;

    // ── the lane ──
    ctx.strokeStyle = `hsla(${hue}, 40%, 60%, 0.22)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, midY - laneH / 2); ctx.lineTo(W, midY - laneH / 2);
    ctx.moveTo(0, midY + laneH / 2); ctx.lineTo(W, midY + laneH / 2); ctx.stroke();

    if (this.chart) {
      // charted: the lane is live even if the realtime clock has no opinion
    } else if (!clock.locked) {
      ctx.fillStyle = `hsla(${hue}, 20%, 65%, 0.30)`;
      ctx.font = "9px 'SF Mono', ui-monospace, Menlo, monospace";
      ctx.textAlign = 'center';
      ctx.fillText('L I S T E N I N G', W / 2, midY + 3);
      this.drawField(field, hue);
      return;
    }

    // ── the hit line: where a note must be when you press ──
    const lf = this.lineFlash;
    ctx.strokeStyle = `hsla(${hue}, 90%, ${78 + lf * 18}%, ${(0.78 + lf * 0.22).toFixed(3)})`;
    ctx.lineWidth = 3 + lf * 3;
    ctx.beginPath();
    ctx.moveTo(hitX, midY - laneH * 0.72); ctx.lineTo(hitX, midY + laneH * 0.72);
    ctx.stroke();
    // a soft pool behind it so the eye rests there
    const g = ctx.createRadialGradient(hitX, midY, 0, hitX, midY, laneH * 1.5);
    g.addColorStop(0, `hsla(${hue}, 90%, 78%, ${(0.10 + lf * 0.26).toFixed(3)})`);
    g.addColorStop(1, `hsla(${hue}, 90%, 78%, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(hitX - laneH * 1.5, 0, laneH * 3, H);

    // ── the notes, sliding in from the right ──
    for (const n of this.notes) {
      const dt = n.t - songTime;                 // seconds until it must be hit
      if (dt > LEAD + 0.05) continue;
      const x = hitX + (dt / LEAD) * (W - hitX);
      if (x < -20) continue;
      const h = n.accent ? laneH * 0.92 : laneH * 0.58;

      if (n.state === 'hit') {
        // consumed — a bright bloom that lifts away
        const f = n.flash;
        ctx.strokeStyle = n.rank === 'perfect'
          ? `hsla(${hue}, 95%, 92%, ${(f * 0.95).toFixed(3)})`
          : `hsla(${hue}, 70%, 78%, ${(f * 0.6).toFixed(3)})`;
        ctx.lineWidth = n.rank === 'perfect' ? 3.4 : 2.4;
        const lift = (1 - f) * 12;
        ctx.beginPath();
        ctx.moveTo(hitX, midY - h / 2 - lift); ctx.lineTo(hitX, midY + h / 2 - lift);
        ctx.stroke();
        continue;
      }
      if (n.state === 'miss') {
        ctx.strokeStyle = `hsla(${hue}, 15%, 55%, ${(n.flash * 0.35).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, midY - h / 2); ctx.lineTo(x, midY + h / 2); ctx.stroke();
        continue;
      }

      // live: brightens as it nears the line, so the moment is unmistakable
      const near = Math.max(0, 1 - dt / LEAD);
      const imminent = Math.pow(Math.max(0, 1 - Math.abs(dt) / 0.22), 2);
      ctx.strokeStyle = `hsla(${hue}, ${72 + near * 24}%, ${64 + near * 24 + imminent * 12}%, ${(0.38 + near * 0.55 + imminent * 0.25).toFixed(3)})`;
      ctx.lineWidth = (n.accent ? 4.5 : 3) + imminent * 2;
      ctx.beginPath();
      ctx.moveTo(x, midY - h / 2); ctx.lineTo(x, midY + h / 2);
      ctx.stroke();
    }

    // faint tick marks at half-lead and full-lead, so distance reads as time
    ctx.fillStyle = `hsla(${hue}, 30%, 60%, 0.10)`;
    ctx.fillRect(hitX + (W - hitX) * 0.5, midY - 1, 1, 2);
    ctx.fillRect(W - 1, midY - 1, 1, 2);

    this.drawField(field, hue);
  }
}
