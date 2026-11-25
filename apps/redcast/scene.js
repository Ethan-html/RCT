// scene.js - what is on screen: items, Preview and Live, fade, drag and resize, undo.
const W = 1920, H = 1080, FADE_MS = 300;
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;
let videoReady = false;

let nextId = 1;
const isBase = (t) => t === 'camera' || t === 'tech' || t === 'media';
const rank = (it) => (isBase(it.type) ? 0 : 1);
const clone = (x) => JSON.parse(JSON.stringify(x));
let onSceneChange = () => {}; // app.js replaces this
let drawMediaItem = () => {}; // app.js draws video/photo clips

function newItem(type, extra) {
  const it = { id: nextId++, type, x: 0, y: 0, w: W, h: H };
  if (type === 'name') Object.assign(it, lookBox('name'), { name: '', title: '' }); // size and place come from Settings > Lower thirds
  if (type === 'verse') Object.assign(it, lookBox('verse'), { ref: '', text: '' }); // and Settings > Bible verse
  if (type === 'card') Object.assign(it, lookBox('message'), { kind: 'message', slot: 'message', a: '', b: '' });
  return Object.assign(it, extra || {});
}

const preview = { items: [newItem('camera')], sel: null };
const live = { items: clone(preview.items), prev: null, fade: null };
const hist = { stack: [], idx: -1 };
const guides = { x: null, y: null };

function ensureBase(items) {
  if (!items.some((i) => isBase(i.type))) items.unshift(newItem('camera'));
  return items;
}

function loadScene(s) {
  if (!s) return;
  try {
    const noMedia = (l) => l.filter((i) => i.type !== 'media'); // loaded videos do not survive a restart
    if (Array.isArray(s.preview) && s.preview.length) preview.items = ensureBase(noMedia(s.preview));
    if (Array.isArray(s.live) && s.live.length) live.items = ensureBase(noMedia(s.live));
    if (s.v !== 2) [preview.items, live.items].forEach((l) => l.forEach((i) => { if (i.type === 'verse') Object.assign(i, { x: 0, y: 790, w: 1920, h: 290 }); }));
    [preview.items, live.items].forEach((list) => list.forEach((i) => { if (isBase(i.type)) Object.assign(i, { x: 0, y: 0, w: W, h: H }); }));
    const maxId = [...preview.items, ...live.items].reduce((m, i) => Math.max(m, i.id || 0), 0);
    nextId = Math.max(nextId, (s.nextId || 1), maxId + 1);
  } catch (e) { /* ignore a damaged save */ }
}
function sceneSnapshot() {
  return { v: 2, preview: preview.items, live: live.items, nextId };
}

// ---------- history (undo / redo for Preview) ----------
function commit() {
  const s = JSON.stringify(preview.items);
  if (hist.stack[hist.idx] === s) { onSceneChange(); return; }
  hist.stack = hist.stack.slice(0, hist.idx + 1);
  hist.stack.push(s);
  if (hist.stack.length > 80) hist.stack.shift();
  hist.idx = hist.stack.length - 1;
  onSceneChange();
}
function undo() {
  if (hist.idx > 0) { hist.idx--; preview.items = JSON.parse(hist.stack[hist.idx]); preview.sel = null; onSceneChange(); }
}
function redo() {
  if (hist.idx < hist.stack.length - 1) { hist.idx++; preview.items = JSON.parse(hist.stack[hist.idx]); preview.sel = null; onSceneChange(); }
}
const canUndo = () => hist.idx > 0;
const canRedo = () => hist.idx < hist.stack.length - 1;

// ---------- actions ----------
function selected() { return preview.items.find((i) => i.id === preview.sel) || null; }

