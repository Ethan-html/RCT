// TV output window: test pattern, black, text, or the live picture sent from the Display window.
let state = { mode: 'black', text: '', mute: false }; // black until told what to show, never the test page
const pattern = document.getElementById('pattern');
const textEl = document.getElementById('text');
const vid = document.getElementById('vid');

function render() {
  pattern.hidden = state.mode !== 'pattern';
  textEl.hidden = state.mode !== 'text';
  vid.hidden = state.mode !== 'stream';
  vid.muted = !!state.mute; // some screens have speakers tied to the sound board
  textEl.textContent = state.text || '';
  document.getElementById('info').textContent = `TV OUTPUT OK - ${window.innerWidth} x ${window.innerHeight}`;
}
window.api.on('tv:state', (s) => { state = s; render(); });
window.addEventListener('resize', render);

// ----- picture link from the operator window (local, never leaves this PC) -----
let pc = null;
let queue = Promise.resolve();
// Chromium starts a local picture link at a very low bitrate and only slowly climbs, which looks soft and blocky. Ask for a high floor and start so it is sharp straight away.
function boostSdp(sdp) {
  const lines = sdp.split('\r\n'), vpt = new Set(), hasFmtp = new Set();
  lines.forEach((l) => { let m = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//.exec(l); if (m) vpt.add(m[1]); m = /^a=fmtp:(\d+) /.exec(l); if (m) hasFmtp.add(m[1]); });
  const x = 'x-google-min-bitrate=8000;x-google-start-bitrate=12000;x-google-max-bitrate=20000', out = [];
  lines.forEach((l) => {
    const f = /^a=fmtp:(\d+) /.exec(l);
    if (f && vpt.has(f[1])) { out.push(l + ';' + x); return; }
    out.push(l);
    const r = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//.exec(l);
    if (r && !hasFmtp.has(r[1])) out.push(`a=fmtp:${r[1]} ${x}`);
  });
  return out.join('\r\n');
}
const sig = (m) => window.api.rtcSignal(m);
function closeLink() { if (pc) { try { pc.close(); } catch (e) { /* ignore */ } pc = null; } vid.srcObject = null; }
async function handle(m) {
  if (m.type === 'offer') {
    closeLink();
    pc = new RTCPeerConnection({ iceServers: [] });
    pc.onicecandidate = (e) => { if (e.candidate) sig({ type: 'ice', candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      try { e.receiver.playoutDelayHint = 0; } catch (err) { /* ignore */ } // local link: show frames the moment they arrive
      vid.srcObject = e.streams[0] || new MediaStream([e.track]); vid.play().catch(() => {});
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    const a = await pc.createAnswer();
    a.sdp = boostSdp(a.sdp);
    await pc.setLocalDescription(a);
    sig({ type: 'answer', sdp: a.sdp });
  } else if (m.type === 'ice' && pc) {
    await pc.addIceCandidate(m.candidate);
  } else if (m.type === 'close') {
    closeLink();
  }
}
window.api.on('rtc:signal', (m) => { queue = queue.then(() => handle(m)).catch((e) => console.error('TV link', e)); });
sig({ type: 'ready' });

function tick(now) {
  requestAnimationFrame(tick);
  if (state.mode !== 'pattern') return;
  const d = new Date();
  document.getElementById('clock').textContent =
    d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  const pos = (now / 2500) % 2;               // sweeps left to right and back every 5 seconds
  const x = pos < 1 ? pos : 2 - pos;
  document.getElementById('sweep').style.left = (x * 94) + '%';
}
requestAnimationFrame(tick);
render();
