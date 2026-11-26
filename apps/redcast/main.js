// Main process. The app's name lives in package.json ("productName"): change it there and it changes everywhere.
const { app, BrowserWindow, ipcMain, screen, session, shell, safeStorage, dialog, protocol, net, nativeImage, desktopCapturer } = require('electron');
const { pathToFileURL } = require('url');
const ytModule = require('./yt');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_NAME = (require('./package.json').productName || 'Redcast');
app.setName(APP_NAME);
// Keep saved settings, pictures and the YouTube sign-in where they always were, so renaming the app never loses them.
app.setPath('userData', path.join(app.getPath('appData'), 'church-switcher-poc'));

// Photos and videos from the chosen media folder are served through this private address, so the pictures can be drawn
// onto the Output without the browser marking it as unsafe (which would blank the stream).
protocol.registerSchemesAsPrivileged([
  { scheme: 'redcast-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'redcast-lt', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }, // imported lower-third pictures
]);

// Keep rendering at full speed even when windows are covered by another window (e.g. the TV window).
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WebRtcHideLocalIpsWithMdns'); // second one lets the two windows find each other for the TV picture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWin = null;
const tvWins = new Map(); // one external window per monitor: display id -> window
let ff = null; // running ffmpeg process
let ffLogStream = null;
let sessionLogPath = null;
let logDir = null;
let recDir = null;
let recoveredFromCrash = false;
let yt = null;
let mediaDir = ''; // the media folder chosen in Settings (saved in config.json, so it survives restarts)
let mediaWatcher = null;
let mediaTimer = null;
let lastCpu = 0;
const ffStats = { frame: 0, fps: 0, bitrate: 0, drop: 0, dup: 0, speed: 0, running: false };

// Startup progress for the launcher's loading window (only when the launcher started us; one line on stdout).
const tell = (m) => { if (!process.env.RED_RUN_APP) return; try { process.stdout.write('@@RED@@' + JSON.stringify(m) + '\n'); } catch (e) { /* launcher gone */ } };
ipcMain.on('boot:progress', (e, pct, text) => tell({ cmd: 'progress', pct: Number(pct) || 0, text: String(text || '') }));
ipcMain.on('boot:loaded', () => tell({ cmd: 'loaded' }));

function pad(n) { return String(n).padStart(2, '0'); }
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function send(channel, data) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, data);
}
function ffmpegPath() {
  const local = path.join(__dirname, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return fs.existsSync(local) ? local : 'ffmpeg'; // falls back to ffmpeg on the system PATH
}

function createMainWindow() {
  tell({ cmd: 'progress', pct: 5, text: 'Opening the window' });
  mainWin = new BrowserWindow({
    width: 1500,
    height: 980,
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'icons', 'redcast.ico'),
    backgroundColor: '#0e1013',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWin.setMenuBarVisibility(false);
  mainWin.loadFile('index.html');
  // Crash recovery: if the screen process dies, stop ffmpeg, reload the screen, and tell the person.
  mainWin.webContents.on('render-process-gone', () => {
    killFfmpeg();
    recoveredFromCrash = true;
    if (mainWin && !mainWin.isDestroyed()) mainWin.reload();
  });
  mainWin.on('closed', () => {
    mainWin = null;
    webDestroy();
    killFfmpeg();
    tvWins.forEach((w) => { if (!w.isDestroyed()) w.close(); });
    app.quit();
  });
}

function killFfmpeg() {
  if (ff) {
    try { ff.stdin.end(); } catch (e) { /* ignore */ }
    try { ff.kill(); } catch (e) { /* ignore */ }
  }
}

// ---------- Screen capture: the windows and monitors that can be shown as the picture ----------
let pendingCapture = ''; // the source picked in the app, handed to getDisplayMedia if the direct way is refused
ipcMain.handle('capture:select', (e, id) => { pendingCapture = String(id || ''); return true; });
ipcMain.handle('capture:sources', async (e, light) => {
  const own = new Set();
  if (mainWin && !mainWin.isDestroyed()) own.add(mainWin.getMediaSourceId());
  tvWins.forEach((w) => { if (!w.isDestroyed()) own.add(w.getMediaSourceId()); });
  const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: light ? { width: 0, height: 0 } : { width: 320, height: 180 }, fetchWindowIcons: false });
  const displays = screen.getAllDisplays();
  return list.filter((s) => !own.has(s.id)).map((s, i) => {
    const isScreen = s.id.startsWith('screen:');
    const d = isScreen ? displays.find((x) => String(x.id) === String(s.display_id)) : null;
    const n = d ? displays.indexOf(d) + 1 : 0;
    return {
      id: s.id, kind: isScreen ? 'screen' : 'window', displayId: s.display_id || '',
      name: isScreen ? `Monitor ${n || i + 1}${d ? ` (${d.bounds.width}x${d.bounds.height})` : ''}${d && d.id === screen.getPrimaryDisplay().id ? ' - main' : ''}` : s.name,
      thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
    };
  });
});

