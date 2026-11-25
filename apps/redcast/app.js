// app.js - operator screen: camera, Setup, streaming, status lights, dialogs, autosave
const $ = (id) => document.getElementById(id);
const previewCanvas = $('previewCanvas');
const liveCanvas = $('liveCanvas');
const pctx = previewCanvas.getContext('2d');
const lctx = liveCanvas.getContext('2d');

// ---------- small helpers ----------
function log(msg) {
  const el = $('log');
  el.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  if (el.textContent.length > 20000) el.textContent = el.textContent.slice(-15000);
  el.scrollTop = el.scrollHeight;
}
function banner(msg) { $('bannerText').textContent = msg; $('banner').hidden = false; log('ALERT: ' + msg); }
$('bannerClose').onclick = () => { $('banner').hidden = true; };
function setStatus(id, text, cls) { const el = $(id); el.textContent = text; el.className = 'status ' + (cls || ''); }
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function showModal(title, html, buttons) {
  $('mTitle').textContent = title;
  $('mBody').innerHTML = html;
  const box = $('mBtns');
  box.innerHTML = '';
  buttons.forEach((b) => {
    const el = document.createElement('button');
    el.textContent = b.label;
    if (b.cls) el.className = b.cls;
    el.onclick = () => { closeModal(); if (b.onClick) b.onClick(); };
    box.appendChild(el);
  });
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; }

// ---------- saved settings ----------
const SAVE_IDS = ['destMode', 'url', 'key', 'encoder', 'bitrate', 'fps', 'outMode', 'testClock', 'ytTitle', 'ytDesc', 'ytPrivacy', 'ytLatency', 'ytDvr', 'bibleFollow', 'endTv', 'endStream', 'cLoop', 'qAuto', 'vidAudio'];
function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } }
const saved = readStore('settings', {});
SAVE_IDS.forEach((id) => {
  if (saved[id] === undefined) return;
  const el = $(id);
  if (el.type === 'checkbox') el.checked = !!saved[id]; else el.value = saved[id];
});
function saveSettings() {
  const s = {};
  SAVE_IDS.forEach((id) => { const el = $(id); s[id] = el.type === 'checkbox' ? el.checked : el.value; });
  s.target = (typeof pb !== 'undefined') ? pb.target : 'stream';
  s.cam = $('camSel').value; s.aud = $('audSel').value;
  localStorage.setItem('settings', JSON.stringify(s));
}
document.addEventListener('change', saveSettings);
document.addEventListener('input', saveSettings);

// ---------- camera and audio ----------
let camStream = null, audioTrack = null;
let camFrames = 0, camGaps = 0, lastCamT = 0, camNominal = 30;
function countCamFrame(now) {
  camFrames++;
  if (lastCamT && now - lastCamT > (1000 / camNominal) * 1.7) camGaps++;
  lastCamT = now;
  video.requestVideoFrameCallback(countCamFrame);
}

async function refreshDevices() {
  try { (await navigator.mediaDevices.getUserMedia({ video: true, audio: true })).getTracks().forEach((t) => t.stop()); }
  catch (e) { log('Device permission probe: ' + e.message); }
  const devs = await navigator.mediaDevices.enumerateDevices();
  const cam = $('camSel'), aud = $('audSel');
  cam.innerHTML = ''; aud.innerHTML = '';
  devs.filter((d) => d.kind === 'videoinput').forEach((d) => cam.add(new Option(d.label || 'Camera ' + (cam.length + 1), d.deviceId)));
  aud.add(new Option('(no audio)', ''));
  devs.filter((d) => d.kind === 'audioinput').forEach((d) => aud.add(new Option(d.label || 'Audio ' + aud.length, d.deviceId)));
  if (saved.cam) cam.value = saved.cam;
  if (saved.aud !== undefined) aud.value = saved.aud;
  log(`Found ${cam.length} camera(s) and ${aud.length - 1} audio input(s).`);
}
$('btnRefresh').onclick = refreshDevices;

function stopCamera() {
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null; audioTrack = null; videoReady = false;
}

async function startCamera() {
  stopCamera();
  const camId = $('camSel').value, audId = $('audSel').value, fps = Number($('fps').value);
  if (!camId) { setStatus('camInfo', 'No camera found', 'bad'); return; }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: camId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: fps } },
      audio: audId ? { deviceId: { exact: audId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 } : false,
    });
  } catch (e) {
    setStatus('camInfo', 'Could not open camera: ' + e.message, 'bad');
    banner('Could not open the camera. Close any other program using it (XSplit, OBS, Camera app), then try again in Settings.');
    return;
  }
  video.srcObject = camStream;
  await video.play();
  const vt = camStream.getVideoTracks()[0];
  const s = vt.getSettings();
  vt.onended = () => { videoReady = false; setStatus('camInfo', 'CAMERA LOST', 'bad'); banner('CAMERA LOST - the capture card stopped sending video. Open Settings and press Start camera.'); };
  audioTrack = camStream.getAudioTracks()[0] || null;
  videoReady = true;
  camFrames = 0; camGaps = 0; lastCamT = 0; camNominal = Math.round(s.frameRate) || 30;
  video.requestVideoFrameCallback(countCamFrame);
  setStatus('camInfo', `Camera OK: ${s.width}x${s.height} at ${Math.round(s.frameRate)} fps${audioTrack ? ', audio on' : ', no audio'}`, 'good');
  log('Camera started: ' + vt.label);
  setupMeter();
  connectCamAudio();
  onSceneChange();
}
$('btnCam').onclick = startCamera;

let audioCtx = null, anL = null, anR = null, bufL = null, bufR = null;
let audioDb = -100, silentSince = null, silentWarned = false;
let techActive = false, streamAudio = null;
const effectiveMuted = () => techActive; // the only thing that cuts the audio is the Tech error screen
function applyMute() {
  const m = effectiveMuted();
  if (mx) mx.master.gain.value = m ? 0 : 1;
  $('btnTech').classList.toggle('active', techActive);
  $('btnTech').textContent = techActive ? 'END TECH ERROR' : 'TECH ERROR';
}
// Everything heard on the stream goes through one mixer: the camera/mixer audio plus any video playing to the Stream.
// Video sound for the TV goes to its own output. Nothing here plays through this PC's speakers.
let mx = null, camSrcNode = null;
function ensureMixer() {
  if (mx) return mx;
  const ctx = new AudioContext();
  const o = { ctx };
  o.streamDest = ctx.createMediaStreamDestination();
  o.master = ctx.createGain(); o.master.connect(o.streamDest);
  o.cam = ctx.createGain(); o.cam.connect(o.master);
  o.vidStream = ctx.createGain(); o.vidStream.gain.value = 0; o.vidStream.connect(o.master);
  o.tvDest = ctx.createMediaStreamDestination();
  o.vidTv = ctx.createGain(); o.vidTv.gain.value = 0; o.vidTv.connect(o.tvDest);
  o.bus = ctx.createGain(); o.bus.connect(o.vidStream); o.bus.connect(o.vidTv);
  players.forEach((p) => { p.node = ctx.createMediaElementSource(p.el); p.node.connect(o.bus); });
  mx = o;
  ctx.resume().catch(() => {});
  applyMute();
  return o;
}
function connectCamAudio() {
  const m = ensureMixer();
  if (camSrcNode) { try { camSrcNode.disconnect(); } catch (e) { /* ignore */ } camSrcNode = null; }
  if (audioTrack) { camSrcNode = m.ctx.createMediaStreamSource(new MediaStream([audioTrack])); camSrcNode.connect(m.cam); }
}
function setupMeter() {
  if (audioCtx) { audioCtx.close(); audioCtx = null; anL = anR = null; }
  if (!audioTrack) { $('meterDb').textContent = 'Audio level: no audio source'; return; }
  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
  const split = audioCtx.createChannelSplitter(2);
  anL = audioCtx.createAnalyser(); anR = audioCtx.createAnalyser();
  anL.fftSize = 1024; anR.fftSize = 1024;
  bufL = new Float32Array(1024); bufR = new Float32Array(1024);
  src.connect(split); split.connect(anL, 0); split.connect(anR, 1); // deliberately not connected to speakers
}
function levelDb(an, buf) {
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}
function drawMeter(id, db) {
  const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
  $(id).style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
}
setInterval(() => {
  if (!anL) { audioDb = -100; drawMeter('mL', -100); drawMeter('mR', -100); return; }
  const l = levelDb(anL, bufL);
  let r = levelDb(anR, bufR);
  if (r < -90 && l > -80) r = l; // a mono source only fills the left channel
  audioDb = Math.max(l, r);
  const m = effectiveMuted();
  drawMeter('mL', m ? -100 : l); drawMeter('mR', m ? -100 : r);
  $('meterBar').style.width = Math.max(0, Math.min(100, (audioDb + 60) / 60 * 100)) + '%';
  $('meterDb').textContent = `Audio level: ${audioDb.toFixed(0)} dB`;
  if (streaming && !m && audioDb < -75) {
    if (!silentSince) silentSince = Date.now();
    else if (Date.now() - silentSince > 15000 && !silentWarned) { silentWarned = true; banner('No audio for 15 seconds - check the audio source.'); }
  } else { silentSince = null; silentWarned = false; }
}, 60);

// ---------- Bible: books > chapters > verses ----------
const BOOKS = [
  ['Genesis',50],['Exodus',40],['Leviticus',27],['Numbers',36],['Deuteronomy',34],['Joshua',24],['Judges',21],['Ruth',4],
  ['1 Samuel',31],['2 Samuel',24],['1 Kings',22],['2 Kings',25],['1 Chronicles',29],['2 Chronicles',36],['Ezra',10],
  ['Nehemiah',13],['Esther',10],['Job',42],['Psalms',150],['Proverbs',31],['Ecclesiastes',12],['Song of Solomon',8],
  ['Isaiah',66],['Jeremiah',52],['Lamentations',5],['Ezekiel',48],['Daniel',12],['Hosea',14],['Joel',3],['Amos',9],
  ['Obadiah',1],['Jonah',4],['Micah',7],['Nahum',3],['Habakkuk',3],['Zephaniah',3],['Haggai',2],['Zechariah',14],['Malachi',4],
  ['Matthew',28],['Mark',16],['Luke',24],['John',21],['Acts',28],['Romans',16],['1 Corinthians',16],['2 Corinthians',13],
  ['Galatians',6],['Ephesians',6],['Philippians',4],['Colossians',4],['1 Thessalonians',5],['2 Thessalonians',3],
  ['1 Timothy',6],['2 Timothy',4],['Titus',3],['Philemon',1],['Hebrews',13],['James',5],['1 Peter',5],['2 Peter',3],
  ['1 John',5],['2 John',1],['3 John',1],['Jude',1],['Revelation',22],
];
const OT_COUNT = 39;
const bible = { book: '', chapter: 0, verses: [], a: 0, b: 0, token: 0 };
const chapterCache = new Map();
let savedVerses = []; // kept only until the app closes, so each service starts fresh

