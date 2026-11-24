// Main process. The app's name lives in package.json ("productName"): change it there and it changes everywhere.
const { app, BrowserWindow, ipcMain, screen, session, shell, safeStorage, dialog } = require('electron');
const ytModule = require('./yt');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_NAME = (require('./package.json').productName || 'Redcast');
app.setName(APP_NAME);
// Keep saved settings, pictures and the YouTube sign-in where they always were, so renaming the app never loses them.
app.setPath('userData', path.join(app.getPath('appData'), 'church-switcher-poc'));

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
let lastCpu = 0;
const ffStats = { frame: 0, fps: 0, bitrate: 0, drop: 0, dup: 0, speed: 0, running: false };

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
  logDir = path.join(app.getPath('documents'), APP_NAME, 'Logs');
  fs.mkdirSync(logDir, { recursive: true });
  recDir = path.join(app.getPath('videos'), APP_NAME);
  fs.mkdirSync(recDir, { recursive: true });
  sessionLogPath = path.join(logDir, `session-${stamp()}.csv`);
  fs.writeFileSync(sessionLogPath,
    'time,streamSeconds,wholePcCpuPct,ffmpegFps,ffmpegSpeed,ffmpegDropped,ffmpegKbps,ffmpegFrames,renderFps,longFrames,cameraFps,cameraFrameGaps,audioDb\n');
  yt = ytModule.create({ shell, safeStorage, userDataDir: app.getPath('userData') });
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  createMainWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', killFfmpeg);
