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

export class BeatCue {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.notes = [];          // {t, accent, state:'live'|'hit'|'miss', flash, rank}
    this._scheduledTo = -1;   // last beat index turned into a note
    this.lineFlash = 0;
    this.lastRank = null;
  }

  reset() {
    this.notes = [];
    this._scheduledTo = -1;
  }

  // Put notes on the grid ahead of the playhead. Only beats, and every beat —
  // a chart with holes would need musical structure we do not have yet, and an
  // even pulse is honest about what the clock actually knows.
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
      return { rank: 'miss', q: 0, late: best ? songTime > best.t : false };
    }
    const late = songTime > best.t;
    const rank = bestD <= PERFECT ? 'perfect' : 'good';
    best.state = 'hit'; best.flash = 1; best.rank = rank;
    this.lineFlash = 1;
    this.lastRank = rank;
    return { rank, q: rank === 'perfect' ? 1 - bestD / PERFECT * 0.3 : 0.55, late };
  }

  update(clock, songTime) {
    this._schedule(clock, songTime);
    for (const n of this.notes) {
      if (n.state === 'live' && songTime - n.t > MISS_AFTER) { n.state = 'miss'; n.flash = 1; }
      if (n.flash) n.flash *= 0.9;
    }
    // drop notes once they are well behind the line
    this.notes = this.notes.filter(n => songTime - n.t < 0.9);
    this.lineFlash *= 0.88;
  }

  draw(clock, songTime, hue) {
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

    if (!clock.locked) {
      ctx.fillStyle = `hsla(${hue}, 20%, 65%, 0.30)`;
      ctx.font = "9px 'SF Mono', ui-monospace, Menlo, monospace";
      ctx.textAlign = 'center';
      ctx.fillText('L I S T E N I N G', W / 2, midY + 3);
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
  }
}
