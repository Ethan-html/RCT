// qr.js - makes a QR code from a web link, with no internet needed.
// Byte mode, error correction level M, versions 1 to 10 (links up to about 210 characters).

const QR = (() => {
  // per version 1..10, level M: [EC codewords per block, blocks]
  const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

  function numRawDataModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const na = Math.floor(ver / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  const numDataCodewords = (ver) => Math.floor(numRawDataModules(ver) / 8) - EC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

  // Reed-Solomon over GF(256)
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0); result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 2);
    }
    return result;
  }
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    data.forEach((b) => {
      const factor = b ^ result.shift(); result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
    });
    return result;
  }

  function toUtf8(str) {
    const out = [];
    const enc = unescape(encodeURIComponent(str));
    for (let i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i));
    return out;
  }

  function buildCodewords(bytes, ver) {
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0x4, 4);
    put(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach((b) => put(b, 8));
    const cap = numDataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; data.push(v); }

    const nb = NUM_BLOCKS[ver], ecl = EC_PER_BLOCK[ver];
    const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    const numShort = nb - (rawCodewords % nb), shortLen = Math.floor(rawCodewords / nb);
    const blocks = [], div = rsDivisor(ecl);
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - ecl + (i < numShort ? 0 : 1)); k += dat.length;
      const ec = rsRemainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ec));
    }
    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((blk, j) => { if (i !== shortLen - ecl || j >= numShort) result.push(blk[i]); });
    }
    return result;
  }

  function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const r = [6];
    for (let pos = ver * 4 + 10; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  function make(text) {
    const bytes = toUtf8(String(text || ' '));
    let ver = 1;
    for (; ver <= 10; ver++) { const capBits = numDataCodewords(ver) * 8; if (4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 <= capBits) break; }
    if (ver > 10) throw new Error('That link is too long for the QR code.');
    const size = ver * 4 + 17;
    const mods = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { mods[y][x] = dark; isFn[y][x] = true; };

    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const ap = alignPositions(ver);
    ap.forEach((ax, i) => ap.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const drawFormat = (mask) => {
      const data = (0 << 3) | mask; // level M = 0b00
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
      setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const b = ((bits >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3);
        setFn(a, c, b); setFn(c, a, b);
      }
    }

    const codewords = buildCodewords(bytes, ver);
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
          if (!isFn[y][x] && i < codewords.length * 8) { mods[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
        }
      }
    }

    const applyMask = (mask) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!isFn[y][x] && inv) mods[y][x] = !mods[y][x];
      }
    };
    const penalty = () => {
      let result = 0;
      const runs = (line) => {
        let r = 0, run = 1;
        for (let k = 1; k < line.length; k++) {
          if (line[k] === line[k - 1]) { run++; if (run === 5) r += 3; else if (run > 5) r++; } else run = 1;
        }
        return r;
      };
      for (let y = 0; y < size; y++) result += runs(mods[y]);
      for (let x = 0; x < size; x++) result += runs(mods.map((row) => row[x]));
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const c = mods[y][x]; if (c === mods[y][x + 1] && c === mods[y + 1][x] && c === mods[y + 1][x + 1]) result += 3;
      }
      const pat = [true, false, true, true, true, false, true, false, false, false, false];
      const match = (get) => {
        let c = 0;
        for (let k = 0; k + 11 <= size; k++) {
          let a = true, b = true;
          for (let m = 0; m < 11; m++) { const v = get(k + m); if (v !== pat[m]) a = false; if (v !== pat[10 - m]) b = false; }
          if (a) c++; if (b) c++;
        }
        return c;
      };
      for (let y = 0; y < size; y++) result += match((k) => mods[y][k]) * 40;
      for (let x = 0; x < size; x++) result += match((k) => mods[k][x]) * 40;
      let dark = 0; mods.forEach((row) => row.forEach((v) => { if (v) dark++; }));
      const total = size * size;
      result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return result;
    };
    let best = 0, bestPen = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask); drawFormat(mask);
      const p = penalty();
      if (p < bestPen) { bestPen = p; best = mask; }
      applyMask(mask); // undo
    }
    applyMask(best); drawFormat(best);
    return { size, get: (x, y) => mods[y][x], version: ver };
  }

  const cache = {};
  return { make, cached: (t) => (cache[t] || (cache[t] = make(t))) };
})();
