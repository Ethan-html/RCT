// looks.js - how Bible verses, lower thirds and quick cards look: styles, designs, text, animation.
// Full lower thirds (verse and cards) are fixed along the bottom. The slide-in (names) is a small two-line plate you can move.

// ----- internal switches: change these here to change how lower thirds behave later -----
// 'all'      = choosing a design in Settings restyles EVERY full lower third (verse, welcome, thank you, countdown, follow, give, message).
// 'selected' = choosing a design only restyles the lower third you are editing (the old behaviour).
const LOWER_THIRD_STYLE_SCOPE = 'all';
// true = a design never changes how a lower third moves, so every lower third keeps its own, different animation.
const STYLE_KEEPS_OWN_ANIMATION = true;

// ----- full-width styles (drawn, no picture needed) -----
const PRESETS = [
  { id: 'classic', name: 'Classic bar', radius: 0 }, { id: 'modern', name: 'Modern tab', radius: 0 },
  { id: 'ribbon', name: 'Ribbon', radius: 0 }, { id: 'split', name: 'Split block', radius: 0 },
  { id: 'angled', name: 'Angled', radius: 0 }, { id: 'stripe', name: 'Top stripe', radius: 0 },
  { id: 'solid', name: 'Solid colour', radius: 0 }, { id: 'neon', name: 'Neon', radius: 14 },
  { id: 'glass', name: 'Glass', radius: 20 }, { id: 'frame', name: 'Frame', radius: 0 },
  { id: 'outline', name: 'Outline', radius: 14 }, { id: 'card', name: 'Card', radius: 18 },
  { id: 'gradient', name: 'Fade out', radius: 0 }, { id: 'wave', name: 'Wave', radius: 0 },
  { id: 'bokeh', name: 'Lights', radius: 0 }, { id: 'stripes', name: 'Pinstripes', radius: 0 },
  { id: 'minimal', name: 'Minimal', radius: 0 },
];
// ----- slide-in plates: small designs made for a name and a title -----
const NAME_PRESETS = [
  { id: 'plate', name: 'Plate' }, { id: 'duo', name: 'Two blocks' }, { id: 'bar2', name: 'Bar and strip' },
  { id: 'tag', name: 'Tag' }, { id: 'underline', name: 'Underline' }, { id: 'pill', name: 'Pill' },
  { id: 'slant', name: 'Slanted' }, { id: 'glassplate', name: 'Glass' }, { id: 'solidplate', name: 'Solid' }, { id: 'box', name: 'Box' },
];
const isPlate = (p) => NAME_PRESETS.some((x) => x.id === p);

// Ready-made picture backgrounds (full-width strips). Uploaded ones are added to this list by app.js.
const BUILTIN_BGS = [
  { id: 'b-dusk', name: 'Dusk', src: 'assets/lowerthirds/dusk.png', w: 1920, h: 280 },
  { id: 'b-gold', name: 'Gold', src: 'assets/lowerthirds/gold.png', w: 1920, h: 280 },
  { id: 'b-ocean', name: 'Ocean', src: 'assets/lowerthirds/ocean.png', w: 1920, h: 280 },
  { id: 'b-ember', name: 'Ember', src: 'assets/lowerthirds/ember.png', w: 1920, h: 280 },
  { id: 'b-forest', name: 'Forest', src: 'assets/lowerthirds/forest.png', w: 1920, h: 280 },
  { id: 'b-royal', name: 'Royal', src: 'assets/lowerthirds/royal.png', w: 1920, h: 280 },
  { id: 'b-slate', name: 'Slate', src: 'assets/lowerthirds/slate.png', w: 1920, h: 280 },
  { id: 'b-light', name: 'Light', src: 'assets/lowerthirds/light.png', w: 1920, h: 280, tone: 'light' },
  { id: 'b-ex-dusk', name: 'Your example: Dusk', src: 'assets/lowerthirds/example-dusk.png', w: 1920, h: 275 },
  { id: 'b-ex-welcome', name: 'Your example: Welcome', src: 'assets/lowerthirds/example-welcome.png', w: 1920, h: 275, hasText: true },
];
const bgLib = BUILTIN_BGS.map((b) => Object.assign({ builtin: true }, b));
// Imported pictures are permanent app assets kept by the main process; app.js hands the list over at start-up and after every change.
function setCustomBgs(items) {
  for (let i = bgLib.length - 1; i >= 0; i--) if (!bgLib[i].builtin) { delete bgImgs[bgLib[i].id]; bgLib.splice(i, 1); }
  (items || []).forEach((u) => bgLib.push({ id: u.id, name: u.name, src: u.url, w: u.w, h: u.h, custom: true }));
}
const bgImgs = {};
const bgEntry = (id) => bgLib.find((b) => b.id === id) || null;
function bgImage(id) {
  if (!id) return null;
  if (bgImgs[id]) return bgImgs[id];
  const e = bgEntry(id);
  if (!e) return null;
  const im = new Image(); if (e.custom) im.crossOrigin = 'anonymous'; im.src = e.src; bgImgs[id] = im;
  return im;
}
const bandHeight = (e) => Math.round(1920 * e.h / e.w); // how tall a full-width strip is

