// Settings and the on-disk layout. Everything lives in %APPDATA%\Red Launcher:
//   settings.json
//   logs\
//   apps\<id>\state.json          which version is current and which is the previous one
//   apps\<id>\<version>\...       one folder per installed version
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// RCT_DATA is set by START-LOCAL.bat so test runs keep their files in the project's .local-data folder (ignored by git)
// instead of touching the real install in %APPDATA%.
const ROOT = process.env.RCT_DATA || path.join(app.getPath('appData'), 'Red Launcher');
const LAUNCHER_VERSION = app.getVersion();   // the version in launcher/package.json, which RCT's release workflow bumps
const APPS = path.join(ROOT, 'apps');
const LOGS = path.join(ROOT, 'logs');
const SETTINGS_FILE = path.join(ROOT, 'settings.json');
fs.mkdirSync(APPS, { recursive: true });
fs.mkdirSync(LOGS, { recursive: true });

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function writeJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

const cfg = readJson(path.join(__dirname, '..', 'launcher.config.json'), {});
const settings = Object.assign({ startup: 'ask', repo: cfg.repo || '', screens: {}, screensConfigured: false }, readJson(SETTINGS_FILE, {}));
if (!settings.repo) settings.repo = cfg.repo || '';
function save() { writeJson(SETTINGS_FILE, settings); }

const appDir = (id) => path.join(APPS, id);
const versionDir = (id, v) => path.join(APPS, id, v);
const readState = (id) => readJson(path.join(appDir(id), 'state.json'), { current: null, previous: null });
const writeState = (id, s) => writeJson(path.join(appDir(id), 'state.json'), s);
function installedVersion(id) {
  const s = readState(id);
  return s.current && fs.existsSync(path.join(versionDir(id, s.current), 'app.json')) ? s.current : null;
}
const readManifest = (id, v) => readJson(path.join(versionDir(id, v), 'app.json'), null);

module.exports = { LAUNCHER_VERSION, ROOT, APPS, LOGS, settings, save, appDir, versionDir, readState, writeState, installedVersion, readManifest, readJson };
