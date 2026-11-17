'use strict';
const {
  app, BrowserWindow, WebContentsView, ipcMain, session, shell, Tray, Menu, clipboard, ClipboardItem, dialog,
  nativeImage, nativeTheme, desktopCapturer, screen, Notification, safeStorage, net, powerMonitor,
} = require('electron');
const { createSync } = require('./sync.js');
const { createUpdater } = require('./updater.js');
let sync = null; // cloud sync, started once the window is up
let updater = null; // one-click updates from GitHub releases
const path = require('node:path');
const { pathToFileURL } = require('node:url');
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

const ICON = path.join(__dirname, '..', 'build', 'icons', '512x512.png');
const RADIUS = 8; // pane corner radius; matches .pane in ui.css
const BG = () => (nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#f7f7f5');
const UI = (f) => path.join(__dirname, 'ui', f);

// Chrome UA without "Electron/x" and app tokens, so Teams/Outlook treat us as Chrome.
const UA = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(/\s(wakeup|work-?hub|Work Hub)\/\S+/i, '');

function safeUrl(u) { try { return new URL(u); } catch { return null; } }
const hostIn = (url, hosts) => {
  const u = safeUrl(url); if (!u) return false;
  return hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
};
const isHttp = (url) => /^https?:\/\//i.test(url || '');
// Hosts allowed to navigate inside the built-in apps (sign-in flows). Everything else follows the Links setting.
const INTERNAL_HOSTS = [
  'microsoftonline.com', 'microsoft.com', 'office.com', 'office.net', 'office365.com',
  'live.com', 'microsoftazuread-sso.com', 'sharepoint.com', 'skype.com', 'cloud.microsoft',
  'mmu.edu.my',
];
// Sign-in pages: keep them in a small popup so the page that opened them can finish signing in.
const AUTH_HOSTS = ['login.microsoftonline.com', 'login.microsoft.com', 'login.live.com', 'account.live.com', 'microsoftazuread-sso.com', 'accounts.google.com', 'appleid.apple.com'];
const isAuth = (url) => hostIn(url, AUTH_HOSTS);
const isTeamsLink = (url) => hostIn(url, ['teams.microsoft.com', 'teams.cloud.microsoft']) && /^\/l\//.test(safeUrl(url)?.pathname || '');
// Ebwise (Moodle) course files: opening them in the pane would replace the course page.
const isDocNav = (url) => hostIn(url, ['mmu.edu.my']) && /\/(pluginfile\.php|mod\/resource\/view\.php)/.test(safeUrl(url)?.pathname || '');

// ---- services: built-ins from services.json plus the user's own apps (Settings → Apps)
const BUILTIN = require('./services.json');
const BUILTIN_IDS = BUILTIN.map((s) => s.id);
// Ebwise forgets its own sign-in whenever the app closes (a session-only cookie), but your Microsoft 365 sign-in is kept.
// When the app's pane lands on its login page, press its "Microsoft 365" button for you (at most once a minute, so a failed
// sign-in can't loop). Documents from that app wait on the login page until the app is signed in, then reload.
const lastSignIn = {}; const signingIn = new Set();
function signInAgain(id, wc) {
  const src = BUILTIN.find((s) => s.id === (byId[id]?.from || id)); const sso = src?.signIn; if (!sso) return;
  let u; try { u = new URL(wc.getURL()); } catch { return; }
  if (u.origin !== new URL(src.url).origin) return;
  const onLogin = u.pathname === sso.page;
  if (id !== src.id) { // a document pane: let the app sign in, then come back to the document
    if (onLogin && !paneWc(src.id)) wake(src.id); // the app isn't open: open it in the background to sign in
    return;
  }
  if (!onLogin) { // signed in (or never needed to): reload any documents that were stuck on the login page
    if (u.pathname.startsWith('/auth/')) return; // still on its way through the sign-in pages
    if (signingIn.delete(id)) {
      send('notice', { id: `signin:${id}`, kind: 'success', title: `Signed in to ${src.name}`, detail: 'With your Microsoft 365 account.', pane: id });
      if (sso.docs && u.pathname.startsWith(sso.docs)) wc.loadURL(src.url).catch(() => {}); // it was sent to a document, not home
    }
    for (const [fid, p] of panes) {
      const fw = byId[fid]?.from === id && p.view?.webContents; if (!fw || fw.isDestroyed()) continue;
      try { if (new URL(fw.getURL()).pathname === sso.page) fw.loadURL(byId[fid].url).catch(() => {}); } catch { /* not loaded yet */ }
    }
    return;
  }
  if (u.search || Date.now() - (lastSignIn[id] || 0) < 60e3) return; // the bare login page only (?errors etc. stay visible)
  lastSignIn[id] = Date.now(); signingIn.add(id);
  send('notice', { id: `signin:${id}`, kind: 'busy', title: `Signing in to ${src.name}…`, detail: 'Using your Microsoft 365 account. No password needed.', pane: id });
  setTimeout(() => { if (signingIn.delete(id)) send('notice', { id: `signin:${id}`, kind: 'error', title: `Couldn’t sign in to ${src.name} by itself`, detail: 'Sign in on its page. Your Microsoft 365 session may have ended.', pane: id }); }, 30e3);
  wc.executeJavaScript(`document.querySelector(${JSON.stringify(sso.click)})?.click()`).catch(() => {});
}
const Planner = require('./ui/planner-core.js');
let SERVICES = []; let byId = {};
let FILES = []; // open documents and screenshots: [{id, name, src, partition, from, ts}]
const valid = (id) => typeof id === 'string' && Object.hasOwn(byId, id) && !byId[id].hidden;
// Camera/mic/screen only for services flagged "media" in services.json (Teams).
const MEDIA_HOSTS = [...new Set(BUILTIN.filter((s) => s.media && s.url).flatMap((s) => [new URL(s.url).hostname, ...(s.mediaHosts || [])]))];
const isMediaHost = (url) => hostIn(url, MEDIA_HOSTS);
// apps you added and allowed the microphone (voice chat in an AI app): audio only, never the camera or your screen
const isMicHost = (url) => { try { const h = new URL(url).hostname; return (state?.settings?.customApps || []).some((c) => c.mic && new URL(c.url).hostname === h); } catch { return false; } };
const isInternal = (url, svc) => url.startsWith('about:') || hostIn(url, INTERNAL_HOSTS) || (!!svc?.hosts && hostIn(url, svc.hosts));

// Sites an app signs in through or links to for its own account pages: they open in a WakeUp window with the
// app's sign-in instead of your browser, so signing in finishes inside WakeUp. Cloudflare's check runs on many.
const RELATED_HOSTS = {
  'claude.ai': ['claude.com', 'anthropic.com'], 'chatgpt.com': ['openai.com'], 'gemini.google.com': ['google.com'],
  'copilot.microsoft.com': ['microsoft.com', 'live.com', 'bing.com'], 'chat.mistral.ai': ['mistral.ai'], 'grok.com': ['x.ai', 'x.com'],
  'perplexity.ai': [], 'chat.deepseek.com': ['deepseek.com'],
};
function customHosts(url) {
  const h = new URL(url).hostname.replace(/^www\./, '');
  return [h, ...(RELATED_HOSTS[h] || []), 'challenges.cloudflare.com'];
}

function rebuildServices(s) {
  const custom = s.customApps.map((c) => ({
    id: c.id, name: c.name, url: c.url, color: c.color, icon: c.icon || null, custom: true, own: c.own,
    partition: c.own ? `persist:${c.id}` : 'persist:m365',
    hosts: customHosts(c.url),
  }));
  const all = [...BUILTIN, ...custom];
  const rank = (id) => { const i = s.order.indexOf(id); return i < 0 ? 1000 + all.findIndex((x) => x.id === id) : i; };
  // a file pane browses like the app it came from (same sign-in, same sites), but never leaves its document
  const files = FILES.map((f) => {
    const from = all.find((x) => x.id === f.from);
    // a page docked from a link window may also browse its own site
    const own = f.link && isHttp(f.src) ? [new URL(f.src).hostname.replace(/^www\./, '')] : [];
    return { id: f.id, name: f.name, kind: 'file', url: isHttp(f.src) ? f.src : pathToFileURL(f.src).href, partition: f.partition, color: '#6b6a67', local: !isHttp(f.src), from: f.from || null, link: !!f.link, hosts: [...(from?.hosts || []), ...own] };
  });
  SERVICES = [...all
    .map((x) => ({ ...x, kind: x.kind || 'web', hidden: s.hidden.includes(x.id), keepAlive: s.keepAlive[x.id] ?? !!x.keepAlive }))
    .sort((a, b) => rank(a.id) - rank(b.id)), ...files];
  byId = Object.fromEntries(SERVICES.map((x) => [x.id, x]));
}
const shownServices = () => SERVICES.filter((s) => !s.hidden && s.kind !== 'file');
const isLocal = (id) => byId[id]?.kind === 'local';

// ---- settings (validated on load and on every change, so a bad value can never crash the app)
const settingsDefaults = () => ({
  launch: 'last', startHidden: false, onClose: 'tray',
  sleepMinutes: 10, sleepWhenHidden: true,
  hidden: ['todo'], order: [], notify: {}, keepAlive: {},
  downloadDir: '', askDownload: false, openDownload: false, notifyDownload: true,
  externalLinks: 'browser', docLinks: 'beside',
  theme: 'system', zoom: 100, compact: false, labels: true, sideWidth: 0,
  nickname: '', reminders: 10, weekStart: 1, classLabel: 'code', taskReminder: '08:00',
  screenshotDir: '', screenshotCopy: true,
  customApps: [], autoUpdate: true,
});
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const num = (v, lo, hi, d) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function cleanCustomApps(list) {
  const out = []; const seen = new Set();
  for (const c of Array.isArray(list) ? list.slice(0, 20) : []) {
    if (!isObj(c)) continue;
    const name = text(c.name, 32);
    const u = safeUrl(text(c.url, 2000));
    if (!name || !u || u.protocol !== 'https:') continue;
    let id = typeof c.id === 'string' && /^c-[a-z0-9-]{1,40}$/.test(c.id) ? c.id : '';
    if (!id || seen.has(id)) id = `c-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'app'}-${Math.random().toString(36).slice(2, 6)}`;
    seen.add(id);
    const icon = typeof c.icon === 'string' && c.icon.length < 90000 && /^data:image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(c.icon) ? c.icon : null;
    out.push({ id, name, url: u.href, color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#5e6ad2', own: c.own !== false, icon, ai: c.ai === true, mic: c.mic === true });
  }
  return out;
}
function cleanSettings(raw, legacy = {}) {
  const d = settingsDefaults();
  const r = isObj(raw) ? raw : {};
  const customApps = cleanCustomApps(r.customApps);
  const ids = [...BUILTIN_IDS, ...customApps.map((c) => c.id)];
  const idList = (v) => [...new Set((Array.isArray(v) ? v : []).filter((id) => ids.includes(id)))];
  const idMap = (v) => Object.fromEntries(Object.entries(isObj(v) ? v : {}).filter(([k, b]) => ids.includes(k) && typeof b === 'boolean'));
  const dir = text(r.downloadDir, 1000);
  return {
    launch: ['home', 'last'].includes(r.launch) || ids.includes(r.launch) ? r.launch : d.launch,
    startHidden: bool(r.startHidden, d.startHidden),
    onClose: oneOf(r.onClose, ['tray', 'minimize', 'quit'], legacy.closeToTray === false ? 'quit' : d.onClose),
    sleepMinutes: Math.round(num(r.sleepMinutes ?? legacy.sleepMinutes, 0, 1440, d.sleepMinutes)),
    sleepWhenHidden: bool(r.sleepWhenHidden, d.sleepWhenHidden),
    hidden: idList(r.hidden ?? d.hidden).slice(0, ids.length - 1), // at least one app stays visible
    order: idList(r.order),
    notify: idMap(r.notify),
    keepAlive: idMap(r.keepAlive),
    downloadDir: path.isAbsolute(dir) ? dir : '',
    askDownload: bool(r.askDownload, d.askDownload),
    openDownload: bool(r.openDownload, d.openDownload),
    notifyDownload: bool(r.notifyDownload, d.notifyDownload),
    externalLinks: oneOf(r.externalLinks, ['browser', 'window'], d.externalLinks),
    docLinks: oneOf(r.docLinks, ['beside', 'full', 'window', 'browser'], d.docLinks),
    theme: oneOf(r.theme, ['system', 'light', 'dark'], d.theme),
    zoom: Math.round(num(r.zoom, 50, 200, d.zoom)),
    compact: bool(r.compact, d.compact),
    labels: bool(r.labels, d.labels),
    sideWidth: r.sideWidth ? Math.round(num(r.sideWidth, 180, 480, 0)) : 0, // 0 = follows the window size
    nickname: text(r.nickname, 30),
    reminders: oneOf(Number(r.reminders), [0, 5, 10, 15], d.reminders),
    weekStart: oneOf(Number(r.weekStart), [0, 1], d.weekStart),
    classLabel: oneOf(r.classLabel, ['code', 'name', 'both'], d.classLabel),
    taskReminder: r.taskReminder === '' || r.taskReminder === null ? '' : (/^([01]\d|2[0-3]):[0-5]\d$/.test(r.taskReminder) ? r.taskReminder : d.taskReminder), // phone/tablet only; '' = off
    screenshotDir: path.isAbsolute(text(r.screenshotDir, 1000)) ? text(r.screenshotDir, 1000) : '',
    screenshotCopy: bool(r.screenshotCopy, d.screenshotCopy),
    customApps,
    autoUpdate: bool(r.autoUpdate, d.autoUpdate),
  };
}

// ---- timetable + tasks: validated by the same code the Android app uses
const { cleanPlanner, emptyPlanner } = require('./shared/planner-schema.js');

// ---- files shown inside WakeUp (PDFs, images, screenshots)
const VIEWABLE = /\.(pdf|png|jpe?g|gif|webp|bmp)$/i; // no SVG: it can carry scripts
const cleanFiles = (list) => (Array.isArray(list) ? list : []).filter(isObj).slice(0, 8).map((f) => {
  const src = typeof f.src === 'string' ? f.src : '';
  const ok = isHttp(src) ? safeUrl(src)?.protocol === 'https:' : path.isAbsolute(src) && VIEWABLE.test(src);
  if (!ok || typeof f.id !== 'string' || !/^f-[a-z0-9]{1,20}$/.test(f.id)) return null;
  return { id: f.id, name: text(f.name, 200) || 'Document', src, partition: typeof f.partition === 'string' && /^(persist:[a-z0-9-]{1,48}|files)$/.test(f.partition) ? f.partition : 'files', from: typeof f.from === 'string' ? f.from : null, link: f.link === true, ts: num(f.ts, 0, 1e14, Date.now()) };
}).filter(Boolean);
const cleanShots = (list) => (Array.isArray(list) ? list : []).filter((x) => isObj(x) && typeof x.path === 'string' && path.isAbsolute(x.path) && /\.png$/i.test(x.path))
  .slice(0, 10).map((x) => ({ id: typeof x.id === 'string' ? x.id.slice(0, 30) : `s${Math.random().toString(36).slice(2, 8)}`, path: x.path, name: path.basename(x.path), ts: num(x.ts, 0, 1e14, 0) }));

// ---- persisted state (v4 = v3 + remembered splits, planner, open files, screenshots; v5 = v4 with the new sidebar)
const STATE_FILE = path.join(app.getPath('userData'), 'state.json');
const defaults = () => ({
  v: 5,
  mode: 'tile', // 'tile' | 'free'
  tile: null, // split tree: {dir:'h'|'v', sizes:[fractions], children:[...]} | {pane:id}
  free: [], // [{id, x, y, w, h}] in % of the stage, last = topmost
  alive: [], // every open pane (visible, parked in background, or popped out)
  popped: [], // panes living in their own window
  focused: null,
  zoomed: null,
  splits: [], // remembered split views: [{tile, focused}]; clicking an app in one brings it back
  popBounds: {},
  docBounds: null, // size of document/link windows
  window: { width: 1600, height: 1000 },
  toldAboutTray: false,
  downloads: [], // last finished downloads, newest first
  shots: [], // last screenshots, newest first
  files: [],
  planner: emptyPlanner(),
  settings: settingsDefaults(),
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

// Validate anything coming from disk or the renderer, so a bad value can never crash the app.
function cleanLayout(l) {
  const popped = uniq(l.popped);
  const tile = cleanTree(l.tile, new Set(popped));
  const seen = new Set(popped);
  const free = (Array.isArray(l.free) ? l.free : [])
    .filter((p) => p && valid(p.id) && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ id: p.id, x: num(p.x, -90, 100, 5), y: num(p.y, 0, 95, 5), w: num(p.w, 5, 100, 50), h: num(p.h, 5, 100, 60) }));
  // remembered splits: each app in at most one, never one that is popped out or shown right now in a split
  const taken = new Set([...popped, ...(leaves(tile).length > 1 ? leaves(tile) : [])]);
  const splits = [];
  for (const sp of (Array.isArray(l.splits) ? l.splits : []).slice(0, 6)) {
    const t = isObj(sp) ? cleanTree(sp.tile, taken) : null;
    if (!t || !t.children) { for (const id of leaves(t)) taken.delete(id); continue; } // a split of one is no split
    splits.push({ tile: t, focused: leaves(t).includes(sp.focused) ? sp.focused : leaves(t)[0] });
  }
  const alive = uniq([...uniq(l.alive), ...leaves(tile), ...free.map((p) => p.id), ...popped, ...splits.flatMap((x) => leaves(x.tile))]);
  const pick = (v) => (valid(v) && alive.includes(v) ? v : null);
  return { mode: l.mode === 'free' ? 'free' : 'tile', tile, free, alive, popped, focused: pick(l.focused), zoomed: pick(l.zoomed), splits };
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
const cleanDownloads = (list) => (Array.isArray(list) ? list : [])
  .filter((d) => isObj(d) && typeof d.id === 'string' && typeof d.path === 'string' && path.isAbsolute(d.path))
  .slice(0, 20)
  .map((d) => ({
    id: d.id, name: text(d.name, 300) || path.basename(d.path), path: d.path,
    url: typeof d.url === 'string' ? d.url : '', partition: typeof d.partition === 'string' ? d.partition : '',
    received: num(d.received, 0, 1e13, 0), total: num(d.total, 0, 1e13, 0),
    state: oneOf(d.state, ['completed', 'cancelled', 'interrupted'], 'completed'), ts: num(d.ts, 0, 1e14, 0),
  }));

function loadState() {
  for (const file of [STATE_FILE, STATE_FILE + '.bak']) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!isObj(raw)) throw new Error('not an object');
      const before = raw.v || 1;
      if (before < 4 && isObj(raw.settings)) { // 2.2: the built-in Tasks list replaces Microsoft To Do; documents open beside the app
        raw.settings.hidden = [...(Array.isArray(raw.settings.hidden) ? raw.settings.hidden : []), 'todo'];
        if (raw.settings.docLinks === 'window') raw.settings.docLinks = 'beside';
      }
      if (before < 5 && isObj(raw.settings)) { // 2.2 redesign: the sidebar is a labelled list; the old 'compact'/'no names' icon bar would now fold it to icons
        raw.settings.compact = false; raw.settings.labels = true;
      }
      const settings = cleanSettings(raw.settings, raw);
      FILES = cleanFiles(raw.files);
      rebuildServices(settings);
      const s = { ...defaults(), ...raw, v: 5, settings, ...cleanLayout(before >= 2 ? raw : migrateV1(raw)) };
      if (!isObj(s.window)) s.window = defaults().window;
      if (!isObj(s.popBounds)) s.popBounds = {};
      if (!isObj(s.docBounds)) s.docBounds = null;
      s.downloads = cleanDownloads(raw.downloads);
      s.shots = cleanShots(raw.shots);
      s.planner = cleanPlanner(raw.planner);
      s.files = FILES;
      for (const k of ['layout', 'slots', 'sizes', 'maximized', 'closeToTray', 'sleepMinutes', 'last']) delete s[k]; // older formats
      if (file === STATE_FILE) fs.copyFileSync(file, file + '.bak');
      else log('state.json unreadable; restored from backup');
      if (!raw.v) log('migrated state.json from v1');
      if (raw.settings !== undefined && before >= 4 && JSON.stringify(raw.settings) !== JSON.stringify(settings)) log('settings had invalid or missing values; fixed');
      if (raw.planner !== undefined && JSON.stringify(raw.planner) !== JSON.stringify(s.planner)) log('timetable/tasks had invalid values; fixed');
      return s;
    } catch (e) {
      if (e.code !== 'ENOENT') log(`could not read ${path.basename(file)}:`, e.message);
    }
  }
  const d = defaults(); rebuildServices(d.settings); return d;
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

// ---- dock menu: right-click WakeUp in the dock → open one app on its own
const DESKTOP_FILE = path.join(app.getPath('home'), '.local', 'share', 'applications', 'wakeup.desktop');
const EXEC = () => process.env.APPIMAGE || process.execPath;
function writeDesktopEntry() {
  if (!app.isPackaged) return; // `npm start` must not point the launcher at the dev Electron
  const apps = shownServices();
  const exec = `"${EXEC().replace(/(["`$\\])/g, '\\$1')}"`;
  const body = `[Desktop Entry]
Type=Application
Name=${APP}
GenericName=Workspace
Comment=Ebwise, Outlook, Teams, your timetable and tasks in one window
Exec=${exec} %U
TryExec=${EXEC()}
Icon=wakeup
Terminal=false
Categories=Office;Network;
Keywords=mail;teams;outlook;calendar;todo;ebwise;mmu;workhub;
StartupNotify=true
StartupWMClass=wakeup
SingleMainWindow=true
Actions=${apps.map((s) => `open-${s.id};`).join('')}settings;quit;
${apps.map((s) => `
[Desktop Action open-${s.id}]
Name=${text(s.name, 32)}
Exec=${exec} --open=${s.id}
`).join('')}
[Desktop Action settings]
Name=Settings
Exec=${exec} --open=settings

[Desktop Action quit]
Name=Quit ${APP}
Exec=${exec} --quit
`;
  try { if (fs.readFileSync(DESKTOP_FILE, 'utf8') === body) return; } catch { /* missing: write it */ }
  try {
    fs.mkdirSync(path.dirname(DESKTOP_FILE), { recursive: true });
    fs.writeFileSync(DESKTOP_FILE + '.tmp', body);
    fs.renameSync(DESKTOP_FILE + '.tmp', DESKTOP_FILE);
  } catch (e) { log('could not write launcher', e); }
}
const argOpen = (argv) => {
  const i = argv.findIndex((a) => a === '--open' || a.startsWith('--open='));
  if (i < 0) return null;
  return argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1] || null;
};