function setPreviewBase(type, extra) {
  preview.items = preview.items.filter((i) => !isBase(i.type));
  const it = newItem(type, extra);
  preview.items.unshift(it);
  preview.sel = null;
  commit();
}
// Only one lower third is ever on screen. Adding any (verse, name, card) replaces the one that was there.
const isLower = (t) => t === 'verse' || t === 'name' || t === 'card';
const withoutLowers = (list) => list.filter((i) => !isLower(i.type));
let onLookGeom = () => {}; // app.js remembers where the slide-in was put
function addCard(fields) {
  preview.items = withoutLowers(preview.items);
  const it = newItem('card', fields);
  Object.assign(it, lookBox(slotOf(it))); // full lower thirds always sit in their own fixed place
  preview.items.push(it); preview.sel = null; // pushed items are shown, never selected: only a click selects
  commit();
  return it;
}
// Straight to the Output (and Preview, so SEND does not light up)
function sendItemNow(it) {
  setLive([...withoutLowers(clone(live.items)), clone(it)], false);
  preview.items = preview.items.filter((i) => i.id !== it.id); preview.sel = null; commit();
  return it;
}
function showCardNow(fields) { return sendItemNow(addCard(fields)); }
function addName(name, title) {
  preview.items = preview.items.filter((i) => i.type === 'name' || !isLower(i.type));
  let it = preview.items.find((i) => i.type === 'name');
  if (it) { it.name = name; it.title = title; it.w = slideWidth(name, title); }
  else { it = newItem('name', { name, title }); it.w = slideWidth(name, title); preview.items.push(it); }
  preview.sel = null;
  commit();
  return it;
}
function addVerse(ref, text, trans) {
  const label = trans ? `${ref} (${trans})` : ref;
  preview.items = preview.items.filter((i) => i.type === 'verse' || !isLower(i.type));
  const ex = preview.items.find((i) => i.type === 'verse');
  if (ex) { ex.ref = label; ex.text = text; }
  else { const it = newItem('verse', { ref: label, text }); preview.items.push(it); }
  preview.sel = null;
  commit();
}
// If a verse is already on the Output, swap its words right there (no SEND needed).
// Position and size on the Output are kept; Preview is kept in step so SEND does not glow.
const liveHasVerse = () => live.items.some((i) => i.type === 'verse');
function followLiveVerse(ref, text, trans) {
  const lv = live.items.find((i) => i.type === 'verse');
  if (!lv) { addVerse(ref, text, trans); return; }
  const label = trans ? `${ref} (${trans})` : ref;
  startVerseSwap(lv.id, lv.ref, lv.text); // only the words cross-fade; the bar stays where it is
  const items = clone(live.items);
  const v = items.find((i) => i.type === 'verse');
  v.ref = label; v.text = text;
  live.items = items;
  live.prev = null;
  onSceneChange();
}
function refreshPlateWidths() { // the slide-in is as wide as its words, whatever design is chosen
  preview.items.forEach((i) => { if (i.type === 'name') i.w = slideWidth(i.name, i.title); });
}
function resetLookGeometry(slot) {
  preview.items.forEach((i) => {
    if (!isLower(i.type) || (slot && slotOf(i) !== slot)) return;
    const b = lookBox(slotOf(i));
    if (i.type === 'name') { i.x = b.x; i.y = b.y; i.h = b.h; i.w = slideWidth(i.name, i.title); } else Object.assign(i, b); // a slide-in keeps the width of its words
  });
  commit();
}
// A photo is an overlay (not the base picture): move it, resize it (shape stays), then SEND.
function addPhoto(clipId, nw, nh) {
  const ar = nw && nh ? nw / nh : 16 / 9;
  let w = 1300, h = w / ar;
  if (h > 800) { h = 800; w = h * ar; }
  const it = newItem('photo', { clipId, w: Math.round(w), h: Math.round(h), x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) });
  preview.items = preview.items.filter((i) => i.type !== 'photo');
  preview.items.splice(1, 0, it); // above the camera, below any verse or name
  preview.sel = null; // click it in Preview if you want to move or resize it
  commit();
}
function removeSelected() {
  const it = selected();
  if (!it || isBase(it.type)) return false;
  preview.items = preview.items.filter((i) => i.id !== it.id);
  preview.sel = null;
  commit();
  return true;
}
function nudge(dx, dy) {
  const it = selected();
  if (!it || isBase(it.type) || isFixed(it)) return;
  it.x += dx; it.y += dy;
  commit();
}

