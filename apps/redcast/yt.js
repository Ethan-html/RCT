// yt.js - YouTube sign-in and broadcast creation (runs in the main process).
// Uses the Google "installed app" sign-in with a temporary local web address to receive the result.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCOPE = 'https://www.googleapis.com/auth/youtube';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/youtube/v3';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Title and description tokens, for example "Sunday Service - {longdate}".
function expandTemplate(text, d) {
  d = d || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const hour = d.getHours();
  const map = {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    longdate: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    shortdate: `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`,
    iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    month: d.toLocaleDateString('en-US', { month: 'long' }),
    day: String(d.getDate()),
    year: String(d.getFullYear()),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    service: hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening',
  };
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k.toLowerCase() in map ? map[k.toLowerCase()] : m));
}

function create(deps) {
  const { shell, safeStorage, userDataDir } = deps;
  const fetchFn = deps.fetchFn || fetch;
  const file = path.join(userDataDir, 'youtube-auth.bin');
  let data = { clientId: '', clientSecret: '', refreshToken: '', channel: '' };
  let access = { token: '', exp: 0 };

  function load() {
    try {
      const buf = fs.readFileSync(file);
      const text = buf[0] === 1 ? safeStorage.decryptString(buf.subarray(1)) : buf.subarray(1).toString('utf8');
      data = Object.assign(data, JSON.parse(text));
    } catch (e) { /* nothing saved yet */ }
  }
  function save() {
    const json = JSON.stringify(data);
    let buf;
    if (safeStorage && safeStorage.isEncryptionAvailable()) buf = Buffer.concat([Buffer.from([1]), safeStorage.encryptString(json)]);
    else buf = Buffer.concat([Buffer.from([0]), Buffer.from(json, 'utf8')]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
  }
  load();

  function status() {
    return { hasClient: !!(data.clientId && data.clientSecret), signedIn: !!data.refreshToken, channel: data.channel || '' };
  }
  function setClient(id, secret) {
    data.clientId = String(id || '').trim();
    if (secret) data.clientSecret = String(secret).trim();
    save();
    return status();
  }

  async function tokenRequest(params) {
    const res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j.error_description || j.error || `HTTP ${res.status}`;
      const err = new Error(j.error === 'invalid_grant' ? 'YouTube sign-in expired. Please sign in again.' : `Google sign-in failed: ${msg}`);
      err.code = j.error;
      throw err;
    }
    return j;
  }

  async function signIn() {
    if (!data.clientId || !data.clientSecret) throw new Error('Add the Google client ID and secret first (Advanced > YouTube connection).');
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const result = await new Promise((resolve, reject) => {
      let timer = null;
      const srv = http.createServer();
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        const redirect = `http://127.0.0.1:${port}`;
        srv.on('request', (req, res) => {
          const u = new URL(req.url, 'http://127.0.0.1');
          if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
          const err = u.searchParams.get('error');
          const code = u.searchParams.get('code');
          const bad = err || !code || u.searchParams.get('state') !== state;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<html><body style="font-family:Segoe UI,Arial;background:#101317;color:#eee;text-align:center;padding-top:80px">
            <h2>${bad ? 'Sign-in did not finish' : 'Signed in'}</h2><p>${bad ? 'You can close this tab and try again in Church Switcher.' : 'You can close this tab and go back to Church Switcher.'}</p></body></html>`);
          clearTimeout(timer);
          srv.close();
          if (bad) reject(new Error(err ? `Sign-in was cancelled or refused (${err}).` : 'Sign-in response was not valid.'));
          else resolve({ code, redirect });
        });
        const url = AUTH_URL + '?' + new URLSearchParams({
          client_id: data.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
          code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state,
        }).toString();
        shell.openExternal(url);
        timer = setTimeout(() => { srv.close(); reject(new Error('Sign-in timed out after 5 minutes.')); }, 5 * 60 * 1000);
      });
    });
    const tok = await tokenRequest({
      code: result.code, client_id: data.clientId, client_secret: data.clientSecret,
      redirect_uri: result.redirect, grant_type: 'authorization_code', code_verifier: verifier,
    });
    if (!tok.refresh_token) throw new Error('Google did not return a long-lived sign-in. Remove Church Switcher from your Google account permissions and try again.');
    data.refreshToken = tok.refresh_token;
    access = { token: tok.access_token, exp: Date.now() + (tok.expires_in || 3600) * 1000 };
    data.channel = '';
    save();
    try {
      const ch = await api('GET', '/channels?part=snippet&mine=true');
      data.channel = (ch.items && ch.items[0] && ch.items[0].snippet.title) || 'your channel';
    } catch (e) { data.channel = 'your channel'; }
    save();
    return status();
  }

  async function signOut() {
    const t = data.refreshToken;
    data.refreshToken = ''; data.channel = ''; access = { token: '', exp: 0 };
    save();
    if (t) { try { await fetchFn(`${REVOKE_URL}?token=${encodeURIComponent(t)}`, { method: 'POST' }); } catch (e) { /* best effort */ } }
    return status();
  }

  async function accessToken() {
    if (access.token && Date.now() < access.exp - 60000) return access.token;
    if (!data.refreshToken) throw new Error('Not signed in to YouTube.');
    const tok = await tokenRequest({
      client_id: data.clientId, client_secret: data.clientSecret, refresh_token: data.refreshToken, grant_type: 'refresh_token',
    });
    access = { token: tok.access_token, exp: Date.now() + (tok.expires_in || 3600) * 1000 };
    return access.token;
  }

  function friendly(j, status) {
    const reason = j && j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
    const msg = (j && j.error && j.error.message) || `HTTP ${status}`;
    if (reason === 'liveStreamingNotEnabled') return 'Live streaming is not turned on for this YouTube channel. Enable it in YouTube Studio (it can take up to 24 hours the first time).';
    if (reason === 'quotaExceeded') return 'YouTube says the daily request limit was reached. Try again tomorrow.';
    if (reason === 'insufficientPermissions' || status === 403) return `YouTube refused the request (${reason || msg}).`;
    return `YouTube error: ${msg}`;
  }

  async function api(method, pathAndQuery, body) {
    const token = await accessToken();
    const res = await fetchFn(API + pathAndQuery, {
      method,
      headers: Object.assign({ Authorization: `Bearer ${token}` }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(friendly(j, res.status));
    return j;
  }

  // Reuse one permanent stream key so nothing changes between services.
  async function ensureStream() {
    const list = await api('GET', '/liveStreams?part=snippet,cdn,status&mine=true&maxResults=50');
    const items = (list.items || []).filter((s) => s.cdn && s.cdn.ingestionType === 'rtmp' && s.cdn.ingestionInfo);
    const pick = items.find((s) => s.snippet && s.snippet.title === 'Church Switcher') || items[0];
    if (pick) return pick;
    return api('POST', '/liveStreams?part=snippet,cdn,contentDetails,status', {
      snippet: { title: 'Church Switcher' },
      cdn: { frameRate: 'variable', ingestionType: 'rtmp', resolution: 'variable' },
      contentDetails: { isReusable: true },
    });
  }

  async function prepare(tpl, now) {
    const d = now || new Date();
    const title = expandTemplate(tpl.title || 'Live Service {date}', d).slice(0, 100);
    const description = expandTemplate(tpl.description || '', d).slice(0, 5000);
    const stream = await ensureStream();
    const info = stream.cdn.ingestionInfo;
    const b = await api('POST', '/liveBroadcasts?part=snippet,contentDetails,status', {
      snippet: { title, description, scheduledStartTime: new Date(d.getTime() + 20000).toISOString() },
      status: { privacyStatus: tpl.privacy || 'unlisted', selfDeclaredMadeForKids: false },
      contentDetails: {
        enableAutoStart: true, enableAutoStop: true, enableDvr: tpl.dvr !== false, recordFromStart: true,
        latencyPreference: tpl.latency || 'low',
      },
    });
    await api('POST', `/liveBroadcasts/bind?part=id,contentDetails&id=${encodeURIComponent(b.id)}&streamId=${encodeURIComponent(stream.id)}`);
    return {
      broadcastId: b.id, streamId: stream.id, title,
      url: info.ingestionAddress, key: info.streamName,
      watchUrl: `https://www.youtube.com/watch?v=${b.id}`,
    };
  }

  async function end(broadcastId) {
    try { await api('POST', `/liveBroadcasts/transition?broadcastStatus=complete&id=${encodeURIComponent(broadcastId)}&part=status`); return true; }
    catch (e) { return false; } // auto-stop will close it when the stream ends
  }

  return { status, setClient, signIn, signOut, prepare, end, expand: expandTemplate };
}

module.exports = { create, expandTemplate };
