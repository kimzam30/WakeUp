'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const listen = (ch) => (fn) => ipcRenderer.on(ch, (_e, v) => fn(v));
contextBridge.exposeInMainWorld('hub', {
  init: () => ipcRenderer.invoke('init'),
  onStatus: listen('status'),
  onUnread: listen('unread'),
  onCmd: listen('cmd'),
  onFocused: listen('focused'),
  onSettings: listen('settings'),
  onDownload: listen('download'),
  onFound: listen('found'),
  commit: (layout) => ipcRenderer.send('commit', layout),
  bounds: (b) => ipcRenderer.send('bounds', b),
  cover: (on) => ipcRenderer.send('cover', on),
  focusView: (id) => ipcRenderer.send('focus-view', id),
  retry: (id) => ipcRenderer.send('retry', id),
  retryFailed: () => ipcRenderer.send('retry-failed'),
  nav: (id, action) => ipcRenderer.send('nav', { id, action }),
  find: (id, text, forward, start) => ipcRenderer.send('find', { id, text, forward, start }),
  findBar: (id, open) => ipcRenderer.send('find-bar', { id, open }),
  setSettings: (patch) => ipcRenderer.invoke('settings-set', patch),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  clearAppData: (id) => ipcRenderer.send('clear-app-data', id),
  download: (id, action) => ipcRenderer.send('download', { id, action }),
  app: (action) => ipcRenderer.send('app', action),
});
