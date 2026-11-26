// The launcher itself: first-launch install, startup choice, updates, tray, and the window the person sees.
const { app, BrowserWindow, ipcMain, Tray, Menu, shell, screen, nativeImage } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

app.setPath('userData', process.env.RCT_DATA || path.join(app.getPath('appData'), 'Red Launcher'));
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const store = require('./store');
const gh = require('./github');
const inst = require('./installer');
const rt = require('./runtime');
const registry = require('../apps.registry.json');

const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
let win = null, tray = null, quitting = false, warnedTray = false;
let stage = null, stageInfo = {};       // overlay on the window: install | needRepo | error | screens | choose
let busyText = '';
let checking = false;
const installing = {};                  // id -> { pct, text }
const updates = {};                     // id -> release that is newer than what is installed and works with this launcher
const blocked = {};                     // id -> newer release that needs a newer launcher (no Update button until the launcher is updated)
let launcherUpdate = null;              // newer launcher release, if any
let updatingAll = false;
let startedWithFlag = false;            // started with --launcher
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The boot animation plays in the window on every start. Nothing (prompt, update box, hiding to the tray) happens until it has finished.
const BOOT_MS = 3200; let bootAt = 0;
const afterSplash = () => sleep(Math.max(0, bootAt + BOOT_MS - Date.now()));

const reg = (id) => registry.find((r) => r.id === id);
const installedIds = () => registry.map((r) => r.id).filter((id) => store.installedVersion(id));
rt.init({ changed: () => push() });

// ---------- state sent to the window ----------
let pushTimer = null;
function push(now) {
  if (now) { if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; } if (win && !win.isDestroyed()) win.webContents.send('state', publicState()); return; }
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; if (win && !win.isDestroyed()) win.webContents.send('state', publicState()); }, 60);
}

// ---------- questions, asked inside the launcher window (replaces the plain Windows message boxes) ----------
// ask({ title, detail, glyph, buttons: [{ label, sub, kind }], cancel }) resolves to the index of the clicked button.
// kind: 'pri' (red), 'danger' (red), or nothing. Esc or clicking outside answers with `cancel`.
let confirmInfo = null, confirmResolve = null;
function ask(o) {
  if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(-1); }     // a newer question replaces an older one
  return new Promise((resolve) => {
    confirmResolve = resolve;
    confirmInfo = { title: o.title, detail: o.detail || '', glyph: o.glyph || '', buttons: o.buttons, cancel: o.cancel == null ? o.buttons.length - 1 : o.cancel };
    showWindow();
    push(true);
  });
}
function answer(i) {
  const r = confirmResolve; confirmResolve = null; confirmInfo = null;
  push(true);
  if (r) r(i);
}
function say(text) { if (win && !win.isDestroyed()) win.webContents.send('toast', text); }
const canSelfUpdate = () => app.isPackaged && process.platform === 'win32';
// Everything that has an update waiting, launcher last (it restarts).
function pending() {
  const items = installedIds().filter((id) => updates[id]).map((id) => ({ id, name: reg(id).name, glyph: reg(id).glyph, from: store.installedVersion(id), to: updates[id].version }));
  if (launcherUpdate) items.push({ id: 'launcher', name: 'Red Launcher', glyph: 'lch', from: store.LAUNCHER_VERSION, to: launcherUpdate.version, launcher: true });
  return items;
}
function publicState() {
  return {
    stage, stageInfo, busyText, checking, pending: pending(), dev: store.DEV, confirm: confirmInfo,
    launcher: { version: store.LAUNCHER_VERSION, update: launcherUpdate ? launcherUpdate.version : null, installing: installing.launcher || null, canSelfUpdate: canSelfUpdate() },
    settings: { startup: store.settings.startup, repo: store.settings.repo },
    displays: rt.displays().map((d, i) => ({ index: i, w: d.size.width, h: d.size.height })),
    apps: registry.map((r) => {
      const v = store.installedVersion(r.id);
      return {
        id: r.id, name: r.name, glyph: r.glyph, description: r.description,
        installed: !!v, version: v, previous: v ? store.readState(r.id).previous : null,
        running: rt.isRunning(r.id), starting: rt.isStarting(r.id), loading: rt.loadingOf(r.id), update: updates[r.id] ? updates[r.id].version : null,
        blocked: blocked[r.id] ? { version: blocked[r.id].version, needs: blocked[r.id].minLauncher } : null,
        screen: rt.screenOf(r.id), installing: installing[r.id] || null,
      };
    }),
  };
}
function setStage(s, info) { stage = s; stageInfo = info || {}; push(); }
function setBusy(t) { busyText = t || ''; push(); }

