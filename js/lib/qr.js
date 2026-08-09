// QR — a self-contained byte-mode QR encoder (versions 1-10, ECC level M),
// a compact port of the public-domain qrcodegen algorithm. It exists so the
// stream card can put a scannable join code on screen with no network and no
// third-party script — the whole app stays self-hosted, and so does this.

const ECC_M = 0; // format bits for level M are 0b00

// per-version tables, level M only, versions 1..10
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const ECC_PER_BLOCK   = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS      = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
               [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// ── GF(256) Reed-Solomon, polynomial 0x11D ──
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xFF;
}

function rsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

// ── the matrix ──
export function makeQR(text) {
  const bytes = new TextEncoder().encode(text);

  // smallest version whose data capacity fits: header is 4 mode bits +
  // 8 count bits (versions 1-9) or 16 (10+) for byte mode
  let ver = -1;
  for (let v = 1; v <= 10; v++) {
    const dataCw = TOTAL_CODEWORDS[v - 1] - ECC_PER_BLOCK[v - 1] * NUM_BLOCKS[v - 1];
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    if (bytes.length * 8 + headerBits <= dataCw * 8) { ver = v; break; }
  }
  if (ver < 0) return null; // too long for v10 — the caller shows text only

  const size = ver * 4 + 17;
  const dataCw = TOTAL_CODEWORDS[ver - 1] - ECC_PER_BLOCK[ver - 1] * NUM_BLOCKS[ver - 1];

  // ── bit stream: mode, count, data, terminator, pad ──
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);                          // byte mode
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataCw * 8 - bits.length));          // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  for (let pad = 0xEC; bits.length < dataCw * 8; pad ^= 0xEC ^ 0x11) push(pad, 8);

  const data = new Uint8Array(dataCw);
  bits.forEach((b, i) => { data[i >> 3] |= b << (7 - (i & 7)); });

  // ── split into blocks, append ECC, interleave ──
  const numBlocks = NUM_BLOCKS[ver - 1];
  const eccLen = ECC_PER_BLOCK[ver - 1];
  const numShort = numBlocks - (TOTAL_CODEWORDS[ver - 1] % numBlocks);
  const shortLen = Math.floor(TOTAL_CODEWORDS[ver - 1] / numBlocks) - eccLen;
  const divisor = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len); k += len;
    blocks.push({ dat, ecc: rsRemainder(dat, divisor) });
  }
  const out = [];
  const maxDat = shortLen + 1;
  for (let i = 0; i < maxDat; i++)
    for (const b of blocks) if (i < b.dat.length) out.push(b.dat[i]);
  for (let i = 0; i < eccLen; i++)
    for (const b of blocks) out.push(b.ecc[i]);

  // ── modules ──
  const mod = Array.from({ length: size }, () => new Uint8Array(size));
  const isFn = Array.from({ length: size }, () => new Uint8Array(size));
  const set = (x, y, v) => { mod[y][x] = v ? 1 : 0; isFn[y][x] = 1; };

  // timing
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // finders + separators
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  // alignment (skip any overlapping a finder)
  const ap = ALIGN[ver - 1];
  for (const cy of ap) for (const cx of ap) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // reserve format areas (filled after masking)
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { set(8, i, 0); set(i, 8, 0); }
    if (i < 8) { set(size - 1 - i, 8, 0); set(8, size - 1 - i, 0); }
  }
  set(8, size - 8, 1); // the dark module

  // ── zig-zag data placement ──
  let bi = 0;
  const total = out.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFn[y][x] || bi >= total) continue;
        mod[y][x] = (out[bi >> 3] >>> (7 - (bi & 7))) & 1;
        bi++;
      }
    }
  }

  // ── mask selection by penalty ──
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
  ];
  const applyMask = m => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
      if (!isFn[y][x] && MASKS[m](x, y)) mod[y][x] ^= 1;
  };
  const drawFormat = m => {
    const dataBits = (ECC_M << 3) | m;                    // M = 0b00
    let rem = dataBits;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fb = ((dataBits << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, (fb >>> i) & 1);
    set(8, 7, (fb >>> 6) & 1); set(8, 8, (fb >>> 7) & 1); set(7, 8, (fb >>> 8) & 1);
    for (let i = 9; i < 15; i++) set(14 - i, 8, (fb >>> i) & 1);
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, (fb >>> i) & 1);
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, (fb >>> i) & 1);
    set(8, size - 8, 1);
  };
  const penalty = () => {
    let p = 0;
    for (let y = 0; y < size; y++) {              // runs, both directions
      for (const grab of [x => mod[y][x], x => mod[x][y]]) {
        let run = 1;
        for (let x = 1; x <= size; x++) {
          if (x < size && grab(x) === grab(x - 1)) run++;
          else { if (run >= 5) p += 3 + (run - 5); run = 1; }
        }
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += mod[y][x];
    p += Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const p = penalty();
    if (p < bestP) { bestP = p; best = m; }
    applyMask(m);                                  // undo
  }
  applyMask(best); drawFormat(best);

  return { size, get: (x, y) => mod[y][x] === 1 };
}

// paint onto a canvas, dark-on-light with the mandatory quiet zone —
// contrast and the quiet zone are what make it scan off a compressed stream
export function drawQR(canvas, text, px = 4) {
  const qr = makeQR(text);
  if (!qr) return false;
  const quiet = 4;
  const cells = qr.size + quiet * 2;
  canvas.width = canvas.height = cells * px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++)
      if (qr.get(x, y)) ctx.fillRect((x + quiet) * px, (y + quiet) * px, px, px);
  return true;
}