// ---------- Displays and TV window ----------
ipcMain.handle('displays:list', () => {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    isMain: d.id === primary,
    label: `Display ${i + 1}: ${d.bounds.width}x${d.bounds.height} at (${d.bounds.x},${d.bounds.y})${d.id === primary ? ' - MAIN SCREEN' : ''}`,
  }));
});

ipcMain.handle('tv:open', (e, displayId) => {
  const d = screen.getAllDisplays().find((x) => x.id === displayId);
  if (!d) return { ok: false, error: 'Display not found' };
  const old = tvWins.get(displayId);
  if (old && !old.isDestroyed()) old.close();
  const isMain = d.id === screen.getPrimaryDisplay().id;
  // On the main screen it opens as a normal window (so the operator window is never covered); on other monitors it is full screen.
  const win = new BrowserWindow(isMain
    ? { x: d.bounds.x + 80, y: d.bounds.y + 80, width: 960, height: 540, show: false, title: 'External display (test window)', backgroundColor: '#000000', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }
    : {
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, show: false, skipTaskbar: true,
      focusable: false, // never steals keyboard focus from the operator window
      backgroundColor: '#000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
  tvWins.set(displayId, win);
  win.once('ready-to-show', () => { if (!isMain) win.setFullScreen(true); win.show(); });
  win.on('closed', () => { if (tvWins.get(displayId) === win) tvWins.delete(displayId); send('tv:closed', displayId); });
  win.loadFile('tv.html');
  return { ok: true };
});

ipcMain.handle('tv:close', (e, displayId) => {
  if (displayId === undefined) tvWins.forEach((w) => { if (!w.isDestroyed()) w.close(); });
  else { const w = tvWins.get(displayId); if (w && !w.isDestroyed()) w.close(); }
  return { ok: true };
});

ipcMain.on('tv:set', (e, displayId, state) => {
  const w = tvWins.get(displayId);
  if (w && !w.isDestroyed()) w.webContents.send('tv:state', state);
});

// ---------- Web page: a hidden browser window; its picture is used like the camera or a video ----------
// It is drawn off screen, so no mouse pointer is ever in the picture. The operator clicks, scrolls and types on a
// preview in the app and those are passed on to the page here.
const WEB_W = 1920, WEB_H = 1080;
let webWin = null, webPending = null, webTimer = null, webLast = 0;
let webState = { url: '', title: '', loading: false, error: '' };
const webTell = () => send('web:state', webState);
function webFlush() {
  webTimer = null;
  if (!webPending || !webWin || webWin.isDestroyed()) return;
  const img = webPending; webPending = null; webLast = Date.now();
  try { const sz = img.getSize(), cs = webWin.getContentSize(); send('web:frame', { buf: img.toJPEG(85), w: sz.width, h: sz.height, cw: cs[0], ch: cs[1] }); } catch (e) { /* skip this frame */ }
}
function webDestroy() {
  if (webTimer) { clearTimeout(webTimer); webTimer = null; }
  webPending = null;
  if (webWin && !webWin.isDestroyed()) webWin.destroy();
  webWin = null;
}
function webMake() {
  webWin = new BrowserWindow({
    show: false, width: WEB_W, height: WEB_H, useContentSize: true, frame: false, backgroundColor: '#000000',
    webPreferences: { offscreen: true, partition: 'persist:redcast-web', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const wc = webWin.webContents;
  webWin.setContentSize(WEB_W, WEB_H);
  wc.setFrameRate(24);
  wc.setAudioMuted(true); // the page's own sound is not sent anywhere
  wc.session.setPermissionRequestHandler((w, p, cb) => cb(false));
  wc.session.on('will-download', (ev) => ev.preventDefault());
  wc.on('paint', (ev, dirty, image) => { webPending = image; if (!webTimer) webTimer = setTimeout(webFlush, Math.max(0, 40 - (Date.now() - webLast))); });
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) wc.loadURL(url); return { action: 'deny' }; }); // new windows open in the same page
  wc.on('dom-ready', () => { wc.insertCSS('html { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }').catch(() => {}); }); // no scroll bar in the picture; scrolling still works
  wc.on('did-start-loading', () => { webState = Object.assign({}, webState, { loading: true, error: '' }); webTell(); });
  wc.on('did-stop-loading', () => { webState = Object.assign({}, webState, { loading: false, url: wc.getURL(), title: wc.getTitle() }); webTell(); });
  wc.on('did-navigate', (e, url) => { webState = Object.assign({}, webState, { url }); webTell(); });
  wc.on('did-navigate-in-page', (e, url) => { webState = Object.assign({}, webState, { url }); webTell(); });
  wc.on('page-title-updated', (e, title) => { webState = Object.assign({}, webState, { title }); webTell(); });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) { webState = Object.assign({}, webState, { loading: false, error: desc || 'The page did not load' }); webTell(); } });
  webWin.on('closed', () => { webWin = null; webState = { url: '', title: '', loading: false, error: '' }; webTell(); });
}
ipcMain.handle('web:open', (e, raw) => {
  let u;
  try { raw = String(raw || '').trim(); u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw); } catch (err) { return { ok: false, error: 'That does not look like a web address.' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'Only web addresses starting with http or https work.' };
  if (!webWin || webWin.isDestroyed()) webMake();
  webState = { url: u.href, title: '', loading: true, error: '' }; webTell();
  webWin.webContents.loadURL(u.href).catch(() => { /* did-fail-load reports it */ });
  return { ok: true };
});
ipcMain.handle('web:close', () => { webDestroy(); webState = { url: '', title: '', loading: false, error: '' }; webTell(); return { ok: true }; });
ipcMain.on('web:nav', (e, action) => {
  if (!webWin || webWin.isDestroyed()) return;
  const wc = webWin.webContents;
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  else if (action === 'reload') wc.reload();
});
const WEB_EVENTS = ['mouseDown', 'mouseUp', 'mouseMove', 'mouseWheel', 'keyDown', 'keyUp', 'char'];
const WEB_MODS = ['shift', 'control', 'alt', 'meta', 'leftButtonDown', 'middleButtonDown', 'rightButtonDown'];
ipcMain.on('web:input', (e, ev) => {
  if (!webWin || webWin.isDestroyed() || !ev || !WEB_EVENTS.includes(ev.type)) return;
  const wc = webWin.webContents, n = (v) => Math.round(Number(v) || 0);
  const out = { type: ev.type, modifiers: (Array.isArray(ev.modifiers) ? ev.modifiers : []).filter((m) => WEB_MODS.includes(m)) };
  if (ev.type.startsWith('mouse')) {
    const cs = webWin.getContentSize(); // the page's real size, which can be smaller than asked if the screen is small
    out.x = Math.max(0, Math.min(cs[0] - 1, n(ev.x))); out.y = Math.max(0, Math.min(cs[1] - 1, n(ev.y)));
    if (ev.type === 'mouseWheel') { out.deltaX = n(ev.deltaX); out.deltaY = n(ev.deltaY); }
    else { out.button = ['left', 'middle', 'right'].includes(ev.button) ? ev.button : 'left'; out.clickCount = Math.max(1, Math.min(3, n(ev.clickCount) || 1)); }
    if (ev.type === 'mouseDown') wc.focus();
  } else { if (ev.type === 'keyDown') wc.focus(); out.keyCode = String(ev.keyCode || '').slice(0, 16); }
  try { wc.sendInputEvent(out); } catch (err) { /* ignore a bad event */ }
});

