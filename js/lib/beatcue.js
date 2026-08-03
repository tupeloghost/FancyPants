// Beat cue — the thing that tells you WHEN to tap.
//
// A clock that knows where the next beat is has to show it, or the player is
// still reacting to sound instead of playing with it. The cue is an approach
// ring: it opens a beat ahead and closes onto a fixed target, meeting it
// exactly on the beat. You tap when the two rings touch. That is readable at
// a glance, needs no reading, and works at stream size.
//
// Deliberately not a note highway — this sits quietly at the bottom of the
// frame and never competes with the world. And no words: a judgement is a
// flash of light, tight and bright when you are close, loose and dim when you
// are not.

const PERFECT = 0.045;   // seconds either side of the beat
const GOOD = 0.095;

export function judge(offsetSeconds) {
  if (offsetSeconds == null) return null;
  const a = Math.abs(offsetSeconds);
  if (a <= PERFECT) return { rank: 'perfect', q: 1 - a / PERFECT * 0.35, late: offsetSeconds > 0 };
  if (a <= GOOD) return { rank: 'good', q: 0.5 - (a - PERFECT) / (GOOD - PERFECT) * 0.3, late: offsetSeconds > 0 };
  return { rank: 'miss', q: 0, late: offsetSeconds > 0 };
}

export class BeatCue {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.flash = 0;        // beat pulse on the target
    this.hit = 0;          // judgement flash
    this.hitRank = null;
    this.hitLate = false;
  }

  // call when the player taps, with the clock's offset to the nearest beat
  register(offsetSeconds) {
    const j = judge(offsetSeconds);
    if (!j) return null;
    this.hit = 1;
    this.hitRank = j.rank;
    this.hitLate = j.late;
    return j;
  }

  onBeat() { this.flash = 1; }

  draw(clock, songTime, hue) {
    const { ctx, cv } = this;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    this.flash *= 0.88;
    this.hit *= 0.90;

    const cx = W / 2, cy = H / 2;
    const target = Math.min(W, H) * 0.20;

    if (!clock.locked) {
      // no grid — say so quietly rather than showing a cue that means nothing
      ctx.strokeStyle = `hsla(${hue}, 20%, 60%, 0.18)`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.arc(cx, cy, target, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    // ── the approach ring: opens a beat out, closes onto the target ──
    const ph = clock.phase(songTime);          // 0 at a beat, 1 just before next
    const approach = target + (1 - ph) * target * 2.6;
    const near = Math.pow(ph, 2.2);            // tightens as it lands
    ctx.strokeStyle = `hsla(${hue}, 85%, ${68 + near * 22}%, ${(0.22 + near * 0.6).toFixed(3)})`;
    ctx.lineWidth = 1.5 + near * 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, approach, 0, Math.PI * 2); ctx.stroke();

    // ── the target: where it has to arrive ──
    ctx.strokeStyle = `hsla(${hue}, 70%, 78%, ${(0.34 + this.flash * 0.5).toFixed(3)})`;
    ctx.lineWidth = 2 + this.flash * 2.4;
    ctx.beginPath(); ctx.arc(cx, cy, target, 0, Math.PI * 2); ctx.stroke();

    // a filled bloom on the beat itself
    if (this.flash > 0.02) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, target * 1.5);
      g.addColorStop(0, `hsla(${hue}, 90%, 80%, ${(this.flash * 0.30).toFixed(3)})`);
      g.addColorStop(1, `hsla(${hue}, 90%, 80%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, target * 1.5, 0, Math.PI * 2); ctx.fill();
    }

    // ── judgement: light, never words ──
    if (this.hit > 0.02) {
      const perfect = this.hitRank === 'perfect';
      const good = this.hitRank === 'good';
      // a perfect hit rings tight and bright; a miss blooms wide and dull
      const r = perfect ? target * (1 + (1 - this.hit) * 0.35)
              : good ? target * (1 + (1 - this.hit) * 0.9)
                     : target * (1 + (1 - this.hit) * 1.8);
      const l = perfect ? 92 : good ? 76 : 52;
      const sat = perfect ? 95 : good ? 70 : 25;
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${l}%, ${(this.hit * (perfect ? 0.95 : good ? 0.6 : 0.3)).toFixed(3)})`;
      ctx.lineWidth = perfect ? 3.2 : good ? 2.2 : 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

      // which side you erred on — a tick left for early, right for late
      if (!perfect && this.hit > 0.25) {
        const s = this.hitLate ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cx + s * (target * 1.5), cy - 5);
        ctx.lineTo(cx + s * (target * 1.5 + 7), cy);
        ctx.lineTo(cx + s * (target * 1.5), cy + 5);
        ctx.stroke();
      }
    }
  }
}
