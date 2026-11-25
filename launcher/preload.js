const { contextBridge, ipcRenderer } = require('electron');
const OK = new Set(['state:get', 'app:open', 'app:close', 'app:openAll', 'app:update', 'launcher:update', 'updates:all', 'updates:later', 'app:rollback', 'confirm:answer',
  'settings:set', 'screen:set', 'screens:done', 'screens:identify', 'startup:choose', 'updates:check', 'tool:run', 'boot:retry', 'boot:skip', 'repo:save']);
contextBridge.exposeInMainWorld('red', {
  invoke: (ch, arg) => (OK.has(ch) ? ipcRenderer.invoke(ch, arg) : Promise.reject(new Error('blocked'))),
  on: (ch, cb) => { if (['state', 'toast'].includes(ch)) ipcRenderer.on(ch, (_e, d) => cb(d)); },
});
