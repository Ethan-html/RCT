// Runs one installed app's main process inside this Electron. Used only when RED_RUN_APP is set.
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const dir = process.env.RED_RUN_APP;
const man = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch (e) { /* optional */ }

// The app thinks it lives in its own folder, not inside the launcher.
process.chdir(dir);
app.getAppPath = () => dir;
const origLoadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, options) {
  return origLoadFile.call(this, path.isAbsolute(file) ? file : path.join(dir, file), options);
};
if (man.appUserModelId) app.setAppUserModelId(man.appUserModelId); // its own taskbar button and icon

let bounds = null;
try { bounds = JSON.parse(process.env.RED_BOUNDS || 'null'); } catch (e) { /* none */ }
const icon = man.icon ? nativeImage.createFromPath(path.join(dir, man.icon)) : null;

// Put the app's FIRST window on the screen chosen in the launcher. Later windows (for example Redcast's
// TV output) are left alone: they have their own screen setting inside the app.
let first = null;
app.on('browser-window-created', (_e, win) => {
  if (first) return;
  first = win;
  try {
    if (icon && !icon.isEmpty()) win.setIcon(icon);
    if (bounds) win.setBounds(bounds);
    if (process.env.RED_MAXIMIZE === '1') win.maximize();
  } catch (e) { /* placement is best effort */ }
});

function bringToFront() {
  const w = first && !first.isDestroyed() ? first : BrowserWindow.getAllWindows()[0];
  if (!w) return;
  if (w.isMinimized()) w.restore();
  w.setAlwaysOnTop(true); w.show(); w.focus(); w.setAlwaysOnTop(false);
}

// The launcher talks to us over stdin, one JSON line per command.
try {
  process.stdin.setEncoding('utf8');
  let buf = '';
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (m.cmd === 'focus') bringToFront();
        if (m.cmd === 'quit') app.quit();
      } catch (e) { /* ignore bad lines */ }
    }
  });
  process.stdin.on('error', () => {});
} catch (e) { /* no stdin: fine */ }

require(path.join(dir, man.main || pkg.main || 'main.js'));
