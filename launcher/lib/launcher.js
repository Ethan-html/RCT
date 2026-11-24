// The launcher itself: first-launch install, startup choice, updates, tray, and the window the person sees.
const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, screen, nativeImage } = require('electron');
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

const reg = (id) => registry.find((r) => r.id === id);
const installedIds = () => registry.map((r) => r.id).filter((id) => store.installedVersion(id));
rt.init({ installed: installedIds, name: (id) => (reg(id) || {}).name || id, changed: () => push() });

// ---------- state sent to the window ----------
let pushTimer = null;
function push() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; if (win && !win.isDestroyed()) win.webContents.send('state', publicState()); }, 60);
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
    stage, stageInfo, busyText, checking, pending: pending(),
    launcher: { version: store.LAUNCHER_VERSION, update: launcherUpdate ? launcherUpdate.version : null, installing: installing.launcher || null, canSelfUpdate: canSelfUpdate() },
    settings: { startup: store.settings.startup, repo: store.settings.repo },
    displays: rt.displays().map((d, i) => ({ index: i, w: d.size.width, h: d.size.height })),
    apps: registry.map((r) => {
      const v = store.installedVersion(r.id);
      return {
        id: r.id, name: r.name, glyph: r.glyph, description: r.description,
        installed: !!v, version: v, previous: v ? store.readState(r.id).previous : null,
        running: rt.isRunning(r.id), update: updates[r.id] ? updates[r.id].version : null,
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
    const r = await dialog.showMessageBox({ type: 'question', buttons: ['Quit launcher', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Quit the launcher?', detail: 'Redcam runs inside the launcher, so it will close too.' });
    if (r.response !== 0) return;
  }
  const todo = pending();
  if (todo.length) {                                  // updates are waiting: offer them on the way out
    const r = await dialog.showMessageBox({
      type: 'question', buttons: ['Update, then quit', 'Quit without updating', 'Cancel'], defaultId: 0, cancelId: 2,
      message: todo.length === 1 ? 'An update is ready.' : todo.length + ' updates are ready.',
      detail: todo.map((t) => `${t.name}: ${t.from} → ${t.to}`).join('\n') + '\n\nUpdating first means next Sunday starts on the new versions. Running apps will be closed.',
    });
    if (r.response === 2) return;
    if (r.response === 0) {
      const res = await runUpdates({ relaunch: false, confirmed: true });
      if (res.failed.length) {
        const f = await dialog.showMessageBox({ type: 'warning', buttons: ['Quit anyway', 'Stay open'], defaultId: 1, cancelId: 1, message: 'Some updates did not finish.', detail: res.failed.join('\n') });
        if (f.response !== 0) return;
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
const repoOk = () => store.settings.repo && !/YOUR-/i.test(store.settings.repo);

async function installMissing() {
  const missing = registry.filter((r) => !store.installedVersion(r.id));
  if (!missing.length) return true;
  if (!repoOk()) { setStage('needRepo'); return false; }
  setStage('install');
  let rels;
  try { rels = await gh.listReleases(store.settings.repo); }
  catch (e) { setStage('error', { message: String(e.message || e), canSkip: installedIds().length > 0 }); return false; }
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
    if (manual) say('Could not check for updates: ' + (e.message || e));   // offline is fine: installed apps still open
  } finally { checking = false; push(); }
}

async function updateApp(id, quiet) {
  const rel = updates[id];
  if (!rel) return false;
  if (rt.isRunning(id)) { say('Close ' + reg(id).name + ' first, then update it.'); return false; }
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
  const t0 = Date.now();
  while (installedIds().some((id) => rt.isRunning(id)) && Date.now() - t0 < 9000) await sleep(250);
}
const runningNames = () => installedIds().filter((id) => rt.isRunning(id)).map((id) => reg(id).name);

// Downloads the new launcher, starts its installer, and closes. relaunch=false when the person is quitting.
async function updateLauncher(opts) {
  const o = Object.assign({ relaunch: true, confirm: true }, opts);
  const rel = launcherUpdate;
  if (!rel) return false;
  if (!canSelfUpdate()) { say('The launcher can only update itself once it is installed with the setup file.'); return false; }
  if (o.confirm && runningNames().length) {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Close apps and update', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Update the launcher?', detail: runningNames().join(' and ') + ' will close first. If you are streaming or recording, it will stop.' });
    if (r.response !== 0) return false;
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
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Close apps and update', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Update now?', detail: runningNames().join(' and ') + ' will close first. If you are streaming or recording, it will stop.' });
    if (r.response !== 0) return res;
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
  for (const id of installedIds()) await openApp(id);
  setStage(null);
  if (win && !win.isDestroyed()) win.hide();    // the launcher shrinks to the tray
}

async function closeApp(id) {
  if (id === 'redcast') {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Close Redcast', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Close Redcast?', detail: 'If you are streaming or recording, it will stop.' });
    if (r.response !== 0) return;
  }
  rt.close(id);
}

// ---------- fix-it tools ----------
async function runTool(name) {
  const ids = installedIds();
  try {
    if (name === 'logs') { await shell.openPath(store.LOGS); return; }
    if (ids.some((id) => rt.isRunning(id)) && name !== 'logs') return say('Close the apps first, then run this.');
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
async function afterInstall() {
  if (!store.settings.screensConfigured) {
    if (rt.displays().length > 1) { setStage('screens'); showWindow(); return; }
    store.settings.screensConfigured = true; store.save();
  }
  await decideStartup(false);
}
async function decideStartup(forceAsk) {
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
  if (registry.some((r) => !store.installedVersion(r.id))) {
    showWindow();
    if (!(await installMissing())) return;
  }
  setStage(null);
  // Ask about updates BEFORE the apps open, so nothing has to be closed. Gives up after 6 seconds when offline.
  await checkUpdates(false, { timeoutMs: 6000, balloon: false });
  if (pending().length) { setStage('updates', { mode: 'start' }); showWindow(); return; }
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
handle('app:rollback', (id) => {
  if (rt.isRunning(id)) return say('Close ' + reg(id).name + ' first.');
  inst.rollback(id); updates[id] = null; say(reg(id).name + ' is back on version ' + store.installedVersion(id) + '.'); push();
});
handle('tab:click', (id) => (rt.isRunning(id) ? rt.focus(id) : openApp(id)));
handle('tabs:get', (idx) => rt.tabData(Number(idx)));
handle('settings:set', ({ key, value }) => {
  if (key === 'startup' && ['ask', 'all', 'launcher'].includes(value)) { store.settings.startup = value; store.save(); push(); }
});
handle('repo:save', (repo) => {
  store.settings.repo = String(repo || '').trim(); store.save();
  if (stage === 'needRepo') boot(); else { push(); checkUpdates(true); }
});
handle('screen:set', ({ id, index }) => { store.settings.screens[id] = index; store.save(); push(); });
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
screen.on('display-added', push);
screen.on('display-removed', push);

app.whenReady().then(() => {
  createWindow();
  createTray();
  boot();
  setInterval(() => checkUpdates(false), 6 * 3600 * 1000);   // the launcher stays in the tray all day: look again now and then
});
