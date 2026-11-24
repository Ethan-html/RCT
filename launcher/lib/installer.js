// Installs an app version from a release zip, keeps the previous version for rollback,
// and runs the app's one-time setup (Redcast: downloads the right ffmpeg for this PC).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const gh = require('./github');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
async function retry(fn, n = 6) { for (let i = 0; ; i++) { try { return fn(); } catch (e) { if (i >= n) throw e; await sleep(500); } } }

function runSetup(id, version, onLine) {
  return new Promise((resolve, reject) => {
    const man = store.readManifest(id, version);
    const s = man && man.setup;
    if (!s || process.platform !== 'win32') return resolve();
    const dir = store.versionDir(id, version);
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, s.script), ...(s.args || [])], { cwd: dir, windowsHide: true });
    const log = fs.createWriteStream(path.join(store.LOGS, id + '-setup.log'), { flags: 'a' });
    let last = '';
    const feed = (d) => {
      log.write(d);
      String(d).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).forEach((l) => { last = l; if (onLine) onLine(l.slice(0, 100)); });
    };
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('error', reject);
    p.on('exit', (code) => { log.end(); code === 0 ? resolve() : reject(new Error('Setup did not finish. ' + last)); });
  });
}

// True when everything the app needs on this PC (for Redcast: bin\ffmpeg.exe) is in place.
function requirementsOk(id, version) {
  const man = store.readManifest(id, version);
  const need = (man && man.setup && man.setup.requires) || [];
  return need.every((f) => fs.existsSync(path.join(store.versionDir(id, version), f)));
}

async function install(id, rel, report) {
  const AdmZip = require('adm-zip');
  const base = store.appDir(id);
  fs.mkdirSync(base, { recursive: true });
  const zip = path.join(base, 'download.zip');
  report({ pct: 1, text: 'Downloading ' + rel.version + '…' });
  await gh.download(rel.url, zip, (f) => report({ pct: 1 + Math.round(f * 68), text: 'Downloading ' + rel.version + '…' }));

  report({ pct: 72, text: 'Unpacking…' });
  const stage = path.join(base, rel.version + '.new');
  const target = path.join(base, rel.version);
  rmrf(stage);
  new AdmZip(zip).extractAllTo(stage, true);
  fs.rmSync(zip, { force: true });
  if (!fs.existsSync(path.join(stage, 'app.json'))) { rmrf(stage); throw new Error('That release has no app.json inside, so it was not installed.'); }
  // Safety net: the update list already hides versions that need a newer launcher, but never install one by accident.
  const need = (store.readJson(path.join(stage, 'app.json'), {}) || {}).minLauncher;
  if (need && gh.cmp(need, store.LAUNCHER_VERSION) > 0) {
    rmrf(stage);
    throw new Error(`This version needs Red Launcher ${need} or newer (this one is ${store.LAUNCHER_VERSION}). Update the launcher first.`);
  }

  const st = store.readState(id);
  // Keep files that belong to this PC, not to the release (ffmpeg), so updates do not download them again.
  if (st.current) {
    const keep = path.join(store.versionDir(id, st.current), 'bin');
    if (fs.existsSync(keep)) fs.cpSync(keep, path.join(stage, 'bin'), { recursive: true });
  }
  rmrf(target);
  await retry(() => fs.renameSync(stage, target));

  let warning = '';
  const man = store.readManifest(id, rel.version);
  if (man && man.setup && !requirementsOk(id, rel.version)) {
    report({ pct: 80, text: 'Setting up this PC…' });
    try { await runSetup(id, rel.version, (t) => report({ pct: 85, text: t })); }
    catch (e) { warning = e.message; }  // it will try again the first time the app is opened
  }

  store.writeState(id, { current: rel.version, previous: st.current && st.current !== rel.version ? st.current : st.previous });
  prune(id);
  report({ pct: 100, text: 'Installed' });
  return { warning };
}

function prune(id) {
  const st = store.readState(id);
  for (const name of fs.readdirSync(store.appDir(id))) {
    const full = path.join(store.appDir(id), name);
    if (!fs.statSync(full).isDirectory()) continue;
    if (name === st.current || name === st.previous) continue;
    rmrf(full);
  }
}

function rollback(id) {
  const st = store.readState(id);
  if (!st.previous || !fs.existsSync(path.join(store.versionDir(id, st.previous), 'app.json'))) throw new Error('There is no earlier version to go back to.');
  store.writeState(id, { current: st.previous, previous: st.current });
}

// Downloads the launcher's own installer and starts it. Windows only, and only for the installed launcher.
// relaunch=true: the new launcher opens by itself afterwards. relaunch=false (updating while quitting): it does not.
async function installLauncher(rel, report, relaunch) {
  const os = require('os');
  const file = path.join(os.tmpdir(), rel.name || ('Red-Launcher-Setup-' + rel.version + '.exe'));
  fs.rmSync(file, { force: true });
  report({ pct: 1, text: 'Downloading launcher ' + rel.version + '…' });
  await gh.download(rel.url, file, (f) => report({ pct: 1 + Math.round(f * 94), text: 'Downloading launcher ' + rel.version + '…' }));
  if (rel.size && fs.statSync(file).size !== rel.size) { fs.rmSync(file, { force: true }); throw new Error('The launcher download is damaged. Try again.'); }
  report({ pct: 98, text: 'Starting the installer…' });
  // These are the flags electron-builder's installer understands: silent, mark as an update, reopen afterwards.
  const args = ['--updated', '/S'].concat(relaunch ? ['--force-run'] : []);
  const p = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  p.on('error', () => {});
  p.unref();
}

module.exports = { installLauncher, install, runSetup, requirementsOk, rollback };
