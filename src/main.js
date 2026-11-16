'use strict';
const {
  app, BrowserWindow, WebContentsView, ipcMain, session, shell, Tray, Menu,
  nativeImage, nativeTheme, desktopCapturer, screen, Notification,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// ---- identity: must match the .desktop file so the dock groups windows and shows our icon
const APP = 'WakeUp';
app.setName(APP);
app.setDesktopName('wakeup.desktop');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,WaylandWindowDecorations');
  app.commandLine.appendSwitch('class', 'wakeup');
}

// WAKEUP_PROFILE=/some/dir runs a separate, throwaway profile (for testing without touching real sign-ins).
if (process.env.WAKEUP_PROFILE) app.setPath('userData', path.resolve(process.env.WAKEUP_PROFILE));
else {
  // The app used to be called "Work Hub". Move its profile once so the rename keeps every sign-in and layout.
  const dir = path.join(app.getPath('appData'), APP);
  const legacy = path.join(app.getPath('appData'), 'Work Hub');
  try { if (!fs.existsSync(dir) && fs.existsSync(legacy)) fs.renameSync(legacy, dir); } catch (e) { console.error('could not move old profile', e); }
  app.setPath('userData', dir);
}
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---- logging: errors go to ~/.config/WakeUp/logs/main.log (rotated at 1 MB) instead of crashing the app
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'main.log');
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack : String(p))).join(' ')}\n`;
  console.error(line.trimEnd());
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if ((fs.statSync(LOG_FILE, { throwIfNoEntry: false })?.size ?? 0) > 1e6) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* logging must never throw */ }
}
process.on('uncaughtException', (e) => log('uncaught', e));
process.on('unhandledRejection', (e) => log('unhandled rejection', e));

const SERVICES = require('./services.json');
const byId = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
const valid = (id) => typeof id === 'string' && Object.hasOwn(byId, id);
const ICON = path.join(__dirname, '..', 'build', 'icons', '512x512.png');
const BG = () => (nativeTheme.shouldUseDarkColors ? '#161618' : '#ececef');

// Chrome UA without "Electron/x" and app tokens, so Teams/Outlook treat us as Chrome.
const UA = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(/\s(wakeup|work-?hub|Work Hub)\/\S+/i, '');

const hostIn = (url, hosts) => {
  try {
    const { hostname } = new URL(url);
    return hosts.some((h) => hostname === h || hostname.endsWith('.' + h));
  } catch { return false; }
};
// Hosts allowed to navigate/open popups inside the app (sign-in flows). Everything else opens in the default browser.
const INTERNAL_HOSTS = [
  'microsoftonline.com', 'microsoft.com', 'office.com', 'office.net', 'office365.com',
  'live.com', 'microsoftazuread-sso.com', 'sharepoint.com', 'skype.com', 'cloud.microsoft',
  'mmu.edu.my',
];
const isInternal = (url) => url.startsWith('about:') || hostIn(url, INTERNAL_HOSTS);
// Camera/mic/screen only for services flagged "media" in services.json (Teams).
const MEDIA_HOSTS = [...new Set(SERVICES.filter((s) => s.media).flatMap((s) => [new URL(s.url).hostname, ...(s.mediaHosts || [])]))];
const isMediaHost = (url) => hostIn(url, MEDIA_HOSTS);

// ---- persisted state (v2)
const STATE_FILE = path.join(app.getPath('userData'), 'state.json');
const defaults = () => ({
  v: 2,
  mode: 'tile', // 'tile' | 'free'
  tile: null, // split tree: {dir:'h'|'v', sizes:[fractions], children:[...]} | {pane:id}
  free: [], // [{id, x, y, w, h}] in % of the stage, last = topmost
  alive: [], // every open pane (visible, parked in background, or popped out)
  popped: [], // panes living in their own window
  focused: null,
  zoomed: null,
  last: null, // last non-empty workspace, for "Restore" on the start screen
  popBounds: {},
  window: { width: 1600, height: 1000 },
  closeToTray: true,
  sleepMinutes: 10,
  toldAboutTray: false,
});

function cleanTree(n, seen) {
  if (!n || typeof n !== 'object') return null;
  if ('pane' in n) {
    if (!valid(n.pane) || seen.has(n.pane)) return null;
    seen.add(n.pane);
    return { pane: n.pane };
  }
  if ((n.dir !== 'h' && n.dir !== 'v') || !Array.isArray(n.children)) return null;
  const children = []; const sizes = [];
  n.children.forEach((c, i) => {
    const k = cleanTree(c, seen);
    if (!k) return;
    const s = Number(n.sizes?.[i]) > 0 ? Number(n.sizes[i]) : 1;
    if (k.dir === n.dir) { // flatten same-direction nesting
      k.children.forEach((cc, j) => { children.push(cc); sizes.push(s * k.sizes[j]); });
    } else { children.push(k); sizes.push(s); }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  const sum = sizes.reduce((a, b) => a + b, 0);
  return { dir: n.dir, sizes: sizes.map((s) => s / sum), children };
}
const leaves = (n) => (!n ? [] : n.pane ? [n.pane] : n.children.flatMap(leaves));
const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).filter(valid))];
const num = (v, lo, hi, d) => (v != null && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

// Validate anything coming from disk or the renderer, so a bad value can never crash the app.
function cleanLayout(l) {
  const popped = uniq(l.popped);
  const tile = cleanTree(l.tile, new Set(popped));
  const seen = new Set(popped);
  const free = (Array.isArray(l.free) ? l.free : [])
    .filter((p) => p && valid(p.id) && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ id: p.id, x: num(p.x, -90, 100, 5), y: num(p.y, 0, 95, 5), w: num(p.w, 5, 100, 50), h: num(p.h, 5, 100, 60) }));
  const alive = uniq([...uniq(l.alive), ...leaves(tile), ...free.map((p) => p.id), ...popped]);
  const pick = (v) => (valid(v) && alive.includes(v) ? v : null);
  return { mode: l.mode === 'free' ? 'free' : 'tile', tile, free, alive, popped, focused: pick(l.focused), zoomed: pick(l.zoomed) };
}

// v1 stored {layout, slots, sizes, maximized}; turn it into the equivalent split tree.
function migrateV1(raw) {
  const n = { single: 1, cols2: 2, cols3: 3, grid: 4 }[raw.layout] || 1;
  const ids = uniq(raw.slots).slice(0, n);
  const L = ids.map((pane) => ({ pane }));
  const sz = raw.sizes || {};
  let tile = null;
  if (L.length === 1) tile = L[0];
  else if (raw.layout === 'grid' && L.length === 4) {
    const c = num(sz.grid?.col, 10, 90, 50) / 100; const r = num(sz.grid?.row, 10, 90, 50) / 100;
    tile = { dir: 'v', sizes: [r, 1 - r], children: [{ dir: 'h', sizes: [c, 1 - c], children: L.slice(0, 2) }, { dir: 'h', sizes: [c, 1 - c], children: L.slice(2) }] };
  } else if (L.length > 1) {
    const cuts = (Array.isArray(sz[raw.layout]) ? sz[raw.layout] : []).map(Number);
    const edges = cuts.length === L.length - 1 ? [0, ...cuts, 100] : L.map((_, i) => (100 * i) / L.length).concat(100);
    tile = { dir: 'h', sizes: L.map((_, i) => Math.max(1, edges[i + 1] - edges[i])), children: L };
  }
  const zoomed = Number.isInteger(raw.maximized) ? ids[raw.maximized] : null;
  return { tile, alive: ids, focused: ids[raw.focused] ?? ids[0] ?? null, zoomed };
}

function loadState() {
  for (const file of [STATE_FILE, STATE_FILE + '.bak']) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
      const s = { ...defaults(), ...raw, v: 2, ...cleanLayout(raw.v === 2 ? raw : migrateV1(raw)) };
      const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);
      if (!obj(s.window)) s.window = defaults().window;
      if (!obj(s.popBounds)) s.popBounds = {};
      if (!obj(s.last)) s.last = null;
      s.sleepMinutes = num(raw.sleepMinutes, 0, 1440, 10);
      s.closeToTray = s.closeToTray !== false;
      for (const k of ['layout', 'slots', 'sizes', 'maximized']) delete s[k]; // v1 leftovers
      if (file === STATE_FILE) fs.copyFileSync(file, file + '.bak');
      else log('state.json unreadable; restored from backup');
      if (raw.v !== 2) log('migrated state.json from v1');
      return s;
    } catch (e) {
      if (e.code !== 'ENOENT') log(`could not read ${path.basename(file)}:`, e.message);
    }
  }
  return defaults();
}

const state = loadState();
let saveTimer = null;
function writeState() {
  clearTimeout(saveTimer); saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state, null, 2));
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); // atomic: a crash mid-write can't corrupt state.json
  } catch (e) { log('saving state failed', e); }
}
const saveState = () => { clearTimeout(saveTimer); saveTimer = setTimeout(writeState, 400); };

let win; let tray; let quitting = false; let covered = false;
/** id -> { view, status, url, hiddenSince, retries, retryTimer, popWin, unread } */
const panes = new Map();
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

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
    return cb(['notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'speaker-selection'].includes(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    if (permission === 'media') return isMediaHost(origin);
    return ['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission);
  });
  // On Wayland, getSources() opens the system (PipeWire portal) picker and returns the chosen source.
  ses.setDisplayMediaRequestHandler(async (request, cb) => {
    if (!isMediaHost(request.securityOrigin || request.frame?.url || '')) return cb({});
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      cb(sources.length ? { video: sources[0] } : {});
    } catch (e) { log('screen share failed', e); cb({}); }
  });
}

// ---- pane status: loading / ready / error / crashed / hung / sleeping
const pane = (id) => {
  if (!panes.has(id)) panes.set(id, { view: null, status: 'new', url: null, hiddenSince: null, retries: 0, retryTimer: null, popWin: null, unread: 0 });
  return panes.get(id);
};
function setStatus(id, status, extra = {}) {
  const p = panes.get(id); if (!p) return;
  p.status = status;
  send('status', { id, status, ...extra });
}

const RETRY_DELAYS = [5, 15, 30, 60, 120];
function scheduleRetry(id) {
  const p = panes.get(id); if (!p) return 0;
  clearTimeout(p.retryTimer);
  const secs = RETRY_DELAYS[Math.min(p.retries, RETRY_DELAYS.length - 1)];
  p.retries++;
  p.retryTimer = setTimeout(() => retry(id), secs * 1000);
  return secs;
}
function retry(id) {
  const p = panes.get(id); if (!p) return;
  clearTimeout(p.retryTimer);
  if (!p.view || p.view.webContents.isDestroyed()) { p.view = null; wake(id); return; }
  setStatus(id, 'loading');
  p.view.webContents.loadURL(p.url || byId[id].url).catch(() => { /* reported via did-fail-load */ });
}

function createView(id) {
  const p = pane(id);
  const svc = byId[id];
  configureSession(svc.partition);
  const view = new WebContentsView({
    webPreferences: { partition: svc.partition, sandbox: true, contextIsolation: true, spellcheck: true },
  });
  view.setBorderRadius?.(p.popWin ? 0 : 8);
  view.setBackgroundColor(BG());
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, icon: ICON, webPreferences: { partition: svc.partition, sandbox: true } } };
    }
    shell.openExternal(url).catch((e) => log('openExternal failed', e));
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isInternal(url)) { e.preventDefault(); shell.openExternal(url).catch((er) => log('openExternal failed', er)); }
  });
  wc.on('page-title-updated', (_e, title) => {
    const m = title.match(/^\((\d+)\)|\((\d+)\)\s*$|^(\d+)\s+unread/i);
    const n = m ? Number(m[1] || m[2] || m[3]) : 0;
    if (n !== p.unread) { p.unread = n; updateBadge(); send('unread', { id, n }); }
  });
  wc.on('did-start-loading', () => { if (p.status !== 'error') setStatus(id, 'loading'); });
  wc.on('did-stop-loading', () => { if (p.status === 'loading') setStatus(id, 'ready'); });
  wc.on('did-navigate', (_e, url) => { p.url = url; });
  wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) p.url = url; });
  wc.on('did-finish-load', () => {
    if (p.status === 'error') return; // Chromium's error page finished; only retry() clears an error
    p.retries = 0; clearTimeout(p.retryTimer); setStatus(id, 'ready');
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 = aborted by a newer navigation, not a real failure
    if (url && !url.startsWith('chrome-error:')) p.url = url;
    log(`${id} failed to load (${code} ${desc})`);
    setStatus(id, 'error', { code, desc, retryIn: scheduleRetry(id) });
  });
  wc.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    log(`${id} renderer gone: ${d.reason} (${d.exitCode})`);
    setStatus(id, 'crashed', { reason: d.reason });
  });
  wc.on('unresponsive', () => setStatus(id, 'hung'));
  wc.on('responsive', () => { if (p.status === 'hung') setStatus(id, 'ready'); });
  wc.on('before-input-event', (e, input) => { if (handleShortcut(input, id)) e.preventDefault(); });
  wc.on('focus', () => { if (!p.popWin) send('focused', id); });
  p.view = view;
  setStatus(id, 'loading');
  wc.loadURL(p.url || svc.url, { userAgent: UA }).catch(() => { /* reported via did-fail-load */ });
  return view;
}
function wake(id) { const p = pane(id); return p.view || createView(id); }

function detach(view) {
  for (const w of [win, ...[...panes.values()].map((p) => p.popWin)]) {
    if (w && !w.isDestroyed() && w.contentView.children.includes(view)) w.contentView.removeChildView(view);
  }
}
function destroyView(p) {
  if (!p.view) return;
  detach(p.view);
  if (!p.view.webContents.isDestroyed()) p.view.webContents.close();
  p.view = null;
}
function closePane(id) {
  const p = panes.get(id); if (!p) return;
  clearTimeout(p.retryTimer);
  if (p.popWin && !p.popWin.isDestroyed()) { const w = p.popWin; p.popWin = null; w.destroy(); }
  destroyView(p);
  panes.delete(id);
  updateBadge();
}

// ---- sleep: unload panes that have been out of sight for a while (frees RAM). keepAlive services never sleep.
setInterval(() => {
  if (!state.sleepMinutes) return;
  const cutoff = Date.now() - state.sleepMinutes * 60e3;
  for (const [id, p] of panes) {
    if (!p.view || p.popWin || byId[id].keepAlive || !p.hiddenSince || p.hiddenSince > cutoff) continue;
    if (p.view.webContents.isCurrentlyAudible()) continue;
    p.url = p.view.webContents.getURL() || p.url;
    destroyView(p);
    if (p.unread) { p.unread = 0; updateBadge(); send('unread', { id, n: 0 }); } // asleep = no title updates
    setStatus(id, 'sleeping');
  }
}, 60e3);

// ---- placement: the renderer reports where each pane body sits; we place native views there.
let lastBounds = { rects: {}, order: [] };
let lastOrder = '';
function applyBounds(b = lastBounds) {
  lastBounds = b;
  if (!win || win.isDestroyed()) return;
  const show = new Set();
  if (!covered) {
    const order = b.order.filter((id) => b.rects[id] && state.alive.includes(id) && !state.popped.includes(id));
    const reorder = order.join() !== lastOrder;
    lastOrder = order.join();
    for (const id of order) {
      const r = b.rects[id];
      if (!(r.width >= 20 && r.height >= 20)) continue;
      const view = wake(id);
      if (reorder || !win.contentView.children.includes(view)) win.contentView.addChildView(view); // re-adding raises to top
      view.setBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      view.setVisible(true);
      panes.get(id).hiddenSince = null;
      show.add(id);
    }
    // re-adding views to restack them can drop keyboard focus; give it back to the focused pane
    const f = panes.get(state.focused)?.view;
    if (reorder && f && show.has(state.focused) && win.isFocused() && !f.webContents.isDestroyed()) f.webContents.focus();
  }
  for (const [id, p] of panes) {
    if (show.has(id) || p.popWin || !p.view) continue;
    p.view.setVisible(false);
    p.hiddenSince ??= Date.now();
  }
}

// ---- pop-out windows: the same view moves into its own window, so nothing reloads and sign-in is kept
function popOut(id) {
  const p = pane(id);
  if (p.popWin) return;
  const view = wake(id);
  detach(view);
  const w = new BrowserWindow({
    ...fitOnScreen(state.popBounds[id] || { width: 1000, height: 760 }), minWidth: 360, minHeight: 300,
    title: `${byId[id].name} — ${APP}`, icon: ICON, autoHideMenuBar: true, backgroundColor: BG(),
  });
  p.popWin = w;
  w.setMenuBarVisibility(false);
  view.setBorderRadius?.(0);
  w.contentView.addChildView(view);
  const fit = () => { const [cw, ch] = w.getContentSize(); view.setBounds({ x: 0, y: 0, width: cw, height: ch }); };
  const remember = () => { if (!w.isMinimized() && !w.isMaximized()) { state.popBounds[id] = w.getBounds(); saveState(); } };
  fit(); view.setVisible(true);
  w.on('resize', () => { fit(); remember(); });
  w.on('move', remember);
  w.on('close', () => {
    if (p.popWin !== w || quitting) return; // closed by us (dock/close), or app quitting: keep popped state for next launch
    // the user closed the window → dock the pane back into the layout
    w.contentView.removeChildView(view);
    view.setBorderRadius?.(8);
    p.popWin = null;
    send('cmd', { name: 'dock', arg: id });
  });
  view.webContents.focus();
}
function dockBack(id) {
  const p = panes.get(id);
  if (!p?.popWin) return;
  const w = p.popWin; p.popWin = null;
  if (p.view) { w.contentView.removeChildView(p.view); p.view.setBorderRadius?.(8); }
  w.destroy();
}

// The renderer owns the layout; main validates, persists, and reconciles windows/views with it.
function commit(raw) {
  const l = cleanLayout(raw && typeof raw === 'object' ? raw : {});
  Object.assign(state, l);
  if (leaves(l.tile).length || l.free.length) state.last = { mode: l.mode, tile: l.tile, free: l.free, alive: l.alive };
  for (const [id, p] of panes) {
    if (!l.alive.includes(id)) closePane(id);
    else if (p.popWin && !l.popped.includes(id)) dockBack(id);
  }
  for (const id of l.popped) popOut(id);
  saveState();
}

// ---- keyboard shortcuts (work from the shell and from inside any web pane)
function handleShortcut(input, fromId) {
  if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return false;
  const k = input.key.toLowerCase();
  const popped = fromId && panes.get(fromId)?.popWin;
  const cmd = (name, arg) => { send('cmd', { name, arg }); return true; };
  if (!input.shift) {
    if (/^[1-9]$/.test(k) && SERVICES[Number(k) - 1]) { showWindow(); return cmd('open', SERVICES[Number(k) - 1].id); }
    if (k === 'w') return cmd('close', popped ? fromId : undefined);
    if (k === 'm' && !popped) return cmd('zoom');
    if (k === 'r') { retryOrReload(fromId || state.focused); return true; }
    if (k === 'tab' && !popped) return cmd('cycle', 1);
  } else {
    if (k === 'tab' && !popped) return cmd('cycle', -1);
    if (k === 'o') { if (popped) popped.close(); else cmd('popout'); return true; }
    if (k === 'f') return cmd('mode');
    if (k === 'l') return cmd('preset');
    if (k === 'h') { showWindow(); return cmd('home'); }
  }
  return false;
}
function retryOrReload(id) {
  const p = panes.get(id); if (!p) return;
  if (!p.view || ['error', 'crashed', 'sleeping'].includes(p.status)) retry(id); else p.view.webContents.reload();
}

// ---- badge + tray
function updateBadge() {
  const total = [...panes.values()].reduce((a, p) => a + (p.unread || 0), 0);
  try { app.setBadgeCount(total); } catch { /* unsupported launcher */ }
  tray?.setToolTip(total ? `${APP} — ${total} unread` : APP);
}

const AUTOSTART = path.join(app.getPath('home'), '.config', 'autostart', 'wakeup.desktop');
const LEGACY_AUTOSTART = path.join(path.dirname(AUTOSTART), 'workhub.desktop');
const autostartOn = () => fs.existsSync(AUTOSTART);
function setAutostart(on) {
  try {
    if (on) {
      const exec = process.env.APPIMAGE || process.execPath;
      fs.mkdirSync(path.dirname(AUTOSTART), { recursive: true });
      fs.writeFileSync(AUTOSTART, `[Desktop Entry]\nType=Application\nName=${APP}\nExec="${exec}" --hidden\nIcon=wakeup\nX-GNOME-Autostart-enabled=true\n`);
    } else fs.rmSync(AUTOSTART, { force: true });
  } catch (e) { log('autostart change failed', e); }
  buildTray();
}

function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

function buildTray() {
  try {
    if (!tray) {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icons', '32x32.png')));
      tray.setToolTip(APP);
      tray.on('click', showWindow);
    }
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Show ${APP}`, click: showWindow },
      { type: 'separator' },
      ...SERVICES.map((s, i) => ({ label: s.name, accelerator: `Ctrl+${i + 1}`, click: () => { showWindow(); send('cmd', { name: 'open', arg: s.id }); } })),
      { type: 'separator' },
      { label: 'Start at login', type: 'checkbox', checked: autostartOn(), click: (m) => setAutostart(m.checked) },
      { label: 'Keep running when closed', type: 'checkbox', checked: state.closeToTray, click: (m) => { state.closeToTray = m.checked; saveState(); } },
      { label: 'Sleep background panes after 10 min', type: 'checkbox', checked: state.sleepMinutes > 0, click: (m) => { state.sleepMinutes = m.checked ? 10 : 0; saveState(); } },
      { label: 'Open log folder', click: () => { fs.mkdirSync(LOG_DIR, { recursive: true }); shell.openPath(LOG_DIR); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
  } catch (e) { log('tray unavailable', e); tray = null; }
}