// ---------- window, tray ----------
function createWindow() {
  win = new BrowserWindow({
    width: 940, height: 720, minWidth: 720, minHeight: 560, show: false, backgroundColor: '#101010', title: 'Red Launcher',
    icon: ICON, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide();
    if (tray && !warnedTray) { warnedTray = true; try { tray.displayBalloon({ title: 'Red Launcher is still running', content: 'Click the tray icon near the clock to open it again.' }); } catch (x) { /* windows only */ } }
  });
}
function showWindow() { if (!win || win.isDestroyed()) createWindow(); win.show(); win.focus(); }
function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }));
  tray.setToolTip('Red Launcher: click to open');
  tray.on('click', showWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open launcher', click: showWindow },
    { label: 'Check for updates', click: () => { showWindow(); checkUpdates(true); } },
    { type: 'separator' },
    { label: 'Quit', click: () => askQuit() },
  ]));
}
async function askQuit() {
  if (rt.hasBackendApps()) {
    const r = await ask({ title: 'Quit the launcher?', detail: 'Redcam runs inside the launcher, so it will close too.', glyph: 'lch',
      buttons: [{ label: 'Quit launcher', kind: 'danger' }, { label: 'Cancel' }], cancel: 1 });
    if (r !== 0) return;
  }
  const todo = pending();
  if (todo.length) {                                  // updates are waiting: offer them on the way out
    const r = await ask({
      title: todo.length === 1 ? 'An update is ready' : todo.length + ' updates are ready', glyph: 'lch',
      detail: todo.map((t) => `${t.name}: ${t.from} → ${t.to}`).join('\n') + '\n\nUpdating first means next Sunday starts on the new versions. Running apps will be closed.',
      buttons: [{ label: 'Update, then quit', kind: 'pri' }, { label: 'Quit without updating' }, { label: 'Cancel' }], cancel: 2,
    });
    if (r === 2 || r < 0) return;
    if (r === 0) {
      const res = await runUpdates({ relaunch: false, confirmed: true });
      if (res.failed.length) {
        const f = await ask({ title: 'Some updates did not finish', detail: res.failed.join('\n'), glyph: 'lch', buttons: [{ label: 'Quit anyway', kind: 'danger' }, { label: 'Stay open' }], cancel: 1 });
        if (f !== 0) return;
      }
      if (res.launcherStarted) return;                // the installer is running and the launcher is already closing
    }
  }
  quitting = true; rt.quitAll(); app.quit();
}

// ---------- Shift held at startup (Windows) ----------
function shiftHeld() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    const ps = "Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern short GetAsyncKeyState(int k);' -Name K -Namespace W; if (([W.K]::GetAsyncKeyState(16) -band 0x8000) -ne 0) { '1' } else { '0' }";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(!err && String(out).trim() === '1'));
  });
}

// ---------- installing and updating ----------
const repoOk = () => store.settings.repo && !/YOUR/i.test(store.settings.repo);

