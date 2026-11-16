'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const listen = (ch) => (fn) => ipcRenderer.on(ch, (_e, v) => fn(v));
contextBridge.exposeInMainWorld('hub', {
  init: () => ipcRenderer.invoke('init'),
  onStatus: listen('status'),
  onUnread: listen('unread'),
  onCmd: listen('cmd'),
  onFocused: listen('focused'),
  commit: (layout) => ipcRenderer.send('commit', layout),
  bounds: (b) => ipcRenderer.send('bounds', b),
  cover: (on) => ipcRenderer.send('cover', on),
  focusView: (id) => ipcRenderer.send('focus-view', id),
  retry: (id) => ipcRenderer.send('retry', id),
  retryFailed: () => ipcRenderer.send('retry-failed'),
  nav: (id, action) => ipcRenderer.send('nav', { id, action }),
});