// Passes the picture handshake between the operator window and each external window.
ipcMain.on('rtc:signal', (e, p) => {
  if (mainWin && e.sender === mainWin.webContents) {
    const w = tvWins.get(p.id);
    if (w && !w.isDestroyed()) w.webContents.send('rtc:signal', p.msg);
  } else {
    let id = null;
    tvWins.forEach((w, k) => { if (!w.isDestroyed() && w.webContents === e.sender) id = k; });
    if (id !== null && mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('rtc:signal', { id, msg: p.msg });
  }
});

// ---------- App settings kept by the main process (config.json in the app's data folder) ----------
function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function readConfig() { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {}; } catch (e) { return {}; } }
function writeConfig(patch) {
  const next = Object.assign(readConfig(), patch);
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    const tmp = configPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, configPath()); // written whole or not at all
  } catch (e) { /* the setting still works until the app closes */ }
  return next;
}

ipcMain.handle('layout:get', () => { const l = readConfig().layout; return ['A', 'B', 'C'].includes(l) ? l : ''; });
ipcMain.handle('layout:set', (e, l) => { if (['A', 'B', 'C'].includes(l)) writeConfig({ layout: l }); return { ok: true }; });

// ---------- Media folder: every photo and video in it shows up on the Videos & Photos shelf ----------
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm', '.ogv', '.mkv']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const MAX_MEDIA_FILES = 2000;
const mediaUrl = (rel) => 'redcast-media://files/' + rel.split('/').map(encodeURIComponent).join('/');

