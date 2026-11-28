// Sermon clip. Redcam says "start" when the camera goes to the Sermon scene and "end" when it goes to any other scene.
// Redcast notes the times while the stream records. When the stream is over, the sermon parts are cut out of the full recording
// (no re-encoding), joined in order, and saved as Sermon.mp4 and "Sermon audio.mp3" in the same folder as the full recording.
// Nothing is shown to the operator.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8765;                 // Redcast listens here, on this computer only
const REDCAM_STATE = 'http://127.0.0.1:8080/api/sermon/state';
const GRACE_MS = 15000;            // leaving the Sermon scene and coming back within this long counts as one continuous sermon
const MIN_PART_SEC = 2;

function create(env) { // env: { ffmpegPath, log }
  let sess = null;     // { folder, segments: [{ file, start, end }], sermon: [{ start, end }] }
  const log = (m) => { try { env.log('Sermon: ' + m); } catch (e) { /* ignore */ } };
  const sessFile = () => (sess ? path.join(sess.folder, '.sermon-session.json') : null);
  const save = () => { try { if (sess) fs.writeFileSync(sessFile(), JSON.stringify(sess)); } catch (e) { /* ignore */ } };

  function begin(folder) { // a stream (or the continuation of one after a reconnect / restart) starts recording into this folder
    let prior = null;
    try { prior = JSON.parse(fs.readFileSync(path.join(folder, '.sermon-session.json'), 'utf8')); } catch (e) { /* new stream */ }
    const isNew = !(prior && Array.isArray(prior.segments) && Array.isArray(prior.sermon));
    sess = isNew ? { folder, segments: [], sermon: [] } : Object.assign(prior, { folder });
    save();
    if (isNew) askRedcam(); // the camera may already be on the Sermon scene when the stream starts
  }
  function askRedcam() {
    try {
      const req = http.get(REDCAM_STATE, { timeout: 1500 }, (res) => {
        let b = '';
        res.on('data', (d) => { b += d; if (b.length > 2000) res.destroy(); });
        res.on('end', () => { try { if (JSON.parse(b).inSermon) event('start'); } catch (e) { /* ignore */ } });
      });
      req.on('error', () => {}); req.on('timeout', () => req.destroy());
    } catch (e) { /* Redcam is not running */ }
  }
  function segmentStart(file) { if (sess && file) { sess.segments.push({ file, start: null, end: null }); save(); } }
  function firstChunk() { // video really starts flowing now
    const s = sess && sess.segments[sess.segments.length - 1];
    if (s && s.start === null) { s.start = Date.now(); save(); }
  }
  function segmentEnd() {
    const s = sess && sess.segments[sess.segments.length - 1];
    if (s && s.start !== null && s.end === null) { s.end = Date.now(); save(); }
  }
  function event(kind) {
    if (!sess) return; // nothing is recording: nothing to cut
    const now = Date.now(), last = sess.sermon[sess.sermon.length - 1];
    if (kind === 'start') {
      if (last && last.end === null) return;                                    // already in the sermon
      if (last && now - last.end <= GRACE_MS) { last.end = null; log('back within the grace time, one continuous sermon'); }
      else { sess.sermon.push({ start: now, end: null }); log('started'); }
    } else if (kind === 'end') {
      if (last && last.end === null) { last.end = now; log('ended'); }
    }
    save();
  }

  // Position of a clock time inside the joined full recording (pieces are laid end to end, gaps between them are not in the file).
  function toOffset(t) {
    let acc = 0;
    for (const s of sess.segments) {
      if (s.start === null) continue;
      const end = s.end === null ? Date.now() : s.end;
      if (t < s.start) return acc;
      if (t <= end) return acc + (t - s.start) / 1000;
      acc += (end - s.start) / 1000;
    }
    return acc;
  }
  const run = (args) => new Promise((resolve) => {
    try {
      const p = spawn(env.ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'ignore', windowsHide: true });
      p.on('error', () => resolve(false));
      p.on('exit', (c) => resolve(c === 0));
    } catch (e) { resolve(false); }
  });

  async function finish(full) { // the stream is over and `full` is the whole recording
    if (!sess) return;
    const s = sess; sess = null;
    try {
      const ends = s.segments.map((g) => g.end).filter((x) => x !== null);
      const streamEnd = ends.length ? Math.max(...ends) : Date.now();
      s.sermon.forEach((i) => { if (i.end === null) i.end = streamEnd; }); // the stream ended while still on the Sermon scene
      if (!s.sermon.length || !full || !fs.existsSync(full)) { try { fs.unlinkSync(path.join(s.folder, '.sermon-session.json')); } catch (e) { /* ignore */ } return; }
      sess = s; // toOffset reads it
      const spans = s.sermon.map((i) => [toOffset(i.start), toOffset(i.end)]).filter(([a, b]) => b - a >= MIN_PART_SEC);
      sess = null;
      const parts = [];
      for (let k = 0; k < spans.length; k++) {
        const part = path.join(s.folder, `.sermon-part${k + 1}.mp4`);
        if (await run(['-ss', spans[k][0].toFixed(2), '-i', full, '-t', (spans[k][1] - spans[k][0]).toFixed(2), '-c', 'copy', '-movflags', '+faststart', part])) parts.push(part);
      }
      if (!parts.length) { log('nothing could be cut'); return; }
      const out = path.join(s.folder, 'Sermon.mp4');
      let ok = false;
      if (parts.length === 1) { try { fs.renameSync(parts[0], out); ok = true; } catch (e) { /* ignore */ } }
      else {
        const list = path.join(s.folder, '.sermon-list.txt');
        fs.writeFileSync(list, parts.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
        ok = await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
        try { fs.unlinkSync(list); } catch (e) { /* ignore */ }
      }
      parts.forEach((f) => { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } });
      if (!ok) { log('could not join the sermon parts'); return; }
      const mp3 = await run(['-i', out, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', path.join(s.folder, 'Sermon audio.mp3')]);
      log(`saved Sermon.mp4${mp3 ? ' and Sermon audio.mp3' : ' (the audio file could not be made)'} in ${s.folder}`);
      try { fs.unlinkSync(path.join(s.folder, '.sermon-session.json')); } catch (e) { /* ignore */ }
    } catch (e) { log('failed: ' + e.message); }
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/sermon') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 2000) req.destroy(); });
      req.on('end', () => {
        try { const ev = JSON.parse(body).event; if (ev === 'start' || ev === 'end') event(ev); } catch (e) { /* ignore */ }
        res.writeHead(200); res.end('ok');
      });
    } else { res.writeHead(404); res.end(); }
  });
  server.on('error', () => { /* port busy: the sermon clip simply does not run */ });
  const listen = () => { try { server.listen(PORT, '127.0.0.1'); } catch (e) { /* ignore */ } };
  return { listen, begin, event, segmentStart, firstChunk, segmentEnd, finish };
}
module.exports = { create };
