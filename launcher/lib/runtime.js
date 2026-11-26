// Opens, closes and places the apps. Every app opens in its own window, maximized on the screen chosen for it in the
// launcher (own taskbar icon, own window controls). Two apps on the same screen simply open two windows.
//   type "electron":       run the app's own main.js in a second copy of this Electron (see runner.js)
//   type "backend-window": start the app's backend program, then show its page in a window of ours (Redcam)
const { app, BrowserWindow, WebContentsView, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const store = require('./store');
const brand = require('./brand');
const loader = require('./loader');
const registry = require('../apps.registry.json');

const running = new Map();   // id -> { id, kind: 'proc'|'win', proc, win, port }   apps that are open (as far as the person can see)
const dying = new Map();     // id -> Promise that resolves when a closed app's program has really exited
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let hooks = { changed: () => {} };
const init = (h) => { hooks = Object.assign(hooks, h); };

// Screen 1 is always the main display, the rest go left to right.
function displays() {
  const all = screen.getAllDisplays();
  const prim = screen.getPrimaryDisplay();
  return [prim, ...all.filter((d) => d.id !== prim.id).sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)];
}
function screenOf(id) {
  const i = store.settings.screens[id];
  return Number.isInteger(i) && i < displays().length ? i : 0; // unplugged screen: fall back to the main one
}
function boundsFor(idx) {
  const wa = displays()[idx].workArea;
  return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
}

const isRunning = (id) => running.has(id);
// "Starting" = the program was launched but its window is not on screen yet (the first start after an update can take a while).
const isStarting = (id) => running.has(id) && (!running.get(id).ready || !!running.get(id).loading);
const loadingOf = (id) => (running.has(id) ? running.get(id).loading || null : null);   // { pct, text } while the app is starting
function markReady(rec) { if (!rec.ready) { rec.ready = true; hooks.changed(); } }

// ---- the loading window and the progress bar on the app's card ----
// Both show the same thing: how far the app is, and what it is doing. The app can report its own steps (see main.js of Redcast);
// an app that does not still gets a bar that moves, and the window closes when the app says it is ready.
function startLoading(rec, man, bounds) {
  const reg = registry.find((r) => r.id === rec.id) || {};
  rec.loading = { pct: 3, text: 'Getting ' + man.name + ' ready' };
  rec.loader = loader.open({ name: man.name, glyph: reg.glyph, bounds });
  rec.loader.set(3, rec.loading.text);
  rec.loadTimer = setTimeout(() => endLoading(rec), 60000);          // never leave it up forever
  hooks.changed();
}
function setLoading(rec, pct, text) {
  if (!rec.loading) return;
  rec.loading = { pct: Math.max(rec.loading.pct, Math.min(99, pct)), text: text || rec.loading.text };
  if (rec.loader) rec.loader.set(rec.loading.pct, rec.loading.text);
  hooks.changed();
}
function endLoading(rec, quick) {
  if (rec.loadTimer) { clearTimeout(rec.loadTimer); rec.loadTimer = null; }
  const l = rec.loader; rec.loader = null;
  if (l) { if (quick) l.close(); else l.finish(); }
  if (rec.loading) { rec.loading = null; hooks.changed(); }
}
const isBusy = (id) => running.has(id) || dying.has(id);   // open, or closed but still shutting down in the background
const killTree = (p) => {
  try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }) : p.kill(); } catch (e) { /* already gone */ }
};

async function pickPort(preferred) {
  const free = (port) => new Promise((res) => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(port, '0.0.0.0');
  });
  if (await free(preferred)) return preferred;   // Redcam is normally on 8080 so phones and Stream Deck can find it
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function waitHttp(port, ms, died) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (died()) return reject(new Error('The backend program stopped while starting. See backend.log in the app data folder.'));
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (r) => { r.resume(); resolve(); });
      req.on('error', () => (Date.now() - t0 > ms ? reject(new Error('The backend program did not start in time.')) : setTimeout(poll, 300)));
      req.on('timeout', () => req.destroy());
    })();
  });
}

function forwardFront(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true); win.show(); win.focus(); win.setAlwaysOnTop(false);
}

