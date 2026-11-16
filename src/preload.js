'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  ready: () => ipcRenderer.send('ready'),
  bounds: (b) => ipcRenderer.send('bounds', b),
  assign: (slot, id) => ipcRenderer.send('assign', { slot, id }),
  layout: (l) => ipcRenderer.send('layout', l),
  focus: (i) => ipcRenderer.send('focus', i),
  maximize: (i) => ipcRenderer.send('maximize', i),
  sizes: (s) => ipcRenderer.send('sizes', s),
  nav: (slot, action) => ipcRenderer.send('nav', { slot, action }),
  dragging: (on) => ipcRenderer.send('dragging', on),
});