function setLive(items, instant, opts) {
  const before = clone(live.items);
  const used = [...before, ...items].filter((i) => isLookType(i.type)).map(lookOfItem);
  let dur = FADE_MS;
  if (used.length) dur = Math.max(...used.map((st) => (st.anim === 'none' ? 0 : st.animMs))); // each look sets its own speed
  if (!dur) instant = true;
  if (JSON.stringify(before) !== JSON.stringify(items)) live.prev = before;
  live.fade = instant ? null : { from: before, start: performance.now(), dur, rise: !(opts && opts.swap) };
  const had = new Set(before.map((i) => i.id)), now = performance.now();
  items.forEach((i) => { if (!had.has(i.id)) appearAt[i.id] = now; });
  Object.keys(appearAt).forEach((k) => { if (!items.some((i) => String(i.id) === k)) delete appearAt[k]; });
  live.items = clone(items);
  onSceneChange();
}
// Changes only the Output's base picture (camera, video). Preview is never touched, so a video on the stream does not show in Preview.
function setLiveBase(type, extra, fade, plain) {
  let it;
  if (type === 'camera') { const pb = preview.items.find((i) => isBase(i.type)); it = pb && pb.type === 'camera' ? clone(pb) : newItem('camera'); }
  else it = newItem(type, extra);
  const keep = plain ? [] : clone(live.items).filter((i) => !isBase(i.type));
  setLive([it, ...keep], !fade);
}
const liveBaseItem = () => live.items.find((i) => isBase(i.type)) || null;
// Does Preview differ from the Output? Ids are ignored for the base picture, and a video on the Output is not compared with Preview.
function sigList(list, skipBase) {
  return JSON.stringify(list.filter((i) => !(skipBase && isBase(i.type))).map((i) => (isBase(i.type) ? { type: i.type, clipId: i.clipId } : i)));
}
// Lower thirds in Preview are things waiting to go up. Once sent they leave Preview, so having none there never means "take it off the Output".
function previewDiffers() {
  const skip = !!(liveBaseItem() && liveBaseItem().type === 'media');
  const pRest = preview.items.filter((i) => !isLower(i.type)), lRest = live.items.filter((i) => !isLower(i.type));
  return preview.items.some((i) => isLower(i.type)) || sigList(pRest, skip) !== sigList(lRest, skip);
}
// SEND with a blank Preview takes the lower third that is on the Output off.
const liveHasLower = () => live.items.some((i) => isLower(i.type));
const sendWouldClear = () => !previewDiffers() && liveHasLower();
function goLive() {
  if (!previewDiffers()) {
    if (liveHasLower()) setLive(live.items.filter((i) => !isLower(i.type)), false); // the blank Preview is sent too
    return;
  }
  const lb = liveBaseItem(), pRest = preview.items.filter((i) => !isLower(i.type)), pLower = preview.items.filter((i) => isLower(i.type));
  const keepLower = clone(live.items).filter((i) => isLower(i.type));
  const body = lb && lb.type === 'media' ? [clone(lb), ...clone(pRest).filter((i) => !isBase(i.type))] : clone(pRest); // overlays go on top of a playing video
  setLive([...body, ...(pLower.length ? clone(pLower) : keepLower)], false); // the lower third in Preview replaces the one on the Output; otherwise the Output keeps its own
  preview.items = pRest; preview.sel = null; // Preview is empty again, ready for the next one
  commit();
}
function clearAll() { setLive([newItem('camera')], true); }
function techNow() { setLive([newItem('tech')], true); }
function restoreLive() {
  if (!live.prev) return;
  const cur = clone(live.items);
  live.items = live.prev; live.prev = cur; live.fade = null;
  onSceneChange();
}
function removeLiveItem(id) {
  setLive(live.items.filter((i) => i.id !== id || isBase(i.type)), false);
}