function scanMedia() {
  if (!mediaDir) return { ok: true, dir: '', files: [], exists: false };
  if (!fs.existsSync(mediaDir)) return { ok: true, dir: mediaDir, files: [], exists: false };
  const files = [];
  const walk = (dir, rel, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const en of entries) {
      if (files.length >= MAX_MEDIA_FILES) return;
      if (en.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + en.name : en.name;
      if (en.isDirectory()) { if (depth < 3) walk(path.join(dir, en.name), r, depth + 1); continue; }
      const ext = path.extname(en.name).toLowerCase();
      const kind = VIDEO_EXT.has(ext) ? 'video' : IMAGE_EXT.has(ext) ? 'image' : null;
      if (kind) files.push({ rel: r, name: path.basename(en.name, ext), kind, url: mediaUrl(r) });
    }
  };
  walk(mediaDir, '', 0);
  return { ok: true, dir: mediaDir, files, exists: true };
}
function watchMedia() {
  if (mediaWatcher) { try { mediaWatcher.close(); } catch (e) { /* ignore */ } mediaWatcher = null; }
  if (!mediaDir || !fs.existsSync(mediaDir)) return;
  const ping = () => { clearTimeout(mediaTimer); mediaTimer = setTimeout(() => send('media:changed', scanMedia()), 800); }; // wait for copying to finish
  try { mediaWatcher = fs.watch(mediaDir, { recursive: true }, ping); }
  catch (e) { try { mediaWatcher = fs.watch(mediaDir, ping); } catch (e2) { mediaWatcher = null; } }
  if (mediaWatcher) mediaWatcher.on('error', () => { /* folder went away: the next scan reports it */ });
}
function setMediaDir(dir) {
  mediaDir = dir ? path.resolve(String(dir)) : '';
  writeConfig({ mediaFolder: mediaDir });
  watchMedia();
}
ipcMain.handle('media:get', () => scanMedia());
ipcMain.handle('media:scan', () => scanMedia());
ipcMain.handle('media:choose', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Choose the folder with your photos and videos', defaultPath: mediaDir || app.getPath('videos'), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return Object.assign(scanMedia(), { canceled: true });
  setMediaDir(r.filePaths[0]);
  return scanMedia();
});
ipcMain.handle('media:clear', () => { setMediaDir(''); return scanMedia(); });
ipcMain.handle('media:open', () => (mediaDir ? shell.openPath(mediaDir) : ''));

