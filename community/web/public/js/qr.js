/** Byte-mode QR (ECC M, versions 1-10). Drawn locally. No network. */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

function gfMul(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

const TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const EC_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGN = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};
const VERSION_BITS = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };

function dataCapacity(version) {
  return TOTAL_CW[version] - EC_PER_BLOCK[version] * EC_BLOCKS[version];
}

function pickVersion(byteLen) {
  for (let v = 1; v <= 10; v += 1) {
    const countBits = v <= 9 ? 8 : 16;
    const bits = 4 + countBits + byteLen * 8;
    if (Math.ceil(bits / 8) <= dataCapacity(v)) return v;
  }
  throw new Error("Text is too long for a local sign-in code graphic.");
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, degree) {
  const gen = rsGenerator(degree);
  const buf = data.concat(new Array(degree).fill(0));
  for (let i = 0; i < data.length; i += 1) {
    const coef = buf[i];
    if (!coef) continue;
    for (let j = 0; j < gen.length; j += 1) buf[i + j] ^= gfMul(gen[j], coef);
  }
  return buf.slice(data.length);
}

function pushBits(bits, value, n) {
  for (let i = n - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function encodeData(bytes, version) {
  const capacity = dataCapacity(version);
  const bits = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(bits, b, 8);
  const maxBits = capacity * 8;
  const term = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < term; i += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j += 1) v = (v << 1) | bits[i + j];
    data.push(v);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (data.length < capacity) {
    data.push(pads[p]);
    p = 1 - p;
  }
  return data;
}

function interleave(data, version) {
  const blocks = EC_BLOCKS[version];
  const ecLen = EC_PER_BLOCK[version];
  const totalData = dataCapacity(version);
  const shortLen = Math.floor(totalData / blocks);
  const longCount = totalData % blocks;
  const groups = [];
  let offset = 0;
  for (let i = 0; i < blocks; i += 1) {
    const n = shortLen + (i < blocks - longCount ? 0 : 1);
    const block = data.slice(offset, offset + n);
    offset += n;
    groups.push({ data: block, ecc: rsEncode(block, ecLen) });
  }
  const out = [];
  const maxData = Math.max(...groups.map((g) => g.data.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const g of groups) if (i < g.data.length) out.push(g.data[i]);
  }
  for (let i = 0; i < ecLen; i += 1) {
    for (const g of groups) out.push(g.ecc[i]);
  }
  return out;
}

function sizeOf(version) {
  return 21 + 4 * (version - 1);
}

function makeGrid(n) {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => null));
}

function placeFinder(grid, x, y) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = y + r;
      const cc = x + c;
      if (rr < 0 || cc < 0 || rr >= grid.length || cc >= grid.length) continue;
      const on = r === -1 || r === 7 || c === -1 || c === 7 ? 0 : r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4) ? 1 : 0;
      grid[rr][cc] = on;
    }
  }
}

function placeAlign(grid, version) {
  const pos = ALIGN[version];
  if (!pos) return;
  for (const r of pos) {
    for (const c of pos) {
      if (grid[r][c] != null) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0;
          grid[r + dr][c + dc] = on;
        }
      }
    }
  }
}

function reservePatterns(grid, version) {
  const n = grid.length;
  placeFinder(grid, 0, 0);
  placeFinder(grid, n - 7, 0);
  placeFinder(grid, 0, n - 7);
  for (let i = 8; i < n - 8; i += 1) {
    if (grid[6][i] == null) grid[6][i] = i % 2 === 0 ? 1 : 0;
    if (grid[i][6] == null) grid[i][6] = i % 2 === 0 ? 1 : 0;
  }
  placeAlign(grid, version);
  for (let i = 0; i < 9; i += 1) {
    if (grid[8][i] == null) grid[8][i] = 0;
    if (grid[i][8] == null) grid[i][8] = 0;
  }
  for (let i = 0; i < 8; i += 1) {
    if (grid[8][n - 1 - i] == null) grid[8][n - 1 - i] = 0;
    if (grid[n - 1 - i][8] == null) grid[n - 1 - i][8] = 0;
  }
  grid[n - 8][8] = 1;
  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        grid[i][n - 11 + j] = 0;
        grid[n - 11 + j][i] = 0;
      }
    }
  }
}

