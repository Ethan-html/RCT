// Talks to GitHub Releases. Public repo, no token. Each release is tagged "<name>-v<version>":
//   redcast-v0.2.0   has one .zip attached that starts with "redcast-"
//   redcam-v1.3.0    has one .zip attached that starts with "redcam-"
//   launcher-v0.2.0  has the Red-Launcher-Setup-<version>.exe installer attached
// An app release can say which launcher it needs by putting a line like  min-launcher: 0.2.0  in its notes.
const fs = require('fs');

function parse(v) { return String(v).split('.').map((n) => parseInt(n, 10) || 0); }
function cmp(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
}

async function listReleases(repo, timeoutMs) {
  const { net } = require('electron');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('The GitHub repo name looks wrong. It should look like owner/repo.');
  const r = await net.fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: { 'User-Agent': 'RedLauncher', Accept: 'application/vnd.github+json' },
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (r.status === 404) throw new Error('GitHub says that repo does not exist, or it is private. Check the name in Settings.');
  if (!r.ok) throw new Error('GitHub answered with an error (' + r.status + '). Try again in a minute.');
  return r.json();
}

// The oldest launcher an app release works with, read from the release notes. Missing = works with any launcher.
function minLauncherOf(rel) {
  const m = /min-launcher:\s*v?(\d+\.\d+\.\d+)/i.exec((rel && rel.body) || '');
  return m ? m[1] : null;
}

function toRelease(id, rel, version) {
  const isLauncher = id === 'launcher';
  const asset = (rel.assets || []).find((a) => isLauncher
    ? /^Red-Launcher-Setup-.*\.exe$/i.test(a.name)
    : /\.zip$/i.test(a.name) && a.name.toLowerCase().startsWith(id + '-'));
  return asset ? { id, version, tag: rel.tag_name, url: asset.browser_download_url, size: asset.size, name: asset.name, minLauncher: isLauncher ? null : minLauncherOf(rel) } : null;
}

// Newest published release for one app, ignoring drafts, pre-releases and other apps' tags.
function latestFor(releases, id) {
  const re = new RegExp('^' + id + '-v(\\d+\\.\\d+\\.\\d+)$');
  let best = null;
  for (const rel of releases || []) {
    if (rel.draft || rel.prerelease) continue;
    const m = re.exec(rel.tag_name || '');
    if (!m) continue;
    const r = toRelease(id, rel, m[1]);
    if (r && (!best || cmp(r.version, best.version) > 0)) best = r;
  }
  return best;
}

function releaseByVersion(releases, id, version) {
  const rel = (releases || []).find((x) => x.tag_name === `${id}-v${version}`);
  return rel ? toRelease(id, rel, version) : null;
}

async function download(url, dest, onProgress) {
  const { net } = require('electron');
  const r = await net.fetch(url, { headers: { 'User-Agent': 'RedLauncher' } });
  if (!r.ok || !r.body) throw new Error('Download failed (' + r.status + ')');
  const total = Number(r.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  const reader = r.body.getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
      if (total && onProgress) onProgress(got / total);
    }
  } finally {
    await new Promise((res) => out.end(res));
  }
  if (total && got < total) throw new Error('The download was cut short. Check the internet connection.');
}

module.exports = { minLauncherOf, cmp, listReleases, latestFor, releaseByVersion, download };