// Keep saved bounds on a monitor that still exists.
function fitOnScreen(b) {
  const hasPos = Number.isFinite(b.x) && Number.isFinite(b.y);
  const width0 = num(b.width, 360, 10000, 1200); const height0 = num(b.height, 300, 10000, 800);
  const area = (hasPos ? screen.getDisplayMatching({ x: b.x, y: b.y, width: width0, height: height0 }) : screen.getPrimaryDisplay()).workArea;
  const width = Math.min(width0, area.width); const height = Math.min(height0, area.height);
  const onScreen = hasPos && b.x > area.x - width / 2 && b.x < area.x + area.width - 80 && b.y >= area.y - 10 && b.y < area.y + area.height - 80;
  return onScreen ? { x: b.x, y: b.y, width, height } : { width, height };
}

// ---- window
function createWindow() {
  win = new BrowserWindow({
    ...fitOnScreen(state.window),
    minWidth: 720, minHeight: 480,
    title: APP,
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: BG(),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  if (state.window.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.webContents.on('before-input-event', (e, input) => { if (handleShortcut(input)) e.preventDefault(); });
  win.webContents.on('render-process-gone', (_e, d) => { log('shell UI gone', d.reason); if (!quitting) win.webContents.reload(); });

  const remember = () => {
    if (!win || win.isMinimized()) return;
    state.window = win.isMaximized() ? { ...state.window, maximized: true } : { ...win.getBounds(), maximized: false };
    saveState();
  };
  win.on('resize', remember); win.on('move', remember);
  win.on('close', (e) => {
    if (quitting || !state.closeToTray || !tray) return;
    e.preventDefault(); win.hide();
    if (!state.toldAboutTray && Notification.isSupported()) {
      new Notification({ title: `${APP} is still running`, body: 'Your sign-ins and notifications stay on. Quit from the tray icon.', icon: ICON }).show();
      state.toldAboutTray = true; saveState();
    }
  });
  win.on('closed', () => { win = null; });
}

// ---- IPC from the shell UI
ipcMain.handle('init', () => ({
  services: SERVICES,
  layout: { mode: state.mode, tile: state.tile, free: state.free, alive: state.alive, popped: state.popped, focused: state.focused, zoomed: state.zoomed },
  last: state.last,
  status: Object.fromEntries([...panes].map(([id, p]) => [id, p.status])),
  unread: Object.fromEntries([...panes].map(([id, p]) => [id, p.unread])),
}));
ipcMain.on('commit', (_e, l) => commit(l));
ipcMain.on('bounds', (_e, b) => {
  if (!b || typeof b !== 'object' || !b.rects || typeof b.rects !== 'object' || !Array.isArray(b.order)) return;
  applyBounds(b);
});
// While the UI shows something over the panes (dragging, menus, start screen), hide the web views.
ipcMain.on('cover', (_e, on) => { covered = !!on; applyBounds(); });
ipcMain.on('focus-view', (_e, id) => {
  const p = panes.get(id);
  if (p?.popWin) { p.popWin.show(); p.popWin.focus(); }
  if (p?.view && !p.view.webContents.isDestroyed()) p.view.webContents.focus();
});
ipcMain.on('retry', (_e, id) => { if (valid(id)) retryOrReload(id); });
ipcMain.on('retry-failed', () => { for (const [id, p] of panes) if (p.status === 'error') retry(id); });
ipcMain.on('nav', (_e, { id, action } = {}) => {
  const wc = panes.get(id)?.view?.webContents; if (!wc || wc.isDestroyed()) return;
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (action === 'reload') retryOrReload(id);
  if (action === 'external') shell.openExternal(wc.getURL()).catch((e) => log('openExternal failed', e));
});

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; writeState(); });
app.whenReady().then(() => {
  createWindow();
  if (fs.existsSync(LEGACY_AUTOSTART)) { fs.rmSync(LEGACY_AUTOSTART, { force: true }); setAutostart(true); } // carry "start at login" over the rename
  buildTray();
  nativeTheme.on('updated', () => {
    win?.setBackgroundColor(BG());
    for (const p of panes.values()) p.view?.setBackgroundColor(BG());
  });
}).catch((e) => log('startup failed', e));
app.on('window-all-closed', () => { if (quitting || !tray) app.quit(); });
