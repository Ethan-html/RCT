// Makes the release zip for one app:   node tools/package-app.js redcast   (or redcam)
// The version comes from the app's package.json. Run "npm install" inside launcher/ once first.
const fs = require('fs');
const path = require('path');
const AdmZip = require(path.join(__dirname, '..', 'launcher', 'node_modules', 'adm-zip'));

const id = process.argv[2];
const root = path.join(__dirname, '..');
const appDir = path.join(root, 'apps', id || '');
if (!id || !fs.existsSync(path.join(appDir, 'app.json'))) { console.error('Usage: node tools/package-app.js redcast|redcam'); process.exit(1); }

const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const manifest = Object.assign(JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8')), { version });
const zip = new AdmZip();

if (manifest.type === 'backend-window') {
  // Redcam: the built Python backend (PyInstaller folder) plus its icon. Build it first with tools\release-redcam.bat.
  const built = path.join(appDir, 'backend-dist', 'ptz-backend');
  if (!fs.existsSync(path.join(built, 'ptz-backend.exe'))) {
    console.error('The backend is not built yet. Run tools\\release-redcam.bat on Windows instead.'); process.exit(1);
  }
  zip.addLocalFolder(built, 'backend');
  for (const f of ['icon.ico', 'icon.png']) if (fs.existsSync(path.join(appDir, f))) zip.addLocalFile(path.join(appDir, f));
} else {
  // Redcast: all the source, without things that belong to one PC or only matter for stand-alone use.
  const skip = new Set(['bin', 'runtime', 'node_modules', '.git', 'START.bat', 'REPAIR-INSTALL.bat', 'RESET-FFMPEG.bat', 'app.json']);
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir)) {
      if (!rel && skip.has(name)) continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full, path.posix.join(rel, name));
      else zip.addLocalFile(full, rel);
    }
  };
  walk(appDir, '');
}
zip.addFile('app.json', Buffer.from(JSON.stringify(manifest, null, 2)));

fs.mkdirSync(path.join(root, 'release'), { recursive: true });
const out = path.join(root, 'release', `${id}-${version}.zip`);
zip.writeZip(out);
console.log('\nBuilt ' + out + ' (' + Math.round(fs.statSync(out).size / 1048576 * 10) / 10 + ' MB)');
console.log('\nThis is the MANUAL way. Easier: use RELEASE.bat, or the Release button on GitHub (see docs/RELEASING.md).');
console.log('\nTo publish by hand: on GitHub make a new release');
console.log('  Tag:    ' + id + '-v' + version);
console.log('  Attach: ' + path.basename(out));
if (manifest.minLauncher) console.log('  Notes:  paste this line so old launchers hold the update back:  <!-- min-launcher: ' + manifest.minLauncher + ' -->');