function formatBits(mask) {
  const data = mask & 7;
  let d = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((d >>> i) & 1) d ^= 0x537 << (i - 10);
  }
  return ((data << 10) | d) ^ 0x5412;
}

function placeFormat(grid, mask) {
  const bits = formatBits(mask);
  const n = grid.length;
  for (let i = 0; i < 15; i += 1) {
    const bit = (bits >>> (14 - i)) & 1;
    if (i < 6) {
      grid[i][8] = bit;
      grid[8][n - 1 - i] = bit;
    } else if (i < 8) {
      grid[i + 1][8] = bit;
      grid[8][n - 1 - i] = bit;
    } else {
      grid[8][14 - i + (14 - i < 6 ? 0 : 1)] = bit;
      grid[n - 15 + i][8] = bit;
    }
  }
}

function placeVersion(grid, version) {
  if (version < 7) return;
  const bits = VERSION_BITS[version];
  const n = grid.length;
  for (let i = 0; i < 18; i += 1) {
    const bit = (bits >>> (17 - i)) & 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    grid[r][n - 11 + c] = bit;
    grid[n - 11 + c][r] = bit;
  }
}

function maskBit(mask, r, c) {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function placeData(grid, codewords, mask) {
  const n = grid.length;
  const bits = [];
  for (const w of codewords) pushBits(bits, w, 8);
  let i = 0;
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let y = 0; y < n; y += 1) {
      const row = up ? n - 1 - y : y;
      for (const dx of [0, -1]) {
        const c = col + dx;
        if (grid[row][c] != null) continue;
        let bit = i < bits.length ? bits[i] : 0;
        i += 1;
        if (maskBit(mask, row, c)) bit ^= 1;
        grid[row][c] = bit;
      }
    }
    up = !up;
  }
}

function scoreGrid(grid) {
  const n = grid.length;
  let score = 0;
  for (let r = 0; r < n; r += 1) {
    let run = 1;
    for (let c = 1; c < n; c += 1) {
      if (grid[r][c] === grid[r][c - 1]) run += 1;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let c = 0; c < n; c += 1) {
    let run = 1;
    for (let r = 1; r < n; r += 1) {
      if (grid[r][c] === grid[r - 1][c]) run += 1;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let r = 0; r < n - 1; r += 1) {
    for (let c = 0; c < n - 1; c += 1) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }
  let dark = 0;
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (grid[r][c]) dark += 1;
  score += Math.abs(Math.floor((dark * 100) / (n * n) / 5) - 10) * 10;
  return score;
}

function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

export function qrModules(text) {
  const bytes = [...new TextEncoder().encode(String(text || ""))];
  const version = pickVersion(bytes.length);
  const data = interleave(encodeData(bytes, version), version);
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = makeGrid(sizeOf(version));
    reservePatterns(grid, version);
    placeVersion(grid, version);
    placeFormat(grid, mask);
    placeData(grid, data, mask);
    const score = scoreGrid(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }
  return best;
}

export function qrSvg(text, { size = 192, dark = "#04120c", light = "#edfff4", alt = "Sign-in setup graphic" } = {}) {
  const grid = qrModules(text);
  const n = grid.length;
  const quiet = 4;
  const dim = n + quiet * 2;
  const cell = size / dim;
  let rects = `<rect width="${size}" height="${size}" fill="${light}"/>`;
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!grid[r][c]) continue;
      const x = (c + quiet) * cell;
      const y = (r + quiet) * cell;
      rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cell + 0.05).toFixed(2)}" height="${(cell + 0.05).toFixed(2)}" fill="${dark}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${alt}">${rects}</svg>`;
}