async function installMissing() {
  const missing = registry.filter((r) => !store.installedVersion(r.id));
  if (!missing.length) return true;
  if (!repoOk()) { setStage('needRepo'); return false; }
  setStage('install');
  let rels;
  try { rels = await gh.listReleases(store.settings.repo); }
  catch (e) {
    if (e.code === 'BADREPO') { setStage('needRepo', { message: e.message }); return false; }   // built-in repo failed: ask
    setStage('error', { message: String(e.message || e), canSkip: installedIds().length > 0 }); return false;
  }
  for (const r of missing) {
    const rel = gh.latestFor(rels, r.id);
    if (!rel) { setStage('error', { message: `No release for ${r.name} yet. On GitHub, publish a release tagged ${r.id}-v0.1.0 with ${r.id}-0.1.0.zip attached. (RELEASING.md explains the Release button that does this.)`, canSkip: installedIds().length > 0 }); return false; }
    installing[r.id] = { pct: 0, text: 'Starting…' }; push();
    try {
      const res = await inst.install(r.id, rel, (p) => { installing[r.id] = p; push(); });
      if (res.warning) say(r.name + ' installed, but setup needs another try: ' + res.warning);
    } catch (e) {
      delete installing[r.id];
      setStage('error', { message: `Could not install ${r.name}: ${e.message || e}`, canSkip: installedIds().length > 0 });
      return false;
    }
    delete installing[r.id]; push();
  }
  return true;
}

async function checkUpdates(manual, opts) {
  opts = opts || {};
  if (checking) return;
  if (store.DEV) { if (manual) say('Dev mode: running your local apps folder, so update checks are off. Use START-LOCAL-RELEASES.bat to test updates.'); return; }
  if (!repoOk()) { if (manual) say('Set the GitHub repo in Settings first.'); return; }
  checking = true; push();
  try {
    const rels = await gh.listReleases(store.settings.repo, opts.timeoutMs);
    // The launcher itself.
    const lrel = gh.latestFor(rels, 'launcher');
    launcherUpdate = lrel && gh.cmp(lrel.version, store.LAUNCHER_VERSION) > 0 ? lrel : null;
    let found = launcherUpdate ? 1 : 0, waiting = 0;
    // Each app. A newer version that needs a newer launcher is held back: no Update button until the launcher is updated.
    for (const id of installedIds()) {
      const rel = gh.latestFor(rels, id);
      updates[id] = null; blocked[id] = null;
      if (!rel || gh.cmp(rel.version, store.installedVersion(id)) <= 0) continue;
      if (rel.minLauncher && gh.cmp(rel.minLauncher, store.LAUNCHER_VERSION) > 0) { blocked[id] = rel; waiting++; }
      else { updates[id] = rel; found++; }
    }
    if (manual) {
      if (found) say(found === 1 ? 'An update is available.' : found + ' updates are available.');
      else if (waiting) say('A newer app version is waiting for a newer launcher, which is not published yet.');
      else say('Everything is up to date.');
    } else if (found && opts.balloon !== false && tray) { try { tray.displayBalloon({ title: 'Update available', content: 'Open the launcher to update. Nothing changes until you choose.' }); } catch (e) { /* windows only */ } }
  } catch (e) {
    if (e.code === 'BADREPO') { setStage('needRepo', { message: e.message }); showWindow(); }   // built-in repo failed: ask
    else if (manual) say('Could not check for updates: ' + (e.message || e));   // offline is fine: installed apps still open
  } finally { checking = false; push(); }
}

async function updateApp(id, quiet) {
  const rel = updates[id];
  if (!rel) return false;
  if (rt.isBusy(id)) { say(rt.isRunning(id) ? 'Close ' + reg(id).name + ' first, then update it.' : reg(id).name + ' is still shutting down. Try again in a moment.'); return false; }
  installing[id] = { pct: 0, text: 'Starting…' }; push();
  let ok = false;
  try {
    const res = await inst.install(id, rel, (p) => { installing[id] = p; push(); });
    updates[id] = null; ok = true;
    if (!quiet) say(reg(id).name + ' is now version ' + rel.version + '. The old version is kept for rollback.' + (res.warning ? ' ' + res.warning : ''));
  } catch (e) { say('Update failed: ' + (e.message || e)); }
  delete installing[id]; push();
  return ok;
}

async function closeAllApps() {
  installedIds().filter((id) => rt.isRunning(id)).forEach((id) => rt.close(id));
  await rt.waitStopped(9000);                         // the windows are gone at once, but wait for the programs to release their files
}
const runningNames = () => installedIds().filter((id) => rt.isRunning(id)).map((id) => reg(id).name);

