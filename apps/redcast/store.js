// Keeps everything the app remembers in a file as well as in the browser store.
// On start the file is loaded first (it wins). After that every change is saved to the file quietly in the background, and once more when the window closes.
(function () {
  const api = window.api;
  if (!api || !api.settingsLoad) return;
  let fileExists = false;
  try {
    const raw = api.settingsLoad();
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        fileExists = true;
        localStorage.clear();
        Object.keys(o).forEach((k) => localStorage.setItem(k, String(o[k])));
      }
    }
  } catch (e) { /* no file yet, or it could not be read: carry on with the browser store */ }

  const dump = () => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return JSON.stringify(o);
  };
  let timer = null;
  const flush = () => { clearTimeout(timer); timer = null; try { api.settingsSave(dump()); } catch (e) { /* ignore */ } };
  window.flushStore = flush;
  const later = () => { if (!timer) timer = setTimeout(flush, 800); };

  const P = Storage.prototype, set = P.setItem, rem = P.removeItem, clr = P.clear;
  P.setItem = function (k, v) { set.call(this, k, v); if (this === localStorage) later(); };
  P.removeItem = function (k) { rem.call(this, k); if (this === localStorage) later(); };
  P.clear = function () { clr.call(this); if (this === localStorage) later(); };

  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);
  if (!fileExists) later(); // first run after this update: copy what the browser store already has into the file
})();
