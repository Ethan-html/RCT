// pure.js - small calculations with no screen in them: audio levels, the smart gain, and the crop box.
// Kept apart from app.js so they can be tested on their own.

// ---- audio meter zones (the same convention as OBS): green below -20 dB, yellow -20 to -9 dB, red above -9 dB ----
const METER = { min: -60, yellow: -20, red: -9, target: -12 };
const meterPct = (db) => Math.max(0, Math.min(100, (db - METER.min) / (0 - METER.min) * 100));
const dbToGain = (db) => Math.pow(10, db / 20);
const sampleDb = (peak) => (peak > 0 ? Math.max(-100, 20 * Math.log10(peak)) : -100);

// ---- smart gain ----
// `samples` are loudness readings (dB, measured with the gain at 0 dB) taken while someone talks normally.
// It picks ONE gain so the loud parts of speech sit at the top of the yellow zone (METER.target), never so high
// that the very loudest sound would pass -3 dB. The result is a single fixed number: it is not adjusted again.
function computeSmartGain(samples, opts) {
  const o = Object.assign({ target: METER.target, ceiling: -3, minGain: -20, maxGain: 30, minActive: 12 }, opts);
  const all = samples.filter((x) => Number.isFinite(x) && x > -100);
  if (all.length < o.minActive) return { ok: false, reason: 'quiet' };
  const sorted = all.slice().sort((a, b) => a - b);
  const q = (list, p) => list[Math.min(list.length - 1, Math.floor(p * list.length))];
  const floor = q(sorted, 0.1);
  const gate = Math.max(-55, floor + 12); // pauses and room noise do not count
  const active = sorted.filter((x) => x > gate);
  if (active.length < o.minActive) return { ok: false, reason: 'quiet' };
  const loud = q(active, 0.9), top = sorted[sorted.length - 1];
  let gain = o.target - loud;
  gain = Math.min(gain, o.ceiling - top);
  gain = Math.max(o.minGain, Math.min(o.maxGain, gain));
  gain = Math.round(gain * 2) / 2;
  return { ok: true, gain, loud, top, active: active.length };
}

// ---- crop box ----
// A crop is { l, t, r, b }: how much is cut from each side, as a fraction (0 to 1) of the captured picture.
const CROP_MIN = 0.06; // the box never gets smaller than 6% of the picture
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
function cropNorm(c) {
  c = Object.assign({ l: 0, t: 0, r: 0, b: 0 }, c || {});
  c.l = clampN(Number(c.l) || 0, 0, 1 - CROP_MIN); c.t = clampN(Number(c.t) || 0, 0, 1 - CROP_MIN);
  c.r = clampN(Number(c.r) || 0, 0, 1 - CROP_MIN - c.l); c.b = clampN(Number(c.b) || 0, 0, 1 - CROP_MIN - c.t);
  return c;
}
// Which part of the box is under the pointer? (px, py) and the box edges are fractions of the picture; `grab` is how close counts.
function cropHit(c, px, py, grab) {
  const L = c.l, T = c.t, R = 1 - c.r, B = 1 - c.b;
  const nearX = (x) => Math.abs(px - x) <= grab, nearY = (y) => Math.abs(py - y) <= grab;
  const inX = px >= L - grab && px <= R + grab, inY = py >= T - grab && py <= B + grab;
  if (!inX || !inY) return null;
  const w = nearX(L) ? 'w' : nearX(R) ? 'e' : '', n = nearY(T) ? 'n' : nearY(B) ? 's' : '';
  if (w || n) return (n + w) || null;
  return 'move';
}
// Drags one handle ('n','s','e','w','ne','nw','se','sw') to the pointer. vw/vh are the real size of the picture, which is
// needed to keep the box 16:9 (lock = true).
function cropResize(c, handle, px, py, vw, vh, lock) {
  px = clampN(px, 0, 1); py = clampN(py, 0, 1);
  let L = c.l, T = c.t, R = 1 - c.r, B = 1 - c.b;
  if (!lock) {
    if (handle.includes('w')) L = clampN(px, 0, R - CROP_MIN);
    if (handle.includes('e')) R = clampN(px, L + CROP_MIN, 1);
    if (handle.includes('n')) T = clampN(py, 0, B - CROP_MIN);
    if (handle.includes('s')) B = clampN(py, T + CROP_MIN, 1);
    return cropNorm({ l: L, t: T, r: 1 - R, b: 1 - B });
  }
  const k = (16 / 9) * vh / vw; // width fraction divided by height fraction
  const hasX = handle.includes('e') || handle.includes('w'), hasY = handle.includes('n') || handle.includes('s');
  if (hasX && hasY) { // a corner: the opposite corner stays where it is
    const ax = handle.includes('w') ? R : L, ay = handle.includes('n') ? B : T;
    const dirX = handle.includes('w') ? -1 : 1, dirY = handle.includes('n') ? -1 : 1;
    let w = Math.max(0, (px - ax) * dirX), h = Math.max(0, (py - ay) * dirY);
    w = Math.max(w, h * k);
    const maxW = dirX > 0 ? 1 - ax : ax, maxH = dirY > 0 ? 1 - ay : ay;
    w = Math.min(w, maxW, maxH * k); w = Math.max(w, CROP_MIN, CROP_MIN * k); h = w / k;
    const nx = ax + dirX * w, ny = ay + dirY * h;
    return cropNorm({ l: Math.min(ax, nx), t: Math.min(ay, ny), r: 1 - Math.max(ax, nx), b: 1 - Math.max(ay, ny) });
  }
  const cx = (L + R) / 2, cy = (T + B) / 2;
  let w, h;
  if (hasX) { // a side: the other side stays, the height follows the width, centred
    const fixed = handle === 'e' ? L : R;
    w = Math.abs(px - fixed); w = Math.max(CROP_MIN, CROP_MIN * k, w);
    w = Math.min(w, handle === 'e' ? 1 - L : R, 2 * Math.min(cy, 1 - cy) * k);
    h = w / k;
    const nl = handle === 'e' ? L : R - w;
    return cropNorm({ l: nl, t: cy - h / 2, r: 1 - (nl + w), b: 1 - (cy + h / 2) });
  }
  const fixedY = handle === 's' ? T : B; // top or bottom edge: the width follows the height, centred
  h = Math.abs(py - fixedY); h = Math.max(CROP_MIN, CROP_MIN / k, h);
  h = Math.min(h, handle === 's' ? 1 - T : B, 2 * Math.min(cx, 1 - cx) / k);
  w = h * k;
  const nt = handle === 's' ? T : B - h;
  return cropNorm({ l: cx - w / 2, t: nt, r: 1 - (cx + w / 2), b: 1 - (nt + h) });
}
function cropMove(c, dx, dy) { // moves the whole box, staying inside the picture
  const w = 1 - c.l - c.r, h = 1 - c.t - c.b;
  const l = clampN(c.l + dx, 0, 1 - w), t = clampN(c.t + dy, 0, 1 - h);
  return { l, t, r: 1 - l - w, b: 1 - t - h };
}

if (typeof module !== 'undefined') module.exports = { METER, meterPct, dbToGain, sampleDb, computeSmartGain, CROP_MIN, cropNorm, cropHit, cropResize, cropMove };