// Downloads the new launcher, starts its installer, and closes. relaunch=false when the person is quitting.
async function updateLauncher(opts) {
  const o = Object.assign({ relaunch: true, confirm: true }, opts);
  const rel = launcherUpdate;
  if (!rel) return false;
  if (!canSelfUpdate()) { say('The launcher can only update itself once it is installed with the setup file.'); return false; }
  if (o.confirm && runningNames().length) {
    const r = await ask({ title: 'Update the launcher?', glyph: 'lch', detail: runningNames().join(' and ') + ' will close first. If you are streaming or recording, it will stop.',
      buttons: [{ label: 'Close apps and update', kind: 'pri' }, { label: 'Cancel' }], cancel: 1 });
    if (r !== 0) return false;
  }
  installing.launcher = { pct: 0, text: 'Starting…' }; push();
  try {
    await closeAllApps();
    await inst.installLauncher(rel, (p) => { installing.launcher = p; push(); }, o.relaunch);
  } catch (e) { delete installing.launcher; push(); say('Launcher update failed: ' + (e.message || e)); return false; }
  quitting = true; rt.quitAll(); app.quit();
  return true;
}

// Update everything that is waiting: apps first, the launcher last because it restarts.
async function runUpdates(opts) {
  const o = Object.assign({ relaunch: true, confirmed: false }, opts);
  const res = { failed: [], launcherStarted: false };
  if (updatingAll) return res;
  const todo = pending();
  if (!todo.length) return res;
  if (!o.confirmed && runningNames().length) {
    const r = await ask({ title: 'Update now?', glyph: 'lch', detail: runningNames().join(' and ') + ' will close first. If you are streaming or recording, it will stop.',
      buttons: [{ label: 'Close apps and update', kind: 'pri' }, { label: 'Cancel' }], cancel: 1 });
    if (r !== 0) return res;
  }
  updatingAll = true;
  try {
    await closeAllApps();
    for (const t of todo.filter((x) => !x.launcher)) if (!(await updateApp(t.id, true))) res.failed.push(t.name + ' did not update.');
    if (launcherUpdate && !res.failed.length) res.launcherStarted = await updateLauncher({ relaunch: o.relaunch, confirm: false });
    else if (launcherUpdate) res.failed.push('The launcher was not updated because an app update failed.');
  } finally { updatingAll = false; push(); }
  return res;
}

// ---------- opening apps ----------
async function openApp(id) {
  const ver = store.installedVersion(id);
  if (!ver) return say(reg(id).name + ' is not installed.');
  try {
    if (!inst.requirementsOk(id, ver)) {
      setBusy('Setting up this PC for ' + reg(id).name + '…');
      try { await inst.runSetup(id, ver, (t) => setBusy(reg(id).name + ': ' + t)); } finally { setBusy(''); }
    }
    await rt.launch(id);
  } catch (e) { say('Could not open ' + reg(id).name + ': ' + (e.message || e)); }
}
async function openAll() {
  // Start every app at the same time. They were opened one after the other, which made the launcher sit frozen while
  // the second app waited for the first.
  setStage(null);
  await Promise.all(installedIds().map((id) => openApp(id)));
  if (win && !win.isDestroyed()) win.hide();    // the launcher shrinks to the tray
}

async function closeApp(id) {
  if (id === 'redcast') {
    const r = await ask({ title: 'Close Redcast?', glyph: reg(id).glyph, detail: 'If you are streaming or recording, it will stop.',
      buttons: [{ label: 'Close Redcast', kind: 'danger' }, { label: 'Cancel' }], cancel: 1 });
    if (r !== 0) return;
  }
  rt.close(id);                                       // the window goes away at once; the program finishes in the background
}