// scripts/install.sh runs `wakeup --install-desktop` to write the launcher, then exits.
if (process.argv.includes('--install-desktop')) { writeDesktopEntry(); process.exit(0); }
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
if (process.argv.includes('--quit')) process.exit(0); // nothing running: nothing to quit

// What to show at launch: `--open <id>`, else the "At launch open" setting.
const openArg = argOpen(process.argv);
{
  // launching into one app (or the start screen) keeps the current split for later instead of throwing it away
  const target = valid(openArg) ? openArg : valid(state.settings.launch) ? state.settings.launch : null;
  if (target || (state.settings.launch === 'home' && openArg !== 'settings')) {
    const splits = leaves(state.tile).length > 1 && state.mode === 'tile' ? [{ tile: state.tile, focused: state.focused }, ...state.splits] : state.splits;
    Object.assign(state, cleanLayout({ ...state, mode: 'tile', tile: target ? { pane: target } : null, free: [], focused: target, zoomed: null, splits }));
  }
}
nativeTheme.themeSource = state.settings.theme;

let win; let tray; let quitting = false; let covered = false;
/** id -> { view, status, url, hiddenSince, retries, retryTimer, popWin, unread, findOpen } */
const panes = new Map();
const pendingUrl = {}; // id -> URL a pane should open with (mail compose, Teams meeting links)
if (process.env.WAKEUP_PROFILE) global.wakeupDebug = { panes, state }; // test profiles only: lets a debugger inspect panes
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
// settings changes also reach popped-out Timetable/Tasks windows (week start, nickname)
const sendSettings = () => { const p = settingsPayload(); for (const w of shellWindows()) w.webContents.send('settings', p); return p; };
const paneIdOf = (wc) => { for (const [id, p] of panes) if (p.view?.webContents === wc) return id; return null; };
const paneWc = (id) => { const wc = panes.get(id)?.view?.webContents; return wc && !wc.isDestroyed() ? wc : null; };

