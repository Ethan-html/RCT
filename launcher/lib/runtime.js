// Opens, closes and places the apps, and draws the tab bar when two apps share a screen.
//   type "electron":       run the app's own main.js in a second copy of this Electron (see runner.js)
//   type "backend-window": start the app's backend program, then show its page in a window of ours (Redcam)
const { app, BrowserWindow, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const store = require('./store');

const TAB_H = 34;
const running = new Map();   // id -> { id, kind: 'proc'|'win', proc, win, port }
const tabWins = new Map();   // screen index -> BrowserWindow
const active = {};           // screen index -> id of the tab that is in front
let hooks = { installed: () => [], name: (id) => id, changed: () => {} };
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
const groupOn = (idx) => hooks.installed().filter((id) => screenOf(id) === idx);
function boundsFor(idx) {
  const wa = displays()[idx].workArea;
  const tab = groupOn(idx).length > 1;
  return { tab, bounds: { x: wa.x, y: wa.y + (tab ? TAB_H : 0), width: wa.width, height: wa.height - (tab ? TAB_H : 0) } };
}

const isRunning = (id) => running.has(id);
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

function launchElectron(rec, dir, man, bounds, tab) {
  const env = Object.assign({}, process.env, { RED_RUN_APP: dir, RED_APP_ID: rec.id, RED_BOUNDS: JSON.stringify(bounds), RED_MAXIMIZE: tab ? '0' : '1' });
  delete env.ELECTRON_RUN_AS_NODE;
  const log = fs.openSync(path.join(store.LOGS, rec.id + '.log'), 'a');
  const args = app.isPackaged ? [] : [app.getAppPath()];   // unpackaged dev run needs the launcher's own folder
  const p = spawn(process.execPath, args, { env, cwd: dir, stdio: ['pipe', log, log] });
  fs.closeSync(log);
  rec.kind = 'proc'; rec.proc = p;
  p.stdin.on('error', () => {});
  p.on('error', () => gone(rec));
  p.on('exit', () => gone(rec));
}

async function launchBackend(rec, dir, man, bounds, tab) {
  const b = man.backend || {};
  const exe = path.join(dir, b.exe);
  if (!fs.existsSync(exe)) throw new Error(man.name + ' is missing its backend program (' + b.exe + ').');
  const port = await pickPort(b.port || 8080);
  const dataDir = path.join(app.getPath('appData'), man.dataFolder || man.name);
  fs.mkdirSync(dataDir, { recursive: true });
  const env = Object.assign({}, process.env, { [b.portEnv || 'PORT']: String(port), [b.dataDirEnv || 'PTZ_DATA_DIR']: dataDir });
  const log = fs.createWriteStream(path.join(dataDir, 'backend.log'), { flags: 'a' });
  const p = spawn(exe, [], { env, cwd: path.dirname(exe), windowsHide: true });
  p.stdout.pipe(log, { end: false }); p.stderr.pipe(log, { end: false });
  rec.kind = 'win'; rec.proc = p; rec.port = port;
  let dead = false;
  p.on('exit', () => { dead = true; if (rec.win && !rec.win.isDestroyed()) rec.win.destroy(); gone(rec); });
  p.on('error', () => { dead = true; });
  try { await waitHttp(port, 40000, () => dead); } catch (e) { killTree(p); throw e; }

  const icon = man.icon ? path.join(dir, man.icon) : undefined;
  const win = new BrowserWindow(Object.assign({}, bounds, {
    show: false, title: man.name, icon, backgroundColor: '#101010', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  }));
  rec.win = win;
  try { win.setAppDetails({ appId: man.appUserModelId || 'com.red.' + rec.id, appIconPath: icon, appIconIndex: 0, relaunchDisplayName: man.name }); } catch (e) { /* taskbar details are cosmetic */ }
  win.once('ready-to-show', () => { win.show(); if (!tab) win.maximize(); });
  win.on('closed', () => killTree(p));
  win.loadURL('http://127.0.0.1:' + port + '/');
}

function gone(rec) {
  if (running.get(rec.id) !== rec) return;
  running.delete(rec.id);
  updateTabs();
  hooks.changed();
}

async function launch(id) {
  if (running.has(id)) return focus(id);
  const ver = store.installedVersion(id);
  if (!ver) throw new Error('Not installed yet.');
  const dir = store.versionDir(id, ver);
  const man = store.readManifest(id, ver);
  const idx = screenOf(id);
  const { bounds, tab } = boundsFor(idx);
  const rec = { id, kind: null };
  running.set(id, rec);
  hooks.changed();
  try {
    if (man.type === 'electron') launchElectron(rec, dir, man, bounds, tab);
    else if (man.type === 'backend-window') await launchBackend(rec, dir, man, bounds, tab);
    else throw new Error('This app has an unknown type: ' + man.type);
  } catch (e) { running.delete(id); updateTabs(); hooks.changed(); throw e; }
  active[idx] = id;
  if (tab) ensureTabBar(idx);
  updateTabs();
  hooks.changed();
}

function focus(id) {
  const rec = running.get(id);
  if (!rec) return;
  active[screenOf(id)] = id;
  if (rec.win) forwardFront(rec.win);
  else if (rec.proc && rec.proc.stdin.writable) rec.proc.stdin.write(JSON.stringify({ cmd: 'focus' }) + '\n');
  updateTabs();
}

function close(id) {
  const rec = running.get(id);
  if (!rec) return;
  if (rec.win) { rec.win.close(); return; }
  if (rec.proc) {
    try { rec.proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch (e) { /* fall through to the timer */ }
    setTimeout(() => { if (running.get(id) === rec) killTree(rec.proc); }, 6000);
  }
}

// ---- tab bar: a thin strip at the top of a screen that two apps share ----
function tabData(idx) {
  return groupOn(idx).map((id) => ({ id, name: hooks.name(id), running: running.has(id), active: active[idx] === id }));
}
function ensureTabBar(idx) {
  if (tabWins.has(idx) || !displays()[idx]) return;
  const wa = displays()[idx].workArea;
  const w = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: TAB_H, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: false, hasShadow: false, show: false, backgroundColor: '#1a1a1a',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.loadFile(path.join(__dirname, '..', 'renderer', 'tabbar.html'), { query: { screen: String(idx) } });
  w.once('ready-to-show', () => w.showInactive());
  w.on('closed', () => tabWins.delete(idx));
  tabWins.set(idx, w);
}
function updateTabs() {
  for (const [idx, w] of tabWins) {
    const list = tabData(idx);
    if (!list.some((t) => t.running) || list.length < 2) { w.destroy(); continue; }
    if (!w.isDestroyed()) w.webContents.send('tabs', list);
  }
}
function quitAll() {
  for (const rec of running.values()) if (rec.kind === 'win' && rec.proc) killTree(rec.proc);
  for (const w of tabWins.values()) if (!w.isDestroyed()) w.destroy();
}
const hasBackendApps = () => [...running.values()].some((r) => r.kind === 'win');

module.exports = { init, displays, screenOf, isRunning, launch, focus, close, tabData, updateTabs, quitAll, hasBackendApps };
