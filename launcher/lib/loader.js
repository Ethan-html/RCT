// The small window shown while an app starts: the app's icon, its name, what it is doing right now, and a progress bar.
// It sits above everything on the screen the app will open on, and closes by itself when the app is ready.
const { BrowserWindow } = require('electron');

const TILE = '<rect x="16" y="16" width="480" height="480" rx="112" fill="#141414" stroke="#2e2e2e" stroke-width="4"/>';
const GLYPHS = {
  live: TILE + '<g fill="none" stroke="#ebebeb" stroke-width="30" stroke-linecap="round"><path d="M330.3 189.1A100 100 0 0 1 330.3 322.9"/><path d="M181.7 322.9A100 100 0 0 1 181.7 189.1"/><path d="M382.3 142.3A170 170 0 0 1 382.3 369.7"/><path d="M129.7 369.7A170 170 0 0 1 129.7 142.3"/></g><circle cx="256" cy="256" r="58" fill="#ef4b52"/>',
  cam: TILE + '<circle cx="256" cy="256" r="127" fill="none" stroke="#ebebeb" stroke-width="30"/><circle cx="256" cy="256" r="44" fill="#ef4b52"/><g fill="#ef4b52"><path d="M256 58L226 104H286Z"/><path d="M256 454L226 408H286Z"/><path d="M58 256L104 226V286Z"/><path d="M454 256L408 226V286Z"/></g>',
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page(name, glyph) {
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#141414;color:#ebebeb;font:14px "Segoe UI",system-ui,sans-serif;-webkit-user-select:none;user-select:none}
body{border:1px solid #2e2e2e;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:0 34px;animation:in .25s ease-out}
@keyframes in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
body.out{opacity:0;transition:opacity .3s}
svg{width:76px;height:76px;filter:drop-shadow(0 0 18px rgba(239,75,82,.3))}
h1{margin:6px 0 0;font-size:19px;font-weight:600;letter-spacing:.2px}
#t{color:#8c8c8c;font-size:13px;min-height:18px}
.bar{width:100%;height:8px;border-radius:99px;background:#2a2a2a;overflow:hidden;margin-top:6px}
.bar i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#ef4b52,#ff9a9f,#ef4b52);background-size:200% 100%;animation:sh 1.2s linear infinite}
@keyframes sh{to{background-position:-200% 0}}
#p{color:#8c8c8c;font-size:12px;align-self:flex-end;font-variant-numeric:tabular-nums}
</style><svg viewBox="0 0 512 512">${GLYPHS[glyph] || GLYPHS.live}</svg>
<h1>${esc(name)}</h1><div id="t">Starting...</div><div class="bar"><i id="b"></i></div><div id="p">0%</div>
<script>
// The bar eases toward the latest value it was told, and creeps forward a little while it waits, so it never looks frozen.
let target = 0, shown = 0, last = 'Starting...';
window.__set = (pct, text) => { target = Math.max(target, Math.min(100, pct)); if (text) { last = text; document.getElementById('t').textContent = text; } };
window.__out = () => document.body.classList.add('out');
(function tick() {
  const cap = target >= 100 ? 100 : Math.min(97, target + 6);
  shown += (target - shown) * 0.08;
  if (shown >= target - 0.4 && shown < cap) shown += 0.03;
  shown = Math.min(shown, cap);
  document.getElementById('b').style.width = shown + '%';
  document.getElementById('p').textContent = Math.round(shown) + '%';
  requestAnimationFrame(tick);
})();
</script>`;
}

// open({ name, glyph, bounds }) -> { set(pct, text), finish(), close() }
function open(opts) {
  const w = 420, h = 250, b = opts.bounds || { x: 0, y: 0, width: 1280, height: 720 };
  let win = null, loaded = false, closed = false, pending = null;
  try {
    win = new BrowserWindow({
      width: w, height: h, x: Math.round(b.x + (b.width - w) / 2), y: Math.round(b.y + (b.height - h) / 2),
      frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, focusable: false, show: false, hasShadow: true, backgroundColor: '#141414', alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.once('ready-to-show', () => { if (win && !win.isDestroyed() && !closed) win.showInactive(); });
    win.webContents.once('did-finish-load', () => { loaded = true; if (pending) { run(pending.pct, pending.text); pending = null; } });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(opts.name, opts.glyph))).catch(() => {});
  } catch (e) { win = null; }       // a loading window is only nice to have: the app starts without it
  const alive = () => win && !win.isDestroyed() && !closed;
  function run(pct, text) { if (alive()) win.webContents.executeJavaScript(`window.__set(${Number(pct) || 0},${JSON.stringify(String(text || ''))})`).catch(() => {}); }
  const api = {
    set(pct, text) { if (!alive()) return; if (!loaded) pending = { pct: Math.max(pct, pending ? pending.pct : 0), text: text || (pending && pending.text) }; else run(pct, text); },
    close() { closed = true; try { if (win && !win.isDestroyed()) win.destroy(); } catch (e) { /* already gone */ } },
    finish() {       // 100%, a moment to show it, then fade away
      if (!alive()) return;
      api.set(100, 'Ready');
      setTimeout(() => { if (alive()) win.webContents.executeJavaScript('window.__out()').catch(() => {}); }, 350);
      setTimeout(() => api.close(), 700);
    },
  };
  return api;
}

module.exports = { open };
