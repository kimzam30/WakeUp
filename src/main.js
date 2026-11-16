'use strict';
const {
  app, BrowserWindow, WebContentsView, ipcMain, session, shell, Tray, Menu,
  nativeImage, nativeTheme, desktopCapturer, screen,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// ---- identity: must match the .desktop file so the dock groups windows and shows our icon
app.setName('Work Hub');
app.setDesktopName('workhub.desktop');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,WaylandWindowDecorations');
  app.commandLine.appendSwitch('class', 'workhub');
}

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const SERVICES = JSON.parse(fs.readFileSync(path.join(__dirname, 'services.json'), 'utf8'));
const byId = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
const ICON = path.join(__dirname, '..', 'build', 'icons', '512x512.png');

// Chrome UA without "Electron/x" and app tokens, so Teams/Outlook treat us as Chrome.
const UA = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(/\s(work-?hub|Work Hub)\/\S+/i, '');

// Hosts allowed to open popups inside the app (sign-in flows). Everything else opens in the default browser.
const INTERNAL_HOSTS = [
  'microsoftonline.com', 'microsoft.com', 'office.com', 'office.net', 'office365.com',
  'live.com', 'microsoftazuread-sso.com', 'sharepoint.com', 'skype.com', 'cloud.microsoft',
  'mmu.edu.my',
];
const isInternal = (url) => {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol === 'about:') return true;
    return INTERNAL_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
  } catch { return false; }
};
const MEDIA_HOSTS = ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft'];
const isMediaHost = (url) => {
  try { const { hostname } = new URL(url); return MEDIA_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h)); }
  catch { return false; }
};

// ---- persisted state
const STATE_FILE = path.join(app.getPath('userData'), 'state.json');
const DEFAULT_STATE = {
  layout: 'grid',
  slots: ['mail', 'calendar', 'teams', 'ebwise'],
  sizes: { cols2: [50], cols3: [33.3, 66.7], grid: { col: 50, row: 50 } },
  focused: 0,
  maximized: null,
  window: { width: 1600, height: 1000 },
  closeToTray: true,
};
let state;
try { state = { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; }
catch { state = structuredClone(DEFAULT_STATE); }
let saveTimer;
const saveState = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }, 300);
};

let win; let tray; let quitting = false;
const views = new Map(); // service id -> WebContentsView
const unread = new Map(); // service id -> count

// ---- sessions: permissions, screen share, UA
const configured = new Set();
function configureSession(partition) {
  if (configured.has(partition)) return;
  configured.add(partition);
  const ses = session.fromPartition(partition);
  ses.setUserAgent(UA);
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = details.requestingUrl || wc.getURL();
    if (permission === 'media' || permission === 'display-capture') return cb(isMediaHost(url));
    if (['notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'speaker-selection'].includes(permission)) return cb(true);
    return cb(false);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (permission === 'media') return isMediaHost(origin);
    return ['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission);
  });
  // On Wayland, getSources() opens the GNOME PipeWire portal picker and returns the chosen source.
  ses.setDisplayMediaRequestHandler(async (request, cb) => {
    if (!isMediaHost(request.securityOrigin || request.frame?.url || '')) return cb({});
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      if (!sources.length) return cb({});
      cb({ video: sources[0] });
    } catch (e) {
      console.error('screen share failed', e);
      cb({});
    }
  });
}

function getView(id) {
  if (views.has(id)) return views.get(id);
  const svc = byId[id];
  configureSession(svc.partition);
  const view = new WebContentsView({
    webPreferences: { partition: svc.partition, sandbox: true, contextIsolation: true, spellcheck: true },
  });
  view.setBorderRadius?.(10);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, webPreferences: { partition: svc.partition } } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isInternal(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  wc.on('page-title-updated', (_e, title) => {
    const m = title.match(/^\((\d+)\)|\((\d+)\)\s*$|^(\d+)\s+unread/i);
    unread.set(id, m ? Number(m[1] || m[2] || m[3]) : 0);
    updateBadge();
  });
  wc.on('before-input-event', (e, input) => { if (handleShortcut(input)) e.preventDefault(); });
  wc.on('focus', () => {
    const idx = state.slots.indexOf(id);
    if (idx >= 0 && idx !== state.focused) { state.focused = idx; saveState(); sendState(); }
  });
  wc.loadURL(svc.url, { userAgent: UA });
  views.set(id, view);
  return view;
}

// ---- layout
const LAYOUTS = { single: 1, cols2: 2, cols3: 3, grid: 4 };
const LAYOUT_ORDER = Object.keys(LAYOUTS);
const slotCount = () => LAYOUTS[state.layout];

function visibleSlots() {
  const n = slotCount();
  const ids = state.slots.slice(0, n);
  if (state.maximized != null && ids[state.maximized]) return [state.maximized];
  return ids.map((_, i) => i);
}

// Renderer reports where each slot body sits; we place native views there.
let lastBounds = {};
function applyBounds(bounds) {
  lastBounds = bounds || lastBounds;
  if (!win) return;
  const show = new Set();
  for (const i of visibleSlots()) {
    const id = state.slots[i];
    const b = lastBounds[i];
    if (!id || !b || b.width < 10 || b.height < 10) continue;
    const view = getView(id);
    if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
    view.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
    view.setVisible(true);
    show.add(id);
  }
  for (const [id, view] of views) if (!show.has(id)) view.setVisible(false);
}

function sendState() {
  if (!win) return;
  win.webContents.send('state', {
    ...state,
    services: SERVICES,
    unread: Object.fromEntries(unread),
    slotCount: slotCount(),
  });
}

