// The route — the map a set travels, drawn as an engraved star chart.
//
// This is the interstitial: what a room looks at between rounds. It has three
// jobs. Say where the session is going, show where everybody stands, and be
// worth looking at on a stream while a track is being charted.
//
// The register is deliberate. A cartoon board would fight everything else here
// — the Didot, the gilt frame in Paint by Numbers, the engraved plate. So this
// is an old atlas route: hairline double rules, roman numerals, a curve struck
// between medallions, and each player a small mark of light travelling it.

const NODE_R = 21;

// A gentle S struck across the plate. Positions are fractions of the canvas so
// the route holds its shape at any size.
function layout(n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    pts.push({
      x: 0.10 + u * 0.80,
      y: 0.54 + Math.sin(u * Math.PI * 1.15 + 0.35) * 0.20,
    });
  }
  return pts;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export class RouteMap {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = [];        // [{label}]
    this.at = 0;            // index of the round being entered
    this.tokens = [];       // [{name, color, target, x, y, seeded}]
    this.stars = [];
    this.t = 0;
  }

  setRoute(nodes) {
    this.nodes = nodes;
    this.pts = layout(Math.max(1, nodes.length));
    this.stars = [];
    // a fixed starfield — regenerated per route, still per session
    for (let i = 0; i < 90; i++) {
      this.stars.push({
        x: Math.random(), y: Math.random(),
        r: 0.3 + Math.random() * 1.1,
        a: 0.10 + Math.random() * 0.45,
        ph: Math.random() * 6.28,
      });
    }
  }

  // players: [{name, color, at}] — `at` is the node index they have reached
  setTokens(players) {
    const byName = new Map(this.tokens.map(t => [t.name, t]));
    this.tokens = players.map(p => {
      const prev = byName.get(p.name);
      return prev
        ? Object.assign(prev, { color: p.color, target: p.at, me: p.me })
        : { name: p.name, color: p.color, target: p.at, x: 0, y: 0, seeded: false, me: p.me };
    });
  }

  _nodeXY(i, W, H) {
    const p = this.pts[Math.max(0, Math.min(this.pts.length - 1, i))];
    return { x: p.x * W, y: p.y * H };
  }

  draw(dt, hue) {
    const { ctx, cv } = this;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.t += dt;
    const t = this.t;

    // ── the plate: a faint wash and a scatter of stars ──
    const wash = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, W * 0.6);
    wash.addColorStop(0, `hsla(${hue}, 60%, 40%, 0.10)`);
    wash.addColorStop(1, 'hsla(0,0%,0%,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);

    for (const s of this.stars) {
      const tw = 0.6 + 0.4 * Math.sin(t * 1.1 + s.ph);
      ctx.fillStyle = `hsla(${hue}, 30%, 92%, ${(s.a * tw).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
    }

    if (!this.nodes.length) return;

    // ── the route: a curve struck between the medallions ──
    const P = this.nodes.map((_, i) => this._nodeXY(i, W, H));
    const path = new Path2D();
    path.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      const mx = (a.x + b.x) / 2;
      path.bezierCurveTo(mx, a.y, mx, b.y, b.x, b.y);
    }

    // engraved double rule — one hairline over a wider soft one
    ctx.strokeStyle = `hsla(${hue}, 50%, 70%, 0.10)`;
    ctx.lineWidth = 7; ctx.stroke(path);
    ctx.strokeStyle = `hsla(${hue}, 60%, 78%, 0.30)`;
    ctx.lineWidth = 1; ctx.stroke(path);

    // the stretch already travelled, lit
    if (this.at > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, P[Math.min(this.at, P.length - 1)].x, H);
      ctx.clip();
      ctx.strokeStyle = `hsla(${hue}, 85%, 80%, 0.55)`;
      ctx.lineWidth = 1.6; ctx.stroke(path);
      ctx.restore();
    }

    // ── the medallions ──
    for (let i = 0; i < this.nodes.length; i++) {
      const { x, y } = P[i];
      const done = i < this.at;
      const here = i === this.at;
      const pulse = here ? 0.5 + 0.5 * Math.sin(t * 2.1) : 0;

      if (here) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, NODE_R * 3.4);
        g.addColorStop(0, `hsla(${hue}, 90%, 78%, ${(0.16 + pulse * 0.14).toFixed(3)})`);
        g.addColorStop(1, `hsla(${hue}, 90%, 78%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, NODE_R * 3.4, 0, Math.PI * 2); ctx.fill();
      }

      // outer ring
      ctx.strokeStyle = done ? `hsla(${hue}, 70%, 80%, 0.55)`
        : here ? `hsla(${hue}, 88%, 88%, ${(0.75 + pulse * 0.25).toFixed(3)})`
               : `hsla(${hue}, 45%, 70%, 0.26)`;
      ctx.lineWidth = here ? 1.8 : 1.1;
      ctx.beginPath(); ctx.arc(x, y, NODE_R + (here ? pulse * 1.6 : 0), 0, Math.PI * 2); ctx.stroke();

      // inner rule, the engraved detail that makes it a medallion not a circle
      ctx.strokeStyle = done ? `hsla(${hue}, 70%, 82%, 0.32)` : `hsla(${hue}, 45%, 72%, 0.16)`;
      ctx.lineWidth = 0.75;
      ctx.beginPath(); ctx.arc(x, y, NODE_R - 4.5, 0, Math.PI * 2); ctx.stroke();

      if (done) {
        ctx.fillStyle = `hsla(${hue}, 70%, 76%, 0.16)`;
        ctx.beginPath(); ctx.arc(x, y, NODE_R - 4.5, 0, Math.PI * 2); ctx.fill();
      }

      // numeral
      ctx.fillStyle = here ? `hsl(${hue}, 55%, 95%)`
        : done ? `hsla(${hue}, 50%, 88%, 0.7)` : `hsla(${hue}, 35%, 78%, 0.38)`;
      ctx.font = `${here ? 15 : 13}px 'Didot', 'Bodoni 72', Georgia, serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ROMAN[i + 1] || String(i + 1), x, y + 0.5);

      // The stop, named beneath. Typography has to suit the plate: letterspacing
      // is what makes a short name look struck rather than typed, but on a phone
      // it turns any real name into something wider than the map. So spacing is
      // a wide-plate luxury, the size follows the plate, and anything that still
      // will not fit its share of the route is trimmed rather than run off it.
      const narrow = W < 520;
      ctx.font = `${narrow ? 6.5 : 8}px 'SF Mono', ui-monospace, Menlo, monospace`;
      ctx.fillStyle = here ? `hsla(${hue}, 45%, 90%, 0.95)` : `hsla(${hue}, 30%, 78%, 0.42)`;
      ctx.textBaseline = 'top';
      const raw = this.nodes[i].label || '';
      let text = (!narrow && raw.length <= 12) ? raw.split('').join(' ') : raw;
      const budget = (W / this.nodes.length) * 1.1;
      if (ctx.measureText(text).width > budget) {
        while (text.length > 4 && ctx.measureText(text + '…').width > budget) text = text.slice(0, -1);
        text = text.trimEnd() + '…';
      }
      const half = ctx.measureText(text).width / 2;
      ctx.fillText(text, Math.max(half + 3, Math.min(W - half - 3, x)), y + NODE_R + 11);
    }

    // ── the field, travelling ──
    // Tokens fan around their medallion so a pack does not become one dot.
    const groups = new Map();
    for (const tk of this.tokens) {
      const k = Math.max(0, Math.min(this.nodes.length - 1, tk.target));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(tk);
    }
    for (const [idx, list] of groups) {
      const base = P[idx];
      list.forEach((tk, j) => {
        const spread = list.length > 1 ? (j - (list.length - 1) / 2) : 0;
        const ang = -Math.PI / 2 + spread * 0.5;
        const tx = base.x + Math.cos(ang) * (NODE_R + 13);
        const ty = base.y + Math.sin(ang) * (NODE_R + 13);
        if (!tk.seeded) { tk.x = tx; tk.y = ty; tk.seeded = true; }
        // ease along — the move between rounds is its own small reveal
        tk.x += (tx - tk.x) * Math.min(1, dt * 3.2);
        tk.y += (ty - tk.y) * Math.min(1, dt * 3.2);

        const css = '#' + (tk.color >>> 0).toString(16).padStart(6, '0');
        const g = ctx.createRadialGradient(tk.x, tk.y, 0, tk.x, tk.y, 11);
        g.addColorStop(0, css); g.addColorStop(1, css + '00');
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(tk.x, tk.y, 11, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = css;
        ctx.beginPath(); ctx.arc(tk.x, tk.y, tk.me ? 4 : 3, 0, Math.PI * 2); ctx.fill();
        if (tk.me) {
          ctx.strokeStyle = `hsla(0, 0%, 100%, 0.85)`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(tk.x, tk.y, 7, 0, Math.PI * 2); ctx.stroke();
        }
      });
    }
  }
}