// ----- the design library: a name, a group, and everything that makes it look that way -----
const LIGHT = { nameColor: '#14161a', textColor: '#14161a', titleColor: '#4a5266' };
const DK = { nameColor: '#ffffff', textColor: '#ffffff', titleColor: '#d6dbe6' };
const DES = (id, name, group, s) => ({ id, name, group, s: Object.assign({}, DK, s) });
const DESIGNS_FULL = [
  DES('navy-bar', 'Navy bar', 'Classic', { preset: 'classic', bg: '#0a1e50', opacity: 92, accent: '#f5b800', font: 'Georgia', titleColor: '#e9dcae', refColor: '#f5b800', anim: 'fade' }),
  DES('burgundy', 'Burgundy', 'Classic', { preset: 'classic', bg: '#5a0f1f', opacity: 94, accent: '#e8c46a', font: 'Georgia', titleColor: '#f0d9b0', refColor: '#e8c46a', anim: 'fade' }),
  DES('forest-bar', 'Forest', 'Classic', { preset: 'classic', bg: '#0d3b2a', opacity: 94, accent: '#d9c27a', font: 'Georgia', titleColor: '#e6dbb0', refColor: '#d9c27a', anim: 'wipe' }),
  DES('charcoal', 'Charcoal', 'Classic', { preset: 'classic', bg: '#1b1b1d', opacity: 94, accent: '#ffffff', refColor: '#c9cfda', anim: 'slide' }),
  DES('modern-dark', 'Modern dark', 'Modern', { preset: 'modern', bg: '#141414', opacity: 88, accent: '#f5b800', refColor: '#f5b800', anim: 'fade' }),
  DES('modern-light', 'Modern light', 'Modern', Object.assign({ preset: 'modern', bg: '#f4f5f8', opacity: 96, accent: '#2f6bff', refColor: '#2f6bff', anim: 'rise' }, LIGHT)),
  DES('ribbon-navy', 'Ribbon', 'Modern', { preset: 'ribbon', bg: '#101a3a', opacity: 94, accent: '#ff7a1a', refColor: '#ff9a4a', anim: 'wipe' }),
  DES('split-red', 'Split block', 'Modern', { preset: 'split', bg: '#161616', opacity: 94, accent: '#d7263d', refColor: '#ff6a7c', anim: 'slide' }),
  DES('angled-teal', 'Angled', 'Modern', { preset: 'angled', bg: '#0b1f2a', opacity: 94, accent: '#18c7b0', refColor: '#18c7b0', anim: 'slide' }),
  DES('stripe-slate', 'Top stripe', 'Modern', { preset: 'stripe', bg: '#1e2530', opacity: 94, accent: '#4aa3ff', refColor: '#7fbcff', anim: 'unfold' }),
  DES('solid-red', 'Solid red', 'Bold', { preset: 'solid', bg: '#c8102e', opacity: 100, accent: '#ffffff', font: 'Impact', nameWeight: 'normal', nameCaps: true, titleColor: '#ffd9de', refColor: '#ffd9de', anim: 'bounce' }),
  DES('solid-blue', 'Solid blue', 'Bold', { preset: 'solid', bg: '#1550d6', opacity: 100, accent: '#ffffff', font: 'Trebuchet MS', titleColor: '#d6e2ff', refColor: '#d6e2ff', anim: 'zoom' }),
  DES('solid-yellow', 'Solid yellow', 'Bold', { preset: 'solid', bg: '#ffd400', opacity: 100, accent: '#111111', font: 'Impact', nameWeight: 'normal', nameCaps: true, nameColor: '#111111', textColor: '#111111', titleColor: '#3a3300', refColor: '#3a3300', anim: 'bounce' }),
  DES('neon-cyan', 'Neon cyan', 'Bold', { preset: 'neon', bg: '#06141c', opacity: 90, accent: '#19e3ff', refColor: '#19e3ff', anim: 'flip' }),
  DES('neon-pink', 'Neon pink', 'Bold', { preset: 'neon', bg: '#14060f', opacity: 90, accent: '#ff3df2', refColor: '#ff7af6', anim: 'flip' }),
  DES('glass-blue', 'Glass blue', 'Glass and light', { preset: 'glass', bg: '#1c4fa0', opacity: 70, accent: '#ffffff', refColor: '#cfe0ff', shadow: true, anim: 'rise' }),
  DES('glass-dark', 'Glass dark', 'Glass and light', { preset: 'glass', bg: '#000000', opacity: 60, accent: '#ffffff', refColor: '#e4e4e4', shadow: true, anim: 'fade' }),
  DES('frame-gold', 'Gold frame', 'Glass and light', { preset: 'frame', bg: '#0c0c10', opacity: 88, accent: '#d4af37', font: 'Georgia', refColor: '#d4af37', titleColor: '#e8d9a0', anim: 'typewriter' }),
  DES('outline-white', 'Outline', 'Glass and light', { preset: 'outline', bg: '#000000', opacity: 70, accent: '#ffffff', refColor: '#e4e4e4', shadow: true, anim: 'wipe' }),
  DES('card-white', 'White card', 'Glass and light', Object.assign({ preset: 'card', bg: '#ffffff', opacity: 96, accent: '#2f6bff', refColor: '#2f6bff', anim: 'zoom' }, LIGHT)),
  DES('wave-blue', 'Blue wave', 'Textured', { preset: 'wave', bg: '#0a2a5c', opacity: 95, accent: '#3fb6ff', refColor: '#7fd0ff', anim: 'rise' }),
  DES('wave-sunset', 'Sunset wave', 'Textured', { preset: 'wave', bg: '#5a1230', opacity: 95, accent: '#ff9f43', refColor: '#ffb86b', titleColor: '#ffd9b0', anim: 'bounce' }),
  DES('bokeh-night', 'Night lights', 'Textured', { preset: 'bokeh', bg: '#0b0b1f', opacity: 95, accent: '#9d7bff', refColor: '#b9a2ff', anim: 'fade' }),
  DES('stripes-charcoal', 'Pinstripes', 'Textured', { preset: 'stripes', bg: '#1a1c20', opacity: 95, accent: '#f5b800', refColor: '#f5b800', anim: 'slide' }),
  DES('minimal-white', 'Minimal', 'Minimal', { preset: 'minimal', accent: '#ffffff', shadow: true, refColor: '#ffffff', anim: 'fade' }),
  DES('fade-dark', 'Fade out', 'Minimal', { preset: 'gradient', bg: '#000000', opacity: 82, accent: '#f5b800', refColor: '#f5b800', anim: 'wipe' }),
];
const DESIGNS_NAME = [
  DES('plate-navy', 'Navy plate', 'Plates', { preset: 'plate', bg: '#0a1e50', opacity: 92, accent: '#f5b800', anim: 'slide' }),
  DES('plate-charcoal', 'Charcoal plate', 'Plates', { preset: 'plate', bg: '#1b1b1d', opacity: 94, accent: '#ffffff', anim: 'wipe' }),
  DES('plate-light', 'Light plate', 'Plates', Object.assign({ preset: 'plate', bg: '#f4f5f8', opacity: 96, accent: '#2f6bff', anim: 'curtain' }, LIGHT)),
  DES('duo-red', 'Red two blocks', 'Two lines', { preset: 'duo', bg: '#141414', opacity: 94, accent: '#d7263d', titleColor: '#e8e8e8', anim: 'slideR' }),
  DES('duo-blue', 'Blue two blocks', 'Two lines', { preset: 'duo', bg: '#0f1d3a', opacity: 94, accent: '#2f6bff', titleColor: '#cfd9f2', anim: 'drop' }),
  DES('bar2-gold', 'Gold strip', 'Two lines', { preset: 'bar2', bg: '#14141a', opacity: 94, accent: '#d4af37', titleColor: '#1a1405', anim: 'unfold' }),
  DES('tag-orange', 'Orange tag', 'Two lines', { preset: 'tag', bg: '#121820', opacity: 94, accent: '#ff7a1a', titleColor: '#1a0d00', anim: 'rise' }),
  DES('slant-teal', 'Slanted teal', 'Modern', { preset: 'slant', bg: '#0b1f2a', opacity: 94, accent: '#18c7b0', anim: 'tilt' }),
  DES('pill-dark', 'Dark pill', 'Modern', { preset: 'pill', bg: '#101216', opacity: 92, accent: '#f5b800', anim: 'zoom' }),
  DES('pill-light', 'Light pill', 'Modern', Object.assign({ preset: 'pill', bg: '#ffffff', opacity: 96, accent: '#2f6bff', anim: 'bounce' }, LIGHT)),
  DES('glass-white', 'Glass plate', 'Modern', { preset: 'glassplate', bg: '#1c4fa0', opacity: 70, accent: '#ffffff', shadow: true, anim: 'fade' }),
  DES('solid-yellow-plate', 'Yellow plate', 'Bold', { preset: 'solidplate', bg: '#ffd400', opacity: 100, accent: '#111111', nameColor: '#111111', titleColor: '#3a3300', anim: 'flip' }),
  DES('box-cyan', 'Neon box', 'Bold', { preset: 'box', bg: '#06141c', opacity: 90, accent: '#19e3ff', anim: 'typewriter' }),
  DES('underline-white', 'Underline', 'Minimal', { preset: 'underline', accent: '#ffffff', shadow: true, anim: 'line' }),
];
const designById = (id) => DESIGNS_FULL.find((d) => d.id === id) || DESIGNS_NAME.find((d) => d.id === id) || null;