function renderBooks() {
  const box = $('bookList');
  box.innerHTML = '';
  BOOKS.forEach(([name], i) => {
    if (i === 0 || i === OT_COUNT) {
      const h = document.createElement('div');
      h.className = 'testament'; h.textContent = i === 0 ? 'Old Testament' : 'New Testament';
      box.appendChild(h);
    }
    const b = document.createElement('button');
    b.className = 'bookrow' + (name === bible.book ? ' sel' : '');
    b.textContent = name;
    b.onclick = () => selectBook(name);
    box.appendChild(b);
  });
}
function renderChapters() {
  const box = $('chapList');
  box.innerHTML = '';
  const entry = BOOKS.find((x) => x[0] === bible.book);
  $('chHead').textContent = entry ? bible.book : 'Chapters';
  if (!entry) { box.innerHTML = '<div class="msg" style="grid-column:1/-1">Pick a book.</div>'; return; }
  for (let n = 1; n <= entry[1]; n++) {
    const b = document.createElement('button');
    b.textContent = n;
    if (n === bible.chapter) b.className = 'sel';
    b.onclick = () => selectChapter(n);
    box.appendChild(b);
  }
}
function selectBook(name) {
  bible.book = name; bible.chapter = 0; bible.verses = []; bible.a = bible.b = 0; bible.token++;
  renderBooks(); renderChapters(); renderVerses();
}
async function selectChapter(n, pick) {
  bible.chapter = n; bible.a = bible.b = 0;
  renderChapters();
  await loadVerses();
  if (pick && bible.verses.length) {
    bible.a = bible.b = pick === 'last' ? bible.verses[bible.verses.length - 1].verse : 1;
    updateVerseSel(); sendSelection(); scrollToVerse(bible.a);
  }
}
function scrollToVerse(n) { // moves only the verse list, never the page around it
  const list = $('verseList'), row = list.querySelector(`.verserow[data-v="${n}"]`);
  if (!row) return;
  const lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect();
  if (rr.top < lr.top) list.scrollTop -= lr.top - rr.top + 8;
  else if (rr.bottom > lr.bottom) list.scrollTop += rr.bottom - lr.bottom + 8;
}
// Arrow keys: one verse at a time, rolling over into the next or previous chapter and book.
async function stepVerse(d) {
  if (!bible.a || !bible.chapter) return;
  const n = (d > 0 ? bible.b : bible.a) + d;
  const last = bible.verses.length ? bible.verses[bible.verses.length - 1].verse : 0;
  const bi = BOOKS.findIndex((x) => x[0] === bible.book);
  if (n > last) {
    if (bible.chapter < BOOKS[bi][1]) await selectChapter(bible.chapter + 1, 'first');
    else if (bi + 1 < BOOKS.length) { selectBook(BOOKS[bi + 1][0]); await selectChapter(1, 'first'); }
  } else if (n < 1) {
    if (bible.chapter > 1) await selectChapter(bible.chapter - 1, 'last');
    else if (bi > 0) { selectBook(BOOKS[bi - 1][0]); await selectChapter(BOOKS[bi - 1][1], 'last'); }
  } else {
    bible.a = bible.b = n;
    updateVerseSel(); sendSelection(); scrollToVerse(n);
  }
}
async function loadVerses() {
  const trans = $('bibleTrans').value;
  const key = `${trans}|${bible.book}|${bible.chapter}`;
  const tok = ++bible.token;
  $('verHead').textContent = `${bible.book} ${bible.chapter}`;
  if (chapterCache.has(key)) { bible.verses = chapterCache.get(key); renderVerses(); return; }
  $('verseList').innerHTML = '<div class="msg">Loading...</div>';
  const r = await window.api.bibleFetch(`${bible.book} ${bible.chapter}`, trans);
  if (tok !== bible.token) return; // a newer pick replaced this one
  if (!r.ok) { $('verseList').innerHTML = `<div class="msg">${esc(r.error)}</div>`; return; }
  chapterCache.set(key, r.verses);
  bible.verses = r.verses;
  renderVerses();
}
function renderVerses() {
  const box = $('verseList');
  box.innerHTML = '';
  $('verHead').textContent = bible.chapter ? `${bible.book} ${bible.chapter}` : 'Verses';
  if (!bible.chapter) {
    box.innerHTML = '<div class="msg">Pick a book, then a chapter, then tap a verse. It goes to Preview.<br>Tap Next verse to add more, or hold Shift and tap to pick a range.</div>';
  } else {
    bible.verses.forEach((v) => {
      const row = document.createElement('div');
      row.className = 'verserow'; row.dataset.v = v.verse;
      row.innerHTML = `<b>${v.verse}</b><span>${esc(v.text)}</span>`;
      row.onclick = (e) => onVerse(v.verse, e);
      box.appendChild(row);
    });
  }
  updateVerseSel();
}
function updateVerseSel() {
  document.querySelectorAll('#verseList .verserow').forEach((r) => {
    const n = Number(r.dataset.v);
    r.classList.toggle('sel', bible.a > 0 && n >= bible.a && n <= bible.b);
  });
  $('btnVerseSave').disabled = !bible.a;
  const last = bible.verses.length ? bible.verses[bible.verses.length - 1].verse : 0;
  $('btnVerseNext').disabled = !bible.a || bible.b >= last;
}
function selectionPayload() {
  if (!bible.a) return null;
  const vs = bible.verses.filter((x) => x.verse >= bible.a && x.verse <= bible.b);
  if (!vs.length) return null;
  return {
    ref: `${bible.book} ${bible.chapter}:${bible.a}${bible.b > bible.a ? '-' + bible.b : ''}`,
    text: vs.map((x) => x.text).join(' '),
    trans: $('bibleTrans').value.toUpperCase(),
  };
}
// A verse already on the Output is swapped in place (no SEND); otherwise it goes to Preview as before.
function pushVerse(ref, text, trans) {
  if ($('bibleFollow').checked && liveHasVerse()) followLiveVerse(ref, text, trans);
  else addVerse(ref, text, trans);
}
function sendSelection() { const p = selectionPayload(); if (p) pushVerse(p.ref, p.text, p.trans); }
function onVerse(v, e) {
  if ((e.shiftKey || e.ctrlKey || e.metaKey) && bible.a) { bible.a = Math.min(bible.a, v); bible.b = Math.max(bible.b, v); }
  else { bible.a = bible.b = v; }
  updateVerseSel();
  sendSelection();
}
$('btnVerseNext').onclick = () => {
  bible.b++;
  updateVerseSel(); sendSelection();
  const row = document.querySelector(`#verseList .verserow[data-v="${bible.b}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
};
$('bibleTrans').onchange = async () => {
  if (!bible.chapter) return;
  await loadVerses();
  if (bible.a) sendSelection();
};
function renderSaved() {
  const box = $('savedList');
  box.innerHTML = '';
  if (!savedVerses.length) { box.innerHTML = '<div class="msg">Press Save verse to keep a verse here for this service.</div>'; return; }
  savedVerses.forEach((v, idx) => {
    const row = document.createElement('div');
    row.className = 'savedrow';
    row.innerHTML = `<b>${esc(v.ref)} (${esc(v.trans)})</b><span>${esc(v.text)}</span><i title="Remove">x</i>`;
    row.onclick = (e) => {
      if (e.target.tagName === 'I') { savedVerses.splice(idx, 1); renderSaved(); return; }
      pushVerse(v.ref, v.text, v.trans);
    };
    box.appendChild(row);
  });
}
$('btnVerseSave').onclick = () => {
  const p = selectionPayload();
  if (!p) return;
  if (!savedVerses.some((v) => v.ref === p.ref && v.trans === p.trans)) savedVerses.push(p);
  renderSaved();
  const b = $('btnVerseSave'); b.textContent = 'Saved'; setTimeout(() => { b.textContent = 'Save verse'; }, 900);
};

// ---------- bottom dock: Bible, Videos & Photos, Lower Thirds, TV, Bible Look ----------
let dockTab = '';
function setDock(tab) {
  dockTab = tab;
  ['Bible', 'Media', 'Lower'].forEach((t) => { $('pane' + t).hidden = dockTab !== t; });
  document.querySelectorAll('#dockTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === dockTab));
  if (dockTab === 'Lower') $('msgA').focus();
}
// Views: Show (the service screen), TV, Looks. Keys only act in Show, like the real thing on Sunday.
let view = 'Show';
function setView(v) {
  view = v;
  ['Show', 'TV', 'Settings'].forEach((n) => { $('view' + n).hidden = v !== n; });
  document.querySelectorAll('#viewTabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'Show') fitAll();
  if (v === 'TV') { refreshScreens(); updateMediaUI(); }
  if (v === 'Settings') showPage(settingsPage);
}
let settingsPage = 'cards';
function showPage(p) {
  settingsPage = p;
  document.querySelectorAll('.spage').forEach((s) => { s.hidden = s.dataset.page !== p; });
  document.querySelectorAll('.settingsnav button').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
  lookReplay.verse = lookReplay.name = lookReplay.card = performance.now() - 5000;
  if (p === 'media') showMediaSettings();
  if (p === 'screens') renderScreenManager();
  if (p === 'qr') loadQrFields();
}
function openSettings(p) { setView('Settings'); showPage(p || settingsPage); }
document.querySelectorAll('.settingsnav button').forEach((b) => { b.onclick = () => showPage(b.dataset.page); });
document.querySelectorAll('#viewTabs button').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  const v = { 1: 'Show', 2: 'TV', 3: 'Settings' }[e.key];
  if (v) { setView(v); e.preventDefault(); }
});
document.querySelectorAll('#dockTabs button').forEach((b) => { b.onclick = () => setDock(b.dataset.tab); });

// ---------- fill the window: size the two pictures to the space they have ----------
const RAIL_MIN = 220, STRIP = 44, TABS = 45, PANEL_MIN = 240;
function fitAll() {
  const st = $('stage');
  const mw = document.documentElement.clientWidth, mh = $('viewShow').clientHeight;
  if (mw <= 0 || mh <= 0) return;
  let w = Math.floor((mw - RAIL_MIN) / 2);
  let h = Math.round(w * 9 / 16);
  const maxStage = mh - TABS - PANEL_MIN;
  if (h + STRIP > maxStage) { h = Math.max(160, maxStage - STRIP); w = Math.floor(h * 16 / 9); }
  st.style.gridTemplateColumns = `${w}px 1fr ${w}px`;
  st.style.height = (h + STRIP) + 'px';
  [previewCanvas, liveCanvas].forEach((c) => { c.style.width = w + 'px'; c.style.height = h + 'px'; });
}
window.addEventListener('resize', fitAll);

$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
$('btnRemoveSel').onclick = removeSelected;
function endTech(restore) {
  if (!techActive) return;
  techActive = false;
  if (restore) restoreLive();
  applyMute();
}
$('btnGo').onclick = () => { endTech(false); goLive(); log('SEND'); };
$('btnClear').onclick = () => { endTech(false); stopOnClear(); clearAll(); log('CLEAR ALL'); };
$('btnTech').onclick = () => {
  if (techActive) { endTech(true); log('TECH ERROR ended'); }
  else { techActive = true; techNow(); applyMute(); log('TECH ERROR (audio cut)'); }
};
attachPreviewMouse(previewCanvas);

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'select', 'textarea'].includes(tag) || !$('modal').hidden || view !== 'Show') return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { undo(); e.preventDefault(); }
  else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { redo(); e.preventDefault(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { removeSelected(); e.preventDefault(); }
  else if (dockTab === 'Bible' && bible.a && !e.altKey && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) {
    stepVerse(['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key) ? -1 : 1);
    e.preventDefault();
  }
  else if (dockTab === 'Media' && !e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
    stepClip(e.key === 'ArrowLeft' ? -1 : 1);
    e.preventDefault();
  }
  else if (e.key.startsWith('Arrow')) {
    const d = e.shiftKey ? 40 : 10;
    nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
    e.preventDefault();
  }
});

function describe(it) {
  if (it.type === 'camera') return 'Camera';
  if (it.type === 'tech') return 'Tech Difficulties screen';
  if (it.type === 'photo') { const c = clipById(it.clipId); return 'Photo: ' + (c ? c.name : ''); }
  if (it.type === 'media') { const c = clipById(it.clipId); return 'Video: ' + (c ? c.name : ''); }
  if (it.type === 'verse') return 'Verse: ' + (it.ref || '');
  if (it.type === 'card') return (SLOT_NAMES[it.slot] || 'Card') + (it.a ? ': ' + it.a : '');
  return 'Name: ' + (it.name || '');
}
function refreshMainUI() {
  const differs = previewDiffers(), clears = sendWouldClear();
  $('btnGo').classList.toggle('ready', differs || clears);
  $('btnGo').querySelector('small').textContent = clears ? 'Blank Preview clears the lower third' : 'Preview to Output';
  previewCanvas.classList.toggle('pending', differs);
  $('btnUndo').disabled = !canUndo();
  $('btnRedo').disabled = !canRedo();
  const sel = selected();
  $('btnRemoveSel').disabled = !sel || isBase(sel.type);
  $('hint').textContent = !videoReady ? 'The camera is not running. Open Settings to choose the camera.'
    : differs ? 'Press SEND to put this Preview on the Output.'
      : clears ? 'Preview is blank. Press SEND to take the lower third off the Output.'
      : 'Preview and Output match. Pick a verse or name to build the next look.';
  const box = $('onnow');
  box.innerHTML = '';
  live.items.forEach((it) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = esc(describe(it)) + (isBase(it.type) ? '' : ' <b title="Take off screen">x</b>');
    if (!isBase(it.type)) c.querySelector('b').onclick = () => removeLiveItem(it.id);
    box.appendChild(c);
  });
  const strip = (id, list) => { const b = $(id); b.innerHTML = ''; list.forEach((it) => b.appendChild(mk('span', 'chip', esc(describe(it))))); };
  strip('engLive', live.items); strip('engPrev', preview.items);
  applyAudioMode();
  checkAutoHide();
}
onSceneChange = () => { refreshMainUI(); saveScene(); };

function saveScene() { /* the app always starts clean: plain camera, nothing on screen */ }

// ---------- status lights ----------

function setPill(id, cls, text) { const el = $(id); el.className = 'pill ' + cls; el.querySelector('span').textContent = text; }
function updatePills() {
  $('liveBadge').textContent = streaming ? 'ON AIR' : 'OUTPUT';
  $('outDot').className = 'dot' + (streaming ? ' red' : '');
  setPill('pCam', videoReady ? 'ok' : 'bad', videoReady ? 'Camera OK' : 'Camera off');
  if (!audioTrack) setPill('pAud', 'warn', 'No audio');
  else setPill('pAud', audioDb > -70 ? 'ok' : 'warn', audioDb > -70 ? 'Audio OK' : 'Audio quiet');
  { const n = [...screens.values()].filter((s) => s.open).length; setPill('pTv', n ? 'ok' : '', n ? `External: ${n} on` : 'External off'); }
  if (streaming) {
    const ff = latestMetrics.ff || {};
    const healthy = ff.running && ff.speed > 0.95;
    const rec = currentDest === 'record';
    setPill('pStream', healthy ? 'onair' : 'warn', healthy ? (rec ? 'REC ' : 'LIVE ') + fmtTime((Date.now() - streamStart) / 1000) : rec ? 'Recording trouble' : 'Stream trouble');
  } else setPill('pStream', '', recordOnly() ? 'Not recording' : 'Off air');
}

// ---------- drawing loop ----------
let lastT = 0, liveLast = 0, liveFrameNo = 0;
let fpsCount = 0, renderFps = 0, longFrames = 0, longFramesTotal = 0, lastFpsT = performance.now();
let camFpsNow = 0, lastCamFrames = 0;

function loop(now) {
  requestAnimationFrame(loop);
  if (lastT) { fpsCount++; if (now - lastT > 40) { longFrames++; longFramesTotal++; } }
  lastT = now;
  renderPreview(pctx, previewCanvas.width, previewCanvas.height);
  const target = Number($('fps').value) || 30;
  if (now - liveLast >= 1000 / target - 3) {
    liveLast = now; liveFrameNo++;
    drawList(lctx, liveList(now), liveCanvas.width, liveCanvas.height);
    if ($('testClock').checked) drawTestClock(lctx);
  }
  drawDisplayFrames(now);
  if (now - lastFpsT >= 1000) {
    renderFps = Math.round(fpsCount * 1000 / (now - lastFpsT));
    fpsCount = 0; lastFpsT = now;
    camFpsNow = camFrames - lastCamFrames; lastCamFrames = camFrames;
  }
}
function drawTestClock(ctx) {
  const d = new Date();
  const txt = d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0') + '  f' + (liveFrameNo % 100000);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(W - 640, 20, 620, 90);
  ctx.fillStyle = '#0f0'; ctx.font = 'bold 58px Consolas, monospace'; ctx.textBaseline = 'top';
  ctx.fillText(txt, W - 625, 34);
  ctx.restore();
}
requestAnimationFrame(loop);

// ---------- Settings: how lower thirds look. Every kind has its own look. ----------
const FONT_LIST = ['Segoe UI', 'Figtree', 'Arial', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Calibri', 'Georgia', 'Times New Roman', 'Impact'];
const FONT_OPTS = FONT_LIST.map((f) => [f, f]);
const ANIM_OPTS = [['fade', 'Fade'], ['rise', 'Rise up'], ['slide', 'Slide in from the left'], ['slideR', 'Slide in from the right'], ['wipe', 'Wipe across'], ['curtain', 'Open outward from the middle'], ['drop', 'Lower in from above'], ['tilt', 'Tilt up'], ['zoom', 'Zoom in'], ['bounce', 'Drop in and bounce'], ['unfold', 'Unfold from the middle'], ['flip', 'Swing up'], ['typewriter', 'Type the words on'], ['none', 'Cut (no animation)']];
const ANIM_OPTS_NAME = [...ANIM_OPTS.slice(0, -1), ['line', 'Line stretches out, words rise and drop away'], ['none', 'Cut (no animation)']];
const ALIGN_OPTS = [['left', 'Left'], ['center', 'Centred']];
const WEIGHT_OPTS = [['normal', 'Regular'], ['bold', 'Bold']];
const R = (k, l, min, max, step) => ({ k, l, t: 'range', min, max, step });
const S = (k, l, opts) => ({ k, l, t: 'select', opts });
const C = (k, l) => ({ k, l, t: 'color' });
const K = (k, l) => ({ k, l, t: 'check' });
const SEC = {
  gallery: { title: 'Design library', gallery: true },
  shape: { title: 'Shape', shape: true },
  bgPlate: { title: 'Colours', items: [C('bg', 'Main colour'), R('opacity', 'Strength (see-through)', 20, 100, 5), C('accent', 'Accent colour')] },
  bg: { title: 'Background', items: [C('bg', 'Colour'), R('opacity', 'Strength (see-through)', 20, 100, 5), C('accent', 'Accent colour'), R('radius', 'Round the corners', 0, 60, 2)] },
  verse: { title: 'Verse text', items: [S('font', 'Font', FONT_OPTS), C('textColor', 'Colour'), R('textScale', 'Size', 60, 140, 5), S('textWeight', 'Weight', WEIGHT_OPTS), R('lineGap', 'Space between lines', 100, 180, 5), S('align', 'Line up', ALIGN_OPTS), R('pad', 'Space around the text', 50, 200, 10), K('shadow', 'Soft shadow behind the text')] },
  ref: { title: 'Book and verse (the reference)', items: [S('refPos', 'Where it goes', [['above', 'Above the verse'], ['below', 'Below the verse']]), C('refColor', 'Colour'), R('refScale', 'Size', 60, 160, 5), K('refCaps', 'Capital letters')] },
  big: { title: 'Big words', items: [S('font', 'Font (all the words)', FONT_OPTS), C('nameColor', 'Colour'), R('nameScale', 'Size', 50, 160, 5), S('nameWeight', 'Weight', WEIGHT_OPTS), K('nameCaps', 'Capital letters')] },
  small: { title: 'Small words', items: [C('titleColor', 'Colour'), R('titleScale', 'Size', 50, 160, 5), S('titleWeight', 'Weight', WEIGHT_OPTS)] },
  posSlide: { title: 'Words position', items: [S('align', 'Line up', ALIGN_OPTS), R('pad', 'Space around the text', 50, 200, 10), R('textX', 'Move text sideways', -30, 30, 1), R('textY', 'Move text up or down', -30, 30, 1), K('shadow', 'Soft shadow behind the text')] },
  posCard: { title: 'Words position', items: [R('textY', 'Move text up or down', -30, 30, 1), K('shadow', 'Soft shadow behind the text')] },
  sizeFull: { title: 'Size and place', items: [R('boxH', 'Height', 120, 460, 10), R('boxBottom', 'Distance from the bottom', 0, 300, 10)], apply: true, note: 'Full lower thirds always fill the screen from left to right and stay in this place.' },
  sizeSlide: { title: 'Size and place', items: [R('boxH', 'Height', 100, 300, 10), R('boxX', 'Distance from the left', 0, 1500, 10), R('boxBottom', 'Distance from the bottom', 0, 600, 10)], apply: true, note: 'The width fits the words. Drag it anywhere in Preview and it remembers where you put it.' },
  animV: { title: 'When it appears', items: [S('anim', 'Animation', ANIM_OPTS), R('animMs', 'Speed (slower to the right)', 100, 1500, 50), K('shine', 'A light sweep as it appears')], note: 'When you change verse, only the words cross-fade. The bar stays. The words always come in a moment after the bar.' },
  animC: { title: 'When it appears', items: [S('anim', 'Animation', ANIM_OPTS), R('animMs', 'Speed (slower to the right)', 100, 1500, 50), K('shine', 'A light sweep as it appears'), R('autoHide', 'Take it off by itself after (seconds, 0 = stay)', 0, 60, 1)] },
  animN: { title: 'When it appears', items: [S('anim', 'Animation', ANIM_OPTS_NAME), R('animMs', 'Speed (slower to the right)', 100, 1500, 50), K('shine', 'A light sweep as it appears'), R('autoHide', 'Take it off by itself after (seconds, 0 = stay)', 0, 60, 1)], note: 'The "line stretches out" animation suits the Underline plate best: the line grows from the left while the words rise, and on the way out the words drop away as the line pulls back.' },
};
const LOOK_SPEC = {
  verse: [SEC.gallery, SEC.shape, SEC.bg, SEC.verse, SEC.ref, SEC.sizeFull, SEC.animV],
  name: [SEC.gallery, SEC.shape, SEC.bgPlate, SEC.big, SEC.small, SEC.posSlide, SEC.sizeSlide, SEC.animN],
  card: [SEC.gallery, SEC.shape, SEC.bg, SEC.big, SEC.small, SEC.posCard, SEC.sizeFull, SEC.animC],
};
const specKey = (slot) => (slot === 'verse' ? 'verse' : slot === 'name' ? 'name' : 'card');
const pageOf = (slot) => (slot === 'name' ? 'name' : 'card');
const SAMPLE_CANVAS = { name: 'lsSample', card: 'qcSample' };
const lookReplay = { verse: 0, name: 0, card: 0 };
const thumbs = {};
const lookKey = (t) => t;
let qcKind = 'verse';

function saveLook(slot) {
  setLook(slot, looks[slot]);
  try { localStorage.setItem('look.' + slot, JSON.stringify(looks[slot])); } catch (e) { /* ignore */ }
  lookReplay[pageOf(slot)] = performance.now() - 5000; // show the finished look while adjusting
  if (slot === 'name') refreshPlateWidths();
}
onLookGeom = (slot) => saveLook(slot); // the slide-in remembers where you put it
function loadLooks() {
  // Version 3: every kind now has its own different animation and no light sweep by default, so older saved animation choices are dropped once.
  let tidy = false;
  try { tidy = localStorage.getItem('looksVersion') !== '3'; } catch (e) { /* ignore */ }
  Object.keys(LOOK_DEFAULTS).forEach((sl) => {
    const o = readStore('look.' + sl, {});
    if (tidy) { delete o.anim; delete o.animMs; delete o.shine; }
    setLook(sl, o); // old saved looks are tidied by setLook
  });
  if (tidy) { try { localStorage.setItem('looksVersion', '3'); Object.keys(LOOK_DEFAULTS).forEach((sl) => localStorage.setItem('look.' + sl, JSON.stringify(looks[sl]))); } catch (e) { /* ignore */ } }
  buildLookControls('name');
}
function mk(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function rootFor(slot) {
  return slot === 'name' ? $('lsSampleControls') : $('qcLook');
}

function ctlEl(slot, spec) {
  const st = looks[slot];
  const wrap = mk('div', 'ctl');
  let input;
  if (spec.t === 'check') {
    const l = mk('label', 'check'); input = mk('input'); input.type = 'checkbox'; input.checked = !!st[spec.k];
    l.appendChild(input); l.appendChild(document.createTextNode(' ' + spec.l)); wrap.appendChild(l);
    input.onchange = () => { st[spec.k] = input.checked; saveLook(slot); };
    return wrap;
  }
  wrap.appendChild(mk('label', '', spec.l));
  if (spec.t === 'select') {
    input = mk('select'); spec.opts.forEach(([v, n]) => input.add(new Option(n, v))); input.value = st[spec.k] === null ? '' : st[spec.k];
    input.onchange = () => { st[spec.k] = input.value; saveLook(slot); };
  } else if (spec.t === 'range') {
    input = mk('input'); input.type = 'range'; input.min = spec.min; input.max = spec.max; input.step = spec.step; input.value = st[spec.k];
    input.oninput = () => { st[spec.k] = Number(input.value); saveLook(slot); };
  } else {
    input = mk('input'); input.type = 'color'; input.value = st[spec.k];
    input.oninput = () => { st[spec.k] = input.value; saveLook(slot); };
  }
  wrap.appendChild(input);
  return wrap;
}
// ----- the design library: pick a look and the kind takes it on (colours, shape, text style, animation) -----
const THUMB_ITEM = (slot) => {
  if (slot === 'verse') return { id: -11, type: 'verse', ref: 'John 3:16', text: 'For God so loved the world, that he gave his only begotten Son.' };
  if (slot === 'name') return { id: -12, type: 'name', name: 'Pastor John Smith', title: 'Senior Pastor' };
  return Object.assign({ id: -13, type: 'card' }, cardFields(slot, true));
};
function drawDesignThumb(cv, slot, style) {
  const ctx = cv.getContext('2d'), g = ctx.createLinearGradient(0, 0, 0, cv.height);
  g.addColorStop(0, '#6a8199'); g.addColorStop(1, '#2a3541'); ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  const st = Object.assign({}, style);
  withStyle(slot, st, () => {
    ctx.save();
    if (slot === 'name') { const k = cv.width / 880; ctx.scale(k, k); ctx.translate(-40, -585); } else { ctx.scale(cv.width / W, cv.height / 540); ctx.translate(0, -540); } // only the bottom half of the screen matters
    const box = lookBox(slot), it = Object.assign(THUMB_ITEM(slot), box);
    if (slot !== 'name') { it.h = box.h; it.y = H - box.h - looks[slot].boxBottom; it.x = 0; it.w = 1920; }
    else it.w = plateLayout(ctx, looks.name, it.name, it.title, it.h).W;
    drawItem(ctx, it, 1, 0, null);
    ctx.restore();
  });
}
// Choosing a design. LOWER_THIRD_STYLE_SCOPE (looks.js) decides whether it restyles every full lower third or only this one.
function applyDesign(slot, d, all) {
  const everyFull = LOWER_THIRD_STYLE_SCOPE === 'all' || all;
  const slots = slot === 'name' ? ['name'] : everyFull ? FULL_SLOTS : [slot];
  slots.forEach((s) => {
    const st = looks[s], p = PRESETS.find((x) => x.id === d.s.preset);
    const own = Object.assign({}, d.s);
    if (STYLE_KEEPS_OWN_ANIMATION || (all && s !== slot)) { delete own.anim; delete own.animMs; delete own.shine; } // every kind keeps its own way of moving
    Object.assign(st, own);
    st.radius = p ? p.radius : 0; st.showText = true;
    if (s !== 'name') { st.boxX = 0; st.boxW = 1920; if (st.boxH < 200 || st.boxH > 400) st.boxH = LOOK_DEFAULTS[s].boxH; }
    saveLook(s); resetLookGeometry(s);
  });
  buildLookControls(slot);
}
// ----- picture backgrounds: ready-made and imported (imported ones are permanent and shared by every project) -----
async function loadLtLibrary() {
  try { const r = await window.api.ltList(); setCustomBgs(r.items); } catch (e) { log('Could not read the lower-third pictures: ' + e.message); }
}
function applyPicture(slot, e, all) {
  const everyFull = LOWER_THIRD_STYLE_SCOPE === 'all' || all;
  const slots = everyFull ? FULL_SLOTS : [slot];
  slots.forEach((s) => {
    const st = looks[s], light = e.tone === 'light';
    Object.assign(st, { preset: 'image', bgId: e.id, imageFit: 'stretch', radius: 0, showText: !e.hasText, opacity: 100 });
    Object.assign(st, light ? { nameColor: '#14161a', textColor: '#14161a', titleColor: '#4a5266' } : { nameColor: '#ffffff', textColor: '#ffffff', titleColor: '#d6dbe6' });
    st.boxX = 0; st.boxW = 1920; st.boxH = Math.max(120, Math.min(460, bandHeight(e)));
    saveLook(s); resetLookGeometry(s);
  });
  buildLookControls(slot);
}
async function importPictures(slot) {
  const r = await window.api.ltImport();
  setCustomBgs(r.items);
  if (r.failed && r.failed.length) banner('Could not import: ' + r.failed.join(', '));
  if (r.added && r.added.length) log('Imported ' + r.added.length + ' lower-third picture(s)');
  buildLookControls(slot);
}
async function removePicture(slot, e) {
  const r = await window.api.ltRemove(e.id);
  setCustomBgs(r.items);
  FULL_SLOTS.forEach((s) => { if (looks[s].bgId === e.id) { setLook(s, looks[s]); saveLook(s); resetLookGeometry(s); } }); // anything using it goes back to its own design
  buildLookControls(slot);
}
function galleryEl(slot) {
  const wrap = mk('div'), isName = slot === 'name';
  let all = false;
  if (!isName && LOWER_THIRD_STYLE_SCOPE !== 'all') {
    const l = mk('label', 'check'), cb = mk('input'); cb.type = 'checkbox';
    l.appendChild(cb); l.appendChild(document.createTextNode(' Use the design I click for ALL full lower thirds (each one keeps its own animation)'));
    cb.onchange = () => { all = cb.checked; }; wrap.appendChild(l);
  } else if (!isName) wrap.appendChild(mk('div', 'small', 'Choosing a design here restyles every full lower third. Each one keeps its own animation.'));
  const designs = isName ? DESIGNS_NAME : DESIGNS_FULL, st = looks[slot];
  const groups = [...new Set(designs.map((d) => d.group))];
  const tile = (name, on, paint, onclick) => {
    const b = mk('button', 'gitem' + (on ? ' on' : '')), cv = mk('canvas'); cv.width = 240; cv.height = slot === 'name' ? 135 : 76;
    b.appendChild(cv); b.appendChild(mk('span', '', esc(name))); b.onclick = onclick; paint(cv); return b;
  };
  groups.forEach((gname) => {
    wrap.appendChild(mk('div', 'ilabel gl', gname));
    const g = mk('div', 'gallery');
    designs.filter((d) => d.group === gname).forEach((d) => {
      const on = st.preset === d.s.preset && st.bg === d.s.bg && st.accent === d.s.accent;
      g.appendChild(tile(d.name, on, (cv) => drawDesignThumb(cv, slot, d.s), () => applyDesign(slot, d, all)));
    });
    wrap.appendChild(g);
  });
  if (!isName) {
    wrap.appendChild(mk('div', 'ilabel gl', 'Pictures'));
    const g = mk('div', 'gallery');
    bgLib.forEach((e) => {
      const on = st.preset === 'image' && st.bgId === e.id;
      const b = tile(e.name, on, (cv) => {
        const draw = () => {
          const ctx = cv.getContext('2d'), gr = ctx.createLinearGradient(0, 0, 0, cv.height);
          gr.addColorStop(0, '#6a8199'); gr.addColorStop(1, '#2a3541'); ctx.fillStyle = gr; ctx.fillRect(0, 0, cv.width, cv.height);
          const im = bgImage(e.id), k = cv.width / 1920;
          if (im && im.complete && im.naturalWidth) { const sh = bandHeight(e) * k; ctx.drawImage(im, 0, cv.height - sh, cv.width, sh); }
        };
        draw();
        const im = bgImage(e.id); if (im && !im.complete) im.addEventListener('load', draw, { once: true });
      }, () => applyPicture(slot, e, all));
      if (e.custom) {
        const x = mk('span', 'gx', 'Remove'); x.title = 'Remove this picture from the library';
        x.onclick = (ev) => { ev.stopPropagation(); if (x.dataset.sure) { removePicture(slot, e); return; } x.dataset.sure = '1'; x.textContent = 'Click again to remove'; setTimeout(() => { x.dataset.sure = ''; x.textContent = 'Remove'; }, 3000); };
        b.appendChild(x);
      }
      g.appendChild(b);
    });
    wrap.appendChild(g);
    const row = mk('div', 'row');
    const imp = mk('button', 'primary', 'Import picture...'); imp.onclick = () => importPictures(slot);
    const opn = mk('button', '', 'Open pictures folder'); opn.onclick = () => window.api.ltOpen();
    row.appendChild(imp); row.appendChild(opn); wrap.appendChild(row);
    wrap.appendChild(mk('div', 'small', 'Imported pictures are kept by the app (not in your media folder) and are there every time you open it. Best size: 1920 wide, 200 to 460 tall (a PNG with see-through edges works well).'));
  }
  return wrap;
}
function shapeEl(slot) {
  const st = looks[slot], isName = slot === 'name';
  const opts = (isName ? NAME_PRESETS : PRESETS).map((p) => [p.id, p.name]);
  const wrap = mk('div', 'ctl'); wrap.appendChild(mk('label', '', isName ? 'Plate layout' : 'Shape of the bar'));
  if (st.preset === 'image') opts.unshift(['image', 'Picture']);
  const sel = mk('select'); opts.forEach(([v, n]) => sel.add(new Option(n, v))); sel.value = st.preset;
  sel.onchange = () => {
    if (st.preset === 'image' && sel.value !== 'image') { st.bgId = null; st.showText = true; st.opacity = LOOK_DEFAULTS[slot].opacity; }
    st.preset = sel.value; const p = PRESETS.find((x) => x.id === sel.value); st.radius = p ? p.radius : 0;
    saveLook(slot); buildLookControls(slot);
  };
  wrap.appendChild(sel);
  wrap.appendChild(mk('div', 'small', isName ? 'Pick a ready-made design above, or change the layout here and then the colours.' : 'Mix your own: pick any shape, then change the colours below.'));
  return wrap;
}
function buildLookControls(slot) {
  const root = rootFor(slot);
  if (!root) return;
  root.innerHTML = '';
  LOOK_SPEC[specKey(slot)].forEach((sec) => {
    const card = mk('div', 'card'); card.appendChild(mk('h3', '', sec.title));
    if (sec.gallery) card.appendChild(galleryEl(slot));
    else if (sec.shape) card.appendChild(shapeEl(slot));
    else {
      const grid = mk('div', 'ctlgrid');
      sec.items.forEach((it) => grid.appendChild(ctlEl(slot, it)));
      card.appendChild(grid);
      if (sec.apply) {
        const row = mk('div', 'row');
        const a = mk('button', 'primary', 'Apply to what is in Preview'); a.onclick = () => resetLookGeometry(slot);
        row.appendChild(a); card.appendChild(row);
      }
      if (sec.note) card.appendChild(mk('div', 'small', sec.note));
    }
    root.appendChild(card);
  });
}
function drawLookSample(page, now) {
  const cv = $(SAMPLE_CANVAS[page]), ctx = cv.getContext('2d');
  const slot = page === 'card' ? qcKind : page, st = looks[slot];
  const g = ctx.createLinearGradient(0, 0, 0, cv.height);
  g.addColorStop(0, '#6a8199'); g.addColorStop(1, '#2a3541'); ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  const b = lookBox(slot);
  let it;
  if (slot === 'verse') it = Object.assign({ id: -1, type: 'verse', ref: 'John 3:16 (KJV)', text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' }, b);
  else if (slot === 'name') it = Object.assign({ id: -2, type: 'name', name: 'Pastor John Smith', title: 'Senior Pastor' }, b, { w: slideWidth('Pastor John Smith', 'Senior Pastor') });
  else it = Object.assign({ id: -3, type: 'card' }, b, cardFields(qcKind, true));
  appearAt[it.id] = lookReplay[page]; // so the sample replays the staggered entrance
  // Replay shows the way in, a short hold, then the way out, and then the finished look stays up while you adjust it.
  const dur = st.anim === 'none' ? 1 : st.animMs, t = now - lookReplay[page], hold = 1800;
  let p = 1, dir = 'in', draw = true;
  if (t < dur) p = t / dur;
  else if (t >= dur + hold && t < dur * 2 + hold) { p = (t - dur - hold) / dur; dir = 'out'; }
  ctx.save(); ctx.scale(cv.width / W, cv.height / H);
  if (draw) drawItem(ctx, it, p, 0, { p, dir });
  ctx.restore();
}
$('lsSampleReplay').onclick = () => { lookReplay.name = performance.now(); };
$('lsSampleReset').onclick = () => { setLook('name', {}); saveLook('name'); buildLookControls('name'); };
$('btnLowerLook').onclick = () => { openSettings('cards'); };

// ---------- Quick cards and the QR code ----------
const CARD_DEFAULTS = {
  welcomeA: 'Welcome', welcomeB: 'Thanks for joining us',
  thanksA: 'Thank you for joining us', thanksB: 'See you next week',
  soonLabel: 'Service starts in', soonMinutes: 5, serviceTime: '',
  followTitle: 'Follow us', yt: '', fb: '', ig: '',
  giveA: 'Give', giveB: 'Scan to give', giveUrl: '',
};
let cardCfg = Object.assign({}, CARD_DEFAULTS, readStore('cards', {}));
const saveCards = () => { try { localStorage.setItem('cards', JSON.stringify(cardCfg)); } catch (e) { /* ignore */ } };
function cardFields(kind, forSample) {
  const c = cardCfg, demo = (v, d) => (v || (forSample ? d : ''));
  switch (kind) {
    case 'welcome': return { slot: 'welcome', kind: 'message', a: c.welcomeA, b: c.welcomeB };
    case 'thanks': return { slot: 'thanks', kind: 'message', a: c.thanksA, b: c.thanksB };
    case 'countdown': return { slot: 'countdown', kind: 'countdown', mode: 'minutes', a: c.soonLabel, minutes: Number($('cardMinutes').value) || c.soonMinutes };
    case 'service': return { slot: 'countdown', kind: 'countdown', mode: 'service', a: c.soonLabel };
    case 'follow': return { slot: 'follow', kind: 'follow', a: c.followTitle, items: [{ icon: 'youtube', text: demo(c.yt, '@yourchurch') }, { icon: 'facebook', text: demo(c.fb, '/yourchurch') }, { icon: 'instagram', text: demo(c.ig, '@yourchurch') }] };
    case 'verse': return { slot: 'verse' };
    case 'give': return { slot: 'give', kind: 'give', a: c.giveA, b: c.giveB, url: demo(c.giveUrl.trim(), 'https://example.com/give') };
    default: return { slot: 'message', kind: 'message', a: forSample ? 'Your message here' : '', b: forSample ? 'A smaller line under it' : '' };
  }
}
// One tap, or Preview then SEND: the tick box decides. Only one lower third is ever on screen.
function afterAdd(it) { if ($('cardDirect').checked) sendItemNow(it); }
function pushCard(fields) { afterAdd(addCard(fields)); }
function pushName(name, title) { afterAdd(addName(name, title)); }
// The service start time (set once in Settings) so "Until service starts" is one tap.
function serviceEndAt() {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(cardCfg.serviceTime || '').trim());
  if (!m) return null;
  const d = new Date(); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() < Date.now() - 30 * 60 * 1000) d.setDate(d.getDate() + 1); // long past: it means the next one
  return d.getTime();
}
getServiceEnd = serviceEndAt;
// The Until-service and Give buttons only show when Settings has what they need (a start time, a QR link).
function updateServiceLabel() { $('serviceTimeLabel').textContent = cardCfg.serviceTime ? 'Counts down to ' + cardCfg.serviceTime : ''; updateQuickButtons(); }
function updateQuickButtons() {
  $('qcService').hidden = !String(cardCfg.serviceTime || '').trim();
  $('qcGive').hidden = !String(cardCfg.giveUrl || '').trim();
}
document.querySelectorAll('.qcard').forEach((b) => {
  b.onclick = (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (b.dataset.card === 'service' && !cardCfg.serviceTime) { qcKind = 'countdown'; openSettings('cards'); buildCardsPage(); banner('Set the time the service starts, then come back and press this again.'); return; }
    pushCard(cardFields(b.dataset.card));
  };
});
updateServiceLabel();
$('btnMsgAdd').onclick = () => {
  const a = $('msgA').value.trim();
  if (!a) { $('msgA').focus(); return; }
  const b = $('msgB').value.trim();
  if ($('msgType').value === 'slide') pushName(a, b); else pushCard({ slot: 'message', kind: 'message', a, b });
};
$('cardMinutes').value = cardCfg.soonMinutes;
$('cardMinutes').onchange = () => { cardCfg.soonMinutes = Number($('cardMinutes').value) || 5; saveCards(); };
// QR code: the words and the link are set in Settings > QR code. The Give (QR) button on the Lower Thirds tab shows once a link is set.
function loadQrFields() { $('qrLabel').value = cardCfg.giveA || ''; $('qrSmall').value = cardCfg.giveB || ''; $('qrUrl').value = cardCfg.giveUrl || ''; }
[['qrLabel', 'giveA'], ['qrSmall', 'giveB'], ['qrUrl', 'giveUrl']].forEach(([id, key]) => {
  $(id).addEventListener('input', () => { cardCfg[key] = $(id).value; saveCards(); updateQuickButtons(); lookReplay.card = performance.now() - 5000; });
});
$('btnQrLook').onclick = () => { qcKind = 'give'; lookReplay.card = performance.now(); openSettings('cards'); buildCardsPage(); };
loadQrFields(); updateQuickButtons();
const CARD_KINDS = [['verse', 'Bible verse'], ['welcome', 'Welcome'], ['thanks', 'Thank you'], ['countdown', 'Service starting'], ['follow', 'Follow us'], ['give', 'Give (QR)'], ['message', 'Your own message']];
const CARD_TEXT = {
  verse: [],
  welcome: [['welcomeA', 'Big line'], ['welcomeB', 'Small line']],
  thanks: [['thanksA', 'Big line'], ['thanksB', 'Small line']],
  countdown: [['soonLabel', 'Words above the countdown'], ['serviceTime', 'Time the service starts (leave empty to hide the Until service starts button)', 'time']],
  follow: [['followTitle', 'Title'], ['yt', 'YouTube name (leave empty to skip)'], ['fb', 'Facebook name'], ['ig', 'Instagram name']],
  give: [],
  message: [],
};
function buildCardsPage() {
  const root = $('qcSampleControls');
  root.innerHTML = '';
  const textCard = mk('div', 'card'); textCard.appendChild(mk('h3', '', 'Words for: ' + SLOT_NAMES[qcKind]));
  if (qcKind === 'give') {
    textCard.appendChild(mk('div', 'small', 'The words and the link for the QR code are set in Settings > QR code. Here you choose how the card looks and moves.'));
    const row = mk('div', 'row'), go = mk('button', '', 'Open the QR code settings...'); go.onclick = () => openSettings('qr'); row.appendChild(go); textCard.appendChild(row);
  } else if (!CARD_TEXT[qcKind].length) textCard.appendChild(mk('div', 'small', qcKind === 'verse' ? 'The words come from the Bible tab. Here you choose how the verse looks.' : 'You type this one on the Lower Thirds tab each time you use it.'));
  CARD_TEXT[qcKind].forEach(([key, label, kind]) => {
    const w = mk('div', 'ctl'); w.appendChild(mk('label', '', label));
    const inp = mk('input'); inp.type = kind || 'text'; inp.value = cardCfg[key] || '';
    inp.oninput = () => { cardCfg[key] = inp.value; if (key === 'serviceTime') updateServiceLabel(); saveCards(); lookReplay.card = performance.now() - 5000; };
    w.appendChild(inp); textCard.appendChild(w);
  });
  root.appendChild(textCard);
  const lk = mk('div', 'lookctl'); lk.id = 'qcLook'; root.appendChild(lk);
  buildLookControls(qcKind);
  const kinds = $('qcKinds'); kinds.innerHTML = '';
  CARD_KINDS.forEach(([id, n]) => {
    const b = mk('button', 'small' + (qcKind === id ? ' primary' : ''), n); b.onclick = () => { qcKind = id; lookReplay.card = performance.now(); buildCardsPage(); }; kinds.appendChild(b);
  });
  const rp = mk('button', 'small', 'Replay animation'); rp.onclick = () => { lookReplay.card = performance.now(); }; kinds.appendChild(rp);
  const rs = mk('button', 'small', 'Reset this look'); rs.onclick = () => { setLook(qcKind, {}); saveLook(qcKind); buildCardsPage(); }; kinds.appendChild(rs);
}
const buildCardControls = buildCardsPage;

// Take a lower third off by itself after a while, if Settings says so.
const hideTimers = {};
function checkAutoHide() {
  live.items.forEach((it) => {
    if (!(it.type === 'name' || (it.type === 'card' && it.kind !== 'countdown')) || lookOfItem(it).autoHide <= 0 || hideTimers[it.id]) return;
    hideTimers[it.id] = setTimeout(() => { delete hideTimers[it.id]; if (live.items.some((i) => i.id === it.id)) removeLiveItem(it.id); }, lookOfItem(it).autoHide * 1000);
  });
}

// ---------- sound when a video plays on the stream ----------
function applyAudioMode() {
  try {
    if (!mx) return;
    const onStream = !!(liveBase() && liveBase().type === 'media'), mode = $('vidAudio').value;
    mx.cam.gain.value = onStream && mode === 'video' ? 0 : 1;      // the video replaces the microphone
    mx.vidStream.gain.value = onStream && mode !== 'device' ? 1 : 0; // or the microphone stays and the video is not sent
    mx.vidTv.gain.value = openScreens().some((s) => s.sent === 'media') ? 1 : 0; // screens showing the video hear it (each screen can turn its sound off)
  } catch (e) { /* not ready yet */ }
}
$('vidAudio').addEventListener('change', applyAudioMode);

// ---------- media engine: shelf, Play (Stream / TV / Both), queue, end-of-video ----------
function mkPlayer() {
  const el = document.createElement('video');
  el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous'; // files from the media folder need this so the Output stays clean
  const p = { el, clip: null, node: null };
  el.addEventListener('ended', () => { if (p === curPlayer()) onClipEnded(); });
  ['play', 'pause', 'timeupdate', 'loadedmetadata'].forEach((ev) => el.addEventListener(ev, () => { if (p === curPlayer()) updateMediaUI(); }));
  el.addEventListener('error', () => { if (p.clip) banner('That video could not be opened. MP4 (H.264) files work best.'); });
  return p;
}
const players = [mkPlayer(), mkPlayer()]; // the second one preloads the next video in the queue so there is no gap
let curP = 0;
const curPlayer = () => players[curP];
const clips = [];
let clipSeq = 1, qSeq = 1, qi = -1, selClipId = null;
const queue = [];
const pb = { clip: null, target: saved.target || 'stream' };
const clipById = (id) => clips.find((c) => c.id === id) || null;
const liveBase = () => live.items.find((i) => isBase(i.type)) || null;
const isPlayingNow = () => { const p = curPlayer(); return !!pb.clip && p.clip === pb.clip && !p.el.paused && !p.el.ended; };

// Draws a clip fitted inside a box: the live frame if it is the loaded video, otherwise its still picture.
function drawClipFrame(ctx, clipId, x, y, w, h) {
  const c = clipById(clipId);
  if (!c) return;
  const p = curPlayer();
  let el = null, sw = 0, sh = 0;
  if (c.kind === 'video' && p.clip === clipId && p.el.readyState >= 2 && p.el.videoWidth) { el = p.el; sw = el.videoWidth; sh = el.videoHeight; }
  else if (c.thumb && c.thumb.naturalWidth) { el = c.thumb; sw = el.naturalWidth; sh = el.naturalHeight; }
  if (!el) return;
  const k = Math.min(w / sw, h / sh);
  ctx.drawImage(el, x + (w - sw * k) / 2, y + (h - sh * k) / 2, sw * k, sh * k);
}
drawMediaItem = (ctx, it) => drawClipFrame(ctx, it.clipId, it.x, it.y, it.w, it.h);

function loadClip(id) {
  const cur = curPlayer();
  if (cur.clip === id) { pb.clip = id; applyLoop(); return cur; }
  try { cur.el.pause(); } catch (e) { /* ignore */ }
  if (players[1 - curP].clip === id) curP = 1 - curP; // it was already preloaded
  else setPlayerClip(cur, id);
  pb.clip = id; applyLoop();
  return curPlayer();
}
function setPlayerClip(p, id) {
  const c = clipById(id);
  p.clip = id;
  if (c && c.kind === 'video') p.el.src = c.url; else p.el.removeAttribute('src');
  p.el.load();
}
function applyLoop() { players.forEach((p, i) => { p.el.loop = i === curP && $('cLoop').checked; }); }
$('cLoop').addEventListener('change', applyLoop);
function preloadNext() {
  if (qi < 0 || qi + 1 >= queue.length) return;
  const id = queue[qi + 1].clipId, o = players[1 - curP], c = clipById(id);
  if (c && c.kind === 'video' && o.clip !== id) setPlayerClip(o, id);
}

// Play: puts the video where the chosen target is and starts it, all in one press. Nothing plays until this is pressed.
async function playTarget(target, clipId, fromQueue) {
  const c = clipById(clipId || selClipId);
  if (!c || c.kind !== 'video') { showModal('Pick a video', '<p>Pick a video from the shelf first (Videos &amp; Photos tab).</p>', [{ label: 'OK', cls: 'primary' }]); return; }
  const toTv = target === 'tv' || target === 'both', toStream = target === 'stream' || target === 'both';
  const sc = activeScreen();
  if (toTv && (!sc || !sc.open)) { screenNotOpen(sc); return; }
  const m = ensureMixer();
  pb.target = target; applyTargetSeg(); saveSettings();
  if (!fromQueue) qi = -1;
  if (selClipId !== c.id) { selClipId = c.id; renderClips(); }
  const p = loadClip(c.id);
  if (toStream) {
    endTech(false);
    const b = liveBase();
    if (!(b && b.type === 'media' && b.clipId === c.id)) setLiveBase('media', { clipId: c.id }, true, true); // the video goes to the Output only, never to Preview, and gets the whole screen
  }
  if (toTv) { sc.armed = 'media'; sendScreen(sc); }
  { try { await p.el.play(); } catch (e) { banner('Could not play this file: ' + e.message); } }
  preloadNext();
  applyAudioMode();
  renderQueue(); updateMediaUI(); updateDispUI();
  log(`PLAY ${c.name} -> ${target}`);
}
function applyEnd(which) { // what happens when a video is over (or stopped)
  if (which.stream) {
    const b = liveBase();
    if (b && b.type === 'media' && $('endStream').value === 'camera') setLiveBase('camera', null, true, true); // plain camera again
  }
  if (which.tv && $('endTv').value === 'black') openScreens().filter((s) => s.sent === 'media').forEach((s) => { s.armed = 'black'; sendScreen(s); });
}
function onClipEnded() {
  if ($('qAuto').checked && qi >= 0 && qi + 1 < queue.length) { qi++; playTarget(pb.target, queue[qi].clipId, true); return; }
  qi = -1; renderQueue();
  applyEnd({ stream: true, tv: true });
  updateMediaUI();
}
function stopPlayback() {
  const p = curPlayer();
  try { p.el.pause(); p.el.currentTime = 0; } catch (e) { /* ignore */ }
  qi = -1; renderQueue();
  applyEnd({ stream: true, tv: true });
  updateMediaUI();
}
function stopOnClear() { // CLEAR ALL also stops a video that is on the Output
  const b = liveBase();
  if (!b || b.type !== 'media') return;
  try { curPlayer().el.pause(); } catch (e) { /* ignore */ }
  qi = -1; renderQueue();
  applyEnd({ stream: false, tv: true });
  updateMediaUI();
}
function skipQueue() {
  if (qi >= 0 && qi + 1 < queue.length) { qi++; playTarget(pb.target, queue[qi].clipId, true); }
  else stopPlayback();
}

// ----- shelf -----
function makeThumb(c) {
  return new Promise((res) => {
    if (c.kind === 'image') { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { c.thumb = im; res(); }; im.onerror = () => { c.bad = true; res(); }; im.src = c.url; return; }
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.onloadedmetadata = () => { c.dur = v.duration; v.currentTime = Math.min(0.1, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360;
      const x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 640, 360);
      const k = Math.min(640 / v.videoWidth, 360 / v.videoHeight);
      x.drawImage(v, (640 - v.videoWidth * k) / 2, (360 - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k);
      const im = new Image(); im.onload = () => { c.thumb = im; res(); }; im.src = cv.toDataURL('image/jpeg', 0.85);
      v.removeAttribute('src'); v.load();
    };
    v.onerror = () => { c.bad = true; res(); };
    v.src = c.url;
  });
}
function addClipFile(f, pickMe) {
  const c = { id: clipSeq++, name: f.name.replace(/\.[^.]+$/, ''), kind: f.type.startsWith('video/') ? 'video' : 'image', url: URL.createObjectURL(f), dur: 0, thumb: null, ready: false, bad: false };
  clips.push(c);
  renderClips();
  makeThumb(c).then(() => { c.ready = true; renderClips(); if (pickMe && !c.bad) selectClip(c.id); });
}
// Videos and photos added by hand go on the shelf too (they stay until the app closes).
function addFiles(list) {
  const files = [...list].filter((f) => f.type.startsWith('video/') || f.type.startsWith('image/'));
  files.forEach((f, i) => addClipFile(f, i === 0));
}
function selectClip(id) {
  selClipId = id;
  const c = clipById(id);
  if (c && c.kind === 'image' && c.thumb) addPhoto(id, c.thumb.naturalWidth, c.thumb.naturalHeight); // photos are overlays in Preview
  renderClips(); updateMediaUI();
}
function stepClip(d) {
  const ready = clips.filter((c) => c.ready && !c.bad);
  if (!ready.length) return;
  const i = ready.findIndex((c) => c.id === selClipId);
  selectClip(ready[Math.max(0, Math.min(ready.length - 1, i < 0 ? 0 : i + d))].id);
}
const clipInUse = (id) => pb.clip === id || live.items.some((i) => i.clipId === id);
function dropClip(id) {
  const c = clipById(id);
  if (!c) return;
  if (!c.fromFolder) URL.revokeObjectURL(c.url);
  clips.splice(clips.indexOf(c), 1);
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].clipId === id) queue.splice(i, 1);
  players.forEach((p) => { if (p.clip === id) p.clip = null; });
  if (preview.items.some((i) => i.clipId === id)) { preview.items = preview.items.filter((i) => i.clipId !== id); preview.sel = null; commit(); }
  if (selClipId === id) selClipId = null;
}
function removeClip(id) {
  if (clipInUse(id)) { showModal('That one is in use', '<p>Stop it and press CLEAR ALL first, then remove it.</p>', [{ label: 'OK', cls: 'primary' }]); return; }
  dropClip(id);
  renderClips(); renderQueue(); updateMediaUI();
}
function renderClips() {
  const box = $('clipList');
  box.innerHTML = '';
  if (!clips.length) { box.innerHTML = '<div class="msg" style="grid-column:1/-1">Choose a media folder in Settings and its photos and videos appear here by themselves. Or press Add files for one-off files (they stay until the app closes).</div>'; return; }
  clips.forEach((c) => {
    const t = document.createElement('div');
    t.className = 'clip' + (c.id === selClipId ? ' sel' : '');
    const pic = c.thumb ? `<img src="${c.thumb.src}" alt="">` : '<div class="ph">Loading...</div>';
    const meta = c.bad ? 'Could not open' : c.ready ? `Ready${c.kind === 'video' ? ' - ' + fmtMs(c.dur) : ' - photo'}` : 'Loading...';
    t.innerHTML = `${pic}<div class="cname" title="${esc(c.name)}">${esc(c.name)}</div><div class="cmeta ${c.ready && !c.bad ? 'ok' : ''}">${c.ready && !c.bad ? '&#10003; ' : ''}${meta}</div>${c.kind === 'video' ? '<button class="cq">+ Queue</button>' : ''}${c.fromFolder ? '' : '<i title="Remove">x</i>'}`;
    t.onclick = (e) => {
      if (e.target.tagName === 'I') { removeClip(c.id); return; }
      if (e.target.classList.contains('cq')) { addToQueue(c.id); return; }
      if (c.ready && !c.bad) selectClip(c.id);
    };
    box.appendChild(t);
  });
}

// ----- media folder: everything in the chosen folder is on the shelf, and it is remembered between runs -----
let mediaState = { dir: '', exists: false, count: 0 };
let thumbActive = 0;
const thumbWaiting = [];
function queueThumb(c) { // a few at a time, so a big folder does not freeze the app
  const next = () => {
    while (thumbActive < 3 && thumbWaiting.length) {
      const k = thumbWaiting.shift();
      if (!clipById(k.id)) continue;
      thumbActive++;
      makeThumb(k).then(() => { k.ready = true; }).finally(() => { thumbActive--; renderClips(); next(); });
    }
  };
  thumbWaiting.push(c); next();
}
function syncFolder(r) {
  r = r || {};
  mediaState = { dir: r.dir || '', exists: !!r.exists, count: (r.files || []).length };
  const want = new Map((r.files || []).map((f, i) => [f.rel, Object.assign({ order: i }, f)]));
  clips.filter((c) => c.fromFolder && (c.dir !== mediaState.dir || !want.has(c.rel)) && !clipInUse(c.id)).forEach((c) => dropClip(c.id)); // gone from the folder (one that is playing stays until it is stopped)
  want.forEach((f) => {
    const have = clips.find((c) => c.fromFolder && c.rel === f.rel && c.dir === mediaState.dir);
    if (have) { have.order = f.order; return; }
    const c = { id: clipSeq++, name: f.name, kind: f.kind, url: f.url, rel: f.rel, dir: mediaState.dir, fromFolder: true, order: f.order, dur: 0, thumb: null, ready: false, bad: false };
    clips.push(c); queueThumb(c);
  });
  clips.sort((a, b) => (a.fromFolder ? a.order : 1e6 + a.id) - (b.fromFolder ? b.order : 1e6 + b.id));
  renderClips(); renderQueue(); updateMediaUI(); updateMediaFolderUI();
}
function updateMediaFolderUI() {
  const m = mediaState;
  $('mediaFolderNow').textContent = !m.dir ? 'No media folder chosen yet.' : !m.exists ? 'Folder not found: ' + m.dir : `Folder: ${m.dir}  -  ${m.count} photo${m.count === 1 ? '' : 's'} and video${m.count === 1 ? '' : 's'} found`;
  $('btnMediaFolderGo').textContent = m.dir ? 'Change in Settings' : 'Choose a folder in Settings';
  if (settingsPage === 'media') showMediaSettings();
}
function showMediaSettings() {
  const m = mediaState, st = $('mediaDirText');
  st.textContent = !m.dir ? 'No folder chosen yet' : !m.exists ? 'Folder not found: ' + m.dir + '  (is the drive connected?)' : m.dir;
  st.className = 'status ' + (!m.dir ? '' : m.exists ? 'good' : 'bad');
  const vids = clips.filter((c) => c.fromFolder && c.kind === 'video').length, pics = clips.filter((c) => c.fromFolder && c.kind === 'image').length;
  $('mediaCount').textContent = m.dir && m.exists ? `Found ${vids} video${vids === 1 ? '' : 's'} and ${pics} photo${pics === 1 ? '' : 's'}.` : '';
  $('btnMediaOpen').disabled = !m.dir || !m.exists; $('btnMediaClear').disabled = !m.dir; $('btnMediaRescan').disabled = !m.dir;
}
$('btnMediaChoose').onclick = async () => { const r = await window.api.mediaChoose(); if (!r.canceled) { syncFolder(r); log('Media folder: ' + (r.dir || 'none')); } };
$('btnMediaClear').onclick = async () => { syncFolder(await window.api.mediaClear()); log('Media folder cleared'); };
$('btnMediaRescan').onclick = async () => syncFolder(await window.api.mediaScan());
$('btnMediaOpen').onclick = () => window.api.mediaOpen();
$('btnMediaFolderGo').onclick = () => openSettings('media');
window.api.on('media:changed', (r) => syncFolder(r)); // files were added or removed in the folder
async function initMedia() { syncFolder(await window.api.mediaGet()); }

// ----- queue -----
function addToQueue(id) { const c = clipById(id || selClipId); if (!c || c.bad || c.kind !== 'video') return; queue.push({ q: qSeq++, clipId: c.id }); renderQueue(); }
function renderQueue() {
  const box = $('queueList');
  box.innerHTML = '';
  if (!queue.length) box.innerHTML = '<div class="msg">Press + Queue on a video to line them up. They play one after another with no gap.</div>';
  queue.forEach((e, idx) => {
    const c = clipById(e.clipId);
    const row = document.createElement('div');
    row.className = 'qrow' + (idx === qi ? ' now' : '');
    row.innerHTML = `<b>${idx + 1}</b><span>${esc(c ? c.name : '?')}${idx === qi ? ' (playing)' : ''}</span><i title="Remove">x</i>`;
    row.onclick = (ev) => {
      if (ev.target.tagName === 'I') { queue.splice(idx, 1); if (qi >= idx) qi--; renderQueue(); return; }
      qi = idx; playTarget(pb.target, e.clipId, true);
    };
    box.appendChild(row);
  });
  const nxt = qi >= 0 && queue[qi + 1] ? clipById(queue[qi + 1].clipId) : null;
  $('qInfo').textContent = nxt ? 'Up next: ' + nxt.name : '';
  applyQueueOpen();
}
let qOpen = localStorage.getItem('qOpen') !== '0';
function applyQueueOpen() {
  $('queueCol').classList.toggle('closed', !qOpen);
  document.querySelector('#paneMedia .content').classList.toggle('qclosed', !qOpen);
  $('btnQueueToggle').innerHTML = (qOpen ? '&#9662; ' : '&#9656; ') + 'Queue' + (!qOpen && queue.length ? ` (${queue.length})` : '');
}
$('btnQueueToggle').onclick = () => { qOpen = !qOpen; try { localStorage.setItem('qOpen', qOpen ? '1' : '0'); } catch (e) { /* ignore */ } applyQueueOpen(); };
$('qPlay').onclick = () => { if (!queue.length) return; qi = 0; playTarget(pb.target, queue[0].clipId, true); };
$('qSkip').onclick = skipQueue;
$('qClear').onclick = () => { queue.length = 0; qi = -1; renderQueue(); };
$('cQueueAdd').onclick = () => addToQueue();

// ----- Content tab controls -----
function applyTargetSeg() { document.querySelectorAll('#targetSeg button').forEach((b) => b.classList.toggle('on', b.dataset.t === pb.target)); }
document.querySelectorAll('#targetSeg button').forEach((b) => { b.onclick = () => { pb.target = b.dataset.t; applyTargetSeg(); saveSettings(); }; });
$('btnClipAdd').onclick = () => $('clipFile').click();
$('clipFile').onchange = () => { addFiles($('clipFile').files); $('clipFile').value = ''; };
function togglePlay(target) {
  if (isPlayingNow() && pb.clip === selClipId) curPlayer().el.pause();
  else playTarget(target, selClipId);
}
$('cPlay').onclick = () => togglePlay(pb.target);
$('pAdd').onclick = () => { const c = clipById(selClipId); if (c && c.thumb) addPhoto(c.id, c.thumb.naturalWidth, c.thumb.naturalHeight); };
$('pPhotoTv').onclick = () => { const s = activeScreen(); if (!s || !s.open) { screenNotOpen(s); return; } s.armed = 'media'; sendScreen(s); };
$('cStop').onclick = stopPlayback;
function seekTo(v) { const p = curPlayer(); if (p.clip === selClipId && p.el.duration) p.el.currentTime = v / 1000 * p.el.duration; }
$('cSeek').oninput = () => seekTo($('cSeek').value);
$('dispSeek').oninput = () => seekTo($('dispSeek').value);
function updateMediaUI() {
  const c = clipById(selClipId), p = curPlayer();
  const mine = p.clip === selClipId && !!c;
  const label = isPlayingNow() && pb.clip === selClipId ? 'Pause' : 'Play';
  $('cPlay').textContent = label;
  $('btnDispPlay').textContent = label === 'Pause' ? 'Pause' : 'Play here';
  $('cNow').textContent = c ? c.name : 'Pick a video from the shelf';
  const dur = mine && p.el.duration ? p.el.duration : (c ? c.dur : 0);
  const pos = mine ? p.el.currentTime : 0;
  [['cSeek', 'cTime'], ['dispSeek', 'dispTime']].forEach(([s, t]) => {
    if (document.activeElement !== $(s)) $(s).value = dur ? Math.round(pos / dur * 1000) : 0;
    $(t).textContent = `${fmtMs(pos)} / ${fmtMs(dur)}`;
  });
  { const s = activeScreen(); $('vidCtl').hidden = !(c && c.kind === 'video' && s && s.armed === 'media'); }
  $('playVideo').hidden = !(c && c.kind === 'video');
  $('playPhoto').hidden = !(c && c.kind === 'image');
  $('playHead').textContent = c && c.kind === 'image' ? 'Photo' : 'Play';
}
function fmtMs(s) { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// ---------- External displays: any number of monitors, each showing its own thing ----------
// Each monitor gets its own window, its own source, its own sound setting and its own picture link.
const dispCanvas = $('dispCanvas'), dctx = dispCanvas.getContext('2d');
const SRC_NAMES = { live: 'Output', preview: 'Preview', media: 'Video/photo', pattern: 'Test pattern', black: 'Black', off: 'off' };
const isPicture = (s) => s === 'live' || s === 'preview' || s === 'media';
const screens = new Map(); // display id -> screen
let activeId = null, dispLast = 0;
const activeScreen = () => screens.get(activeId) || null;
const openScreens = () => [...screens.values()].filter((s) => s.open);
const screenClip = (s) => (s && s.img) || pb.clip || selClipId; // a photo on that screen, or the loaded video
function mkScreen(d) {
  const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
  return { id: d.id, label: d.label, isMain: d.isMain, open: false, armed: 'live', sent: 'off', img: null, mute: false, link: { pc: null, ready: false }, cv, ctx: cv.getContext('2d'), last: 0 };
}
// Names and hidden screens are remembered between runs.
const screenPrefs = readStore('screenPrefs', {});
const saveScreenPrefs = () => { try { localStorage.setItem('screenPrefs', JSON.stringify(screenPrefs)); } catch (e) { /* ignore */ } };
const isHiddenScreen = (s) => !!(screenPrefs[s.id] && screenPrefs[s.id].hidden);
const visibleScreens = () => [...screens.values()].filter((s) => !isHiddenScreen(s));
function screenName(s) { const p = screenPrefs[s.id]; return (p && p.name) || screenShort(s); }
function pickActiveScreen() {
  const cur = screens.get(activeId);
  if (cur && !isHiddenScreen(cur)) return;
  const vis = visibleScreens();
  const first = vis.find((s) => !s.isMain) || vis[0];
  activeId = first ? first.id : null;
}
async function refreshScreens() {
  const list = await window.api.listDisplays();
  list.forEach((d) => { const s = screens.get(d.id); if (s) { s.label = d.label; s.isMain = d.isMain; } else screens.set(d.id, mkScreen(d)); });
  [...screens.keys()].forEach((id) => { if (!list.some((d) => d.id === id)) { stopLink(screens.get(id), false); screens.delete(id); } });
  pickActiveScreen();
  renderScreens(); renderScreenManager(); updateDispUI();
}
function renameScreen(s) {
  showModal('Rename this screen', `<p>${esc(screenShort(s))}</p><input type="text" id="renameIn" maxlength="40" placeholder="${esc(screenShort(s))}" value="${esc((screenPrefs[s.id] && screenPrefs[s.id].name) || '')}"><div class="small">Leave it empty to go back to the original name.</div>`, [
    { label: 'Cancel', cls: 'ghost' },
    { label: 'Save name', cls: 'primary', onClick: () => {
      const v = $('renameIn').value.trim().slice(0, 40);
      screenPrefs[s.id] = Object.assign({}, screenPrefs[s.id], { name: v });
      saveScreenPrefs(); renderScreens(); renderScreenManager(); updateDispUI();
    } },
  ]);
  const input = $('renameIn');
  input.onkeydown = (e) => { if (e.key === 'Enter') { const ok = $('mBtns').lastChild; if (ok) ok.click(); } }; // Enter saves
  input.focus(); input.select();
}
function setScreenHidden(s, hide) {
  if (hide && s.open) closeScreen(s); // a hidden screen is never left showing something
  screenPrefs[s.id] = Object.assign({}, screenPrefs[s.id], { hidden: hide });
  saveScreenPrefs(); pickActiveScreen();
  renderScreens(); renderScreenManager(); updateDispUI(); updateMediaUI();
}
function renderScreenManager() {
  const box = $('screenManage');
  if (!box) return;
  box.innerHTML = '';
  if (!screens.size) box.innerHTML = '<div class="small">No monitors found.</div>';
  screens.forEach((s) => {
    const hid = isHiddenScreen(s), c = mk('div', 'scard manage' + (hid ? ' dim' : ''));
    c.innerHTML = `<div class="sname">${esc(screenName(s))}${hid ? ' <em>hidden</em>' : ''}</div><div class="sstat">${esc(screenShort(s))}${s.isMain ? ' - this is the main screen' : ''}</div>`;
    const acts = mk('div', 'sacts');
    const rn = mk('button', 'small', 'Rename'); rn.onclick = () => renameScreen(s);
    const hd = mk('button', 'small', hid ? 'Show' : 'Hide'); hd.onclick = () => setScreenHidden(s, !hid);
    acts.appendChild(rn); acts.appendChild(hd); c.appendChild(acts);
    box.appendChild(c);
  });
}
$('btnScreensManage').onclick = () => openSettings('screens');
$('btnScreensRefresh').onclick = refreshScreens;
function drawBars(ctx, w, h) {
  const cols = ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f'];
  cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * w / 7, 0, w / 7 + 1, h * 0.7); });
  const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
  ctx.fillStyle = g; ctx.fillRect(0, h * 0.7, w, h * 0.12);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `bold ${h * 0.07}px "Segoe UI", Arial`;
  ctx.fillText('TEST PATTERN', w / 2, h * 0.93); ctx.textAlign = 'left';
}
function drawSource(ctx, src, w, h, clipId) {
  if (src === 'live') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); ctx.drawImage(liveCanvas, 0, 0, w, h); }
  else if (src === 'preview') drawList(ctx, preview.items.map((i) => ({ i, a: 1 })), w, h);
  else {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    if (src === 'media') {
      if (clipId) drawClipFrame(ctx, clipId, 0, 0, w, h);
      else { ctx.fillStyle = '#666'; ctx.textAlign = 'center'; ctx.font = `${h * 0.05}px "Segoe UI", Arial`; ctx.fillText('Pick a video or photo in Videos & Photos', w / 2, h / 2); ctx.textAlign = 'left'; }
    } else if (src === 'pattern') drawBars(ctx, w, h);
  }
}
function drawDisplayFrames(now) {
  if (view === 'TV' && now - dispLast >= 30) {
    dispLast = now;
    const s = activeScreen();
    if (s) drawSource(dctx, s.armed, dispCanvas.width, dispCanvas.height, s.armed === 'media' ? selClipId : null);
    else { dctx.fillStyle = '#000'; dctx.fillRect(0, 0, dispCanvas.width, dispCanvas.height); }
  }
  if (view === 'Settings' && settingsPage === 'lower') drawLookSample('name', now);
  if (view === 'Settings' && settingsPage === 'cards') drawLookSample('card', now);
  screens.forEach((s) => {
    if (s.link.pc && isPicture(s.sent) && now - s.last >= 1000 / 30 - 3) { s.last = now; drawSource(s.ctx, s.sent, s.cv.width, s.cv.height, screenClip(s)); }
  });
}

// ----- the private link to each external window -----
function stopLink(s, tell = true) {
  if (!s) return;
  if (s.link.pc) { try { s.link.pc.close(); } catch (e) { /* ignore */ } }
  s.link.pc = null;
  if (tell && s.open) window.api.rtcSignal(s.id, { type: 'close' });
}
async function startLink(s) {
  if (!s.link.ready) return;
  stopLink(s, false);
  try {
    const m = ensureMixer();
    const stream = s.cv.captureStream(30);
    m.tvDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const pc = new RTCPeerConnection({ iceServers: [] });
    s.link.pc = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => { if (e.candidate) window.api.rtcSignal(s.id, { type: 'ice', candidate: e.candidate.toJSON() }); };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    window.api.rtcSignal(s.id, { type: 'offer', sdp: offer.sdp });
    pc.getSenders().filter((x) => x.track && x.track.kind === 'video').forEach(async (x) => {
      try { const p = x.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = 12e6; await x.setParameters(p); } catch (e) { /* ignore */ }
    });
    log('External display picture link started: ' + s.label);
  } catch (e) { banner('Could not start the picture for that screen: ' + e.message); stopLink(s); }
}
let rtcQueue = Promise.resolve();
window.api.on('rtc:signal', (p) => {
  const s = screens.get(p.id), m = p.msg;
  if (!s) return;
  rtcQueue = rtcQueue.then(async () => {
    if (m.type === 'ready') { s.link.ready = true; if (s.open) applyScreen(s, false); } // the window is up: show what is selected
    else if (m.type === 'answer' && s.link.pc) await s.link.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
    else if (m.type === 'ice' && s.link.pc) await s.link.pc.addIceCandidate(m.candidate);
  }).catch((e) => log('External link: ' + e.message));
});

// ----- opening, closing, sending -----
function pushScreen(s) { window.api.setTv(s.id, { mode: isPicture(s.sent) ? 'stream' : s.sent, text: '', mute: s.mute }); }
function screenNotOpen(s) {
  showModal('That screen is not open', '<p>Open the screen first. Use Open on the screen in the list.</p>', [
    { label: 'Cancel', cls: 'ghost' }, ...(s ? [{ label: 'Open it now', cls: 'primary', onClick: () => openScreen(s) }] : []),
  ]);
}
async function openScreen(s) {
  const go = async () => {
    const r = await window.api.openTv(s.id);
    if (r.ok) { s.open = true; s.link.ready = false; s.sent = 'off'; } // shows what is selected as soon as the window says it is ready
    else banner('Could not open that screen: ' + r.error);
    updatePills(); renderScreens(); updateDispUI();
  };
  if (s.isMain) showModal('Main screen', '<p>That is your main screen, so it opens as a small test window instead of covering this app.</p>', [{ label: 'Cancel', cls: 'ghost' }, { label: 'Open test window', cls: 'primary', onClick: go }]);
  else await go();
}
function closeScreen(s) { window.api.closeTv(s.id); }
window.api.on('tv:closed', (id) => {
  const s = screens.get(id);
  if (!s) return;
  s.open = false; s.link.ready = false; stopLink(s, false); s.sent = 'off';
  applyAudioMode(); updatePills(); renderScreens(); updateDispUI();
});
const mediaInUse = () => { const b = liveBase(); return (b && b.type === 'media') || openScreens().some((s) => s.sent === 'media'); };
// interactive = the person pressed SEND (so explain problems); otherwise it is the screen opening
function applyScreen(s, interactive) {
  let src = s.armed;
  if (src === 'media') {
    const sc = clipById(selClipId);
    if (!sc && !pb.clip) { if (interactive) { showModal('Nothing chosen', '<p>Pick a video or photo in Videos &amp; Photos first.</p>', [{ label: 'OK', cls: 'primary' }]); return; } src = 'black'; }
    else if (sc && sc.kind === 'image') s.img = sc.id; // a photo never touches the video player
    else { s.img = null; if (selClipId && selClipId !== pb.clip) loadClip(selClipId); } // loaded paused: it only plays when Play is pressed
  }
  const was = s.sent;
  if (was === 'media' && src !== 'media' && pb.target === 'tv' && !openScreens().some((o) => o !== s && o.sent === 'media')) { try { curPlayer().el.pause(); } catch (e) { /* ignore */ } }
  s.sent = src;
  pushScreen(s);
  if (isPicture(src)) { if (!s.link.pc) startLink(s); } else stopLink(s);
  applyAudioMode(); updatePills();
  log(`External display ${screenName(s)}: ${SRC_NAMES[src]}`);
  renderScreens(); updateDispUI(); updateMediaUI();
}
function sendScreen(s) {
  s = s || activeScreen();
  if (!s) { showModal('No screen', '<p>No external monitor was found. Plug one in and press Refresh in Settings > Status &amp; log.</p>', [{ label: 'OK', cls: 'primary' }]); return; }
  if (!s.open) { screenNotOpen(s); return; }
  applyScreen(s, true);
}
function screenShort(s) { return s.label.replace(/ - MAIN SCREEN/, '').replace(/ at \(.*\)/, ''); }
function renderScreens() {
  const box = $('screenList');
  box.innerHTML = '';
  if (!screens.size) box.innerHTML = '<div class="small">No monitors found.</div>';
  else if (!visibleScreens().length) box.innerHTML = '<div class="small">All screens are hidden. Show them again in Settings &gt; Screens.</div>';
  visibleScreens().forEach((s) => {
    const c = mk('div', 'scard' + (s.id === activeId ? ' on' : ''));
    c.innerHTML = `<div class="sname"><i class="dot${s.open ? ' blue' : ''}"></i>${esc(screenName(s))}</div><div class="sstat">${s.isMain ? 'This screen - ' : ''}${s.open ? 'Showing: ' + SRC_NAMES[s.sent] : 'Off'}</div>`;
    const b = mk('button', s.open ? '' : 'primary', s.open ? 'Close' : 'Open');
    b.onclick = (e) => { e.stopPropagation(); if (s.open) closeScreen(s); else openScreen(s); };
    c.appendChild(b);
    c.onclick = () => { activeId = s.id; renderScreens(); updateDispUI(); updateMediaUI(); };
    box.appendChild(c);
  });
}
function updateDispUI() {
  const s = activeScreen(), n = openScreens().length;
  document.querySelectorAll('#viewTV .srcs button').forEach((b) => b.classList.toggle('on', !!s && b.dataset.src === s.armed));
  $('btnDispSend').disabled = !s;
  $('screenAudio').checked = !!s && !s.mute; $('screenAudio').disabled = !s;
  $('btnDispSend').classList.toggle('ready', !!s && (s.armed !== s.sent || !s.open));
  $('dispSendSub').textContent = !s ? 'No screen' : s.armed === s.sent && s.open ? `${SRC_NAMES[s.armed]} is on this screen` : `Put ${SRC_NAMES[s.armed]} on this screen`;
  $('dispNow').textContent = n ? `${n} screen${n > 1 ? 's' : ''} on` : 'Off';
  $('tvDot').className = 'dot' + (s && s.open ? ' blue' : '');
  $('tvNote').textContent = !s ? (screens.size ? 'All screens are hidden. Show one again in Settings > Screens.' : 'No external monitor was found.') : s.open ? `${screenName(s)} is showing: ${SRC_NAMES[s.sent]}. This picture is what SEND will put up.` : `${screenName(s)} is off. Press Open on it in the list.`;
  $('btnDisplay').classList.toggle('live', n > 0);
}
document.querySelectorAll('#viewTV .srcs button').forEach((b) => { b.onclick = () => { const s = activeScreen(); if (!s) return; s.armed = b.dataset.src; updateDispUI(); updateMediaUI(); }; });
$('btnDisplay').onclick = () => setView('TV');
$('btnDispSend').onclick = () => sendScreen();
$('screenAudio').onchange = () => { const s = activeScreen(); if (!s) return; s.mute = !$('screenAudio').checked; if (s.open) pushScreen(s); };
$('btnDispPlay').onclick = () => togglePlay('tv');
$('btnDispRestart').onclick = () => { const p = curPlayer(); if (p.clip === selClipId) p.el.currentTime = 0; };
$('btnTvRefresh').onclick = refreshScreens;

// ---------- encoders ----------
const ENC_LABELS = {
  h264_nvenc: 'NVIDIA graphics card (NVENC)',
  h264_amf: 'AMD graphics card (AMF)',
  h264_qsv: 'Intel graphics (QuickSync)',
  libx264: 'CPU only (x264) - heavier on the PC',
};
let encoderChecked = false;
$('btnFF').onclick = async () => {
  $('ffInfo').textContent = 'Checking this PC...';
  const r = await window.api.checkFfmpeg();
  if (!r.found) { const m = 'ffmpeg NOT FOUND. Close the app and run START.bat again so it can download it.'; $('ffInfo').textContent = m; log(m); return; }
  const sel = $('encoder');
  sel.innerHTML = '';
  r.working.forEach((e) => sel.add(new Option(ENC_LABELS[e], e)));
  sel.add(new Option(ENC_LABELS.libx264, 'libx264'));
  if (saved.encoder && [...sel.options].some((o) => o.value === saved.encoder)) sel.value = saved.encoder;
  else sel.value = r.working.length ? r.working[0] : 'libx264';
  encoderChecked = true;
  saveSettings();
  let msg;
  if (r.working.length) msg = `${r.version.split(' Copyright')[0]}. Working graphics encoder: ${r.working.map((e) => ENC_LABELS[e]).join(', ')}. Selected: ${ENC_LABELS[sel.value]}.`;
  else {
    msg = `${r.version.split(' Copyright')[0]}. NO graphics-card encoder works on this PC, so the CPU encoder is selected.`;
    banner('No graphics-card encoder works on this PC (the CPU encoder was selected). Update the graphics driver, then double-click RESET-FFMPEG.bat.');
    (r.failed || []).forEach((f) => log(`${f.name} failed: ${f.msg}`));
  }
  $('ffInfo').textContent = msg;
  log('Encoder check: ' + msg);
};
$('btnRecs').onclick = () => window.api.openRecordings();
async function showRecDir() { $('recDirText').textContent = await window.api.recDir(); }
$('btnRecChoose').onclick = async () => { const r = await window.api.chooseRecDir(); if (r.ok) { try { localStorage.setItem('recDir', r.dir); } catch (e) { /* ignore */ } } showRecDir(); };
$('btnRecDefault').onclick = async () => { try { localStorage.removeItem('recDir'); } catch (e) { /* ignore */ } await window.api.setRecDir(''); showRecDir(); };
$('outMode').addEventListener('change', () => { if (!streaming) $('btnStream').textContent = startText(); updatePills(); });

// ---------- streaming ----------
let recorder = null, outStream = null, chain = Promise.resolve();
let streaming = false, userStopped = false, streamStart = 0, samples = [], lastRecording = '';
let latestMetrics = { cpu: 0, ff: {} };

function pickMime() {
  return ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
}
let ytState = { hasClient: false, signedIn: false, channel: '' };
let currentDest = 'none', currentBroadcast = null;
// What pressing Start does: stream and keep a backup copy, stream only, or just record to this PC.
const outMode = () => $('outMode').value;
const recordOnly = () => outMode() === 'record';
const startText = () => (recordOnly() ? 'START RECORDING' : 'START STREAM');
const stopText = () => (recordOnly() ? 'STOP RECORDING' : 'STOP STREAM');
function effectiveDest() {
  if (recordOnly()) return 'record';
  if (ytState.signedIn) return 'youtube'; // once connected, YouTube is the destination and the manual choices are hidden
  const m = $('destMode').value;
  if (m === 'file') return 'file';
  if (m === 'rtmp') return $('url').value.trim() && $('key').value.trim() ? 'rtmp' : 'none';
  if (ytState.signedIn) return 'youtube';
  return $('url').value.trim() && $('key').value.trim() ? 'rtmp' : 'none';
}
function ytTemplate() {
  return { title: $('ytTitle').value, description: $('ytDesc').value, privacy: $('ytPrivacy').value, dvr: $('ytDvr').checked, latency: $('ytLatency').value };
}
function readStreamOpts() {
  const d = effectiveDest();
  return {
    dest: d === 'file' ? 'file' : d === 'record' ? 'record' : 'rtmp', url: $('url').value.trim(), key: $('key').value.trim(), encoder: $('encoder').value,
    bitrate: Number($('bitrate').value) || 6000, fps: Number($('fps').value) || 30, record: outMode() !== 'stream',
  };
}

async function requestStart() {
  const o = readStreamOpts();
  const dest = effectiveDest();
  const lines = [];
  const add = (state, text) => lines.push({ state, text });
  add(videoReady ? 'ok' : 'no', videoReady ? 'Camera is working' : 'Camera is not running (open Settings)');
  if (!audioTrack) add('wn', 'No audio source selected');
  else add(audioDb > -75 ? 'ok' : 'wn', audioDb > -75 ? 'Audio is coming in' : 'Audio is very quiet - is the right source selected?');
  if (dest === 'youtube') {
    add('ok', `YouTube: signed in as ${ytState.channel}`);
    add('ok', 'Title: ' + (await window.api.ytExpand($('ytTitle').value)) + ` (${$('ytPrivacy').value})`);
  } else if (dest === 'record') add('ok', 'Recording only: nothing is sent to the internet');
  else if (dest === 'rtmp') add('ok', 'Using the manual stream URL and key');
  else if (dest === 'file') add('wn', 'Saving to a test file on this PC (not live on the internet)');
  else add('no', 'No place to stream to. Sign in with YouTube in Settings.');
  add(encoderChecked ? 'ok' : 'wn', 'Encoder: ' + (ENC_LABELS[o.encoder] || o.encoder));
  if (o.record && dest !== 'file') {
    const free = await window.api.diskFree();
    const what = dest === 'record' ? 'Recording' : 'Backup recording', where = await window.api.recDir();
    if (free === null) add('wn', `${what} is on (could not check disk space)`);
    else if (free < 10e9) add('wn', `${what} is on, but only ${(free / 1e9).toFixed(1)} GB is free on this PC`);
    else add('ok', `${what} is on (${(free / 1e9).toFixed(0)} GB free). Saved in ${where}`);
  }
  const blocked = lines.some((l) => l.state === 'no');
  const mark = { ok: 'OK', no: 'FIX', wn: 'CHECK' };
  const html = lines.map((l) => `<div class="check-line ${l.state}"><b>${mark[l.state]}</b><span>${esc(l.text)}</span></div>`).join('');
  const buttons = [{ label: 'Cancel', cls: 'ghost' }];
  if (blocked) buttons.push({ label: 'Open Settings', cls: 'primary', onClick: () => openSettings('cam') });
  else buttons.push({ label: dest === 'file' ? 'START TEST' : startText(), cls: 'primary', onClick: beginStream });
  showModal(blocked ? 'Not ready yet' : 'Ready to start?', html, buttons);
}

async function beginStream() {
  const o = readStreamOpts();
  const dest = effectiveDest();
  currentDest = dest; currentBroadcast = null;
  if (dest === 'youtube') {
    $('streamStatus').textContent = 'Creating your YouTube broadcast...';
    const p = await window.api.ytPrepare(ytTemplate());
    if (!p.ok) { banner(p.error); $('streamStatus').textContent = 'Not streaming'; return; }
    currentBroadcast = p;
    o.url = p.url; o.key = p.key;
    log(`YouTube broadcast created: ${p.title} ${p.watchUrl}`);
  }
  const r = await window.api.startStream(o);
  if (!r.ok) { banner('Could not start: ' + r.error); if (currentBroadcast) window.api.ytEnd(currentBroadcast.broadcastId); return; }
  lastRecording = r.recording || '';
  log(`ffmpeg started (${r.encoder}) -> ${r.display}${r.recording ? ' + recording ' + r.recording : ''}`);
  startRecorder(o);
}

function startRecorder(o) {
  outStream = liveCanvas.captureStream(o.fps);
  streamAudio = ensureMixer().streamDest.stream.getAudioTracks()[0].clone();
  outStream.addTrack(streamAudio);
  const mimeType = pickMime();
  recorder = new MediaRecorder(outStream, { mimeType, videoBitsPerSecond: 12e6, audioBitsPerSecond: 128e3 });
  chain = Promise.resolve();
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chain = chain.then(() => e.data.arrayBuffer()).then((b) => window.api.sendChunk(b));
  };
  recorder.onstop = async () => {
    await chain;
    await window.api.stopStream();
    outStream.getTracks().forEach((t) => t.stop());
    streamAudio = null;
  };
  recorder.start(200);
  streaming = true; userStopped = false; streamStart = Date.now(); samples = []; longFramesTotal = 0;
  liveCanvas.classList.add('onair');
  const b = $('btnStream'); b.textContent = stopText(); b.classList.add('stop');
  $('summary').textContent = recordOnly() ? 'Recording...' : 'Stream running...';
}

$('btnStream').onclick = () => {
  if (!streaming) { requestStart(); return; }
  showModal(currentDest === 'record' ? 'Stop recording?' : 'Stop the stream?', currentDest === 'record' ? '<p>The recording will be saved.</p>' : '<p>Viewers will see the stream end.</p>', [
    { label: currentDest === 'record' ? 'Keep recording' : 'Keep streaming', cls: 'ghost' },
    { label: currentDest === 'record' ? 'STOP RECORDING' : 'STOP STREAM', cls: 'primary', onClick: () => { userStopped = true; if (recorder && recorder.state !== 'inactive') recorder.stop(); } },
  ]);
};

window.api.on('stream:ended', (e) => {
  const was = streaming;
  streaming = false;
  liveCanvas.classList.remove('onair');
  const b = $('btnStream'); b.textContent = startText(); b.classList.remove('stop');
  if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (err) { /* ignore */ } }
  if (!was) return;
  if (currentBroadcast) { window.api.ytEnd(currentBroadcast.broadcastId); }
  if (userStopped) $('streamStatus').textContent = currentDest === 'record' ? 'Recording saved: ' + lastRecording : 'Stream ended.' + (lastRecording ? ' Backup recording saved.' : '');
  else {
    $('streamStatus').textContent = `STREAM STOPPED UNEXPECTEDLY (code ${e.code}${e.error ? ', ' + e.error : ''}).`;
    banner(currentDest === 'record' ? 'The recording stopped unexpectedly. What was recorded so far should be saved. Check the disk space, then press START RECORDING again.' : 'The stream stopped unexpectedly. Check the internet and the stream key, then press START STREAM again. A backup recording may have been saved.');
  }
  showSummary();
});
window.api.on('ffmpeg:log', (line) => log('ffmpeg: ' + line));

// ---------- metrics, stats, summary ----------
window.api.on('metrics', (m) => {
  latestMetrics = m;
  const ff = m.ff || {};
  const elapsed = streaming ? (Date.now() - streamStart) / 1000 : 0;
  if (streaming) {
    samples.push({ t: elapsed, cpu: m.cpu, fps: ff.fps, speed: ff.speed, drop: ff.drop, frame: ff.frame, queued: ff.queued });
    const ok = ff.running && ff.speed > 0.95;
    $('streamStatus').textContent = `${ok ? (currentDest === 'record' ? 'Recording' : 'On air') : 'Starting / trouble'} - ${fmtTime(elapsed)} - ${Math.round(ff.bitrate || 0)} kbps${outMode() === 'both' && currentDest !== 'file' && currentDest !== 'record' ? ' - backup recording ON' : ''}${currentBroadcast ? ' - ' + currentBroadcast.watchUrl : ''}`;
  }
  updatePills();
  if (view !== 'Settings' || settingsPage !== 'status') return;
  const rows = [
    ['Stream running time', streaming ? fmtTime(elapsed) : '-'],
    ['Whole PC CPU use (includes ffmpeg)', m.cpu.toFixed(1) + ' %'],
    ['Camera frames per second', videoReady ? camFpsNow : '-'],
    ['Camera frame gaps (should stay near 0)', videoReady ? camGaps : '-'],
    ['Live picture redraw rate', renderFps + ' per sec'],
    ['Slow redraws (over 40 ms) this stream', longFramesTotal],
    ['Encoder frames per second', ff.running ? ff.fps : '-'],
    ['Encoder speed (1.00x is perfect)', ff.running ? ff.speed.toFixed(2) + 'x' : '-'],
    ['Frames dropped by encoder', ff.running ? ff.drop : '-'],
    ['Stream bitrate', ff.running ? Math.round(ff.bitrate) + ' kbps' : '-'],
    ['Data waiting for encoder (should stay near 0)', ff.running ? Math.round((ff.queued || 0) / 1024) + ' KB' : '-'],
  ];
  $('stats').innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
});

setInterval(() => {
  window.api.logRow({
    elapsed: streaming ? Math.round((Date.now() - streamStart) / 1000) : 0,
    renderFps, longFrames, camFps: camFpsNow, camDropped: camGaps, audioDb: Math.round(audioDb),
  });
  longFrames = 0;
}, 10000);

function showSummary() {
  const s = samples.filter((x) => x.t > 10);
  const dur = (Date.now() - streamStart) / 1000;
  if (!s.length) { $('summary').textContent = `Stream ran ${fmtTime(dur)} - too short for a result (needs over 10 seconds).`; return; }
  const fps = Number($('fps').value) || 30;
  const minFps = Math.min(...s.map((x) => x.fps));
  const avgSpeed = s.reduce((a, x) => a + x.speed, 0) / s.length;
  const last = samples[samples.length - 1];
  const dropPct = last.frame ? (last.drop / last.frame) * 100 : 0;
  const avgCpu = s.reduce((a, x) => a + x.cpu, 0) / s.length;
  const maxCpu = Math.max(...s.map((x) => x.cpu));
  const maxQ = Math.max(...s.map((x) => x.queued || 0));
  const checks = [
    [dur >= 3600, `Ran ${fmtTime(dur)} (goal: 1 hour or more)`],
    [minFps >= fps - 1.5, `Lowest encoder fps ${minFps} (goal: ${fps - 1} or higher)`],
    [avgSpeed > 0.97 && avgSpeed < 1.03, `Average encoder speed ${avgSpeed.toFixed(2)}x (goal: 0.97 to 1.03)`],
    [dropPct <= 0.1, `Frames dropped by encoder ${last.drop} = ${dropPct.toFixed(2)}% (goal: 0.1% or less)`],
    [longFramesTotal <= 10, `Slow redraws ${longFramesTotal} (goal: 10 or fewer)`],
    [avgCpu < 70, `Whole PC CPU average ${avgCpu.toFixed(0)}%, peak ${maxCpu.toFixed(0)}% (goal: under 70%)`],
    [maxQ < 2 * 1024 * 1024, `Largest backlog waiting for encoder ${Math.round(maxQ / 1024)} KB (goal: under 2048 KB)`],
  ];
  $('summary').innerHTML = checks.map((c) => `<div class="check-line ${c[0] ? 'ok' : 'no'}"><b>${c[0] ? 'PASS' : 'CHECK'}</b><span>${esc(c[1])}</span></div>`).join('');
}

// ---------- YouTube sign-in and template ----------
async function refreshYt() {
  const r = await window.api.ytStatus();
  if (r.ok) ytState = { hasClient: r.hasClient, signedIn: r.signedIn, channel: r.channel };
  if (ytState.signedIn) setStatus('ytInfo', `Connected as ${ytState.channel || 'your channel'}. The connection is saved on this PC and stays after restarts. New streams are created automatically.`, 'good');
  else if (!ytState.hasClient) setStatus('ytInfo', 'One-time setup needed first: see YouTube connection below.', 'warn');
  else setStatus('ytInfo', 'Not signed in. Press the button to connect your channel.', 'warn');
  $('btnYtSign').textContent = ytState.signedIn ? 'Disconnect YouTube' : 'Sign in with YouTube';
  $('btnYtSign').className = ytState.signedIn ? '' : 'primary';
  $('ytClientInfo').textContent = ytState.hasClient ? 'Google client saved.' : 'No Google client saved yet.';
  $('ytSetupCard').hidden = ytState.signedIn; // the one-time setup and the manual stream choices are out of the way once connected
  $('destCard').hidden = ytState.signedIn;
}
async function updateTitlePreview() { $('ytTitlePreview').textContent = 'Title will be: ' + (await window.api.ytExpand($('ytTitle').value)); }
$('ytTitle').addEventListener('input', updateTitlePreview);
$('btnYtSign').onclick = async () => {
  if (ytState.signedIn) { await window.api.ytSignOut(); await refreshYt(); return; }
  if (!ytState.hasClient) { openSettings('stream'); $('ytSetupCard').scrollIntoView({ block: 'center' }); $('ytClientId').focus(); return; }
  setStatus('ytInfo', 'Opening your browser. Sign in there, then come back here...', 'warn');
  const r = await window.api.ytSignIn();
  if (!r.ok) banner(r.error);
  await refreshYt();
};
$('btnYtClient').onclick = async () => {
  const r = await window.api.ytSetClient($('ytClientId').value, $('ytClientSecret').value);
  $('ytClientSecret').value = '';
  if (!r.ok) banner(r.error);
  await refreshYt();
};

// ---------- Settings ----------
$('btnLogs').onclick = () => window.api.openLogs();

// ---------- start up ----------
(async () => {
  commit();
  await loadLtLibrary(); // imported pictures must be known before the saved looks are read
  loadLooks();
  buildCardsPage();
  applyTargetSeg(); renderClips(); renderQueue(); updateMediaUI();
  await initMedia();
  renderBooks(); renderChapters(); renderVerses(); renderSaved();
  applyMute();
  setDock('Bible'); // the Bible page is the default page
  fitAll();
  await refreshDevices();
  const camSaved = saved.cam && [...$('camSel').options].some((o) => o.value === saved.cam);
  if (camSaved) await startCamera();
  else if ($('camSel').options.length) { setStatus('camInfo', 'Choose your camera and press Start camera', 'warn'); }
  await refreshScreens();
  { const nm = await window.api.appName(); if (nm) { document.title = nm; $('brandName').textContent = nm; } } // the name lives in package.json
  { let sd = null; try { sd = localStorage.getItem('recDir'); } catch (e) { /* ignore */ } if (sd) await window.api.setRecDir(sd); showRecDir(); }
  $('btnStream').textContent = startText();
  await refreshYt();
  updateTitlePreview();
  $('logDir').textContent = 'Logs are saved in: ' + (await window.api.logDir());
  $('btnFF').click();
  if (await window.api.recovered()) banner('The app restarted after a problem. If you were streaming, press START STREAM to go live again.');
  if (!camSaved) { openSettings('cam'); } // first run: guide the person to choose the camera
  refreshMainUI();
  updatePills();
  updateDispUI();
  setInterval(updatePills, 1000);
  log('Ready.');
})();