// ---------- fix-it tools ----------
async function runTool(name) {
  const ids = installedIds();
  try {
    if (name === 'logs') { await shell.openPath(store.LOGS); return; }
    if (ids.some((id) => rt.isBusy(id)) && name !== 'logs') return say('Close the apps first, then run this.');
    if (name === 'recheck' || name === 'ffmpeg') {
      for (const id of ids) {
        const v = store.installedVersion(id); const man = store.readManifest(id, v);
        if (!man || !man.setup) continue;
        if (name === 'ffmpeg') for (const f of man.setup.requires || []) fs.rmSync(path.join(store.versionDir(id, v), f), { force: true });
        fs.rmSync(path.join(store.versionDir(id, v), 'bin', 'ffmpeg-build.txt'), { force: true });
        setBusy(reg(id).name + ': checking this PC…');
        await inst.runSetup(id, v, (t) => setBusy(reg(id).name + ': ' + t));
      }
      say(name === 'ffmpeg' ? 'ffmpeg reset and ready.' : 'This PC is checked and ready.');
    } else if (name === 'repair') {
      if (store.DEV) return say('Not available in dev mode.');
      if (!repoOk()) return say('Set the GitHub repo first.');
      setBusy('Repairing…');
      const rels = await gh.listReleases(store.settings.repo);
      for (const id of ids) {
        const rel = gh.releaseByVersion(rels, id, store.installedVersion(id)) || gh.latestFor(rels, id);
        if (rel) await inst.install(id, rel, (p) => setBusy(reg(id).name + ': ' + p.text));
      }
      say('Install repaired.');
    }
  } catch (e) { say('That did not work: ' + (e.message || e)); }
  setBusy('');
}

// ---------- startup ----------
// First start only: look for screens with a short animation. One screen means nothing to ask, so it moves straight on.
async function scanScreens() {
  setStage('scan', { phase: 'scanning' }); showWindow();
  await sleep(1900);
  const n = rt.displays().length;
  setStage('scan', { phase: 'found', count: n });
  await sleep(n > 1 ? 1700 : 1400);
  return n;
}
// A big number on every screen for a moment, so the person can tell which is which.
function identifyScreens() {
  const ds = rt.displays();
  if (ds.length < 2) return;
  ds.forEach((d, i) => {
    const b = d.bounds;
    const w = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false });
    w.setIgnoreMouseEvents(true);
    const html = '<body style="margin:0;height:100vh;display:grid;place-items:center;background:rgba(10,10,10,.6);font-family:Segoe UI,sans-serif;color:#fff;animation:f 2.8s both">'
      + '<div style="text-align:center"><div style="font-size:min(46vh,420px);font-weight:700;line-height:1;color:#ef4b52;text-shadow:0 10px 60px rgba(239,75,82,.5)">' + (i + 1) + '</div>'
      + '<div style="font-size:28px;opacity:.8">' + (i === 0 ? 'Main screen' : 'Screen ' + (i + 1)) + '</div></div>'
      + '<style>@keyframes f{0%{opacity:0;transform:scale(.96)}12%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0}}</style></body>';
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    w.once('ready-to-show', () => { if (!w.isDestroyed()) w.showInactive(); });
    setTimeout(() => { if (!w.isDestroyed()) w.close(); }, 3000);
  });
}
async function afterInstall() {
  if (!store.settings.screensConfigured) {
    const n = await scanScreens();
    if (n > 1) { setStage('screens'); showWindow(); identifyScreens(); return; }
    store.settings.screensConfigured = true; store.save();
  }
  await decideStartup(false);
}
async function decideStartup(forceAsk) {
  await afterSplash();
  const mode = store.settings.startup;
  if (forceAsk || mode === 'ask') { setStage('choose'); showWindow(); return; }
  if (mode === 'launcher') { setStage(null); showWindow(); return; }
  const shift = await shiftHeld();                 // mode 'all': Shift skips it
  if (shift) { setStage('choose'); showWindow(); return; }
  await openAll();
}
async function continueStartup() {
  if (startedWithFlag) { setStage(null); showWindow(); } else await afterInstall();
}
async function boot() {
  startedWithFlag = process.argv.includes('--launcher');
  if (!bootAt) { bootAt = Date.now(); showWindow(); }   // the window opens straight away so the boot animation can play
  let fresh = false;
  if (registry.some((r) => !store.installedVersion(r.id))) {
    fresh = true;
    showWindow();
    if (!(await installMissing())) return;
  }
  if (fresh) {                                        // a moment to enjoy it, then straight on (the apps are already the newest)
    setStage('installed'); await sleep(2800);
    await continueStartup();
    checkUpdates(false, { timeoutMs: 6000, balloon: false });
    return;
  }
  setStage(null);
  // Ask about updates BEFORE the apps open, so nothing has to be closed. Gives up after 6 seconds when offline.
  await checkUpdates(false, { timeoutMs: 6000, balloon: false });
  if (stage === 'needRepo') return;                   // the repo was wrong and we are asking for it
  if (pending().length) { await afterSplash(); setStage('updates', { mode: 'start' }); showWindow(); return; }
  await continueStartup();
}