// Every kind of lower third has its own look ("slot").
const SLOT_NAMES = { verse: 'Bible verse', name: 'Slide-in (names)', welcome: 'Welcome', thanks: 'Thank you', countdown: 'Service starting', follow: 'Follow us', give: 'Give (QR)', message: 'Your own message' };
const FULL_SLOTS = ['verse', 'welcome', 'thanks', 'countdown', 'follow', 'give', 'message'];
const CARD_SLOTS = ['welcome', 'thanks', 'countdown', 'follow', 'give', 'message'];
const BASE_STYLE = {
  preset: 'classic', bg: '#0a1e50', opacity: 90, accent: '#f5b800', radius: 0, bgId: null, imageFit: 'stretch', showText: true,
  font: 'Segoe UI', align: 'left', pad: 100, shadow: false,
  textColor: '#ffffff', textScale: 100, textWeight: 'normal', lineGap: 130, refColor: '#f5b800', refScale: 100, refPos: 'above', refCaps: true,
  nameColor: '#ffffff', nameScale: 100, nameWeight: 'bold', nameCaps: false, titleColor: '#d6dbe6', titleScale: 100, titleWeight: 'normal', textX: 0, textY: 0,
  anim: 'fade', animMs: 500, shine: false, autoHide: 0,
  boxW: 1920, boxH: 280, boxX: 0, boxBottom: 0,
};
const fromDesign = (id, extra) => Object.assign({}, BASE_STYLE, designById(id).s, extra || {});
// Out of the box every kind of lower third and name moves in its own way, and none of them rely on the light sweep.
const LOOK_DEFAULTS = {
  verse: fromDesign('modern-dark', { boxH: 300, anim: 'rise', animMs: 550 }),
  name: fromDesign('plate-navy', { boxW: 900, boxH: 150, boxX: 100, boxBottom: 110, anim: 'slide', animMs: 600 }),
  welcome: fromDesign('burgundy', { align: 'center', anim: 'unfold', animMs: 750 }),
  thanks: fromDesign('glass-blue', { align: 'center', anim: 'fade', animMs: 1100 }),
  countdown: fromDesign('neon-cyan', { align: 'center', anim: 'flip', animMs: 650 }),
  follow: fromDesign('wave-sunset', { align: 'center', anim: 'bounce', animMs: 800 }),
  give: fromDesign('angled-teal', { align: 'center', anim: 'curtain', animMs: 700 }),
  message: fromDesign('frame-gold', { align: 'center', anim: 'typewriter', animMs: 900 }),
};
const looks = {}, lookImg = {};
Object.keys(LOOK_DEFAULTS).forEach((k) => { looks[k] = Object.assign({}, LOOK_DEFAULTS[k]); lookImg[k] = bgImage(looks[k].bgId); });
const isLookType = (t) => t === 'verse' || t === 'name' || t === 'card';
const slotOf = (it) => (it.type === 'verse' ? 'verse' : it.type === 'name' ? 'name' : (looks[it.slot] ? it.slot : 'message'));
const lookOfItem = (it) => looks[slotOf(it)];
const lookOf = (slot) => looks[slot] || looks.message;
const isFixed = (it) => it.type === 'verse' || it.type === 'card'; // full lower thirds stay put; names and photos can be moved
const canResize = (it) => it.type === 'photo';
const swaps = {}; // verse id -> { oldRef, oldText, start, dur }: only the words fade, the bar stays
const appearAt = {}; // item id -> when it went on the Output (scene.js sets it) so entrances can be staggered
let getServiceEnd = () => null; // app.js supplies the service start time

function setLook(slot, o) {
  if (!LOOK_DEFAULTS[slot]) return;
  const st = Object.assign({}, LOOK_DEFAULTS[slot], o || {});
  if ((st.preset === 'image' || st.bgId) && !bgEntry(st.bgId)) { // the picture is no longer in the library: go back to this kind's own design
    const d = LOOK_DEFAULTS[slot];
    ['preset', 'bg', 'opacity', 'accent', 'radius', 'font', 'textColor', 'nameColor', 'titleColor', 'refColor'].forEach((k) => { st[k] = d[k]; });
    st.bgId = null; st.imageFit = 'stretch'; st.showText = true;
  }
  if (slot === 'name' && !isPlate(st.preset)) { st.preset = LOOK_DEFAULTS.name.preset; st.bgId = null; } // the slide-in uses small plates, not pictures or full-width styles
  if (slot !== 'name' && isPlate(st.preset)) st.preset = LOOK_DEFAULTS[slot].preset;
  looks[slot] = st;
  verseCache.clear();
  lookImg[slot] = slot === 'name' ? null : bgImage(st.bgId);
}
function lookBox(slot) {
  const st = lookOf(slot);
  return { x: st.boxX, y: Math.round(H - st.boxBottom - st.boxH), w: st.boxW, h: st.boxH };
}
// Runs a drawing with a design's style standing in for the real one (used for the library thumbnails).
function withStyle(slot, style, fn) {
  const old = looks[slot], oldImg = lookImg[slot];
  looks[slot] = Object.assign({}, old, style);
  lookImg[slot] = slot === 'name' ? null : bgImage(looks[slot].bgId);
  try { fn(); } finally { looks[slot] = old; lookImg[slot] = oldImg; }
}

