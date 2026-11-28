// Remote control page. One web page for a phone (and it scales up to a tablet or laptop), reachable only from the church's own network.
// Two tabs: "Stream" (the Output picture, CLEAR ALL, lower thirds, your own message, a Bible verse, videos and photos)
// and "Camera" (the Redcam controls). A 4-digit PIN protects all of it; the browser remembers the PIN after the first time.
// Open it at  http://<this PC's address>:8766
// Redcam's own page is passed through this server (the Camera tab), so the same PIN covers it.
// Nothing is shown to the operator here. The address and PIN are in Settings > Troubleshooting.
const http = require('http');
const os = require('os');
const crypto = require('crypto');

const PORT = 8766;
const REDCAM_PORT = 8080;
const COOKIE = 'rcpin';
const SECRET = crypto.randomBytes(16).toString('hex'); // new every time Redcast starts, so old logins stop working after a restart of the app only if the PIN changed

function lanAddresses() { // the PC's addresses on the local network (not 127.0.0.1)
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((k) => (nets[k] || []).forEach((n) => { if (n.family === 'IPv4' && !n.internal) out.push(n.address); }));
  return out;
}

const OPS = new Set(['state', 'clear', 'tech', 'card', 'message', 'verse', 'play', 'stopvideo']);

function create(env) { // env: { log, snapshot(): Promise<dataUrl|null>, call(op, args): Promise<object> }
  const log = (m) => { try { env.log('Remote: ' + m); } catch (e) { /* ignore */ } };
  let listening = false;
  let pin = '';                         // set by the screen (Settings holds the real one)
  const fails = new Map();              // ip -> { n, until }: guessing the PIN is slowed down

  const token = () => crypto.createHash('sha256').update(SECRET + '|' + pin).digest('hex');
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const cookieOf = (req) => { const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([a-f0-9]+)').exec(req.headers.cookie || ''); return m ? m[1] : ''; };
  const authed = (req) => !!pin && same(cookieOf(req), token());
  const ipOf = (req) => (req.socket && req.socket.remoteAddress) || '';

  const page = () => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#14161a">
<title>Church remote</title>
<style>
  :root{color-scheme:dark;--bg:#14161a;--card:#1f2228;--card2:#272b33;--line:#2d3139;--text:#f2f3f5;--mut:#9aa0ab;--red:#c8282d;--acc:#3b82f6;--amber:#f0b429}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 system-ui,Segoe UI,Arial,sans-serif;padding-top:env(safe-area-inset-top)}
  button,input,select{font:inherit;color:inherit}
  button{font-weight:700;padding:14px 10px;border-radius:12px;border:1px solid var(--line);background:var(--card);min-height:54px;cursor:pointer;touch-action:manipulation}
  button:active{filter:brightness(1.3)}
  button.clear{background:var(--red);border-color:var(--red)}
  button.pri{background:var(--acc);border-color:var(--acc)}
  button.on{outline:3px solid var(--amber)}
  button small{display:block;font-weight:400;color:var(--mut);font-size:12px;margin-top:2px}
  input,select{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--card2);min-height:48px}
  label{display:block;font-size:13px;color:var(--mut);margin:8px 2px 4px}
  .hide{display:none!important}
  /* PIN screen */
  #lock{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px}
  #lock h1{font-size:20px;margin:0}
  #dots{display:flex;gap:14px;margin:6px 0}
  #dots i{width:16px;height:16px;border-radius:50%;border:2px solid var(--mut)}
  #dots i.f{background:var(--text);border-color:var(--text)}
  #pad{display:grid;grid-template-columns:repeat(3,78px);gap:12px}
  #pad button{min-height:68px;font-size:24px}
  #lockmsg{min-height:1.4em;color:var(--amber);font-size:14px;text-align:center}
  /* App */
  #app{display:flex;flex-direction:column;height:100%}
  #views{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}
  .view{padding:10px;max-width:1180px;margin:0 auto}
  #camview{padding:0;height:100%;max-width:none}
  #camview iframe{width:100%;height:100%;border:0;background:#000;display:block}
  #tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:#0f1114;border-top:1px solid var(--line)}
  #tabs button{min-height:56px;font-size:17px}
  #tabs button.cur{background:var(--acc);border-color:var(--acc)}
  .pic{position:relative;background:#000;border:1px solid var(--line);border-radius:12px;overflow:hidden;aspect-ratio:16/9}
  .pic img{width:100%;height:100%;object-fit:contain;display:block}
  .pic span{position:absolute;left:8px;top:8px;background:rgba(0,0,0,.6);padding:2px 8px;border-radius:6px;font-size:12px;letter-spacing:.06em}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .stack{display:grid;gap:10px}
  .main{display:grid;gap:12px}
  details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:0 12px}
  summary{padding:14px 2px;font-weight:700;font-size:15px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center}
  summary::-webkit-details-marker{display:none}
  summary::after{content:"+";color:var(--mut);font-size:20px}
  details[open] summary::after{content:"\\2212"}
  details>.body{padding:0 0 12px}
  .stepper{display:grid;grid-template-columns:52px 1fr 52px;gap:8px;align-items:center}
  .stepper b{text-align:center;font-size:18px}
  .seg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}
  .clips{display:grid;grid-template-columns:1fr;gap:8px}
  .clips button{text-align:left;display:flex;gap:10px;align-items:center}
  .clips button span.k{flex:none;font-size:11px;letter-spacing:.06em;color:var(--mut);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
  .clips button span.n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #toast{position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top));background:#000d;border:1px solid var(--line);padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:92vw;opacity:0;pointer-events:none;transition:opacity .15s}
  #toast.show{opacity:1}
  .empty{color:var(--mut);font-size:14px;padding:6px 2px}
  /* Tablet and laptop: picture and the two big buttons on the left, the rest on the right */
  @media (min-width:820px){
    body{font-size:17px}
    .view{padding:16px}
    .main{grid-template-columns:minmax(340px,5fr) 6fr;align-items:start;gap:18px}
    .left{position:sticky;top:0;display:grid;gap:12px}
    .clips{grid-template-columns:1fr 1fr}
    button{min-height:58px}
    #tabs{grid-template-columns:1fr 1fr;max-width:none}
    #pad{grid-template-columns:repeat(3,92px)}
  }
  @media (min-width:820px) and (orientation:portrait){ .main{grid-template-columns:1fr} .left{position:static} }
</style></head><body>
<div id="toast"></div>

<div id="lock" class="hide">
  <h1>Church remote</h1>
  <div>Enter the 4-digit PIN</div>
  <div id="dots"><i></i><i></i><i></i><i></i></div>
  <div id="lockmsg"></div>
  <div id="pad"></div>
</div>

<div id="app" class="hide">
  <div id="views">
    <div id="streamview" class="view">
      <div class="main">
        <div class="left">
          <div class="pic"><img id="pic" alt="Output picture"><span>OUTPUT</span></div>
          <div class="grid2"><button class="clear" id="clear">CLEAR ALL</button><button id="tech">TECH ERROR</button></div>
        </div>
        <div class="stack">
          <details open><summary>Lower thirds</summary><div class="body">
            <div class="grid2" id="cards">
              <button data-card="welcome">Welcome<small>Thanks for joining us</small></button>
              <button data-card="thanks">Thank you<small>See you next week</small></button>
              <button data-card="follow">Follow us<small>Social names</small></button>
              <button data-card="give" id="cGive" class="hide">Give (QR)<small>QR code and link</small></button>
              <button data-card="service" id="cService" class="hide">Until service starts<small>Counts to the start time</small></button>
            </div>
            <label>Countdown</label>
            <div class="stepper"><button id="minDn">&minus;</button><b><span id="minVal">5</span> minutes</b><button id="minUp">+</button></div>
            <div style="margin-top:8px"><button class="pri" id="cCount" style="width:100%">Start the countdown</button></div>
          </div></details>
          <details><summary>Your own message</summary><div class="body">
            <label for="mA">Big line</label><input id="mA" type="text" autocomplete="off">
            <label for="mB">Small line (optional)</label><input id="mB" type="text" autocomplete="off">
            <div class="seg"><button id="mFull" class="on">Full lower third</button><button id="mSlide">Slide-in</button></div>
            <button class="pri" id="mGo" style="width:100%">Show message</button>
          </div></details>
          <details><summary>Bible verse</summary><div class="body">
            <label for="vRef">Verse (for example John 3:16 or Psalm 23:1-4)</label><input id="vRef" type="text" autocomplete="off" autocapitalize="words">
            <label for="vTr">Translation</label>
            <select id="vTr"><option value="kjv">KJV</option><option value="web">WEB</option><option value="asv">ASV</option><option value="bbe">BBE</option></select>
            <div style="margin-top:10px"><button class="pri" id="vGo" style="width:100%">Show verse</button></div>
          </div></details>
          <details><summary>Videos and photos</summary><div class="body">
            <div class="clips" id="clips"></div>
            <div style="margin-top:8px"><button id="vStop" style="width:100%">Stop the video</button></div>
          </div></details>
        </div>
      </div>
    </div>
    <div id="camview" class="view hide"><iframe id="cam" title="Camera controls"></iframe></div>
  </div>
  <div id="tabs"><button id="tStream" class="cur">Stream</button><button id="tCam">Camera</button></div>
</div>

<script>
(function(){
  var $=function(i){return document.getElementById(i)};
  var PIN_KEY='rcRemotePin', TAB_KEY='rcRemoteTab', pin='', tab='stream', toastT=0, minutes=5, msgType='full';
  function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}}
  function toast(s){var t=$('toast');t.textContent=s;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(function(){t.classList.remove('show')},2800)}

  /* ---- PIN ---- */
  var pad=$('pad'),typed='';
  ['1','2','3','4','5','6','7','8','9','','0','\\u232B'].forEach(function(k){
    var b=document.createElement('button');b.textContent=k;if(!k){b.style.visibility='hidden'}
    b.onclick=function(){ if(k==='\\u232B')typed=typed.slice(0,-1); else if(typed.length<4)typed+=k; dots(); if(typed.length===4)login(typed,true); };
    pad.appendChild(b);
  });
  function dots(){var d=$('dots').children;for(var i=0;i<4;i++)d[i].className=i<typed.length?'f':''}
  function showLock(msg){ $('app').classList.add('hide'); $('lock').classList.remove('hide'); $('lockmsg').textContent=msg||''; typed=''; dots(); }
  function login(p,fromPad){
    fetch('/remote/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:p})})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {s:r.status,j:j}})})
      .then(function(x){
        if(x.s===200){pin=p;ls(PIN_KEY,p);start()}
        else{ls(PIN_KEY,null);showLock(x.s===429?('Too many tries. Wait '+(x.j.wait||60)+' seconds.'):(fromPad?'That PIN is not right.':''))}
      }).catch(function(){showLock('No connection to the church PC.')});
  }
  function authFail(){ls(PIN_KEY,null);showLock('Please enter the PIN again.')}

  /* ---- calls ---- */
  function call(op,args,okText){
    return fetch('/remote/do',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:op,args:args||{}})})
      .then(function(r){ if(r.status===401){authFail();return null} return r.json().catch(function(){return {ok:false}}) })
      .then(function(j){ if(!j)return null; if(j.ok){if(okText)toast(okText)}else toast(j.error||'That did not work. Try again.'); return j })
      .catch(function(){toast('No connection to the church PC.');return null});
  }

  /* ---- state ---- */
  function loadState(){
    fetch('/remote/state').then(function(r){if(r.status===401){authFail();return null}return r.json()}).then(function(s){
      if(!s||!s.ok)return;
      $('cGive').classList.toggle('hide',!s.give); $('cService').classList.toggle('hide',!s.service);
      $('tech').classList.toggle('on',!!s.tech);
      if(!loadState.set&&s.minutes){minutes=s.minutes;$('minVal').textContent=minutes;loadState.set=1}
      var box=$('clips'); box.innerHTML='';
      if(!s.clips||!s.clips.length){var e=document.createElement('div');e.className='empty';e.textContent='No videos or photos on the shelf yet.';box.appendChild(e)}
      else s.clips.forEach(function(c){
        var b=document.createElement('button'),k=document.createElement('span'),n=document.createElement('span');
        k.className='k';k.textContent=c.kind==='video'?'VIDEO':'PHOTO';n.className='n';n.textContent=c.name;b.appendChild(k);b.appendChild(n);
        b.onclick=function(){call('play',{id:c.id},c.kind==='video'?'Playing.':'Photo is up.').then(loadState)};
        box.appendChild(b);
      });
    }).catch(function(){});
  }

  /* ---- picture (only while the Stream tab is showing) ---- */
  var busy=false;
  function tick(){
    if(busy||document.hidden||tab!=='stream'||$('app').classList.contains('hide'))return; busy=true;
    var im=new Image();
    im.onload=function(){$('pic').src=im.src;busy=false};
    im.onerror=function(){busy=false};
    im.src='/remote/snapshot.jpg?'+Date.now();
  }

  /* ---- buttons ---- */
  $('clear').onclick=function(){call('clear',null,'Cleared.').then(loadState)};
  $('tech').onclick=function(){call('tech').then(function(j){if(j&&j.ok)toast(j.tech?'Tech error is on.':'Tech error is off.');loadState()})};
  Array.prototype.forEach.call(document.querySelectorAll('#cards button'),function(b){
    b.onclick=function(){call('card',{kind:b.getAttribute('data-card')},'Sent.')};
  });
  $('minDn').onclick=function(){minutes=Math.max(1,minutes-1);$('minVal').textContent=minutes};
  $('minUp').onclick=function(){minutes=Math.min(120,minutes+1);$('minVal').textContent=minutes};
  $('cCount').onclick=function(){call('card',{kind:'countdown',minutes:minutes},'Countdown started.')};
  $('mFull').onclick=function(){msgType='full';$('mFull').classList.add('on');$('mSlide').classList.remove('on')};
  $('mSlide').onclick=function(){msgType='slide';$('mSlide').classList.add('on');$('mFull').classList.remove('on')};
  $('mGo').onclick=function(){
    var a=$('mA').value.trim(); if(!a){$('mA').focus();return}
    call('message',{a:a,b:$('mB').value.trim(),type:msgType},'Sent.');
  };
  $('vGo').onclick=function(){
    var r=$('vRef').value.trim(); if(!r){$('vRef').focus();return}
    $('vGo').disabled=true; call('verse',{ref:r,trans:$('vTr').value},'Verse is up.').then(function(){$('vGo').disabled=false});
  };
  $('vStop').onclick=function(){call('stopvideo',null,'Stopped.').then(loadState)};

  /* ---- tabs ---- */
  function setTab(t){
    tab=t; ls(TAB_KEY,t);
    $('streamview').classList.toggle('hide',t!=='stream'); $('camview').classList.toggle('hide',t!=='cam');
    $('tStream').classList.toggle('cur',t==='stream'); $('tCam').classList.toggle('cur',t==='cam');
    if(t==='cam'&&!$('cam').getAttribute('src'))$('cam').setAttribute('src','/cam/');
    if(t==='stream'){loadState();tick()}
  }
  $('tStream').onclick=function(){setTab('stream')};
  $('tCam').onclick=function(){setTab('cam')};

  function start(){
    $('lock').classList.add('hide'); $('app').classList.remove('hide');
    setTab(ls(TAB_KEY)==='cam'?'cam':'stream');
  }
  setInterval(tick,2000); setInterval(function(){if(tab==='stream'&&!document.hidden&&!$('app').classList.contains('hide'))loadState()},15000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&tab==='stream'){loadState();tick()}});

  var saved=ls(PIN_KEY);
  if(saved&&/^\\d{4}$/.test(saved))login(saved,false); else showLock('');
})();
</script></body></html>`;

  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const readBody = (req, max) => new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > max) { req.destroy(); resolve(''); } });
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(''));
  });

  function proxy(req, res, path) { // the Camera tab: Redcam's own page, passed through so the PIN covers it
    const headers = Object.assign({}, req.headers, { host: '127.0.0.1:' + REDCAM_PORT });
    delete headers.cookie; delete headers.origin; delete headers.referer;
    const p = http.request({ host: '127.0.0.1', port: REDCAM_PORT, path, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    p.setTimeout(15000, () => p.destroy());
    p.on('error', () => { try { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Camera controls are not running. Open Redcam on the church PC.'); } catch (e) { /* ignore */ } });
    req.pipe(p);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const full = req.url || '/';
      const url = full.split('?')[0];
      if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(page());
        return;
      }
      if (req.method === 'POST' && url === '/remote/login') {
        const ip = ipOf(req), f = fails.get(ip) || { n: 0, until: 0 };
        if (f.until > Date.now()) { json(res, 429, { wait: Math.ceil((f.until - Date.now()) / 1000) }); return; }
        let given = '';
        try { given = String(JSON.parse(await readBody(req, 300)).pin || ''); } catch (e) { /* ignore */ }
        if (pin && /^\d{4}$/.test(given) && same(given, pin)) {
          fails.delete(ip);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `${COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` });
          res.end('{"ok":true}');
        } else {
          f.n += 1;
          if (f.n >= 5) { f.until = Date.now() + 60000 * Math.min(f.n - 4, 10); log('too many wrong PINs from ' + ip); }
          fails.set(ip, f);
          json(res, 401, { ok: false });
        }
        return;
      }
      if (!authed(req)) { json(res, 401, { ok: false }); return; }
      if (req.method === 'GET' && url === '/remote/snapshot.jpg') {
        const data = await env.snapshot();
        const m = /^data:image\/jpeg;base64,(.+)$/.exec(data || '');
        if (!m) { res.writeHead(503); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
        res.end(Buffer.from(m[1], 'base64'));
        return;
      }
      if (req.method === 'GET' && url === '/remote/state') { json(res, 200, await env.call('state', {})); return; }
      if (req.method === 'POST' && url === '/remote/do') {
        let o = {};
        try { o = JSON.parse(await readBody(req, 4000)); } catch (e) { /* ignore */ }
        if (!OPS.has(o.op) || o.op === 'state') { json(res, 400, { ok: false, error: 'Unknown button.' }); return; }
        const r = await env.call(o.op, o.args && typeof o.args === 'object' ? o.args : {});
        if (o.op !== 'state') log(o.op + (o.args && o.args.kind ? ' ' + o.args.kind : ''));
        json(res, 200, r);
        return;
      }
      if (url.startsWith('/remote/')) { res.writeHead(404); res.end(); return; }
      // Anything else belongs to the Camera tab (Redcam's page and its calls)
      if (url === '/cam' || url === '/cam/') proxy(req, res, '/' + (full.includes('?') ? full.slice(full.indexOf('?')) : ''));
      else proxy(req, res, full);
    } catch (e) { try { res.writeHead(500); res.end(); } catch (e2) { /* ignore */ } }
  });
  server.on('error', () => { listening = false; log('could not start (port ' + PORT + ' is busy)'); });
  const listen = () => {
    try {
      server.listen(PORT, '0.0.0.0', () => { listening = true; const a = lanAddresses(); log(a.length ? 'open http://' + a[0] + ':' + PORT + ' on a phone or tablet on the same network' : 'ready, but no network address was found'); });
    } catch (e) { /* ignore */ }
  };
  const address = () => { const a = lanAddresses(); return listening && a.length ? 'http://' + a[0] + ':' + PORT : ''; };
  const setPin = (p) => { const v = String(p || ''); pin = /^\d{4}$/.test(v) ? v : ''; };
  return { listen, address, setPin };
}
module.exports = { create, PORT };