// ---- sessions: permissions, screen share, UA, downloads
const configured = new Set();
function configureSession(partition) {
  if (configured.has(partition)) return;
  configured.add(partition);
  const ses = session.fromPartition(partition);
  ses.setUserAgent(UA);
  const notifyOk = (wc) => { const id = wc && paneIdOf(wc); return !(id && state.settings.notify[id] === false); };
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = details.requestingUrl || wc.getURL();
    if (permission === 'media' && !isMediaHost(url) && isMicHost(url)) return cb((details.mediaTypes || []).length > 0 && details.mediaTypes.every((t) => t === 'audio'));
    if (permission === 'media' || permission === 'display-capture') return cb(isMediaHost(url));
    if (permission === 'notifications') return cb(notifyOk(wc));
    return cb(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'speaker-selection'].includes(permission));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (permission === 'media') return isMediaHost(origin) || isMicHost(origin);
    if (permission === 'notifications') return notifyOk(wc);
    return ['clipboard-sanitized-write', 'fullscreen'].includes(permission);
  });
  // On Wayland, getSources() opens the system (PipeWire portal) picker and returns the chosen source.
  ses.setDisplayMediaRequestHandler(async (request, cb) => {
    if (!isMediaHost(request.securityOrigin || request.frame?.url || '')) return cb({});
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      cb(sources.length ? { video: sources[0] } : {});
    } catch (e) { log('screen share failed', e); cb({}); }
  });
  ses.on('will-download', (_e, item, wc) => onDownload(item, wc, partition));
}

// ---- downloads: straight to the Downloads folder (or ask), with progress in the Downloads panel
const downloads = []; // newest first: {id, name, path, url, partition, received, total, state, ts}
const dlItems = new Map(); // id -> DownloadItem while in progress
const reserved = new Set(); // save paths taken by downloads still in progress
const askOnce = new Set(); // URLs from "Save link as…"
let dlSeq = 0;
const canRetry = (d) => isHttp(d.url) && !!d.partition;
const publicDl = (d) => ({ id: d.id, name: d.name, path: d.path, received: d.received, total: d.total, state: d.state, ts: d.ts, viewable: VIEWABLE.test(d.path || d.name), retry: canRetry(d) || !!dlItems.get(d.id)?.canResume() });
// Files that run code when opened: never open these without the user choosing to.
const RUNNABLE = /\.(desktop|sh|bash|zsh|fish|run|bin|appimage|jar|py|pl|rb|exe|msi|bat|cmd|com|scr|ps1|vbs|deb|rpm|flatpakref|snap)$/i;
const openFile = (p) => (RUNNABLE.test(p) ? shell.showItemInFolder(p) : shell.openPath(p).then((err) => err && log('could not open', path.basename(p), err)));
function downloadDir() {
  const dir = state.settings.downloadDir || app.getPath('downloads');
  try { fs.mkdirSync(dir, { recursive: true }); return dir; } catch (e) { log('download folder unusable, using default', e.message); return app.getPath('downloads'); }
}
function uniquePath(dir, name) {
  const ext = path.extname(name); const base = name.slice(0, name.length - ext.length) || 'download';
  for (let i = 0; ; i++) {
    const p = path.join(dir, i ? `${base} (${i})${ext}` : name);
    if (!reserved.has(p) && !fs.existsSync(p)) return p;
  }
}
function onDownload(item, wc, partition) {
  const s = state.settings;
  const id = `d${Date.now().toString(36)}${dlSeq++}`;
  const name = path.basename(item.getFilename() || '').replace(/^\.+/, '') || 'download';
  const ask = askOnce.delete(item.getURL()) || s.askDownload;
  const dir = downloadDir();
  if (ask) item.setSaveDialogOptions({ defaultPath: path.join(dir, name) });
  else { item.setSavePath(uniquePath(dir, name)); reserved.add(item.getSavePath()); }
  const d = { id, name, path: ask ? '' : item.getSavePath(), url: item.getURL(), partition, received: 0, total: item.getTotalBytes(), state: 'progressing', ts: Date.now() };
  // a document pane whose link turned out to be a download: show the saved file in that same pane
  const fromId = wc && !wc.isDestroyed() ? paneIdOf(wc) : null;
  const filePane = fromId && byId[fromId]?.kind === 'file' && !byId[fromId].local ? fromId : null;
  downloads.unshift(d); dlItems.set(id, item);
  // A link window that only existed to start this download stays blank: close it.
  const w = wc && !wc.isDestroyed() ? linkOwner.get(wc) || BrowserWindow.fromWebContents(wc) : null;
  if (w && linkWindows.has(w) && !linkWindows.get(w).loaded) setImmediate(() => { if (!w.isDestroyed()) w.close(); });
  let lastSent = 0;
  const push = (force) => { const now = Date.now(); if (force || now - lastSent > 250) { lastSent = now; send('download', publicDl(d)); } };
  push(true);
  item.on('updated', (_e, st) => {
    if (item.getSavePath() && item.getSavePath() !== d.path) { d.path = item.getSavePath(); d.name = path.basename(d.path); reserved.add(d.path); }
    d.received = item.getReceivedBytes(); d.total = item.getTotalBytes();
    d.state = st === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
    push(false);
  });
  item.once('done', (_e, st) => {
    dlItems.delete(id); reserved.delete(d.path);
    d.path = item.getSavePath() || d.path; d.received = item.getReceivedBytes(); d.state = st;
    if (!d.path) { downloads.splice(downloads.indexOf(d), 1); send('download', { id, removed: true }); return; } // save dialog cancelled
    d.name = path.basename(d.path);
    send('download', publicDl(d));
    if (st === 'completed' && filePane && FILES.some((f) => f.id === filePane)) {
      if (VIEWABLE.test(d.path)) showInFilePane(filePane, d.path);
      else { send('cmd', { name: 'close', arg: filePane }); openFile(d.path); }
    } else if (st === 'completed') {
      if (s.openDownload && !RUNNABLE.test(d.path)) openFile(d.path);
      else if (s.notifyDownload && Notification.isSupported()) {
        const n = new Notification({ title: 'Download finished', body: d.name, icon: ICON });
        n.on('click', () => (VIEWABLE.test(d.path) ? viewPath(d.path) : openFile(d.path)));
        n.show();
      }
    } else if (st === 'interrupted') {
      log(`download failed: ${d.name}`);
      if (Notification.isSupported()) new Notification({ title: 'Download failed', body: `${d.name}. Open Downloads in ${APP} to retry.`, icon: ICON }).show();
    }
    // kept across restarts without the source URL (SharePoint/Outlook links can carry access tokens)
    state.downloads = downloads.filter((x) => !['progressing', 'paused'].includes(x.state)).slice(0, 20).map(({ url: _u, partition: _p, ...x }) => x);
    saveState();
  });
}
function downloadAction(id, action) {
  const d = downloads.find((x) => x.id === id); if (!d) return;
  const item = dlItems.get(id);
  const drop = () => { downloads.splice(downloads.indexOf(d), 1); state.downloads = state.downloads.filter((x) => x.id !== id); saveState(); send('download', { id, removed: true }); };
  if ((action === 'open' || action === 'view') && d.state === 'completed') {
    if (!fs.existsSync(d.path)) send('download', { ...publicDl(d), missing: true });
    else if (action === 'view') viewPath(d.path); else openFile(d.path);
  }
  else if (action === 'show' && d.path) { if (fs.existsSync(d.path)) shell.showItemInFolder(d.path); else shell.openPath(path.dirname(d.path)); }
  else if (action === 'cancel' && item) item.cancel();
  else if (action === 'retry') {
    if (item?.canResume()) item.resume();
    else if (!item && isHttp(d.url) && d.partition) {
      drop();
      configureSession(d.partition);
      session.fromPartition(d.partition).downloadURL(d.url);
    }
  } else if (action === 'remove' && !item) drop();
}

