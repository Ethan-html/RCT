// Gives each Electron app its own program file with its own name and icon.
//
// Why: Windows names a program in the Firewall prompt, Task Manager and "allow this app" lists by looking at the
// program file itself. Apps run inside the launcher's Electron, so Windows only ever saw "Electron" (or "Red Launcher")
// and Electron's icon. Here each app gets a private copy of the Electron folder where the main .exe is renamed
// (Redcast.exe) and stamped with the app's name and icon. Every other file is a hard link to the original (no extra
// disk space, no copying 200 MB), and anything that cannot be linked is copied.
//
// If anything goes wrong, the app simply runs from the normal Electron exe like before. It is only cosmetic.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');

const SCHEME = 1;   // bump when this way of branding changes, so old copies are rebuilt

function note(text) {
  try { fs.appendFileSync(path.join(store.LOGS, 'brand.log'), new Date().toISOString() + '  ' + text + '\n'); } catch (e) { /* logging is best effort */ }
}

// rcedit is the small tool that rewrites an exe's name and icon. When the launcher is installed it sits outside app.asar.
function findRcedit() {
  const bins = ['rcedit-x64.exe', 'rcedit.exe'];
  const roots = [path.join(__dirname, '..', 'node_modules', 'rcedit', 'bin')];
  for (const r of roots.slice()) roots.push(r.replace('app.asar', 'app.asar.unpacked'));
  for (const r of roots) for (const b of bins) { const f = path.join(r, b); if (fs.existsSync(f) && !f.includes('app.asar' + path.sep)) return f; }
  return null;
}

function runRcedit(rcedit, exe, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(rcedit, [exe].concat(args), { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('rcedit exited with ' + code + ' ' + err.trim()))));
  });
}

// Small fingerprint of a file: if it changes, the copy is out of date.
function sig(file) {
  try { const s = fs.statSync(file); return s.size + ':' + Math.round(s.mtimeMs); } catch (e) { return 'none'; }
}

// Mirrors srcDir into dstDir. Everything is hard-linked (or copied when linking is not possible) except the main exe,
// which is always a real copy because it gets edited. This is async on purpose: the old synchronous version blocked the
// launcher's main process for seconds on first start, which froze the whole app when both apps were started at once.
async function mirror(srcDir, dstDir, mainExe) {
  await fsp.mkdir(dstDir, { recursive: true });
  for (const ent of await fsp.readdir(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name), d = path.join(dstDir, ent.name);
    if (ent.isDirectory()) { await mirror(s, d, mainExe); continue; }
    if (/^uninstall/i.test(ent.name)) continue;           // the launcher's uninstaller is not needed here
    if (s === mainExe) continue;                          // copied separately
    try { await fsp.link(s, d); } catch (e) { await fsp.copyFile(s, d); }
  }
}

const building = new Map();   // id -> Promise, so two requests for the same app share one build

// Returns the path of the program to start for this app. Never throws.
function exeFor(id, name, iconPath) {
  if (process.platform !== 'win32') return Promise.resolve(process.execPath);
  if (!building.has(id)) building.set(id, build(id, name, iconPath).finally(() => building.delete(id)));
  return building.get(id);
}

async function build(id, name, iconPath) {
  try {
    const srcExe = process.execPath, srcDir = path.dirname(srcExe);
    const dir = path.join(store.ROOT, 'runtime', id);
    const safe = String(name || id).replace(/[\\/:*?"<>|]/g, '').trim() || id;
    const exe = path.join(dir, safe + '.exe');
    const stampFile = path.join(dir, '.brand.json');
    const stamp = JSON.stringify({
      scheme: SCHEME, name: safe, launcher: store.LAUNCHER_VERSION,
      exe: sig(srcExe), asar: sig(path.join(srcDir, 'resources', 'app.asar')), icon: iconPath ? sig(iconPath) : 'none',
    });
    let have = ''; try { have = fs.readFileSync(stampFile, 'utf8'); } catch (e) { /* first time */ }
    if (have === stamp && fs.existsSync(exe)) return exe;                // already up to date: instant

    const t0 = Date.now();
    note('building the branded copy for ' + id + ' (first start after an update can take a while)');
    const rcedit = findRcedit();
    if (!rcedit) { note('rcedit not found, ' + name + ' will run as plain Electron'); return process.execPath; }

    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    await mirror(srcDir, dir, srcExe);
    await fsp.copyFile(srcExe, exe);
    const args = [
      '--set-version-string', 'FileDescription', safe,
      '--set-version-string', 'ProductName', safe,
      '--set-version-string', 'InternalName', safe,
      '--set-version-string', 'OriginalFilename', safe + '.exe',
      '--set-version-string', 'CompanyName', 'Red',
    ];
    if (iconPath && fs.existsSync(iconPath) && /\.ico$/i.test(iconPath)) args.push('--set-icon', iconPath);
    await runRcedit(rcedit, exe, args);
    fs.writeFileSync(stampFile, stamp);
    note('built ' + id + ' in ' + Math.round((Date.now() - t0) / 100) / 10 + 's');
    return exe;
  } catch (e) {
    note('could not brand ' + id + ': ' + (e && e.message || e));
    return process.execPath;
  }
}

module.exports = { exeFor };
