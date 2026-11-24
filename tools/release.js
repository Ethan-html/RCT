// Bumps a version number and (on your PC) tags it so GitHub builds and publishes the release.
//
//   node tools/release.js                           asks you what to do
//   node tools/release.js redcast patch             1.2.3 -> 1.2.4
//   node tools/release.js redcam minor              1.2.3 -> 1.3.0
//   node tools/release.js launcher major            1.2.3 -> 2.0.0
//   node tools/release.js redcast same              publish the number that is already there (the very first release)
//   node tools/release.js redcast 0.5.0             set an exact number
//   ...  --min-launcher 0.2.0                       apps only: this version needs launcher 0.2.0 or newer
//   ...  --no-git                                   only change the files (the GitHub "Release" button uses this)
//   node tools/release.js --from-tag redcast-v0.2.0 used by GitHub when a tag is pushed by hand
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const readline = require('readline');

const root = path.join(__dirname, '..');
const APPS = ['redcast', 'redcam', 'launcher'];
const rel = (...p) => path.join(root, ...p);
const pkgPath = (id) => (id === 'launcher' ? rel('launcher', 'package.json') : rel('apps', id, 'package.json'));
const manPath = (id) => rel('apps', id, 'app.json');
const SEMVER = /^\d+\.\d+\.\d+$/;
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const die = (m) => { console.error('\nERROR: ' + m + '\n'); process.exit(1); };
const readVersion = (id) => JSON.parse(fs.readFileSync(pkgPath(id), 'utf8')).version;
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function bump(v, how) {
  if (SEMVER.test(how)) return how;
  if (how === 'same') return v;
  const [a, b, c] = v.split('.').map(Number);
  if (how === 'major') return `${a + 1}.0.0`;
  if (how === 'minor') return `${a}.${b + 1}.0`;
  if (how === 'patch') return `${a}.${b}.${c + 1}`;
  die(`"${how}" is not patch, minor, major, same or a number like 1.4.0.`);
}

function writeVersion(id, version) {
  const p = pkgPath(id);
  const txt = fs.readFileSync(p, 'utf8');
  if (!/"version"\s*:\s*"[^"]+"/.test(txt)) die('No "version" line found in ' + p);
  fs.writeFileSync(p, txt.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version}"`));   // keeps the file's formatting
}

function writeMinLauncher(id, min) {
  const p = manPath(id);
  const man = JSON.parse(fs.readFileSync(p, 'utf8'));
  man.minLauncher = min;
  fs.writeFileSync(p, JSON.stringify(man, null, 2) + '\n');
}

// release/notes.md becomes the text on the GitHub release page. The hidden min-launcher line is what the
// launcher reads to decide whether to show an Update button.
function writeNotes(id, version) {
  const names = { redcast: 'Redcast', redcam: 'Redcam', launcher: 'Red Launcher' };
  let txt = `## ${names[id]} ${version}\n\n${(process.env.RELEASE_NOTES || '').trim() || 'See the commit history for what changed.'}\n`;
  if (id !== 'launcher') {
    const min = JSON.parse(fs.readFileSync(manPath(id), 'utf8')).minLauncher;
    if (min) txt += `\nRequires Red Launcher ${min} or newer.\n\n<!-- min-launcher: ${min} -->\n`;
  }
  fs.mkdirSync(rel('release'), { recursive: true });
  fs.writeFileSync(rel('release', 'notes.md'), txt);
}

function output(o) {
  Object.entries(o).forEach(([k, v]) => console.log(`${k}=${v}`));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(o).map(([k, v]) => `${k}=${v}\n`).join(''));
}