// ---- links: where clicked links and popups go
function openOut(url) {
  if (url.startsWith('mailto:')) { composeMail(url); return; }
  if (!isHttp(url)) { log('blocked a link with scheme', url.split(':')[0]); return; } // never hand file:/smb:/custom schemes to the OS
  shell.openExternal(url).catch((e) => log('openExternal failed', e));
}
function openInPane(id, url) {
  if (!valid(id)) return false;
  const p = panes.get(id);
  if (p?.view && !p.view.webContents.isDestroyed()) { p.url = url; p.view.webContents.loadURL(url, { userAgent: UA }).catch(() => {}); } else pendingUrl[id] = url;
  showWindow(); send('cmd', { name: 'open', arg: id });
  return true;
}
function composeMail(mailto) {
  const u = safeUrl(mailto); if (!u) return;
  let to = u.pathname; try { to = decodeURIComponent(to); } catch { /* keep it encoded */ }
  const q = new URLSearchParams({ to });
  for (const k of ['subject', 'body', 'cc', 'bcc']) if (u.searchParams.get(k)) q.set(k, u.searchParams.get(k));
  if (!openInPane('mail', `https://outlook.office.com/mail/deeplink/compose?${q}`)) shell.openExternal(mailto).catch(() => {});
}
function followLink(svc, url) { // a link leaving the app: browser, or a WakeUp window (Settings → Links)
  if (state.settings.externalLinks === 'window' && isHttp(url)) openLinkWindow(url, svc); else openOut(url);
}
function openDoc(svc, url) { // an Ebwise course file: beside the app, full screen, its own window or the browser (Settings → Links)
  const how = state.settings.docLinks;
  if (how === 'browser') openOut(url);
  else if (how === 'window') openLinkWindow(url, svc);
  else showFile(addFile({ src: url, name: 'Opening…', partition: svc.partition, from: svc.from || svc.id }), how);
}

// ---- documents and images shown in a pane (Chromium's PDF viewer), from Ebwise links, Downloads or screenshots
let fileSeq = 0;
function filesChanged() { state.files = FILES; rebuildServices(state.settings); saveState(); sendSettings(); }
function addFile({ src, name, partition, from, link = false }) {
  const id = `f-${Date.now().toString(36)}${(fileSeq++).toString(36)}`;
  if (FILES.length >= 6) { // make room: close the oldest document that isn't on screen
    const onScreen = new Set([...leaves(state.tile), ...state.free.map((p) => p.id), ...state.popped]);
    const old = FILES.find((f) => !onScreen.has(f.id)) || FILES[0];
    send('cmd', { name: 'close', arg: old.id });
  }
  FILES.push({ id, name: text(name, 200) || 'Document', src, partition, from: from || null, link: !!link, ts: Date.now() });
  filesChanged();
  return id;
}
function showFile(id, how = 'beside') { showWindow(); send('cmd', { name: 'open-file', arg: { id, how: oneOf(how, ['beside', 'full', 'window'], 'beside') } }); }
function viewPath(p, how) { // a file on disk: open it in a pane if Chromium can show it, else with the system app
  if (!VIEWABLE.test(p)) { openFile(p); return; }
  if (!fs.existsSync(p)) return;
  const open = FILES.find((f) => f.src === p);
  showFile(open ? open.id : addFile({ src: p, name: path.basename(p), partition: 'files' }), how);
}
function showInFilePane(id, file) {
  const f = FILES.find((x) => x.id === id); if (!f) return;
  Object.assign(f, { src: file, name: path.basename(file), partition: 'files' });
  filesChanged();
  const p = panes.get(id);
  if (p) { p.url = null; destroyView(p); if (p.popWin) { const v = wake(id); v.setBorderRadius?.(0); p.popWin.contentView.addChildView(v); fitPop(id); } else applyBounds(); }
}
function renameFile(id, name) {
  const f = FILES.find((x) => x.id === id); const n = text(name, 200);
  if (!f || !n || f.name === n || /^https?:/i.test(n)) return;
  f.name = n; filesChanged();
}
const linkWindowSize = () => fitOnScreen(state.docBounds || { width: 1100, height: 820 });
// plugins: a linked page can open a PDF, and it may later move into a pane (which shows PDFs)
const linkPrefs = (svc) => ({ partition: svc.partition, sandbox: true, contextIsolation: true, spellcheck: true, plugins: true });
const linkWindows = new WeakMap(); // window -> { loaded }: a window that never showed a page only existed for a download
const linkOwner = new WeakMap(); // page webContents -> the link window that holds it
function trackLinkWindow(w, svc, rememberSize = true, wc = w.webContents) {
  const info = { loaded: false };
  linkWindows.set(w, info); linkOwner.set(wc, w);
  w.setMenuBarVisibility(false);
  wc.on('did-navigate', (_e, url) => { if (isHttp(url)) info.loaded = true; });
  const remember = () => { if (!w.isMinimized() && !w.isMaximized()) { state.docBounds = w.getBounds(); saveState(); } };
  if (rememberSize) { w.on('resize', remember); w.on('move', remember); } // not for small sign-in popups
  guard(wc, svc, { linkWindow: true });
}