// ---------- drawing ----------
function drawItem(ctx, it, alpha, dy, e) {
  ctx.save();
  ctx.globalAlpha = isLookType(it.type) && e && e.p !== undefined ? 1 : alpha; // verses, names and cards animate themselves
  if (dy && !isLookType(it.type)) ctx.translate(0, dy);
  if (it.type === 'camera') {
    if (videoReady) ctx.drawImage(video, it.x, it.y, it.w, it.h);
    else {
      ctx.fillStyle = '#111'; ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.fillStyle = '#666'; ctx.textAlign = 'center';
      ctx.font = `${it.h * 0.06}px "Segoe UI", Arial`;
      ctx.fillText('No camera', it.x + it.w / 2, it.y + it.h / 2); ctx.textAlign = 'left';
    }
  } else if (it.type === 'tech') {
    const g = ctx.createLinearGradient(0, it.y, 0, it.y + it.h);
    g.addColorStop(0, '#12306b'); g.addColorStop(1, '#0a1838');
    ctx.fillStyle = g; ctx.fillRect(it.x, it.y, it.w, it.h);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = `bold ${it.h * 0.10}px "Segoe UI", Arial`;
    ctx.fillText('Please stand by', it.x + it.w / 2, it.y + it.h * 0.48);
    ctx.font = `${it.h * 0.052}px "Segoe UI", Arial`; ctx.fillStyle = '#c9d6f2';
    ctx.fillText('We are having technical difficulties', it.x + it.w / 2, it.y + it.h * 0.60);
    ctx.textAlign = 'left';
  } else if (it.type === 'name') {
    drawNameItem(ctx, it, e);
  }
  else if (it.type === 'media') {
    ctx.fillStyle = '#000'; ctx.fillRect(it.x, it.y, it.w, it.h);
    drawMediaItem(ctx, it);
  }
  else if (it.type === 'photo') {
    drawMediaItem(ctx, it);
  }
  else if (it.type === 'verse') {
    drawVerseItem(ctx, it, e);
  }
  else if (it.type === 'card') {
    drawCardItem(ctx, it, e);
  }
  ctx.restore();
}