function ask(rl, q) { return new Promise((res) => rl.question(q, (a) => res(a.trim()))); }

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

  // --- GitHub: a tag was pushed by hand. Check the numbers agree, then just write the notes.
  if (flag('--from-tag')) {
    const tag = opt('--from-tag');
    const m = /^(redcast|redcam|launcher)-v(\d+\.\d+\.\d+)$/.exec(tag || '');
    if (!m) die(`The tag "${tag}" does not look like redcast-v0.2.0.`);
    const [, id, version] = m;
    if (readVersion(id) !== version) die(`The tag says ${version} but ${path.relative(root, pkgPath(id))} says ${readVersion(id)}. Use the "Release" button on GitHub (Actions tab) or run RELEASE.bat so they always match.`);
    writeNotes(id, version);
    return output({ app: id, version, tag, files: '' });
  }

  let [id, how] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--min-launcher');
  let min = opt('--min-launcher');
  let interactive = false;
  if (!id) {
    interactive = true;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\nCurrent versions:');
    APPS.forEach((a, i) => console.log(`  ${i + 1}) ${a.padEnd(9)} ${readVersion(a)}`));
    const n = Number(await ask(rl, '\nWhich one are you releasing? (1-3): '));
    id = APPS[n - 1]; if (!id) die('Pick 1, 2 or 3.');
    const b = await ask(rl, 'Size of change: 1) patch = small fix   2) minor = new feature   3) major = big change   4) same number (very first release)   [1]: ');
    how = { '': 'patch', 1: 'patch', 2: 'minor', 3: 'major', 4: 'same' }[b] || b;
    if (id !== 'launcher') {
      const cur = JSON.parse(fs.readFileSync(manPath(id), 'utf8')).minLauncher || 'none';
      const m = await ask(rl, `Oldest launcher this needs? Press Enter to keep ${cur}, or type a version like 0.2.0: `);
      if (m) min = m;
    }
    process.env.RELEASE_NOTES = process.env.RELEASE_NOTES || await ask(rl, 'One line about what changed (optional): ');
    rl.close();
  }
  if (!APPS.includes(id)) die(`Unknown app "${id}". Use redcast, redcam or launcher.`);
  if (!how) die('Say how to bump: patch, minor, major, or an exact number like 1.4.0.');
  if (min && id === 'launcher') die('--min-launcher is for apps only.');
  if (min && !SEMVER.test(min)) die(`"${min}" is not a version like 0.2.0.`);

  const old = readVersion(id);
  const next = bump(old, how);
  if (how !== 'same' && cmp(next, old) <= 0) die(`${next} is not higher than the current ${old}.`);
  const tag = `${id}-v${next}`;
  const useGit = !flag('--no-git');

  if (useGit) {
    try { git('rev-parse', '--is-inside-work-tree'); } catch (e) { die('This is not a git repo. Run this from your cloned RCT folder.'); }
    if (git('tag', '-l', tag)) die(`The tag ${tag} already exists.`);
    const dirty = git('status', '--porcelain').split('\n').filter(Boolean);
    if (dirty.length) die('You have unsaved changes:\n  ' + dirty.join('\n  ') + '\n\nCommit them first (so they go into this release), then run this again.');
  }

  writeVersion(id, next);
  const files = [path.relative(root, pkgPath(id))];
  if (id !== 'launcher') {
    if (min) writeMinLauncher(id, min);
    files.push(path.relative(root, manPath(id)));
  }
  const needs = id !== 'launcher' ? JSON.parse(fs.readFileSync(manPath(id), 'utf8')).minLauncher : null;
  writeNotes(id, next);

  console.log(next === old ? `\n${id}: publishing ${next} as it is` : `\n${id}: ${old} -> ${next}`);
  if (needs) {
    console.log(`Needs launcher ${needs} or newer.`);
    if (cmp(needs, readVersion('launcher')) > 0) console.log(`NOTE: the launcher in this repo is only ${readVersion('launcher')}. Release the launcher first (or after, before anyone updates), or this app update will never appear.`);
  }

  if (!useGit) return output({ app: id, version: next, tag, files: files.join(' ') });

  if (interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ok = (await ask(rl, `\nSave, tag ${tag} and send it to GitHub now? GitHub then builds and publishes it. (y/n): `)).toLowerCase();
    rl.close();
    if (ok !== 'y') { git('checkout', '--', ...files); console.log('Cancelled. Nothing was changed.'); return; }
  }
  git('add', ...files);
  if (execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).trim()) git('commit', '-m', `Release ${tag}`);   // nothing to save when the number did not change
  git('tag', tag);
  console.log('\nSending to GitHub...');
  git('push', 'origin', 'HEAD'); git('push', 'origin', tag);
  console.log(`\nDone. Watch it build: the "Actions" tab on GitHub. In a few minutes the release ${tag} appears and church PCs will offer the update.`);
}

main().catch((e) => die(e.stderr ? String(e.stderr) : e.message));