async function launchElectron(rec, dir, man, bounds) {
  const env = Object.assign({}, process.env, { RED_RUN_APP: dir, RED_APP_ID: rec.id, RED_BOUNDS: JSON.stringify(bounds), RED_MAXIMIZE: '1' });
  delete env.ELECTRON_RUN_AS_NODE;
  // The app's own copy of Electron, named and iconed like the app, so Windows (Firewall prompt, Task Manager) shows
  // "Redcast" and its icon instead of "Electron".
  setLoading(rec, 8, 'Preparing ' + man.name);
  const exe = await brand.exeFor(rec.id, man.name, man.icon ? path.join(dir, man.icon) : null);
  if (rec.closed) { rec.onStopped && rec.onStopped(); return; }       // closed while the first-time setup above was running
  setLoading(rec, 18, 'Starting ' + man.name);
  const log = fs.openSync(path.join(store.LOGS, rec.id + '.log'), 'a');
  const args = app.isPackaged ? [] : [app.getAppPath()];   // unpackaged dev run needs the launcher's own folder
  const p = spawn(exe, args, { env, cwd: dir, stdio: ['pipe', 'pipe', log] });
  rec.kind = 'proc'; rec.proc = p;
  p.stdin.on('error', () => {});
  // stdout carries the app's normal output (goes to its log) and one-line messages for us that start with @@RED@@.
  let buf = '';
  p.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i + 1); buf = buf.slice(i + 1);
      if (line.startsWith('@@RED@@')) {
        try {
          const m = JSON.parse(line.slice(7));
          if (m.cmd === 'ready') { markReady(rec); if (!rec.gotProgress) setTimeout(() => endLoading(rec), 600); }   // an app that reports no steps: its window is the finish line
          else if (m.cmd === 'progress') { rec.gotProgress = true; setLoading(rec, 25 + (Number(m.pct) || 0) * 0.72, m.text); }  // the app's own 0-100 fills the rest of the bar
          else if (m.cmd === 'loaded') { markReady(rec); endLoading(rec); }
        } catch (e) { /* ignore */ }
      } else { try { fs.writeSync(log, line); } catch (e) { /* log closed */ } }
    }
  });
  setTimeout(() => markReady(rec), 30000);              // never leave the card on "Starting" forever
  setLoading(rec, 25, man.name + ' is opening');
  p.stdout.on('error', () => {});
  const stopped = () => { try { fs.closeSync(log); } catch (e) { /* already closed */ } endLoading(rec, true); if (rec.onStopped) rec.onStopped(); gone(rec); };
  p.on('error', stopped);
  p.on('exit', stopped);
}

async function launchBackend(rec, dir, man, bounds) {
  const b = man.backend || {};
  const exe = path.join(dir, b.exe);
  // Dev mode with no built backend: run the Python source directly (needs the packages in requirements.txt).
  const devPy = store.DEV && !fs.existsSync(exe) && fs.existsSync(path.join(dir, 'app.py'));
  if (!devPy && !fs.existsSync(exe)) throw new Error(man.name + ' is missing its backend program (' + b.exe + ').');
  setLoading(rec, 10, 'Starting the ' + man.name + ' engine');
  const port = await pickPort(b.port || 8080);
  const dataDir = path.join(app.getPath('appData'), man.dataFolder || man.name);
  fs.mkdirSync(dataDir, { recursive: true });
  const env = Object.assign({}, process.env, { [b.portEnv || 'PORT']: String(port), [b.dataDirEnv || 'PTZ_DATA_DIR']: dataDir });
  const log = fs.createWriteStream(path.join(dataDir, 'backend.log'), { flags: 'a' });
  const p = devPy
    ? spawn(process.platform === 'win32' ? 'py' : 'python3', process.platform === 'win32' ? ['-3', 'app.py'] : ['app.py'], { env, cwd: dir, windowsHide: true })
    : spawn(exe, [], { env, cwd: path.dirname(exe), windowsHide: true });
  p.stdout.pipe(log, { end: false }); p.stderr.pipe(log, { end: false });
  rec.kind = 'win'; rec.proc = p; rec.port = port;
  let dead = false;
  p.on('exit', () => { dead = true; endLoading(rec, true); if (rec.win && !rec.win.isDestroyed()) rec.win.destroy(); if (rec.onStopped) rec.onStopped(); gone(rec); });
  p.on('error', () => { dead = true; if (rec.onStopped) rec.onStopped(); });
  setLoading(rec, 30, 'Waiting for the engine to answer');
  try { await waitHttp(port, 40000, () => dead); } catch (e) { killTree(p); throw e; }
  if (rec.closed) { killTree(p); return; }            // closed while it was still starting
  setLoading(rec, 70, 'Opening the window');

  const icon = man.icon ? path.join(dir, man.icon) : undefined;
  const win = new BrowserWindow(Object.assign({}, bounds, {
    show: false, title: man.name, icon, backgroundColor: '#101010', autoHideMenuBar: true,
  }));
  const page = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
  page.setBackgroundColor('#101010');
  win.contentView.addChildView(page);
  rec.win = win;
  const layout = () => { if (!win.isDestroyed()) { const [w, h] = win.getContentSize(); page.setBounds({ x: 0, y: 0, width: w, height: h }); } };
  layout();
  for (const ev of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) win.on(ev, layout);
  try { win.setAppDetails({ appId: man.appUserModelId || 'com.red.' + rec.id, appIconPath: icon, appIconIndex: 0, relaunchDisplayName: man.name }); } catch (e) { /* taskbar details are cosmetic */ }
  let shown = false;
  const reveal = () => { if (shown || win.isDestroyed()) return; shown = true; win.show(); win.maximize(); page.webContents.focus(); markReady(rec); endLoading(rec); };
  page.webContents.once('did-finish-load', reveal);
  page.webContents.once('did-fail-load', reveal);
  setTimeout(reveal, 6000);                       // never leave the person waiting on a blank screen
  win.on('closed', () => { killTree(p); try { page.webContents.close(); } catch (e) { /* gone */ } });
  page.webContents.loadURL('http://127.0.0.1:' + port + '/');
}