// ---------- Lower-third pictures: imported pictures are permanent app assets ----------
// They live in their own folder inside the app's data folder (never in the media folder), so they stay available
// in every project and every session until the person removes them.
const LT_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const ltDir = () => path.join(app.getPath('userData'), 'lowerthirds');
const ltIndexPath = () => path.join(ltDir(), 'index.json');
const ltUrl = (file) => 'redcast-lt://files/' + encodeURIComponent(file);
function ltReadIndex() {
  try { const a = JSON.parse(fs.readFileSync(ltIndexPath(), 'utf8')); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function ltWriteIndex(list) {
  fs.mkdirSync(ltDir(), { recursive: true });
  const tmp = ltIndexPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, ltIndexPath()); // written whole or not at all
}
function ltList() {
  const list = ltReadIndex().filter((e) => e && e.id && e.file && fs.existsSync(path.join(ltDir(), path.basename(e.file))));
  return list.map((e) => ({ id: e.id, name: e.name, w: e.w, h: e.h, url: ltUrl(path.basename(e.file)) }));
}
ipcMain.handle('lt:list', () => ({ ok: true, items: ltList() }));
ipcMain.handle('lt:import', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Choose lower-third pictures to import',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: true, canceled: true, items: ltList(), added: [], failed: [] };
  const index = ltReadIndex(), added = [], failed = [];
  fs.mkdirSync(ltDir(), { recursive: true });
  for (const src of r.filePaths) {
    const ext = path.extname(src).toLowerCase(), base = path.basename(src, path.extname(src));
    try {
      if (!LT_EXT.has(ext)) throw new Error('not a supported picture');
      const size = nativeImage.createFromPath(src).getSize();
      if (!size.width || !size.height) throw new Error('could not be read');
      const id = 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const file = id + ext;
      fs.copyFileSync(src, path.join(ltDir(), file)); // a copy: the original can be moved or deleted afterwards
      index.push({ id, name: base, file, w: size.width, h: size.height, added: Date.now() });
      added.push(id);
    } catch (e) { failed.push(path.basename(src)); }
  }
  if (added.length) ltWriteIndex(index);
  return { ok: true, canceled: false, items: ltList(), added, failed };
});
ipcMain.handle('lt:remove', (e, id) => {
  const index = ltReadIndex(), hit = index.find((x) => x.id === id);
  if (hit) {
    try { fs.unlinkSync(path.join(ltDir(), path.basename(hit.file))); } catch (err) { /* already gone */ }
    ltWriteIndex(index.filter((x) => x.id !== id));
  }
  return { ok: true, items: ltList() };
});
ipcMain.handle('lt:open', () => { fs.mkdirSync(ltDir(), { recursive: true }); return shell.openPath(ltDir()); });

// ---------- ffmpeg check ----------
const HW_ENCODERS = ['h264_nvenc', 'h264_amf', 'h264_qsv'];