const hexA = (hex, pct) => {
  const n = parseInt((hex || '#000000').slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(100, pct)) / 100})`;
};
const fontStr = (weight, size, family) => `${weight === 'bold' ? 'bold ' : ''}${size}px "${family}", Arial, sans-serif`;
function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const barW = (h) => Math.max(8, h * 0.035);
const splitW = (h) => Math.round(h * 0.62);
// How far the text is pushed in from the left edge (more for styles that have something on the left).
function leftInset(st, h) {
  const k = st.pad / 100;
  const extra = { classic: barW(h), gradient: barW(h), minimal: 16, image: 120, split: splitW(h) + 10, angled: h * 0.36 + 10, frame: 26 }[st.preset] || 0;
  return Math.max(h * 0.09, 44) * k + extra;
}
const poly = (ctx, pts) => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); };

// ----- full-width backgrounds -----
function drawPanelBg(ctx, st, img, x, y, w, h) {
  const col = hexA(st.bg, st.opacity), r = st.radius;
  ctx.save();
  switch (st.preset) {
    case 'classic':
    case 'gradient': {
      if (st.preset === 'gradient') {
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, col); g.addColorStop(0.6, hexA(st.bg, st.opacity * 0.7)); g.addColorStop(1, hexA(st.bg, 0));
        ctx.fillStyle = g; rrect(ctx, x, y, w, h, r); ctx.fill();
      } else { ctx.fillStyle = col; rrect(ctx, x, y, w, h, r); ctx.fill(); }
      rrect(ctx, x, y, w, h, r); ctx.clip();
      ctx.fillStyle = st.accent; ctx.fillRect(x, y, barW(h), h);
      break;
    }
    case 'modern': {
      ctx.fillStyle = col; rrect(ctx, x, y, w, h, r); ctx.fill();
      const tw = Math.max(90, h * 0.42), th = Math.max(5, h * 0.022);
      const tx = st.align === 'center' ? x + (w - tw) / 2 : x + leftInset(st, h);
      ctx.fillStyle = st.accent; ctx.fillRect(tx, y, tw, th);
      break;
    }
    case 'ribbon': {
      ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
      const tw = Math.max(120, h * 0.55), th = Math.max(10, h * 0.075);
      ctx.fillStyle = st.accent; poly(ctx, [[x, y], [x + tw + th, y], [x + tw, y + th], [x, y + th]]); ctx.fill();
      ctx.fillStyle = hexA(st.accent, 70); ctx.fillRect(x, y + h - 3, w, 3);
      break;
    }
    case 'split': {
      ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
      const sw = splitW(h);
      ctx.fillStyle = st.accent; ctx.fillRect(x, y, sw, h);
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x + sw - 7, y, 7, h);
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; poly(ctx, [[x, y], [x + sw * 0.7, y], [x, y + h * 0.55]]); ctx.fill();
      break;
    }
    case 'angled': {
      const sk = h * 0.36;
      ctx.fillStyle = col; poly(ctx, [[x + sk, y], [x + w, y], [x + w, y + h], [x, y + h]]); ctx.fill();
      ctx.fillStyle = st.accent; poly(ctx, [[x + sk, y], [x + sk + h * 0.08, y], [x + h * 0.08, y + h], [x, y + h]]); ctx.fill();
      break;
    }
    case 'stripe': {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, col); g.addColorStop(1, hexA(st.bg, st.opacity * 0.82));
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = st.accent; ctx.fillRect(x, y, w, Math.max(8, h * 0.05));
      break;
    }
    case 'solid': {
      ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x, y + h - 5, w, 5);
      break;
    }
    case 'neon': {
      ctx.fillStyle = col; rrect(ctx, x, y, w, h, r); ctx.fill();
      ctx.shadowColor = st.accent; ctx.shadowBlur = 30; ctx.strokeStyle = st.accent; ctx.lineWidth = 4;
      rrect(ctx, x + 8, y + 8, w - 16, h - 16, Math.max(0, r - 6)); ctx.stroke();
      ctx.shadowBlur = 8; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      rrect(ctx, x + 8, y + 8, w - 16, h - 16, Math.max(0, r - 6)); ctx.stroke();
      break;
    }
    case 'frame': {
      ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = st.accent; ctx.lineWidth = 2; ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);
      ctx.strokeStyle = hexA(st.accent, 55); ctx.lineWidth = 1; ctx.strokeRect(x + 20, y + 20, w - 40, h - 40);
      break;
    }
    case 'wave': {
      const a = h * 0.07, y0 = y + a * 1.4;
      const wavePath = (phase, off) => { ctx.beginPath(); ctx.moveTo(x, y + h); for (let i = 0; i <= w; i += 8) ctx.lineTo(x + i, y0 + off + a * Math.sin(i / w * Math.PI * 3 + phase)); ctx.lineTo(x + w, y + h); ctx.closePath(); };
      ctx.fillStyle = hexA(st.accent, 28); wavePath(1.4, -a * 0.9); ctx.fill();
      ctx.fillStyle = col; wavePath(0, 0); ctx.fill();
      ctx.strokeStyle = hexA(st.accent, 90); ctx.lineWidth = 4; ctx.beginPath();
      for (let i = 0; i <= w; i += 8) { const yy = y0 + a * Math.sin(i / w * Math.PI * 3); if (i) ctx.lineTo(x + i, yy); else ctx.moveTo(x, yy); }
      ctx.stroke();
      break;
    }
    case 'bokeh': {
      ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      for (let i = 0; i < 18; i++) {
        const fx = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, fy = Math.abs(Math.sin(i * 78.233) * 12345.678) % 1, fr = Math.abs(Math.sin(i * 39.346) * 9876.54) % 1;
        const cx = x + fx * w, cy = y + fy * h, rad = h * (0.14 + fr * 0.4);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, hexA(i % 3 ? st.accent : '#ffffff', 26)); g.addColorStop(1, hexA(st.accent, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'stripes': {
      ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.055)'; ctx.lineWidth = 3; ctx.beginPath();
      for (let k = -h; k < w; k += 16) { ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); }
      ctx.stroke();
      ctx.fillStyle = st.accent; ctx.fillRect(x, y + h - 5, w, 5);
      break;
    }
    case 'glass': {
      ctx.fillStyle = hexA(st.bg, st.opacity * 0.6); rrect(ctx, x, y, w, h, r); ctx.fill();
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(255,255,255,0.20)'); g.addColorStop(1, 'rgba(255,255,255,0.03)');
      ctx.fillStyle = g; rrect(ctx, x, y, w, h, r); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.38)'; rrect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, r); ctx.stroke();
      break;
    }
    case 'minimal': {
      ctx.fillStyle = st.accent; const lh = h * 0.7;
      ctx.fillRect(x, y + (h - lh) / 2, 5, lh);
      break;
    }
    case 'card': {
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 36; ctx.shadowOffsetY = 10;
      ctx.fillStyle = col; rrect(ctx, x, y, w, h, r); ctx.fill();
      ctx.shadowColor = 'transparent';
      rrect(ctx, x, y, w, h, r); ctx.clip();
      ctx.fillStyle = st.accent; ctx.fillRect(x, y, w, Math.max(6, h * 0.035));
      break;
    }
    case 'outline': {
      ctx.fillStyle = hexA(st.bg, st.opacity * 0.35); rrect(ctx, x, y, w, h, r); ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = st.accent; rrect(ctx, x + 2, y + 2, w - 4, h - 4, r); ctx.stroke();
      break;
    }
    case 'image': {
      if (img && img.complete && img.naturalWidth) {
        if (st.imageFit === 'cover') {
          const k = Math.max(w / img.naturalWidth, h / img.naturalHeight), sw = w / k, sh = h / k;
          ctx.drawImage(img, 0, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
        } else if (st.imageFit === 'fit') {
          const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
          ctx.drawImage(img, x + (w - img.naturalWidth * k) / 2, y + (h - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
        } else ctx.drawImage(img, x, y, w, h);
      } else {
        ctx.setLineDash([14, 10]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
        ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `${h * 0.16}px "Segoe UI", Arial`; ctx.textBaseline = 'middle';
        ctx.fillText('Choose a picture in Settings', x + 30, y + h / 2); ctx.textBaseline = 'alphabetic';
      }
      break;
    }
    default: break;
  }
  ctx.restore();
}

function shadowOn(ctx, st, h) {
  if (st.shadow || st.preset === 'minimal' || st.preset === 'underline') { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = Math.max(4, h * 0.05); ctx.shadowOffsetY = 2; }
}
const shadowOff = (ctx) => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };

// ----- text that types itself on -----
// Draws the first part of a string (frac 0..1) without the rest of the text shifting around.
function typedText(ctx, str, x, y, frac) {
  if (frac >= 1) { ctx.fillText(str, x, y); return; }
  const n = Math.ceil(str.length * Math.max(0, frac));
  if (n <= 0) return;
  const align = ctx.textAlign, w = ctx.measureText(str).width;
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.textAlign = 'left'; ctx.fillText(str.slice(0, n), left, y); ctx.textAlign = align;
}
// Splits one typing progress across several lines of text, one after the other.
function typedFracs(lengths, frac) {
  let left = Math.ceil(lengths.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, frac)));
  return lengths.map((len) => { const n = Math.min(len, left); left -= n; return len ? n / len : 1; });
}

// ----- Bible verse -----
const verseCache = new Map();
function wrapLines(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  words.forEach((w) => {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  });
  if (cur) lines.push(cur);
  return lines;
}
function verseLayout(ctx, it, text) {
  const st = looks.verse, k = st.pad / 100;
  const key = `${text}|${it.w}|${it.h}|${st.font}|${st.textScale}|${st.textWeight}|${st.lineGap}|${st.pad}|${st.preset}|${st.refPos}|${st.refScale}`;
  if (verseCache.has(key)) return verseCache.get(key);
  const padX = leftInset(st, it.h), maxW = it.w - padX - Math.max(it.h * 0.09, 44) * k;
  const refH = it.h * 0.14 * st.refScale / 100 + it.h * 0.04;
  const maxH = it.h - refH - it.h * (st.preset === 'wave' ? 0.3 : 0.2) * k;
  const gap = st.lineGap / 100;
  let size = Math.floor(it.h * 0.2 * st.textScale / 100), lines = [];
  for (; size >= 16; size -= 2) {
    ctx.font = fontStr(st.textWeight, size, st.font);
    lines = wrapLines(ctx, text, maxW);
    if (lines.length * size * gap <= maxH) break;
  }
  const out = { size, lines, refH };
  if (verseCache.size > 80) verseCache.clear();
  verseCache.set(key, out);
  return out;
}
function paintVerse(ctx, it, ref, text, alpha, tf) {
  const st = looks.verse, padX = leftInset(st, it.h), gap = st.lineGap / 100;
  const L = verseLayout(ctx, it, text);
  const refSize = it.h * 0.095 * st.refScale / 100;
  const top = it.y + it.h * (st.preset === 'wave' ? 0.22 : 0.13); // fixed starting point, so the words do not shift when the next verse has more or fewer lines
  const refY = st.refPos === 'below' ? it.y + it.h - it.h * 0.13 - refSize : top;
  const textY = st.refPos === 'below' ? top : top + L.refH;
  const center = st.align === 'center', cx = it.x + it.w / 2;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.textBaseline = 'top'; ctx.textAlign = center ? 'center' : 'left';
  shadowOn(ctx, st, it.h);
  const lx = center ? cx : it.x + padX;
  ctx.fillStyle = st.refColor;
  ctx.font = fontStr('bold', refSize, st.font);
  try { ctx.letterSpacing = st.refCaps ? Math.round(refSize * 0.12) + 'px' : '0px'; } catch (e) { /* ignore */ }
  ctx.fillText(st.refCaps ? String(ref || '').toUpperCase() : String(ref || ''), lx, refY);
  try { ctx.letterSpacing = '0px'; } catch (e) { /* ignore */ }
  ctx.font = fontStr(st.textWeight, L.size, st.font);
  ctx.fillStyle = st.textColor;
  const fr = typedFracs(L.lines.map((s) => s.length), tf === undefined ? 1 : tf);
  L.lines.forEach((ln, i) => typedText(ctx, ln, lx, textY + i * L.size * gap, fr[i]));
  shadowOff(ctx);
  ctx.restore();
}

// ----- animation: every look can come in and go out in several ways -----
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOutCubic = (p) => 1 - Math.pow(1 - clamp01(p), 3);
const easeOutBack = (p) => { const c = 1.70158, q = clamp01(p) - 1; return 1 + (c + 1) * q * q * q + c * q * q; };
const sinceAppear = (id) => (appearAt[id] === undefined ? 1e9 : performance.now() - appearAt[id]);
const stagger = (t, delay, dur) => easeOutCubic((t - delay) / (dur || 450)); // 0 -> 1 after a delay; 1 if it has been on a while
const ANIMS = ['fade', 'rise', 'slide', 'slideR', 'wipe', 'curtain', 'drop', 'tilt', 'zoom', 'bounce', 'unfold', 'flip', 'typewriter', 'line', 'none'];
// Applies the entrance/exit to the canvas (already saved). Returns how visible the words should be (they come in a little later than the box).
function beginLookAnim(ctx, st, it, e) {
  if (!e || e.p === undefined || e.p >= 1 || st.anim === 'none') return 1;
  const ein = e.dir !== 'out', p = e.p;
  const v = ein ? easeOutCubic(p) : 1 - p * p;
  const late = clamp01((v - 0.3) / 0.7);
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2, by = it.y + it.h;
  switch (st.anim) {
    case 'rise': ctx.globalAlpha *= v; ctx.translate(0, (1 - v) * 70); return late;
    case 'slide': ctx.globalAlpha *= Math.min(1, v * 1.5); ctx.translate(-(1 - v) * it.w * 0.4, 0); return late;
    case 'wipe': ctx.beginPath(); ctx.rect(it.x - 90, it.y - 90, it.w * v + 90, it.h + 180); ctx.clip(); return 1;
    case 'zoom': {
      const sc = 0.84 + 0.16 * v;
      ctx.globalAlpha *= v; ctx.translate(cx, by); ctx.scale(sc, sc); ctx.translate(-cx, -by);
      return late;
    }
    case 'bounce': { // drops in and settles with a little overshoot
      const off = ein ? 1 - easeOutBack(p) : p * p;
      ctx.globalAlpha *= ein ? Math.min(1, p * 3) : 1 - p; ctx.translate(0, off * 130);
      return ein ? clamp01((p - 0.25) / 0.5) : 1 - p;
    }
    case 'unfold': { // opens from the middle
      ctx.globalAlpha *= Math.min(1, v * 1.6); ctx.translate(cx, cy); ctx.scale(1, Math.max(0.001, v)); ctx.translate(-cx, -cy);
      return clamp01((v - 0.5) / 0.5);
    }
    case 'flip': { // swings up from the bottom edge
      ctx.globalAlpha *= Math.min(1, v * 2); ctx.translate(it.x, by); ctx.scale(1, Math.max(0.001, v)); ctx.translate(-it.x, -by);
      return clamp01((v - 0.45) / 0.55);
    }
    case 'slideR': ctx.globalAlpha *= Math.min(1, v * 1.5); ctx.translate((1 - v) * it.w * 0.4, 0); return late; // comes in from the right
    case 'curtain': { // opens outward from the middle, left and right
      const cw = it.w * v + 180;
      ctx.beginPath(); ctx.rect(cx - cw / 2, it.y - 90, cw, it.h + 180); ctx.clip();
      return clamp01((v - 0.35) / 0.65);
    }
    case 'drop': ctx.globalAlpha *= Math.min(1, v * 1.4); ctx.translate(0, -(1 - v) * (it.h + 120)); return late; // lowers in from above
    case 'tilt': { // swings up around its bottom-left corner
      ctx.globalAlpha *= Math.min(1, v * 1.6); ctx.translate(it.x, by); ctx.rotate(-(1 - v) * 0.32); ctx.translate(-it.x, -by);
      return late;
    }
    case 'line': return 1; // slide-ins draw this one themselves (line stretches, words rise and drop)
    case 'typewriter': { // the bar opens quickly, then the words type themselves on
      const q = ein ? easeOutCubic(clamp01(p / 0.4)) : 1 - p * p;
      ctx.beginPath(); ctx.rect(it.x - 90, it.y - 90, it.w * q + 90, it.h + 180); ctx.clip();
      return 1;
    }
    default: ctx.globalAlpha *= v; return late; // fade
  }
}
const typeFrac = (st, e) => (st.anim !== 'typewriter' || !e || e.p === undefined || e.p >= 1 || e.dir === 'out' ? 1 : clamp01((e.p - 0.38) / 0.62));
// A soft band of light that sweeps across once after it appears.
function drawShine(ctx, st, it) {
  if (!st.shine) return;
  const t = sinceAppear(it.id) - 350, T = 1500;
  if (t < 0 || t > T) return;
  const p = easeOutCubic(t / T), bw = it.w * 0.16;
  ctx.save();
  rrect(ctx, it.x, it.y, it.w, it.h, st.radius); ctx.clip();
  ctx.translate(it.x - bw + p * (it.w + bw * 2), it.y);
  ctx.transform(1, 0, -0.35, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, bw, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${0.24 * (1 - Math.abs(p - 0.5))})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, bw, it.h);
  ctx.restore();
}

function drawVerseItem(ctx, it, e) {
  const st = looks.verse;
  const ta = beginLookAnim(ctx, st, it, e), tf = typeFrac(st, e);
  drawPanelBg(ctx, st, lookImg.verse, it.x, it.y, it.w, it.h);
  drawShine(ctx, st, it);
  if (st.showText === false) return;
  const sw = swaps[it.id];
  let p = 1;
  if (sw) { p = Math.min(1, (performance.now() - sw.start) / sw.dur); if (p >= 1) delete swaps[it.id]; }
  if (sw && p < 1) {
    paintVerse(ctx, it, sw.oldRef, sw.oldText, (1 - p) * ta, 1); // the old words fade out while the new ones fade in
    paintVerse(ctx, it, it.ref, it.text, p * ta, 1);
  } else paintVerse(ctx, it, it.ref, it.text, ta, tf);
}
function startVerseSwap(id, oldRef, oldText) {
  const st = looks.verse;
  if (st.anim === 'none') { delete swaps[id]; return; }
  swaps[id] = { oldRef, oldText, start: performance.now(), dur: Math.min(st.animMs, 700) };
}

// ----- slide-in plates: a name and a title, in small designs made for exactly that -----
function fitText(ctx, text, weight, size, maxW, family) {
  let s = Math.max(10, Math.floor(size));
  for (; s > 10; s -= 2) { ctx.font = fontStr(weight, s, family); if (ctx.measureText(text).width <= maxW) break; }
  ctx.font = fontStr(weight, s, family);
  return s;
}
// Works out the blocks and the two lines of text for a plate. W is how wide it needs to be.
function plateLayout(ctx, st, name, title, h) {
  const hasT = !!(title && String(title).trim());
  const nm = st.nameCaps ? String(name || '').toUpperCase() : String(name || '');
  const ttl = hasT ? String(title) : '';
  const nsz = Math.max(10, Math.floor(h * (hasT ? 0.33 : 0.44) * st.nameScale / 100));
  const tsz = Math.max(8, Math.floor(h * 0.2 * st.titleScale / 100));
  ctx.font = fontStr(st.nameWeight, nsz, st.font); const nw = ctx.measureText(nm).width;
  let tw = 0;
  if (hasT) { ctx.font = fontStr(st.titleWeight, tsz, st.font); tw = ctx.measureText(ttl).width; }
  const pad = h * 0.17 * st.pad / 100, mx = Math.max(nw, tw), col = hexA(st.bg, st.opacity);
  const bg = [], tx = [];
  const addName = (x, y, c, cx, cw, row) => tx.push({ s: nm, x, y, size: nsz, w: st.nameWeight, c, row: row || 1, cx, cw });
  const addTitle = (x, y, c, cx, cw, row) => { if (hasT) tx.push({ s: ttl, x, y, size: tsz, w: st.titleWeight, c, row: row || 2, cx, cw }); };
  let W;
  switch (st.preset) {
    case 'duo': { // name on a coloured block, title on a dark block under it
      const r1 = hasT ? h * 0.58 : h, r2 = h - r1, W1 = pad * 2 + nw, W2 = pad * 2 + tw;
      W = Math.max(W1, hasT ? W2 : 0);
      bg.push({ t: 'rect', x: 0, y: 0, w: W1, h: r1, c: st.accent });
      if (hasT) bg.push({ t: 'rect', x: 0, y: r1, w: W2, h: r2, c: col });
      addName(pad, r1 / 2, st.nameColor, 0, W1); addTitle(pad, r1 + r2 / 2, st.titleColor, 0, W2);
      break;
    }
    case 'bar2': { // dark bar with the name, a coloured strip with the title
      const r1 = hasT ? h * 0.64 : h, r2 = h - r1;
      W = pad * 2 + mx;
      bg.push({ t: 'rect', x: 0, y: 0, w: W, h: r1, c: col });
      if (hasT) bg.push({ t: 'rect', x: 0, y: r1, w: W, h: r2, c: st.accent });
      addName(pad, r1 / 2, st.nameColor, 0, W); addTitle(pad, r1 + r2 / 2, st.titleColor, 0, W);
      break;
    }
    case 'tag': { // a small coloured tag with the title sits on the name block
      const th = hasT ? h * 0.3 : 0, tabW = hasT ? tw + pad * 1.4 : 0, my = th * 0.9;
      W = Math.max(pad * 2 + nw, tabW + pad * 0.4);
      bg.push({ t: 'rect', x: 0, y: my, w: W, h: h - my, c: col });
      if (hasT) bg.push({ t: 'rect', x: 0, y: 0, w: tabW, h: th, c: st.accent });
      addTitle(pad * 0.7, th / 2, st.titleColor, 0, tabW, 1);
      addName(pad, my + (h - my) / 2, st.nameColor, 0, W, 2);
      break;
    }
    case 'underline': { // no box at all: words with a coloured line
      W = mx + pad * 0.9;
      const ly = h * (hasT ? 0.55 : 0.8);
      bg.push({ t: 'rect', x: pad * 0.3, y: ly, w: mx + pad * 0.3, h: Math.max(3, h * 0.03), c: st.accent });
      addName(pad * 0.3, h * (hasT ? 0.33 : 0.47), st.nameColor, 0, W); addTitle(pad * 0.3, h * 0.76, st.titleColor, 0, W);
      break;
    }
    case 'pill': {
      W = pad * 2.8 + mx;
      bg.push({ t: 'rrect', x: 0, y: 0, w: W, h, r: h / 2, c: col, stroke: st.accent, lw: 3 });
      addName(pad * 1.5, h * (hasT ? 0.37 : 0.5), st.nameColor, 0, W); addTitle(pad * 1.5, h * 0.72, st.titleColor, 0, W);
      break;
    }
    case 'slant': {
      const sk = h * 0.3, x0 = sk / 2 + h * 0.09 + pad * 0.7;
      W = x0 + mx + pad * 0.7 + sk / 2;
      bg.push({ t: 'poly', p: [[sk, 0], [W, 0], [W - sk, h], [0, h]], c: col });
      bg.push({ t: 'poly', p: [[sk, 0], [sk + h * 0.09, 0], [h * 0.09, h], [0, h]], c: st.accent });
      addName(x0, h * (hasT ? 0.37 : 0.5), st.nameColor, 0, W); addTitle(x0, h * 0.72, st.titleColor, 0, W);
      break;
    }
    case 'glassplate': {
      W = pad * 2 + mx;
      bg.push({ t: 'glass', x: 0, y: 0, w: W, h, r: h * 0.18, c: col });
      addName(pad, h * (hasT ? 0.37 : 0.5), st.nameColor, 0, W); addTitle(pad, h * 0.72, st.titleColor, 0, W);
      break;
    }
    case 'solidplate': {
      W = pad * 2 + mx;
      bg.push({ t: 'rect', x: 0, y: 0, w: W, h, c: col }, { t: 'rect', x: 0, y: h - 5, w: W, h: 5, c: 'rgba(0,0,0,0.18)' });
      addName(pad, h * (hasT ? 0.37 : 0.5), st.nameColor, 0, W); addTitle(pad, h * 0.72, st.titleColor, 0, W);
      break;
    }
    case 'box': {
      W = pad * 2 + mx;
      bg.push({ t: 'box', x: 0, y: 0, w: W, h, c: hexA(st.bg, st.opacity * 0.6), stroke: st.accent });
      addName(pad, h * (hasT ? 0.37 : 0.5), st.nameColor, 0, W); addTitle(pad, h * 0.72, st.titleColor, 0, W);
      break;
    }
    default: { // plate: dark block with a coloured bar on the left
      const bar = barW(h), x0 = bar + pad;
      W = x0 + mx + pad * 1.2;
      bg.push({ t: 'rect', x: 0, y: 0, w: W, h, c: col }, { t: 'rect', x: 0, y: 0, w: bar, h, c: st.accent });
      addName(x0, h * (hasT ? 0.37 : 0.5), st.nameColor, bar, W - bar); addTitle(x0, h * 0.72, st.titleColor, bar, W - bar);
    }
  }
  return { W: Math.round(Math.max(W, 120)), h, bg, tx };
}
function drawPlateBg(ctx, L, ox, oy) {
  L.bg.forEach((b) => {
    ctx.save();
    switch (b.t) {
      case 'rect': ctx.fillStyle = b.c; ctx.fillRect(ox + b.x, oy + b.y, b.w, b.h); break;
      case 'poly': poly(ctx, b.p.map(([px, py]) => [ox + px, oy + py])); ctx.fillStyle = b.c; ctx.fill(); break;
      case 'rrect':
        rrect(ctx, ox + b.x, oy + b.y, b.w, b.h, b.r); ctx.fillStyle = b.c; ctx.fill();
        ctx.lineWidth = b.lw; ctx.strokeStyle = b.stroke; rrect(ctx, ox + b.x + b.lw / 2, oy + b.y + b.lw / 2, b.w - b.lw, b.h - b.lw, b.r - b.lw / 2); ctx.stroke();
        break;
      case 'glass': {
        rrect(ctx, ox + b.x, oy + b.y, b.w, b.h, b.r); ctx.fillStyle = b.c; ctx.fill();
        const g = ctx.createLinearGradient(0, oy, 0, oy + b.h); g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0.03)');
        ctx.fillStyle = g; rrect(ctx, ox + b.x, oy + b.y, b.w, b.h, b.r); ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; rrect(ctx, ox + b.x + 0.75, oy + b.y + 0.75, b.w - 1.5, b.h - 1.5, b.r); ctx.stroke();
        break;
      }
      case 'box':
        ctx.fillStyle = b.c; ctx.fillRect(ox + b.x, oy + b.y, b.w, b.h);
        ctx.shadowColor = b.stroke; ctx.shadowBlur = 16; ctx.strokeStyle = b.stroke; ctx.lineWidth = 3; ctx.strokeRect(ox + b.x + 2, oy + b.y + 2, b.w - 4, b.h - 4);
        break;
      default: break;
    }
    ctx.restore();
  });
}
// 'line' animation: the line stretches out from the left while the words grow upward.
// On the way out the words drop out through the bottom while the line pulls back to the left.
// Going out, the line and the words run on one single clock, so they always finish together.
const easeInOutCubic = (p) => { p = clamp01(p); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
function lineAnimState(e) {
  if (!e || e.p === undefined || e.p >= 1) return { line: 1, text: 1, ein: true };
  if (e.dir === 'out') { const k = 1 - easeInOutCubic(e.p); return { line: k, text: k, ein: false }; }
  return { line: easeOutCubic(e.p / 0.8), text: easeOutCubic((e.p - 0.2) / 0.8), ein: true };
}
function drawNameLine(ctx, it, L, e, st) {
  const a = lineAnimState(e), h = it.h, onTop = st.preset === 'underline', center = st.align === 'center';
  const left = L.bg.length ? Math.min(...L.bg.map((b) => b.x || 0)) : 0;
  const right = L.bg.length ? Math.max(...L.bg.map((b) => (b.x || 0) + (b.w || L.W))) : L.W;
  const paintBg = () => {
    if (a.line <= 0.002) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(it.x + left - 2, it.y - 30, (right - left) * a.line + 2, h + 60); ctx.clip(); // grows out from the left edge
    drawPlateBg(ctx, L, it.x, it.y);
    ctx.restore();
  };
  if (!onTop) paintBg();
  const lineY = onTop && L.bg[0] ? it.y + L.bg[0].y : it.y + h; // coming in, the top line of words appears from behind the line
  ctx.save();
  ctx.textBaseline = 'middle';
  shadowOn(ctx, st, h);
  ctx.textAlign = center ? 'center' : 'left';
  L.tx.forEach((r) => {
    const dist = (r.row === 1 ? 0.9 : 0.5) * h, off = (1 - a.text) * dist;
    if (off >= dist - 0.5 && !a.ein) return; // already gone
    ctx.save();
    ctx.beginPath();
    ctx.rect(it.x - L.W * 0.1, it.y - h * 0.3, L.W * 1.2, (a.ein && a.text < 1 && r.row === 1 ? lineY : it.y + h) - (it.y - h * 0.3));
    ctx.clip();
    ctx.font = fontStr(r.w, r.size, st.font); ctx.fillStyle = r.c;
    const x = it.x + (center ? r.cx + r.cw / 2 : r.x) + st.textX / 100 * L.W;
    ctx.fillText(r.s, x, it.y + r.y + st.textY / 100 * h + off);
    ctx.restore();
  });
  shadowOff(ctx);
  ctx.restore();
  if (onTop) paintBg();
}
function drawNameItem(ctx, it, e) {
  const st = looks.name;
  const L = plateLayout(ctx, st, it.name, it.title, it.h);
  if (st.anim === 'line') { if (st.showText === false) drawPlateBg(ctx, L, it.x, it.y); else drawNameLine(ctx, it, L, e, st); return; }
  const it2 = Object.assign({}, it, { w: L.W }); // the plate is as wide as its words
  const ta = beginLookAnim(ctx, st, it2, e);
  drawPlateBg(ctx, L, it.x, it.y);
  drawShine(ctx, st, it2);
  if (st.showText === false) return;
  const t = sinceAppear(it.id), a1 = stagger(t, 150, 450), a2 = stagger(t, 330, 450);
  const fr = typedFracs(L.tx.map((r) => r.s.length), typeFrac(st, e));
  ctx.save();
  ctx.textBaseline = 'middle';
  shadowOn(ctx, st, it.h);
  ctx.globalAlpha *= ta;
  const g0 = ctx.globalAlpha, center = st.align === 'center';
  ctx.textAlign = center ? 'center' : 'left';
  L.tx.forEach((r, i) => {
    const a = r.row === 1 ? a1 : a2;
    ctx.font = fontStr(r.w, r.size, st.font); ctx.fillStyle = r.c; ctx.globalAlpha = g0 * a;
    const x = it.x + (center ? r.cx + r.cw / 2 : r.x) + st.textX / 100 * L.W + (1 - a) * 30;
    typedText(ctx, r.s, x, it.y + r.y + st.textY / 100 * it.h, fr[i]);
  });
  shadowOff(ctx);
  ctx.restore();
}
// The slide-in is only as wide as its words need.
let scratchCtx = null;
function slideWidth(name, title) {
  try { if (!scratchCtx) scratchCtx = document.createElement('canvas').getContext('2d'); } catch (e) { scratchCtx = null; }
  if (!scratchCtx || !scratchCtx.measureText) return looks.name.boxW;
  return plateLayout(scratchCtx, looks.name, name, title, looks.name.boxH).W;
}

function drawIcon(ctx, kind, cx, cy, s, accent) {
  ctx.save(); ctx.translate(cx, cy);
  const r = s / 2;
  if (kind === 'youtube') {
    ctx.fillStyle = '#ff1a1a'; rrect(ctx, -r, -r * 0.7, s, s * 0.7, s * 0.2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-r * 0.22, -r * 0.3); ctx.lineTo(r * 0.38, 0); ctx.lineTo(-r * 0.22, r * 0.3); ctx.closePath(); ctx.fill();
  } else if (kind === 'facebook') {
    ctx.fillStyle = '#1877f2'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${s * 0.78}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('f', r * 0.12, r * 0.62);
  } else if (kind === 'instagram') {
    const g = ctx.createLinearGradient(-r, r, r, -r); g.addColorStop(0, '#feda75'); g.addColorStop(0.35, '#fa7e1e'); g.addColorStop(0.65, '#d62976'); g.addColorStop(1, '#4f5bd5');
    ctx.fillStyle = g; rrect(ctx, -r, -r, s, s, s * 0.28); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = s * 0.07;
    rrect(ctx, -r * 0.62, -r * 0.62, s * 0.62, s * 0.62, s * 0.18); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r * 0.42, -r * 0.42, s * 0.04, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = accent || '#f5b800'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function drawQr(ctx, text, x, y, size) {
  let q;
  try { q = QR.cached(text); } catch (e) { return false; }
  const n = q.size, quiet = 2, cell = size / (n + quiet * 2);
  ctx.fillStyle = '#ffffff'; rrect(ctx, x, y, size, size, size * 0.06); ctx.fill();
  ctx.fillStyle = '#101010';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.get(c, r)) ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
  return true;
}
function countdownText(it) {
  let left;
  if (it.mode === 'service') { // counting down to the service start time set in Settings
    const end = getServiceEnd();
    if (end === null) return { big: 'Set the service time in Settings', over: false, small: true };
    left = Math.round((end - Date.now()) / 1000);
  } else { // counting down N minutes from the moment it goes on the Output
    const total = (it.minutes || 5) * 60, started = appearAt[it.id];
    left = started === undefined ? total : Math.round(total - (performance.now() - started) / 1000);
  }
  if (left <= 0) return { big: 'Starting now', over: true };
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
  return { big: h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`, over: false };
}
// Each kind of card moves in its own way as well as using its own entrance:
// Welcome: the lettering tightens. Thank you: the words rise slowly. Countdown: it ticks each second.
// Follow us: rings pulse around the icons. Give: a faint, slow glow drifts over the QR code now and then. Your message: types itself on.
function drawCardItem(ctx, it, e) {
  const slot = slotOf(it), st = looks[slot];
  const ta = beginLookAnim(ctx, st, it, e), tf = typeFrac(st, e);
  drawPanelBg(ctx, st, lookImg[slot], it.x, it.y, it.w, it.h);
  drawShine(ctx, st, it);
  const t = sinceAppear(it.id), h = it.h, cx = it.x + it.w / 2, show = st.showText !== false;
  const now = performance.now(), pulse = 1 + 0.035 * Math.sin(now / 420);
  ctx.save();
  ctx.globalAlpha *= ta;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  shadowOn(ctx, st, h);
  const spaced = (px) => { try { ctx.letterSpacing = px + 'px'; } catch (er) { /* ignore */ } };
  const a1 = stagger(t, slot === 'thanks' ? 250 : 150, slot === 'thanks' ? 900 : 450), a2 = stagger(t, slot === 'thanks' ? 650 : 330, slot === 'thanks' ? 900 : 450);
  const rise = slot === 'thanks' ? 70 : 24;
  const textBlock = (a, b, cxx, maxW) => {
    const hasB = !!(b && String(b).trim());
    const aTxt = st.nameCaps ? String(a || '').toUpperCase() : String(a || '');
    const bTxt = hasB ? String(b).toUpperCase() : '';
    const g0 = ctx.globalAlpha;
    const as = fitText(ctx, aTxt, st.nameWeight, h * (hasB ? 0.36 : 0.46) * st.nameScale / 100, maxW, st.font);
    const bs = hasB ? h * 0.15 * st.titleScale / 100 : 0;
    const total = as + (hasB ? bs * 1.9 : 0), top = it.y + (h - total) / 2 + as * 0.82 + st.textY / 100 * h;
    const fr = typedFracs([aTxt.length, bTxt.length], tf);
    ctx.font = fontStr(st.nameWeight, as, st.font); ctx.fillStyle = st.nameColor; ctx.globalAlpha = g0 * a1;
    if (slot === 'welcome') spaced(Math.round((1 - a1) * as * 0.4)); // starts spread out and settles
    typedText(ctx, aTxt, cxx, top + (1 - a1) * rise, fr[0]);
    spaced(0);
    if (hasB) {
      ctx.font = fontStr('bold', bs, st.font); ctx.fillStyle = st.titleColor; ctx.globalAlpha = g0 * a2;
      spaced(Math.round(bs * 0.14));
      typedText(ctx, bTxt, cxx, top + bs * 1.9 + (1 - a2) * rise, fr[1]);
      spaced(0);
    }
    ctx.globalAlpha = g0;
  };
  if (it.kind === 'countdown') {
    if (show) {
      const cd = countdownText(it), g0 = ctx.globalAlpha;
      ctx.font = fontStr('bold', h * 0.15, st.font); ctx.fillStyle = st.titleColor; ctx.globalAlpha = g0 * a1;
      spaced(Math.round(h * 0.02));
      ctx.fillText(String(it.a || 'Service starts in').toUpperCase(), cx, it.y + h * 0.3);
      spaced(0);
      const sz = fitText(ctx, cd.big, 'bold', h * (cd.small ? 0.2 : 0.46), it.w * 0.7, st.font);
      const tick = cd.over || cd.small ? 1 : 1 + 0.07 * Math.pow(1 - (Date.now() % 1000) / 1000, 6); // a little tick each second
      ctx.fillStyle = cd.over ? st.accent : st.nameColor; ctx.globalAlpha = g0 * a2;
      ctx.save(); ctx.translate(cx, it.y + h * 0.3 + sz + h * 0.04); ctx.scale(tick, tick); ctx.fillText(cd.big, 0, -sz * 0.1 * (tick - 1) * 4); ctx.restore();
      ctx.globalAlpha = g0;
    }
  } else if (it.kind === 'follow') {
    const items = (it.items || []).filter((x) => x && x.text);
    const g0 = ctx.globalAlpha;
    if (show) {
      ctx.font = fontStr('bold', h * 0.17, st.font); ctx.fillStyle = st.titleColor; ctx.globalAlpha = g0 * a1;
      spaced(Math.round(h * 0.02));
      ctx.fillText(String(it.a || 'Follow us').toUpperCase(), cx, it.y + h * 0.27);
      spaced(0);
    }
    const isz = h * 0.3, fs = h * 0.19, gapx = h * 0.45;
    ctx.font = fontStr(st.nameWeight, fs, st.font);
    const widths = items.map((x) => isz + h * 0.12 + ctx.measureText(x.text).width);
    const total = widths.reduce((a, b2) => a + b2, 0) + gapx * Math.max(0, items.length - 1);
    let x = cx - total / 2;
    items.forEach((x0, i) => {
      const pop = stagger(t, 350 + i * 220, 500), sc = (0.6 + 0.4 * easeOutBack(clamp01((t - 350 - i * 220) / 500))) * (t > 1500 ? pulse : 1);
      const my = it.y + h * 0.66;
      ctx.globalAlpha = g0 * pop;
      if (t > 900) { // a ring grows out from each icon and fades
        const ph = ((now / 1600) + i * 0.33) % 1;
        ctx.save(); ctx.globalAlpha = g0 * pop * 0.55 * (1 - ph); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x + isz / 2, my, isz * (0.55 + 0.4 * ph), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      ctx.save(); ctx.translate(x + isz / 2, my); ctx.scale(sc, sc); drawIcon(ctx, x0.icon, 0, 0, isz, st.accent); ctx.restore();
      if (show) { ctx.textAlign = 'left'; ctx.font = fontStr(st.nameWeight, fs, st.font); ctx.fillStyle = st.nameColor; ctx.fillText(x0.text, x + isz + h * 0.12, my + fs * 0.34); ctx.textAlign = 'center'; }
      x += widths[i] + gapx;
    });
    ctx.globalAlpha = g0;
  } else if (it.kind === 'give') {
    const hasQr = !!(it.url && String(it.url).trim());
    const q = h * 0.82, qx = it.x + it.w - q - h * 0.28, qy = it.y + (h - q) / 2;
    const g0 = ctx.globalAlpha, pop = stagger(t, 300, 500), sc = 0.7 + 0.3 * easeOutBack(clamp01((t - 300) / 500)); // the code settles in once and then stays still
    if (show) {
      ctx.textAlign = 'left';
      const tx = it.x + Math.max(h * 0.3, 90) + (st.preset === 'image' ? 110 : st.preset === 'split' ? splitW(h) : st.preset === 'angled' ? h * 0.36 : 0), mw = (hasQr ? qx : it.x + it.w) - tx - h * 0.3;
      const aTxt = st.nameCaps ? String(it.a || 'Give').toUpperCase() : String(it.a || 'Give');
      fitText(ctx, aTxt, st.nameWeight, h * 0.36 * st.nameScale / 100, mw, st.font);
      ctx.fillStyle = st.nameColor; ctx.globalAlpha = g0 * a1; ctx.fillText(aTxt, tx + (1 - a1) * 40, it.y + h * 0.43);
      ctx.font = fontStr('bold', h * 0.14 * st.titleScale / 100, st.font); ctx.fillStyle = st.titleColor; ctx.globalAlpha = g0 * a2;
      spaced(Math.round(h * 0.02));
      ctx.fillText(String(it.b || 'Scan to give').toUpperCase(), tx + (1 - a2) * 40, it.y + h * 0.43 + h * 0.2);
      spaced(0);
      if (hasQr) { // the link itself, for people who cannot scan
        const shown = String(it.url).replace(/^https?:\/\//i, '').replace(/\/$/, '');
        fitText(ctx, shown, 'bold', h * 0.13, mw, st.font);
        ctx.fillStyle = st.accent; ctx.globalAlpha = g0 * a2; ctx.fillText(shown, tx + (1 - a2) * 40, it.y + h * 0.43 + h * 0.2 + h * 0.2);
      }
    }
    if (hasQr) { // no link, no QR code: nothing is drawn
      ctx.globalAlpha = g0 * pop;
      ctx.save(); ctx.translate(qx + q / 2, qy + q / 2); ctx.scale(sc, sc); ctx.translate(-q / 2, -q / 2);
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
      const url = /^[a-z][a-z0-9+.-]*:/i.test(String(it.url).trim()) ? String(it.url).trim() : 'https://' + String(it.url).trim();
      if (!drawQr(ctx, url, 0, 0, q)) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, q, q); }
      ctx.shadowColor = 'transparent';
      if (t > 1500) { // a faint glow drifts slowly down the code once every 10 seconds, then it rests
        const cyc = 10000, span = 0.4, ph = (now % cyc) / cyc;
        if (ph < span) {
          const k = ph / span, sy = easeInOutCubic(k) * (q + q * 0.3) - q * 0.15, soft = q * 0.16, fade = Math.sin(k * Math.PI);
          ctx.save(); rrect(ctx, 0, 0, q, q, q * 0.06); ctx.clip();
          const g = ctx.createLinearGradient(0, sy - soft, 0, sy + soft); g.addColorStop(0, hexA(st.accent, 0)); g.addColorStop(0.5, hexA(st.accent, 16 * fade)); g.addColorStop(1, hexA(st.accent, 0));
          ctx.fillStyle = g; ctx.fillRect(0, sy - soft, q, soft * 2); ctx.restore();
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = g0;
  } else if (show) {
    textBlock(it.a, it.b, cx, it.w * 0.8);
  }
  shadowOff(ctx);
  ctx.restore();
}