function gone(rec) {
  if (running.get(rec.id) !== rec) return;
  running.delete(rec.id);
  hooks.changed();
}

async function launch(id) {
  if (running.has(id)) return focus(id);
  if (dying.has(id)) {                                // it was just closed: let the old copy finish so the two do not collide
    await Promise.race([dying.get(id), sleep(8000)]);
    if (running.has(id)) return focus(id);
  }
  const ver = store.installedVersion(id);
  if (!ver) throw new Error('Not installed yet.');
  const dir = store.versionDir(id, ver);
  const man = store.readManifest(id, ver);
  const bounds = boundsFor(screenOf(id));
  const rec = { id, kind: null };
  running.set(id, rec);
  startLoading(rec, man, bounds);       // the loading window is on screen before anything slow happens
  try {
    if (man.type === 'electron') await launchElectron(rec, dir, man, bounds);
    else if (man.type === 'backend-window') await launchBackend(rec, dir, man, bounds);
    else throw new Error('This app has an unknown type: ' + man.type);
  } catch (e) { endLoading(rec, true); running.delete(id); hooks.changed(); throw e; }
  hooks.changed();
}

function focus(id) {
  const rec = running.get(id);
  if (!rec) return;
  if (rec.win) forwardFront(rec.win);
  else if (rec.proc && rec.proc.stdin.writable) rec.proc.stdin.write(JSON.stringify({ cmd: 'focus' }) + '\n');
}

// Closing is instant from the person's side: the app is marked closed and its window disappears right away.
// The program then finishes shutting down in the background (and is forced if it takes too long).
function close(id) {
  const rec = running.get(id);
  if (!rec) return;
  running.delete(id);
  rec.closed = true;
  endLoading(rec, true);
  const stopped = new Promise((resolve) => { rec.onStopped = resolve; });
  dying.set(id, stopped);
  stopped.then(() => { if (dying.get(id) === stopped) dying.delete(id); });
  if (rec.win || rec.kind === 'win') {
    try { if (rec.win && !rec.win.isDestroyed()) rec.win.destroy(); } catch (e) { /* already gone */ }
    if (rec.proc) killTree(rec.proc); else rec.onStopped();
  } else if (rec.proc) {
    try { rec.proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch (e) { /* fall through to the timer */ }
    setTimeout(() => { if (rec.proc.exitCode === null && !rec.proc.killed) killTree(rec.proc); }, 6000);
  } else rec.onStopped();                              // never got as far as starting a program
  hooks.changed();
}

// Resolves once every app that was closed has really exited (or after ms), so updates do not hit files still in use.
async function waitStopped(ms) {
  if (!dying.size) return;
  await Promise.race([Promise.all([...dying.values()]), sleep(ms || 9000)]);
}

function quitAll() {
  for (const rec of running.values()) if (rec.kind === 'win' && rec.proc) killTree(rec.proc);
}
const hasBackendApps = () => [...running.values()].some((r) => r.kind === 'win');

module.exports = { init, displays, screenOf, isRunning, isStarting, loadingOf, isBusy, launch, focus, close, waitStopped, quitAll, hasBackendApps };