function encoderArgs(enc, br, fps) {
  const rate = ['-b:v', `${br}k`, '-maxrate', `${br}k`, '-bufsize', `${br * 2}k`, '-g', String(fps * 2)];
  switch (enc) {
    case 'h264_nvenc':
      return { pix: 'yuv420p', args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-rc', 'cbr', ...rate, '-profile:v', 'high', '-bf', '0'] };
    case 'h264_amf':
      return { pix: 'nv12', args: ['-c:v', 'h264_amf', '-usage', 'lowlatency', '-rc', 'cbr', ...rate] };
    case 'h264_qsv':
      return { pix: 'nv12', args: ['-c:v', 'h264_qsv', '-preset', 'veryfast', ...rate] };
    default:
      return { pix: 'yuv420p', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', ...rate] };
  }
}

ipcMain.handle('ffmpeg:check', async () => {
  const exe = ffmpegPath();
  const run = (args) => new Promise((resolve) => {
    execFile(exe, args, { timeout: 30000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, out: (stdout || '') + (stderr || '') });
    });
  });
  const v = await run(['-version']);
  if (v.err && v.err.code === 'ENOENT') return { found: false, exe };
  const version = (v.out.split(/\r?\n/)[0] || '').trim();
  const enc = await run(['-hide_banner', '-encoders']);
  const working = [];
  const failed = [];
  for (const name of HW_ENCODERS) {
    if (!new RegExp('\\b' + name + '\\b').test(enc.out)) continue; // this ffmpeg build does not include it
    const e = encoderArgs(name, 4000, 30);
    const t = await run(['-hide_banner', '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=30:d=1',
      ...e.args, '-pix_fmt', e.pix, '-f', 'null', '-']);
    if (!t.err) working.push(name);
    else failed.push({ name, msg: t.out.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ') });
  }
  return { found: true, exe, version, working, failed };
});

// ---------- Streaming ----------
function buildArgs(o) {
  const fps = o.fps || 30;
  const br = o.bitrate || 6000;
  const a = ['-hide_banner', '-fflags', 'nobuffer', '-probesize', '2M', '-analyzeduration', '1M', '-i', 'pipe:0'];
  const e = encoderArgs(o.encoder, br, fps);
  a.push(...e.args, '-pix_fmt', e.pix, '-r', String(fps), '-fps_mode', 'cfr');
  a.push('-af', 'aresample=async=1', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2');
  if (o.dest === 'file') {
    const file = path.join(logDir, `test-output-${stamp()}.mkv`);
    a.push('-y', '-f', 'matroska', file);
    return { args: a, display: file };
  }
  // Recordings are fragmented MP4: they play anywhere, and survive the app or the PC stopping suddenly.
  const MOV = 'frag_keyframe+empty_moov+default_base_moof';
  const rec = path.join(recDir, `${APP_NAME}-${stamp()}.mp4`);
  if (o.dest === 'record') { // recording only: nothing is sent to the internet
    a.push('-y', '-f', 'mp4', '-movflags', MOV, rec);
    return { args: a, display: rec, recording: rec };
  }
  const url = `${o.url.replace(/\/+$/, '')}/${o.key}`;
  const shown = `${o.url.replace(/\/+$/, '')}/********`;
  if (o.record) {
    // Encode once, send to the stream AND save a backup copy. If the internet drops, the recording continues.
    a.push('-flags', '+global_header', '-map', '0:v:0', '-map', '0:a:0?', '-f', 'tee',
      `[f=flv:onfail=ignore]${url}|[f=mp4:movflags=${MOV}]${rec.replace(/\\/g, '/')}`);
    return { args: a, display: shown, recording: rec };
  }
  a.push('-f', 'flv', url);
  return { args: a, display: shown };
}

function parseFfLine(line) {
  if (/frame=\s*\d+/.test(line)) {
    const g = (re) => { const m = line.match(re); return m ? Number(m[1]) : null; };
    const frame = g(/frame=\s*(\d+)/); if (frame !== null) ffStats.frame = frame;
    const fps = g(/fps=\s*([\d.]+)/); if (fps !== null) ffStats.fps = fps;
    const br = g(/bitrate=\s*([\d.]+)kbits\/s/); if (br !== null) ffStats.bitrate = br;
    const drop = g(/drop=\s*(\d+)/); if (drop !== null) ffStats.drop = drop;
    const dup = g(/dup=\s*(\d+)/); if (dup !== null) ffStats.dup = dup;
    const sp = g(/speed=\s*([\d.]+)x/); if (sp !== null) ffStats.speed = sp;
  } else if (line.trim()) {
    send('ffmpeg:log', line.trim());
  }
}

ipcMain.handle('stream:start', (e, o) => {
  if (ff) return { ok: false, error: 'A stream is already running' };
  const exe = ffmpegPath();
  const { args, display, recording } = buildArgs(o);
  try {
    ffLogStream = fs.createWriteStream(path.join(logDir, `ffmpeg-${stamp()}.log`));
    ff = spawn(exe, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  Object.assign(ffStats, { frame: 0, fps: 0, bitrate: 0, drop: 0, dup: 0, speed: 0, running: true });
  const proc = ff;
  proc.stdin.on('error', () => { /* ffmpeg closed its input; exit handler reports it */ });
  let buf = '';
  proc.stderr.on('data', (d) => {
    const s = d.toString();
    if (ffLogStream) ffLogStream.write(s);
    buf += s;
    const parts = buf.split(/[\r\n]+/);
    buf = parts.pop();
    parts.forEach(parseFfLine);
  });
  proc.on('error', (err) => {
    ffStats.running = false;
    if (ff === proc) ff = null;
    send('stream:ended', { code: null, error: err.message });
  });
  proc.on('exit', (code, signal) => {
    ffStats.running = false;
    if (ff === proc) ff = null;
    if (ffLogStream) { ffLogStream.end(); ffLogStream = null; }
    send('stream:ended', { code, signal });
  });
  return { ok: true, exe, display, encoder: o.encoder, recording: recording || '' };
});

ipcMain.on('stream:chunk', (e, data) => {
  if (ff && ff.stdin.writable) ff.stdin.write(Buffer.from(data));
});

ipcMain.handle('stream:stop', () => {
  const p = ff;
  if (!p) return { ok: true };
  try { p.stdin.end(); } catch (err) { /* ignore */ }
  setTimeout(() => { if (ff === p) p.kill(); }, 6000);
  return { ok: true };
});

// ---------- Metrics and logging ----------
let prevCpuTimes = os.cpus();
setInterval(() => {
  const cur = os.cpus();
  let idle = 0, total = 0;
  cur.forEach((c, i) => {
    const p = prevCpuTimes[i];
    const sum = (t) => t.user + t.nice + t.sys + t.idle + t.irq;
    total += sum(c.times) - sum(p.times);
    idle += c.times.idle - p.times.idle;
  });
  prevCpuTimes = cur;
  lastCpu = total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0; // whole PC, includes ffmpeg
  send('metrics', {
    cpu: lastCpu,
    ff: { ...ffStats, queued: ff ? ff.stdin.writableLength : 0 },
  });
}, 1000);

ipcMain.on('log:row', (e, r) => {
  if (!sessionLogPath) return;
  const row = [
    new Date().toISOString(), r.elapsed, lastCpu,
    ffStats.fps, ffStats.speed, ffStats.drop, ffStats.bitrate, ffStats.frame,
    r.renderFps, r.longFrames, r.camFps, r.camDropped, r.audioDb,
  ].join(',');
  fs.appendFile(sessionLogPath, row + '\n', () => {});
});

const wrap = (fn) => async (e, ...args) => {
  try { return Object.assign({ ok: true }, await fn(...args)); } catch (err) { return { ok: false, error: err.message }; }
};
ipcMain.handle('yt:status', wrap(async () => yt.status()));
ipcMain.handle('yt:setClient', wrap(async (id, secret) => yt.setClient(id, secret)));
ipcMain.handle('yt:signIn', wrap(async () => yt.signIn()));
ipcMain.handle('yt:signOut', wrap(async () => yt.signOut()));
ipcMain.handle('yt:prepare', wrap(async (tpl) => yt.prepare(tpl)));
ipcMain.handle('yt:end', wrap(async (id) => ({ ended: await yt.end(id) })));
ipcMain.handle('yt:expand', (e, text) => ytModule.expandTemplate(text, new Date()));

ipcMain.handle('bible:fetch', wrap(async (ref, trans) => {
  const q = String(ref || '').trim();
  if (!q) throw new Error('Type a verse first, like John 3:16.');
  const t = /^[a-z0-9-]+$/i.test(trans || '') ? trans.toLowerCase() : 'kjv';
  const url = 'https://bible-api.com/' + encodeURIComponent(q).replace(/%20/g, '+').replace(/%3A/gi, ':').replace(/%2C/gi, ',') + '?translation=' + t;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try { res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'ChurchSwitcher' } }); }
  catch (e) { throw new Error('Could not reach the Bible service. Check the internet connection.'); }
  finally { clearTimeout(timer); }
  if (res.status === 404) throw new Error(`Could not find "${q}". Try something like John 3:16 or Romans 8:28-30.`);
  if (!res.ok) throw new Error(`The Bible service had a problem (${res.status}). Try again.`);
  const j = await res.json();
  if (!j.verses || !j.verses.length) throw new Error(`Could not find "${q}".`);
  const first = j.verses[0], last = j.verses[j.verses.length - 1];
  return {
    reference: j.reference || q,
    text: j.verses.map((v) => String(v.text).trim().replace(/\s+/g, ' ')).join(' '),
    translation: String(j.translation_id || t).toUpperCase(),
    book: first.book_name, chapter: first.chapter, firstVerse: first.verse, lastVerse: last.verse,
    verses: j.verses.map((v) => ({ verse: v.verse, text: String(v.text).trim().replace(/\s+/g, ' ') })),
  };
}));

ipcMain.handle('app:name', () => APP_NAME);
ipcMain.handle('recordings:open', () => { fs.mkdirSync(recDir, { recursive: true }); return shell.openPath(recDir); });
ipcMain.handle('recordings:dir', () => recDir);
// The default is the Videos folder, in a folder named after the app. It can be changed in Settings.
ipcMain.handle('recordings:setDir', (e, dir) => {
  try { const d = dir && String(dir).trim() ? String(dir).trim() : path.join(app.getPath('videos'), APP_NAME); fs.mkdirSync(d, { recursive: true }); recDir = d; return { ok: true, dir: d }; }
  catch (err) { return { ok: false, error: err.message, dir: recDir }; }
});
ipcMain.handle('recordings:choose', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Where should recordings be saved?', defaultPath: recDir, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, dir: recDir };
  try { fs.mkdirSync(r.filePaths[0], { recursive: true }); recDir = r.filePaths[0]; return { ok: true, dir: recDir }; } catch (err) { return { ok: false, error: err.message, dir: recDir }; }
});
ipcMain.handle('disk:free', () => {
  try { const st = fs.statfsSync(recDir); return st.bavail * st.bsize; } catch (e) { return null; }
});
ipcMain.handle('app:recovered', () => { const v = recoveredFromCrash; recoveredFromCrash = false; return v; });
ipcMain.handle('logs:open', () => shell.openPath(logDir));
ipcMain.handle('logs:dir', () => logDir);

app.whenReady().then(() => {
  { // serve files from the media folder, and only from it
    protocol.handle('redcast-media', (request) => {
      try {
        const rel = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
        const full = path.resolve(mediaDir || '', rel);
        if (!mediaDir || (full !== mediaDir && !full.startsWith(mediaDir + path.sep))) return new Response('Not allowed', { status: 403 });
        const ext = path.extname(full).toLowerCase();
        if (!VIDEO_EXT.has(ext) && !IMAGE_EXT.has(ext)) return new Response('Not allowed', { status: 403 });
        return net.fetch(pathToFileURL(full).toString(), { headers: request.headers, bypassCustomProtocolHandlers: true }).then((res) => {
          const h = new Headers(res.headers); h.set('Access-Control-Allow-Origin', '*');
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
        });
      } catch (e) { return new Response('Not found', { status: 404 }); }
    });
  }
  { // serve imported lower-third pictures, and only from their own folder
    protocol.handle('redcast-lt', (request) => {
      try {
        const file = path.basename(decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, '')));
        const full = path.join(ltDir(), file);
        if (!LT_EXT.has(path.extname(full).toLowerCase()) || !fs.existsSync(full)) return new Response('Not found', { status: 404 });
        return net.fetch(pathToFileURL(full).toString(), { bypassCustomProtocolHandlers: true }).then((res) => {
          const h = new Headers(res.headers); h.set('Access-Control-Allow-Origin', '*');
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
        });
      } catch (e) { return new Response('Not found', { status: 404 }); }
    });
  }
  { const saved = readConfig().mediaFolder; if (saved) { mediaDir = path.resolve(saved); watchMedia(); } }
  logDir = path.join(app.getPath('documents'), APP_NAME, 'Logs');
  fs.mkdirSync(logDir, { recursive: true });
  recDir = path.join(app.getPath('videos'), APP_NAME);
  fs.mkdirSync(recDir, { recursive: true });
  sessionLogPath = path.join(logDir, `session-${stamp()}.csv`);
  fs.writeFileSync(sessionLogPath,
    'time,streamSeconds,wholePcCpuPct,ffmpegFps,ffmpegSpeed,ffmpegDropped,ffmpegKbps,ffmpegFrames,renderFps,longFrames,cameraFps,cameraFrameGaps,audioDb\n');
  yt = ytModule.create({ shell, safeStorage, userDataDir: app.getPath('userData') });
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(true));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, cb) => {
    try { const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }); const hit = list.find((x) => x.id === pendingCapture); cb(hit ? { video: hit } : {}); }
    catch (err) { cb({}); }
  });
  session.defaultSession.setPermissionCheckHandler(() => true);
  createMainWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', killFfmpeg);