// ---- link windows: the page sits under a slim WakeUp bar (link.html) in its own view,
// so it can move into the main window (Dock button, or drag the bar's grip) without reloading.
const LINKBAR = 40;
const linkHosts = new Map(); // token -> { win, view, svc, docked }
let linkSeq = 0;
const linkOf = (sender) => { for (const [token, l] of linkHosts) if (l.win.webContents === sender) return [token, l]; return [null, null]; };
function fitLink(l) {
  if (l.win.isDestroyed()) return;
  const [cw, ch] = l.win.getContentSize();
  l.view.setBounds({ x: 0, y: LINKBAR, width: cw, height: Math.max(0, ch - LINKBAR) });
}
function linkInfo(token) {
  const l = linkHosts.get(token); const wc = l?.view.webContents;
  if (!wc || wc.isDestroyed()) return null;
  return { token, app: l.svc.name, color: l.svc.color, title: wc.getTitle() || l.svc.name, url: wc.getURL(), back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward(), loading: wc.isLoading() };
}
function sendLink(token) {
  const l = linkHosts.get(token); const info = linkInfo(token);
  if (l && info && !l.win.isDestroyed()) l.win.webContents.send('link', info);
}
// a page-opened popup holds its page directly, so moving it in reloads the page in a pane (same sign-in)
function dockPopup(w, wc, svc) {
  const url = wc.getURL(); if (safeUrl(url)?.protocol !== 'https:') return;
  showFile(addFile({ src: url, name: wc.getTitle() || svc.name, partition: svc.partition, from: svc.id, link: true }), 'beside');
  w.close();
}
function openLinkWindow(url, svc) {
  configureSession(svc.partition);
  const w = new BrowserWindow({
    ...linkWindowSize(), minWidth: 360, minHeight: 300, title: svc.name, icon: ICON,
    autoHideMenuBar: true, backgroundColor: BG(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  const view = new WebContentsView({ webPreferences: linkPrefs(svc) });
  view.setBackgroundColor(BG());
  w.contentView.addChildView(view);
  const token = `l${++linkSeq}`;
  const l = { win: w, view, svc, docked: false };
  linkHosts.set(token, l);
  const wc = view.webContents;
  trackLinkWindow(w, svc, true, wc);
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) wc.on(ev, () => sendLink(token));
  wc.on('page-title-updated', (_e, title) => { if (!w.isDestroyed()) w.setTitle(`${title} · ${APP}`); sendLink(token); });
  wc.on('before-input-event', (e, input) => { // Ctrl+W closes this window, Ctrl+R reloads, Ctrl+Shift+D docks it
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
    const k = input.key.toLowerCase();
    if (w.isDestroyed()) return; // the page has moved into WakeUp; its pane handles keys now
    if (k === 'w' && !input.shift) { e.preventDefault(); w.close(); } else if (k === 'r' && !input.shift) { e.preventDefault(); wc.reload(); } else if (k === 'd' && input.shift) { e.preventDefault(); dockLink(token); }
  });
  w.webContents.on('did-finish-load', () => sendLink(token));
  w.on('resize', () => fitLink(l));
  w.on('closed', () => {
    linkHosts.delete(token);
    if (!l.docked && !wc.isDestroyed()) wc.close();
    // closed mid-drag (or its bar crashed): tell the main window to show its apps again
    if (win && !win.isDestroyed()) win.webContents.send('cmd', { name: 'link-drag', arg: null });
  });
  w.loadFile(UI('link.html'));
  fitLink(l);
  wc.loadURL(url, { userAgent: UA }).catch(() => { /* Chromium shows its error page */ });
}
// Move a link window's page into the main window as a document pane. `how` is 'beside' (Dock button) or 'none'
// (a drop: the shell places it where it was dropped). The page keeps running: no reload, no new sign-in.
function dockLink(token, how = 'beside') {
  const l = linkHosts.get(token); const wc = l?.view.webContents;
  if (!l || !wc || wc.isDestroyed()) return null;
  const url = wc.getURL();
  if (!isHttp(url) || safeUrl(url)?.protocol !== 'https:') { openOut(url); return null; }
  const id = addFile({ src: url, name: wc.getTitle() || l.svc.name, partition: l.svc.partition, from: l.svc.id, link: true });
  adopted[id] = l.view;
  linkOwner.delete(wc); // it belongs to a pane now (menus and keys look the owner up)
  // the shell normally shows the new pane within a moment; if it never does, don't leave the page running unseen
  setTimeout(() => { const v = adopted[id]; if (v) { delete adopted[id]; if (!v.webContents.isDestroyed()) v.webContents.close(); log('docked page never shown, closed', id); } }, 15e3);
  l.docked = true;
  l.win.contentView.removeChildView(l.view);
  l.win.destroy();
  if (how !== 'none') showFile(id, how); else showWindow();
  return id;
}

// window.open / target=_blank from a pane or one of its windows
function routeOpen(svc, { url, disposition }) {
  const deny = { action: 'deny' };
  if (url.startsWith('mailto:')) { composeMail(url); return deny; }
  if (isTeamsLink(url) && svc.id !== 'teams' && openInPane('teams', url)) return deny;
  if (disposition === 'background-tab') { openOut(url); return deny; } // Ctrl+click / middle-click
  const allow = (o = {}) => ({ action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON, backgroundColor: BG(), ...o, webPreferences: linkPrefs(svc) } });
  if (isAuth(url)) return allow({ width: 520, height: 720 });
  // scripted popups (compose, sign-in) keep their opener; custom apps may sign in through any provider
  if (url === 'about:blank' || url === '' || (disposition === 'new-window' && (svc.custom || isInternal(url, svc)))) return allow();
  if (isInternal(url, svc)) {
    if (state.settings.docLinks === 'browser') { openOut(url); return deny; }
    openLinkWindow(url, svc); // a WakeUp window with its bar, so it can dock back in
    return deny;
  }
  followLink(svc, url);
  return deny;
}
// Link rules, right-click menu and popups for a pane's page and every window it opens.
function guard(wc, svc, { linkWindow = false } = {}) {
  wc.setWindowOpenHandler((d) => routeOpen(svc, d));
  wc.on('did-create-window', (w, d) => trackLinkWindow(w, svc, !isAuth(d.url)));
  wc.on('context-menu', (_e, params) => contextMenu(wc, params, svc));
  if (linkWindow) return; // link windows browse freely; panes stay on their own sites
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith('mailto:')) { e.preventDefault(); composeMail(url); return; }
    if (isTeamsLink(url) && svc.id !== 'teams') { e.preventDefault(); if (!openInPane('teams', url)) followLink(svc, url); return; }
    if (svc.kind === 'file') { // a document pane: Ebwise may show a page around the file first; anything else leaves
      if (!svc.local && isHttp(url) && (isDocNav(url) || isInternal(url, svc))) return;
      e.preventDefault(); if (isHttp(url)) followLink(svc, url); return;
    }
    if (isDocNav(url)) { e.preventDefault(); openDoc(svc, url); return; }
    if (!svc.custom && !isInternal(url, svc)) { e.preventDefault(); followLink(svc, url); }
  });
}

// ---- right-click menu (Electron has none by default)
function contextMenu(wc, p, svc) {
  const items = [];
  const sep = () => { if (items.length && items.at(-1).type !== 'separator') items.push({ type: 'separator' }); };
  const saveAs = (url) => { askOnce.add(url); wc.downloadURL(url); };
  if (p.misspelledWord) {
    for (const w of p.dictionarySuggestions.slice(0, 5)) items.push({ label: w, click: () => wc.replaceMisspelling(w) });
    if (!p.dictionarySuggestions.length) items.push({ label: 'No spelling suggestions', enabled: false });
    items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    sep();
  }
  if (isHttp(p.linkURL)) {
    items.push(
      { label: 'Open link in browser', click: () => openOut(p.linkURL) },
      { label: `Open link in ${APP} window`, click: () => openLinkWindow(p.linkURL, svc) },
      { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
      { label: 'Save link as…', click: () => saveAs(p.linkURL) },
    );
    sep();
  } else if (p.linkURL.startsWith('mailto:')) {
    items.push({ label: 'Copy email address', click: () => clipboard.writeText(decodeURIComponent(p.linkURL.slice(7).split('?')[0])) });
    sep();
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push({ label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) });
    if (/^(https?|blob|data):/i.test(p.srcURL)) items.push({ label: 'Save image as…', click: () => saveAs(p.srcURL) });
    sep();
  }
  const f = p.editFlags;
  if (p.isEditable) {
    items.push(
      { label: 'Undo', enabled: f.canUndo, click: () => wc.undo() }, { label: 'Redo', enabled: f.canRedo, click: () => wc.redo() }, { type: 'separator' },
      { label: 'Cut', enabled: f.canCut, click: () => wc.cut() }, { label: 'Copy', enabled: f.canCopy, click: () => wc.copy() },
      { label: 'Paste', enabled: f.canPaste, click: () => wc.paste() }, { label: 'Paste as plain text', enabled: f.canPaste, click: () => wc.pasteAndMatchStyle() },
      { label: 'Select all', enabled: f.canSelectAll, click: () => wc.selectAll() },
    );
  } else if (p.selectionText.trim()) items.push({ label: 'Copy', click: () => wc.copy() });
  const owner = linkOwner.get(wc);
  if (owner && !owner.isDestroyed() && isHttp(wc.getURL())) {
    sep();
    const token = [...linkHosts].find(([, l]) => l.win === owner)?.[0];
    items.push({ label: `Move into ${APP}`, click: () => (token ? dockLink(token) : dockPopup(owner, wc, svc)) });
  }
  while (items.at(-1)?.type === 'separator') items.pop();
  if (!items.length) return;
  const id = paneIdOf(wc);
  const w = linkOwner.get(wc) || BrowserWindow.fromWebContents(wc) || (id && panes.get(id)?.popWin) || win;
  Menu.buildFromTemplate(items).popup({ window: w });
}

// ---- pane status: loading / ready / error / crashed / hung / sleeping
const pane = (id) => {
  if (!panes.has(id)) panes.set(id, { view: null, status: 'new', url: null, hiddenSince: null, retries: 0, retryTimer: null, popWin: null, unread: 0, findOpen: false });
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

const iconTried = new Set();
async function fetchIcon(id, url, ses) { // custom apps: keep the site's favicon for the sidebar
  if (iconTried.has(id) || !isHttp(url)) return;
  iconTried.add(id);
  try {
    const res = await ses.fetch(url);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || !type.startsWith('image/') || buf.length > 60000) return;
    const icon = `data:${type};base64,${buf.toString('base64')}`;
    applySettings({ customApps: state.settings.customApps.map((c) => (c.id === id ? { ...c, icon } : c)) });
  } catch (e) { log('could not fetch icon for', id, e.message); }
}