function drawList(ctx, list, w, h) {
  ctx.save();
  ctx.scale(w / W, h / H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  list.forEach((e) => drawItem(ctx, e.i, e.a, 0, e));
  ctx.restore();
}

function liveList(now) {
  if (!live.fade) return live.items.map((i) => ({ i, a: 1 }));
  const f = live.fade, dur = f.dur || FADE_MS;
  const p = Math.min(1, (now - f.start) / dur);
  if (p >= 1) { live.fade = null; return live.items.map((i) => ({ i, a: 1 })); }
  const toIds = new Set(live.items.map((i) => i.id));
  const fromIds = new Set(f.from.map((i) => i.id));
  const out = [];
  f.from.forEach((i) => { if (!toIds.has(i.id)) { const a = isBase(i.type) ? 1 : 1 - p; out.push({ i, a, p, dir: 'out' }); } });
  live.items.forEach((i) => { const isNew = !fromIds.has(i.id); out.push({ i, a: isNew ? p : 1, p: isNew ? p : undefined, dir: 'in' }); });
  out.sort((a, b) => rank(a.i) - rank(b.i));
  return out;
}

const HANDLE = 30;
function corners(it) {
  return { nw: [it.x, it.y], ne: [it.x + it.w, it.y], sw: [it.x, it.y + it.h], se: [it.x + it.w, it.y + it.h] };
}

function renderPreview(ctx, w, h) {
  drawList(ctx, preview.items.map((i) => ({ i, a: 1 })), w, h);
  const it = selected();
  ctx.save();
  ctx.scale(w / W, h / H);
  if (it) {
    ctx.strokeStyle = '#f5b800'; ctx.lineWidth = 4;
    ctx.strokeRect(it.x, it.y, it.w, it.h);
    ctx.fillStyle = '#f5b800';
    if (canResize(it)) Object.values(corners(it)).forEach(([cx, cy]) => ctx.fillRect(cx - HANDLE / 2, cy - HANDLE / 2, HANDLE, HANDLE));
  }
  ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2;
  if (guides.x !== null) { ctx.beginPath(); ctx.moveTo(guides.x, 0); ctx.lineTo(guides.x, H); ctx.stroke(); }
  if (guides.y !== null) { ctx.beginPath(); ctx.moveTo(0, guides.y); ctx.lineTo(W, guides.y); ctx.stroke(); }
  ctx.restore();
}

// ---------- mouse: select, drag, resize ----------
function resizeRect(o, corner, p, lock) {
  const fx = corner.includes('w') ? o.x + o.w : o.x;
  const fy = corner.includes('n') ? o.y + o.h : o.y;
  let nw = Math.abs(p.x - fx), nh = Math.abs(p.y - fy);
  const ar = o.w / o.h;
  if (lock) { nw = Math.max(nw, nh * ar); nh = nw / ar; }
  const minW = 120, minH = lock ? 120 / ar : 60;
  if (nw < minW) { nw = minW; if (lock) nh = nw / ar; }
  if (nh < minH) nh = minH;
  const x = corner.includes('w') ? fx - nw : fx;
  const y = corner.includes('n') ? fy - nh : fy;
  return { x, y, w: nw, h: nh };
}

function snapMove(it, x, y) {
  const T = 16;
  guides.x = null; guides.y = null;
  const xs = [[0, 0], [W - it.w, W], [(W - it.w) / 2, W / 2]];
  const ys = [[0, 0], [H - it.h, H], [(H - it.h) / 2, H / 2]];
  for (const [cand, g] of xs) if (Math.abs(x - cand) < T) { x = cand; guides.x = g; break; }
  for (const [cand, g] of ys) if (Math.abs(y - cand) < T) { y = cand; guides.y = g; break; }
  return { x, y };
}

function attachPreviewMouse(canvas) {
  let drag = null;
  const toScene = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  };
  const hitCorner = (it, p) => {
    for (const [name, [cx, cy]] of Object.entries(corners(it))) {
      if (Math.abs(p.x - cx) <= HANDLE && Math.abs(p.y - cy) <= HANDLE) return name;
    }
    return null;
  };
  const hitItem = (p) => {
    for (let i = preview.items.length - 1; i >= 0; i--) {
      const it = preview.items[i];
      if (isBase(it.type)) continue; // the base picture is locked: it cannot be selected, moved or resized
      if (p.x >= it.x && p.x <= it.x + it.w && p.y >= it.y && p.y <= it.y + it.h) return it;
    }
    return null;
  };
  canvas.addEventListener('mousedown', (e) => {
    const p = toScene(e);
    const sel = selected();
    const c = sel && canResize(sel) ? hitCorner(sel, p) : null;
    if (c) { drag = { mode: 'resize', corner: c, item: sel, orig: { x: sel.x, y: sel.y, w: sel.w, h: sel.h } }; return; }
    const it = hitItem(p);
    if (it) {
      preview.sel = it.id;
      if (!isFixed(it)) drag = { mode: 'move', item: it, start: p, orig: { x: it.x, y: it.y } };
    } else preview.sel = null;
    onSceneChange();
  });
  window.addEventListener('mousemove', (e) => {
    const p = toScene(e);
    if (!drag) {
      const sel = selected();
      const c = sel && canResize(sel) ? hitCorner(sel, p) : null;
      canvas.style.cursor = c ? (c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize') : (hitItem(p) ? (isFixed(hitItem(p)) ? 'default' : 'move') : 'default');
      return;
    }
    const it = drag.item;
    if (drag.mode === 'move') {
      const s = snapMove(it, drag.orig.x + p.x - drag.start.x, drag.orig.y + p.y - drag.start.y);
      it.x = Math.round(s.x); it.y = Math.round(s.y);
    } else {
      const r = resizeRect(drag.orig, drag.corner, p, drag.item.type === 'photo');
      it.x = Math.round(r.x); it.y = Math.round(r.y); it.w = Math.round(r.w); it.h = Math.round(r.h);
    }
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const moved = drag.item;
    drag = null; guides.x = null; guides.y = null;
    if (moved && moved.type === 'name') { // the slide-in remembers where you put it
      looks.name.boxX = moved.x; looks.name.boxBottom = Math.max(0, H - (moved.y + moved.h)); looks.name.boxH = moved.h; onLookGeom('name');
    }
    commit();
  });
}