function setLayout(layout) {
  if (!LAYOUTS[layout]) return;
  state.layout = layout;
  state.maximized = null;
  // make sure every visible slot has a distinct service
  const used = new Set();
  for (let i = 0; i < LAYOUTS[layout]; i++) {
    let id = state.slots[i];
    if (!id || used.has(id)) id = SERVICES.find((s) => !used.has(s.id))?.id;
    state.slots[i] = id; used.add(id);
  }
  if (state.focused >= LAYOUTS[layout]) state.focused = 0;
  saveState(); sendState();
}

function assign(slot, id) {
  if (!byId[id] || slot < 0 || slot >= slotCount()) return;
  const other = state.slots.indexOf(id);
  if (other >= 0 && other < slotCount()) state.slots[other] = state.slots[slot]; // swap
  state.slots[slot] = id;
  state.focused = slot;
  saveState(); sendState();
}

function focusSlot(i) {
  if (i >= slotCount()) return;
  state.focused = i;
  if (state.maximized != null) state.maximized = i;
  saveState(); sendState();
  const id = state.slots[i];
  if (id) setImmediate(() => views.get(id)?.webContents.focus());
}

function toggleMaximize(i = state.focused) {
  state.maximized = state.maximized === i ? null : i;
  saveState(); sendState();
}

function handleShortcut(input) {
  if (input.type !== 'keyDown' || !input.control) return false;
  const k = input.key.toLowerCase();
  if (!input.shift && /^[1-5]$/.test(k)) {
    const id = SERVICES[Number(k) - 1]?.id;
    if (!id) return false;
    const at = state.slots.indexOf(id);
    if (at >= 0 && at < slotCount()) focusSlot(at); else assign(state.focused, id);
    return true;
  }
  if (input.shift && k === 'l') {
    setLayout(LAYOUT_ORDER[(LAYOUT_ORDER.indexOf(state.layout) + 1) % LAYOUT_ORDER.length]);
    return true;
  }
  if (!input.shift && k === 'm') { toggleMaximize(); return true; }
  if (!input.shift && k === 'r') { const id = state.slots[state.focused]; views.get(id)?.webContents.reload(); return true; }
  return false;
}

// ---- badge + tray
function updateBadge() {
  const total = [...unread.values()].reduce((a, b) => a + b, 0);
  try { app.setBadgeCount(total); } catch { /* unsupported launcher */ }
  tray?.setToolTip(total ? `Work Hub — ${total} unread` : 'Work Hub');
  sendState();
}

const AUTOSTART = path.join(app.getPath('home'), '.config', 'autostart', 'workhub.desktop');
const autostartOn = () => fs.existsSync(AUTOSTART);
function setAutostart(on) {
  if (on) {
    const exec = process.env.APPIMAGE || process.execPath;
    fs.mkdirSync(path.dirname(AUTOSTART), { recursive: true });
    fs.writeFileSync(AUTOSTART, `[Desktop Entry]\nType=Application\nName=Work Hub\nExec="${exec}" --hidden\nIcon=workhub\nX-GNOME-Autostart-enabled=true\n`);
  } else fs.rmSync(AUTOSTART, { force: true });
  buildTray();
}

function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

function buildTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icons', '32x32.png'));
  if (!tray) { tray = new Tray(img); tray.setToolTip('Work Hub'); tray.on('click', showWindow); }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Work Hub', click: showWindow },
    { type: 'separator' },
    ...SERVICES.map((s, i) => ({ label: s.name, accelerator: `Ctrl+${i + 1}`, click: () => { showWindow(); assign(state.focused, s.id); } })),
    { type: 'separator' },
    { label: 'Start at login', type: 'checkbox', checked: autostartOn(), click: (m) => setAutostart(m.checked) },
    { label: 'Keep running when closed', type: 'checkbox', checked: state.closeToTray, click: (m) => { state.closeToTray = m.checked; saveState(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---- window
function createWindow() {
  const { width, height, x, y, maximized } = state.window;
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(width, area.width), height: Math.min(height, area.height), x, y,
    minWidth: 720, minHeight: 480,
    title: 'Work Hub',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  if (maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.webContents.on('before-input-event', (e, input) => { if (handleShortcut(input)) e.preventDefault(); });

  const remember = () => {
    if (!win || win.isMinimized()) return;
    state.window = win.isMaximized() ? { ...state.window, maximized: true } : { ...win.getBounds(), maximized: false };
    saveState();
  };
  win.on('resize', remember); win.on('move', remember);
  win.on('close', (e) => {
    if (!quitting && state.closeToTray && tray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

ipcMain.on('ready', () => sendState());
ipcMain.on('bounds', (_e, b) => applyBounds(b));
ipcMain.on('assign', (_e, { slot, id }) => assign(slot, id));
ipcMain.on('layout', (_e, l) => setLayout(l));
ipcMain.on('focus', (_e, i) => focusSlot(i));
ipcMain.on('maximize', (_e, i) => toggleMaximize(i));
ipcMain.on('sizes', (_e, s) => { state.sizes = s; saveState(); });
ipcMain.on('nav', (_e, { slot, action }) => {
  const wc = views.get(state.slots[slot])?.webContents; if (!wc) return;
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (action === 'reload') wc.reload();
  if (action === 'home') wc.loadURL(byId[state.slots[slot]].url);
  if (action === 'external') shell.openExternal(wc.getURL());
});
// While the UI is dragging something, hide the web views so the drop targets are visible.
ipcMain.on('dragging', (_e, on) => {
  if (on) for (const v of views.values()) v.setVisible(false);
  else applyBounds();
});

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.whenReady().then(() => {
  createWindow();
  buildTray();
  nativeTheme.on('updated', () => win?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7'));
});
app.on('window-all-closed', () => { if (quitting || !tray) app.quit(); });