const adopted = {}; // file id -> a link window's view that is moving into that pane
function createView(id) {
  const p = pane(id);
  const svc = byId[id];
  configureSession(svc.partition);
  const keep = adopted[id]; delete adopted[id];
  if (keep) { // drop the link window's listeners; the pane wires its own below
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated', 'before-input-event', 'did-create-window', 'context-menu']) keep.webContents.removeAllListeners(ev);
  }
  const view = keep && !keep.webContents.isDestroyed() ? keep : new WebContentsView({
    webPreferences: { partition: svc.partition, sandbox: true, contextIsolation: true, spellcheck: true, plugins: svc.kind === 'file' },
  });
  view.setBorderRadius?.(p.popWin ? 0 : RADIUS);
  view.setBackgroundColor(BG());
  const wc = view.webContents;
  guard(wc, svc);
  wc.on('page-title-updated', (_e, title) => {
    if (svc.kind === 'file') { if (!svc.local) renameFile(id, title); return; }
    const m = title.match(/^\((\d+)\)|\((\d+)\)\s*$|^(\d+)\s+unread/i);
    const n = m ? Number(m[1] || m[2] || m[3]) : 0;
    if (n !== p.unread) { p.unread = n; updateBadge(); send('unread', { id, n }); }
  });
  if (svc.custom && !svc.icon) wc.on('page-favicon-updated', (_e, favs) => fetchIcon(id, favs[0], wc.session));
  wc.on('did-start-loading', () => { if (p.status !== 'error') setStatus(id, 'loading'); });
  wc.on('did-stop-loading', () => { if (p.status === 'loading') setStatus(id, 'ready'); });
  wc.on('did-navigate', (_e, url) => { p.url = url; });
  wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) p.url = url; });
  wc.on('did-finish-load', () => {
    signInAgain(id, wc);
    if (state.settings.zoom !== 100) wc.setZoomFactor(state.settings.zoom / 100);
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
    // reload by itself once a minute at most; a page that keeps crashing waits for the Reload button
    if (Date.now() - (p.crashedAt || 0) > 60e3) { p.crashedAt = Date.now(); setTimeout(() => retry(id), 500); return; }
    setStatus(id, 'crashed', { reason: d.reason });
  });
  wc.on('unresponsive', () => setStatus(id, 'hung'));
  wc.on('responsive', () => { if (p.status === 'hung') setStatus(id, 'ready'); });
  wc.on('found-in-page', (_e, r) => {
    if (!r.finalUpdate) return;
    const host = p.popWin && !p.popWin.isDestroyed() ? p.popWin.webContents : win?.webContents;
    host?.send('found', { id, active: r.activeMatchOrdinal, matches: r.matches });
  });
  wc.on('before-input-event', (e, input) => { if (handleShortcut(input, id)) e.preventDefault(); });
  wc.on('focus', () => { if (!p.popWin) send('focused', id); });
  p.view = view;
  if (view === keep) {
    p.url = wc.getURL(); setStatus(id, wc.isLoading() ? 'loading' : 'ready');
    if (state.settings.zoom !== 100) wc.setZoomFactor(state.settings.zoom / 100);
    return view;
  }
  setStatus(id, 'loading');
  const url = pendingUrl[id] || p.url || svc.url; delete pendingUrl[id];
  wc.loadURL(url, { userAgent: UA }).catch(() => { /* reported via did-fail-load */ });
  return view;
}
function wake(id) { if (isLocal(id)) return null; const p = pane(id); return p.view || createView(id); }

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
const windowShown = () => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
function markHiddenWindow() { // the whole window is in the tray or minimised: every docked pane is out of sight
  if (!state.settings.sleepWhenHidden) return;
  for (const p of panes.values()) if (p.view && !p.popWin) p.hiddenSince ??= Date.now();
}
setInterval(() => {
  const mins = state.settings.sleepMinutes;
  if (!mins) return;
  if (!windowShown()) markHiddenWindow(); // minimise state can lag behind its event on Wayland
  const cutoff = Date.now() - mins * 60e3;
  for (const [id, p] of panes) {
    if (!p.view || p.popWin || byId[id]?.keepAlive || !p.hiddenSince || p.hiddenSince > cutoff) continue;
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
      const view = wake(id); if (!view) continue; // Timetable and Tasks are drawn by the shell itself
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
const FINDBAR = 40;
function fitPop(id) {
  const p = panes.get(id); const w = p?.popWin;
  if (!w || w.isDestroyed() || !p.view) return;
  const [cw, ch] = w.getContentSize(); const top = p.findOpen ? FINDBAR : 0;
  p.view.setBounds({ x: 0, y: top, width: cw, height: Math.max(0, ch - top) });
}
function popOut(id) {
  const p = pane(id);
  if (p.popWin) return;
  const view = wake(id); // null for Timetable/Tasks: pop.html draws them itself
  if (view) detach(view);
  const w = new BrowserWindow({
    ...fitOnScreen(state.popBounds[id] || { width: 1000, height: 760 }), minWidth: 360, minHeight: 300,
    title: `${byId[id].name} · ${APP}`, icon: ICON, autoHideMenuBar: true, backgroundColor: BG(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  p.popWin = w; p.findOpen = false;
  w.setMenuBarVisibility(false);
  w.loadFile(UI('pop.html'), { query: { id } }); // holds the find bar
  w.webContents.on('before-input-event', (e, input) => { if (handleShortcut(input, id)) e.preventDefault(); });
  if (view) { view.setBorderRadius?.(0); w.contentView.addChildView(view); }
  const remember = () => { if (!w.isMinimized() && !w.isMaximized()) { state.popBounds[id] = w.getBounds(); saveState(); } };
  fitPop(id); view?.setVisible(true);
  w.on('resize', () => { fitPop(id); remember(); });
  w.on('move', remember);
  w.on('close', () => {
    if (p.popWin !== w || quitting) return; // closed by us (dock/close), or app quitting: keep popped state for next launch
    // the user closed the window → dock the pane back into the layout
    if (view && w.contentView.children.includes(view)) w.contentView.removeChildView(view);
    view?.setBorderRadius?.(RADIUS);
    p.popWin = null; p.findOpen = false;
    send('cmd', { name: 'dock', arg: id });
  });
  view?.webContents.focus();
}
function dockBack(id) {
  const p = panes.get(id);
  if (!p?.popWin) return;
  const w = p.popWin; p.popWin = null; p.findOpen = false;
  if (p.view) { w.contentView.removeChildView(p.view); p.view.setBorderRadius?.(RADIUS); p.view.webContents.stopFindInPage('clearSelection'); }
  w.destroy();
}

// The renderer owns the layout; main validates, persists, and reconciles windows/views with it.
function commit(raw) {
  const l = cleanLayout(raw && typeof raw === 'object' ? raw : {});
  Object.assign(state, l);
  // a closed document leaves the Files list (a just-opened one may not have reached the layout yet)
  const gone = FILES.filter((f) => !l.alive.includes(f.id) && Date.now() - f.ts > 5000);
  if (gone.length) { FILES = FILES.filter((f) => !gone.includes(f)); state.files = FILES; rebuildServices(state.settings); }
  for (const [id, p] of panes) {
    if (!l.alive.includes(id)) closePane(id);
    else if (p.popWin && !l.popped.includes(id)) dockBack(id);
  }
  for (const id of l.popped) popOut(id);
  saveState();
  if (gone.length) sendSettings();
}

// ---- keyboard shortcuts (work from the shell and from inside any web pane)
function handleShortcut(input, fromId) {
  if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return false;
  const k = input.key.toLowerCase();
  const popped = fromId && panes.get(fromId)?.popWin;
  if (fromId && !input.shift && byId[fromId]?.ownKeys?.includes(k)) return false; // e.g. Teams' own Ctrl+F search and Ctrl+, settings
  const cmd = (name, arg) => { send('cmd', { name, arg }); return true; };
  if (!input.shift) {
    const apps = shownServices();
    if (/^[1-9]$/.test(k) && apps[Number(k) - 1]) { showWindow(); return cmd('open', apps[Number(k) - 1].id); }
    if (k === 'w') return cmd('close', popped ? fromId : undefined);
    if (k === 'm' && !popped) return cmd('zoom');
    if (k === 'r') { retryOrReload(fromId || state.focused); return true; }
    if (k === 'f') {
      const id = fromId || state.focused; if (!id) return true;
      const host = popped || win;
      host.webContents.focus(); host.webContents.send('cmd', { name: 'find', arg: id });
      return true;
    }
    if (k === ',') { showWindow(); return cmd('settings'); }
    if (k === 'j') { showWindow(); return cmd('downloads'); }
    if (k === 'k') { showWindow(); win.webContents.focus(); return cmd('switcher'); }
    if (k === '/') { showWindow(); win.webContents.focus(); return cmd('help'); }
    if (k === 'tab' && !popped) return cmd('cycle', 1);
  } else {
    if (k === 'k') { showWindow(); win.webContents.focus(); return cmd('switcher'); } // works even where an app uses Ctrl+K itself
    if (k === 's') { showWindow(); return cmd('shot', 'all'); }
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
  tray?.setToolTip(total ? `${APP} · ${total} unread` : APP);
}

const AUTOSTART = path.join(app.getPath('home'), '.config', 'autostart', 'wakeup.desktop');
const LEGACY_AUTOSTART = path.join(path.dirname(AUTOSTART), 'workhub.desktop');
const autostartOn = () => fs.existsSync(AUTOSTART);
const autostartBody = () => `[Desktop Entry]\nType=Application\nName=${APP}\nExec="${EXEC()}" --hidden\nIcon=wakeup\nX-GNOME-Autostart-enabled=true\n`;
function setAutostart(on) {
  try {
    if (on) {
      fs.mkdirSync(path.dirname(AUTOSTART), { recursive: true });
      fs.writeFileSync(AUTOSTART, autostartBody());
    } else fs.rmSync(AUTOSTART, { force: true });
  } catch (e) { log('autostart change failed', e); }
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
      ...shownServices().slice(0, 9).map((s, i) => ({ label: s.name, accelerator: `Ctrl+${i + 1}`, click: () => { showWindow(); send('cmd', { name: 'open', arg: s.id }); } })),
      { type: 'separator' },
      { label: 'Take a screenshot', click: () => { showWindow(); send('cmd', { name: 'shot', arg: 'all' }); } },
      { label: 'Downloads', click: () => { showWindow(); send('cmd', { name: 'downloads' }); } },
      { label: 'Settings…', click: () => { showWindow(); send('cmd', { name: 'settings' }); } },
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

// ---- settings changes from the Settings page (and the favicon fetcher)
const settingsPayload = () => ({
  settings: state.settings, services: SERVICES, autostart: autostartOn(), version: app.getVersion(),
  defaultDownloadDir: app.getPath('downloads'), defaultShotDir: path.join(app.getPath('pictures'), 'Screenshots'),
  layout: { mode: state.mode, tile: state.tile, free: state.free, alive: state.alive, popped: state.popped, focused: state.focused, zoomed: state.zoomed, splits: state.splits },
});
function applySettings(patch, { fromCloud = false } = {}) {
  if (!isObj(patch)) return settingsPayload();
  if (typeof patch.autostart === 'boolean') setAutostart(patch.autostart);
  const prev = state.settings;
  const next = cleanSettings({ ...prev, ...patch });
  state.settings = next;
  rebuildServices(next);
  // apps that were hidden or removed leave the layout and free their memory
  Object.assign(state, cleanLayout(state));
  for (const id of [...panes.keys()]) if (!valid(id)) closePane(id);
  // an edited custom app (new address or sign-in) reloads with it
  for (const c of next.customApps) {
    const old = prev.customApps.find((x) => x.id === c.id); const p = panes.get(c.id);
    if (!old || !p || (old.url === c.url && old.own === c.own)) continue;
    p.url = null; destroyView(p); setStatus(c.id, 'sleeping');
    if (p.popWin) { const v = wake(c.id); v.setBorderRadius?.(0); p.popWin.contentView.addChildView(v); fitPop(c.id); } else applyBounds();
  }
  if (next.theme !== prev.theme) nativeTheme.themeSource = next.theme;
  if (next.zoom !== prev.zoom) for (const p of panes.values()) if (p.view && !p.view.webContents.isDestroyed()) p.view.webContents.setZoomFactor(next.zoom / 100);
  writeDesktopEntry();
  buildTray(); updateBadge(); saveState(); scheduleReminder();
  if (!fromCloud) sync?.settingsChanged(prev, next);
  if (next.autoUpdate !== prev.autoUpdate) updater?.schedule();
  return sendSettings();
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
  win.loadFile(UI('index.html'));
  const hidden = process.argv.includes('--hidden') || (state.settings.startHidden && !openArg);
  win.once('ready-to-show', () => {
    if (!hidden) win.show();
    // Background apps you keep running (Mail, Teams) start after the window is up, so the first paint isn't waiting on them.
    setTimeout(() => {
      for (const id of state.alive) if (byId[id]?.keepAlive && !state.popped.includes(id) && !panes.get(id)?.view) wake(id);
    }, 3000);
  });
  win.webContents.on('before-input-event', (e, input) => { if (handleShortcut(input)) e.preventDefault(); });
  win.webContents.on('render-process-gone', (_e, d) => { log('shell UI gone', d.reason); if (!quitting) win.webContents.reload(); });

  const remember = () => {
    if (!win || win.isMinimized()) return;
    state.window = win.isMaximized() ? { ...state.window, maximized: true } : { ...win.getBounds(), maximized: false };
    saveState();
  };
  win.on('resize', remember); win.on('move', remember);
  win.on('hide', markHiddenWindow); win.on('minimize', markHiddenWindow);
  win.on('show', () => applyBounds()); win.on('restore', () => applyBounds());
  win.on('close', (e) => {
    if (quitting) return;
    const how = state.settings.onClose;
    if (how === 'quit') { quitting = true; app.quit(); return; }
    e.preventDefault();
    if (how === 'minimize' || !tray) { win.minimize(); return; }
    win.hide();
    if (!state.toldAboutTray && Notification.isSupported()) {
      new Notification({ title: `${APP} is still running`, body: 'Your sign-ins and notifications stay on. Quit from the tray icon, or change this in Settings.', icon: ICON }).show();
      state.toldAboutTray = true; saveState();
    }
  });
  win.on('closed', () => { win = null; });
}

// ---- IPC from the shell UI (and pop-out windows)
ipcMain.handle('init', () => ({
  ...settingsPayload(),
  status: Object.fromEntries([...panes].map(([id, p]) => [id, p.status])),
  unread: Object.fromEntries([...panes].map(([id, p]) => [id, p.unread])),
  downloads: downloads.map(publicDl),
  shots: state.shots,
  planner: state.planner,
  openSettings: openArg === 'settings',
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
  const file = FILES.find((f) => f.id === id);
  if (file && !isHttp(file.src)) { // a document on disk: open it with the system app, or show it in its folder
    if (action === 'external') openFile(file.src);
    if (action === 'folder') shell.showItemInFolder(file.src);
    if (action === 'reload') retryOrReload(id);
    return;
  }
  const wc = paneWc(id); if (!wc) return;
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  if (action === 'reload') retryOrReload(id);
  if (action === 'external') openOut(wc.getURL());
});
ipcMain.on('find', (_e, { id, text: q, forward, start } = {}) => {
  const wc = paneWc(id); if (!wc || typeof q !== 'string') return;
  if (!q) { wc.stopFindInPage('clearSelection'); return; }
  wc.findInPage(q.slice(0, 300), { forward: forward !== false, findNext: !!start });
});
ipcMain.on('find-bar', (_e, { id, open } = {}) => {
  const p = panes.get(id); if (!p) return;
  const wc = paneWc(id);
  if (!open && wc) { wc.stopFindInPage('clearSelection'); wc.focus(); }
  if (p.popWin) { p.findOpen = !!open; fitPop(id); }
});
ipcMain.handle('settings-set', (_e, patch) => applySettings(patch));
// the bar on top of a link window
ipcMain.handle('link-init', (e) => { const [token] = linkOf(e.sender); return token ? linkInfo(token) : null; });
ipcMain.on('link-action', (e, action) => {
  const [token, l] = linkOf(e.sender); if (!l) return;
  const wc = l.view.webContents; if (wc.isDestroyed()) return;
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  if (action === 'reload') wc.reload();
  if (action === 'external') openOut(wc.getURL());
  if (action === 'dock') dockLink(token);
});
// dragging a link window's grip: the main window hides its web views so the drop reaches its layout
ipcMain.on('link-drag', (e, on) => {
  const [token, l] = linkOf(e.sender); if (!l || !win || win.isDestroyed()) return;
  win.webContents.send('cmd', { name: 'link-drag', arg: on ? { token, name: linkInfo(token)?.title || l.svc.name, app: l.svc.name, color: l.svc.color } : null });
});
// the main window got the drop: dock it and let the shell place it
ipcMain.handle('dock-link', (e, token) => (win && e.sender === win.webContents && typeof token === 'string' ? dockLink(token, 'none') : null));
ipcMain.handle('pick-folder', async (_e, what) => {
  const shots = what === 'screenshots';
  const r = await dialog.showOpenDialog(win, { title: shots ? 'Save screenshots to' : 'Save downloads to', defaultPath: shots ? shotDir() : downloadDir(), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0] || null;
});
ipcMain.on('clear-app-data', (_e, id) => { // after removing a custom app that had its own sign-in
  if (typeof id !== 'string' || !/^c-[a-z0-9-]{1,40}$/.test(id) || byId[id]) return;
  const ses = session.fromPartition(`persist:${id}`);
  Promise.all([ses.clearStorageData(), ses.clearCache()]).catch((e) => log('clearing app data failed', e));
});
ipcMain.on('download', (_e, { id, action } = {}) => { if (typeof id === 'string') downloadAction(id, action); });
ipcMain.on('app', (_e, action) => {
  if (action === 'logs') { fs.mkdirSync(LOG_DIR, { recursive: true }); shell.openPath(LOG_DIR); }
  if (action === 'downloads-folder') shell.openPath(downloadDir());
  if (action === 'shots-folder') { try { fs.mkdirSync(shotDir(), { recursive: true }); } catch { /* opened below anyway */ } shell.openPath(shotDir()); }
});

// ---- timetable + tasks
const shellWindows = () => [win, ...[...panes.values()].map((p) => p.popWin)].filter((w) => w && !w.isDestroyed() && w.webContents.getURL().startsWith('file:'));
function setPlanner(patch, { fromCloud = false } = {}) {
  const pick = Object.fromEntries(['semester', 'classes', 'changes', 'tasks'].filter((k) => isObj(patch) && k in patch).map((k) => [k, patch[k]]));
  const prev = state.planner;
  state.planner = cleanPlanner({ ...state.planner, ...pick });
  if (!fromCloud) sync?.plannerChanged(prev, state.planner);
  saveState(); scheduleReminder();
  for (const w of shellWindows()) w.webContents.send('planner', state.planner);
  return state.planner;
}
ipcMain.handle('planner-set', (_e, patch) => setPlanner(patch));

// ---- cloud sync (Settings → General → Sync): Google sign-in, then timetable, tasks and settings on every device
const sendSync = (st) => { for (const w of shellWindows()) w.webContents.send('sync', st); };
function startSync() {
  sync = createSync({
    app, shell, safeStorage, net, powerMonitor, state, saveState, log, cleanPlanner,
    setPlanner: (planner) => setPlanner(planner, { fromCloud: true }),
    applySettings: (patch) => applySettings(patch, { fromCloud: true }),
    isVisible: () => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized(),
    confirmSwitch: async ({ email }) => {
      const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: 'question', title: 'Another account', buttons: ['Start fresh', 'Keep and merge'], defaultId: 0, cancelId: 0,
        message: `This computer has a timetable from another account.`,
        detail: `Start fresh to see only ${email}'s timetable and tasks (this computer's copy is removed; the other account keeps its own in the cloud). Keep and merge copies this computer's classes and tasks into ${email}.`,
      });
      return r.response === 1 ? 'merge' : 'fresh';
    },
    onStatus: sendSync,
  });
  sync.start().catch((e) => log('sync start failed', e.message));
  // coming back to the window: catch up on anything that changed elsewhere (no polling while it's hidden)
  if (win && !win.isDestroyed()) for (const ev of ['show', 'restore']) win.on(ev, () => sync?.onShow());
}
ipcMain.handle('update', async (_e, action) => {
  if (!updater) return null;
  if (action === 'check') return updater.check();
  if (action === 'install') { updater.install(); return updater.state(); }
  if (action === 'cancel') updater.cancel();
  if (action === 'restart') updater.restart();
  return updater.state();
});
ipcMain.handle('sync', async (_e, action) => {
  if (!sync) return null;
  if (action === 'sign-in') return sync.signIn();
  if (action === 'sign-out') return sync.signOut();
  if (action === 'cancel') return sync.cancelSignIn();
  if (action === 'now') { await sync.syncNow(); return sync.status(); }
  return sync.status();
});
ipcMain.handle('planner-export', async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender) || win;
  const r = await dialog.showSaveDialog(w, { title: 'Export timetable and tasks', defaultPath: path.join(app.getPath('documents'), 'WakeUp timetable.json'), filters: [{ name: 'WakeUp timetable', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return false;
  try { fs.writeFileSync(r.filePath, JSON.stringify({ app: APP, kind: 'planner', v: 1, planner: state.planner }, null, 2)); return true; } catch (err) { log('export failed', err); return false; }
});
ipcMain.handle('planner-import', async (e) => { // replaces the timetable; tasks from the file are added to yours
  const w = BrowserWindow.fromWebContents(e.sender) || win;
  const r = await dialog.showOpenDialog(w, { title: 'Import a timetable', defaultPath: app.getPath('documents'), filters: [{ name: 'WakeUp timetable', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    if (fs.statSync(r.filePaths[0]).size > 5e6) return { error: 'That file is too big to be a timetable.' };
    const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    const p = cleanPlanner(isObj(raw?.planner) ? raw.planner : raw);
    if (!p.classes.length && !p.semester.start) return { error: 'No classes found in that file.' };
    const have = new Set(state.planner.tasks.map((t) => t.id));
    return { planner: setPlanner({ semester: p.semester, classes: p.classes, changes: p.changes, tasks: [...state.planner.tasks, ...p.tasks.filter((t) => !have.has(t.id))] }) };
  } catch (err) { log('import failed', err); return { error: 'That file isn’t a WakeUp timetable.' }; }
});
// meeting links from the timetable: Teams links open in the Teams pane, others in the browser
function openMeeting(url) { if (!isHttp(url)) return; if (isTeamsLink(url) && openInPane('teams', url)) return; openOut(url); }
ipcMain.on('open-link', (_e, url) => { if (typeof url === 'string') openMeeting(url); });

// ---- class reminders: one timer, re-armed for the next class (and at least every 30 min, so sleep/suspend can't skew it)
let reminderTimer = null; const reminded = new Set(); let remindedDay = '';
function scheduleReminder() {
  clearTimeout(reminderTimer);
  const day = Planner.today(); if (day !== remindedDay) { remindedDay = day; reminded.clear(); } // only today's matter
  const lead = state.settings.reminders * 60e3;
  if (!lead || state.settings.notify.timetable === false) return;
  const now = Date.now();
  const next = Planner.upcoming(state.planner, new Date(now), 8).find((o) => o.startsAt - lead > now - 60e3 && !reminded.has(o.key));
  const wait = next ? Math.max(0, next.startsAt - lead - now) : Infinity;
  reminderTimer = setTimeout(() => {
    if (next && wait <= 30 * 60e3 && Date.now() < next.startsAt) remind(next);
    scheduleReminder();
  }, Math.min(wait, 30 * 60e3));
}
// the class name as the user chose to see it (Settings → Timetable → Show classes as)
function labelFor(c) {
  const m = state.settings.classLabel;
  if (m === 'name') return c.name || c.code;
  if (m === 'both' && c.code && c.name && c.name !== c.code) return `${c.code} · ${c.name}`;
  return c.code || c.name;
}
function remind(o) {
  reminded.add(o.key);
  if (!Notification.isSupported()) return;
  const mins = Math.max(1, Math.round((o.startsAt - Date.now()) / 60e3));
  const who = state.settings.nickname ? `${state.settings.nickname}, ` : '';
  const kind = { lecture: 'Lecture', tutorial: 'Tutorial', lab: 'Lab' }[o.kind];
  const n = new Notification({
    title: `${labelFor(o.cls)} ${kind} in ${mins} min`,
    body: `${who}${o.mode === 'online' ? 'it’s online' : `it’s at ${o.venue || 'the usual place'}`}${o.status === 'replacement' ? ' (replacement class)' : o.status === 'moved-in' ? ' (moved here)' : ''}.${o.mode === 'online' && o.link ? ' Click to join.' : ''}`,
    icon: ICON,
  });
  n.on('click', () => { if (o.mode === 'online' && o.link) openMeeting(o.link); else { showWindow(); send('cmd', { name: 'open', arg: 'timetable' }); } });
  n.show();
}

// ---- screenshots: saved as PNG, copied to the clipboard, and viewable in a pane
const shotDir = () => state.settings.screenshotDir || (process.env.WAKEUP_PROFILE ? path.join(app.getPath('userData'), 'Screenshots') : path.join(app.getPath('pictures'), 'Screenshots'));
const pad2 = (n) => String(n).padStart(2, '0');
// Copy a PNG to the system clipboard. GNOME on Wayland ignores clipboard writes from a window without fresh input
// (Electron reports success but nothing lands), so on Wayland hand it to wl-copy when it's installed.
function copyPng(png) {
  const viaElectron = () => clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
    .then(() => true, (e) => { log('copying screenshot failed', e); return false; });
  if (process.platform !== 'linux' || !process.env.WAYLAND_DISPLAY) return viaElectron();
  // wl-copy stays running to serve the clipboard, so it must not keep any of WakeUp's open files or sockets:
  // a tiny bash step closes every inherited descriptor except stdin/out/err before starting it.
  const CLOSE_AND_COPY = 'for p in /proc/$$/fd/*; do n=${p##*/}; [ "$n" -gt 2 ] 2>/dev/null && eval "exec $n>&-" 2>/dev/null; done; exec wl-copy --type image/png';
  return new Promise((resolve) => {
    let done = false; const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    const p = require('node:child_process').spawn('/bin/bash', ['-c', CLOSE_AND_COPY], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    p.on('error', () => finish(null)); // no bash
    p.on('exit', (code) => finish(code === 0 ? true : null)); // wl-copy forks and exits 0 once it has the image; 127 = not installed
    p.stdin.on('error', () => {}); p.stdin.end(png); p.unref();
    setTimeout(() => finish(true), 5000); // still reading a large image: it's working
  }).then((ok) => (ok === null ? viaElectron() : ok));
}
async function saveShot(img) {
  if (img.isEmpty()) throw new Error('empty capture');
  const dir = shotDir(); fs.mkdirSync(dir, { recursive: true });
  const t = new Date();
  const file = uniquePath(dir, `WakeUp ${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${pad2(t.getHours())}.${pad2(t.getMinutes())}.${pad2(t.getSeconds())}.png`);
  const png = img.toPNG();
  fs.writeFileSync(file, png);
  const copied = state.settings.screenshotCopy ? await copyPng(png) : false;
  const shot = { id: `s${Date.now().toString(36)}`, path: file, name: path.basename(file), ts: Date.now() };
  state.shots = [shot, ...state.shots].slice(0, 10); saveState();
  return { ...shot, copied, thumb: img.resize({ width: Math.min(560, img.getSize().width) }).toDataURL() };
}
const rectOk = (r) => isObj(r) && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k])) && r.width >= 1 && r.height >= 1;
ipcMain.handle('capture', async (_e, { kind, id, rect } = {}) => {
  try {
    if (kind === 'app') {
      const wc = paneWc(id);
      if (wc) return { shot: await saveShot(await wc.capturePage()) };
      if (isLocal(id) && rectOk(rect)) return { shot: await saveShot(await win.webContents.capturePage(Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, Math.round(v)])))) };
      return { error: 'Open an app first.' };
    }
    // everything: the shell plus each visible web view; the shell puts them together on a canvas
    const shell = await win.webContents.capturePage();
    const views = [];
    if (!covered) {
      for (const vid of lastBounds.order) {
        const p = panes.get(vid); const r = lastBounds.rects[vid];
        if (!p?.view || p.popWin || !r || !state.alive.includes(vid)) continue;
        views.push({ url: (await p.view.webContents.capturePage()).toDataURL(), x: r.x, y: r.y, width: r.width, height: r.height });
      }
    }
    return { compose: { shell: shell.toDataURL(), views } };
  } catch (e) { log('screenshot failed', e); return { error: 'The screenshot didn’t work. Try again.' }; }
});
ipcMain.handle('save-shot', async (_e, dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 80e6) return { error: 'bad image' };
  try { return { shot: await saveShot(nativeImage.createFromDataURL(dataUrl)) }; } catch (e) { log('saving screenshot failed', e); return { error: 'The screenshot couldn’t be saved.' }; }
});
ipcMain.on('shot-action', (_e, { id, action, how } = {}) => {
  const sh = state.shots.find((x) => x.id === id); if (!sh) return;
  if (!fs.existsSync(sh.path)) { state.shots = state.shots.filter((x) => x !== sh); saveState(); return; }
  if (action === 'view') viewPath(sh.path, how);
  else if (action === 'show') shell.showItemInFolder(sh.path);
});
ipcMain.on('view-download', (_e, { id, how } = {}) => {
  const d = downloads.find((x) => x.id === id);
  if (d?.state === 'completed' && fs.existsSync(d.path)) viewPath(d.path, how);
});

app.on('second-instance', (_e, argv) => {
  if (argv.includes('--quit')) { quitting = true; app.quit(); return; }
  showWindow();
  const id = argOpen(argv);
  if (id === 'settings') send('cmd', { name: 'settings' });
  else if (valid(id)) send('cmd', { name: 'open', arg: id });
});
app.on('before-quit', () => { quitting = true; writeState(); });
// Sign-ins live in cookies, which Chromium writes to disk lazily. Save them soon after they change, so a crash,
// a logout or a system shutdown doesn't sign you out of Ebwise or Microsoft 365.
app.on('session-created', (ses) => {
  let t = null;
  ses.cookies.on('changed', () => { clearTimeout(t); t = setTimeout(() => ses.cookies.flushStore().catch(() => {}), 2000); });
});
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => app.quit()); // shutdown or logout: quit cleanly (layout and cookies saved)
app.whenReady().then(() => {
  downloads.push(...state.downloads.map((d) => ({ ...d })));
  createWindow();
  setImmediate(() => {
    if (fs.existsSync(LEGACY_AUTOSTART)) { fs.rmSync(LEGACY_AUTOSTART, { force: true }); setAutostart(true); } // carry "start at login" over the rename
    else if (autostartOn() && fs.readFileSync(AUTOSTART, 'utf8') !== autostartBody()) setAutostart(true); // app moved: fix the path
    buildTray();
    writeDesktopEntry();
    scheduleReminder();
    startSync();
    updater = createUpdater({ app, net, log, getSettings: () => state.settings, onState: (st) => send('update', st) });
    updater.start();
  });
  nativeTheme.on('updated', () => {
    win?.setBackgroundColor(BG());
    for (const p of panes.values()) p.view?.setBackgroundColor(BG());
  });
}).catch((e) => log('startup failed', e));
app.on('window-all-closed', () => { if (quitting || !tray) app.quit(); });