// ---------- messages from the window ----------
const handle = (ch, fn) => ipcMain.handle(ch, async (_e, arg) => { try { return await fn(arg); } catch (e) { say(String(e.message || e)); } });
handle('state:get', () => publicState());
handle('app:open', (id) => openApp(id));
handle('app:close', (id) => closeApp(id));
handle('app:openAll', () => openAll());
handle('app:update', (id) => updateApp(id));
handle('launcher:update', () => updateLauncher({ relaunch: true, confirm: true }));
handle('updates:all', async () => {
  const fromStart = stage === 'updates';
  const res = await runUpdates({ relaunch: true });
  if (res.launcherStarted) return;                    // restarting into the new launcher
  if (res.failed.length) say(res.failed.join(' '));
  if (fromStart) { setStage(null); await continueStartup(); }
});
handle('updates:later', async () => { if (stage === 'updates') { setStage(null); await continueStartup(); } });
handle('app:rollback', async (id) => {
  if (rt.isBusy(id)) return say('Close ' + reg(id).name + ' first.');
  const st = store.readState(id);
  const r = await ask({ title: 'Go back to the earlier version?', glyph: reg(id).glyph, detail: reg(id).name + ' ' + store.installedVersion(id) + ' → ' + st.previous,
    buttons: [{ label: 'Go back to ' + st.previous, kind: 'pri' }, { label: 'Cancel' }], cancel: 1 });
  if (r !== 0) return;
  inst.rollback(id); updates[id] = null; say(reg(id).name + ' is back on version ' + store.installedVersion(id) + '.'); push();
});
handle('confirm:answer', (i) => answer(Number(i)));
handle('settings:set', ({ key, value }) => {
  if (key === 'startup' && ['ask', 'all', 'launcher'].includes(value)) { store.settings.startup = value; store.save(); push(); }
});
handle('repo:save', (repo) => {
  store.settings.repo = String(repo || '').trim(); store.save();
  if (stage === 'needRepo') boot(); else { push(); checkUpdates(true); }
});
handle('screen:set', ({ id, index }) => { store.settings.screens[id] = index; store.save(); push(); });
handle('screens:identify', () => identifyScreens());
handle('screens:done', async () => { store.settings.screensConfigured = true; store.save(); await decideStartup(false); });
handle('startup:choose', async ({ mode, remember }) => {
  if (remember) { store.settings.startup = mode; store.save(); }
  if (mode === 'all') await openAll(); else { setStage(null); }
});
handle('updates:check', () => checkUpdates(true));
handle('tool:run', (name) => runTool(name));
handle('boot:retry', () => boot());
handle('boot:skip', async () => { setStage(null); await afterInstall(); });

app.on('second-instance', (_e, argv) => { showWindow(); if (argv.includes('--launcher') && stage !== 'updates') { setStage(null); } });
app.on('window-all-closed', () => { /* stay alive in the tray */ });
app.on('before-quit', () => { quitting = true; });
app.whenReady().then(() => {
  screen.on('display-added', push);       // the screen module only works once the app is ready
  screen.on('display-removed', push);
  createWindow();
  createTray();
  boot();
  setInterval(() => checkUpdates(false), 6 * 3600 * 1000);   // the launcher stays in the tray all day: look again now and then
});
