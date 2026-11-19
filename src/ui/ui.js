'use strict';
/* global hub, Planner, PL:writable, WEEK_START:writable, LABEL_MODE:writable, plannerListeners, plannerUpdated, taskBadge, ICONS, BTN, S16, MARK, MARK_VB, svg, btnSvg, esc, glyph, $, $$, h, clamp, uniq, sum, store, paint,
   FindBar, TasksView, TimetableView, renderToday, openSwitcher, openHelp, splitTitle,
   toggleSettings, renderSettings, toggleDownloads, renderDownloads, renderDlButton, onDownload, onDownloadsClick */
// WakeUp shell UI. The layout lives here; main validates/persists it and places the native web views
// where this file says the pane bodies are (web views always paint above this HTML).
//
// Navigation: clicking an app shows it on its own. Apps you arranged side by side are remembered as a
// "split": clicking any app in a remembered split brings the whole split back.

const GAP = 6; const MIN_TILE = 200; const MIN_FREE_W = 280; const MIN_FREE_H = 180; const SNAP = 10;
let HEADER = 40; // pane header height in px; follows the UI scale (set in render)
let TABH = 34; // the tab strip under it, when an app has more than one tab
const topOf = (id) => HEADER + (hasTabs(id) ? TABH : 0);

const KEYS_HTML = `<dl class="keys">
  <div><dt><kbd>Ctrl</kbd><kbd>K</kbd></dt><dd>Jump to an app, file or action</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>1</kbd>–<kbd>9</kbd></dt><dd>Open an app</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>H</kbd></dt><dd>Today</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>W</kbd></dt><dd>Close app</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>F</kbd></dt><dd>Find in page</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>R</kbd></dt><dd>Reload</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>S</kbd></dt><dd>Screenshot</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>J</kbd></dt><dd>Downloads</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>M</kbd></dt><dd>Full screen in the window</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>Tab</kbd></dt><dd>Next app in a split</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>O</kbd></dt><dd>Pop out / dock back</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>,</kbd></dt><dd>Settings</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>L</kbd></dt><dd>Next layout</dd></div>
  <div><dt><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>F</kbd></dt><dd>Tiled ↔ free-floating</dd></div>
  <div><dt>Drag an app onto the screen</dt><dd>Edge to split, centre to swap</dd></div>
  <div><dt>Right-click a link</dt><dd>Open in browser, copy, save</dd></div>
</dl>`;

// ---------- split tree ----------
const leaf = (pane) => ({ pane });
const H = (children, sizes) => ({ dir: 'h', sizes: sizes || children.map(() => 1 / children.length), children });
const V = (children, sizes) => ({ dir: 'v', sizes: sizes || children.map(() => 1 / children.length), children });
const leaves = (n) => (!n ? [] : n.pane ? [n.pane] : n.children.flatMap(leaves));
function normalize(n) {
  if (!n || n.pane) return n || null;
  const children = []; const sizes = [];
  n.children.forEach((c, i) => {
    const k = normalize(c); if (!k) return;
    if (k.dir === n.dir) k.children.forEach((cc, j) => { children.push(cc); sizes.push(n.sizes[i] * k.sizes[j]); });
    else { children.push(k); sizes.push(n.sizes[i]); }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  const t = sum(sizes);
  return { dir: n.dir, sizes: sizes.map((s) => s / t), children };
}
function removeLeaf(n, id) {
  if (!n) return null;
  if (n.pane) return n.pane === id ? null : n;
  const children = []; const sizes = [];
  n.children.forEach((c, i) => { const k = removeLeaf(c, id); if (k) { children.push(k); sizes.push(n.sizes[i]); } });
  return normalize({ dir: n.dir, sizes, children });
}
const removeMany = (n, ids) => ids.reduce((t, id) => removeLeaf(t, id), n);
const mapLeaf = (n, f) => (!n ? n : n.pane ? leaf(f(n.pane)) : { ...n, children: n.children.map((c) => mapLeaf(c, f)) });
const swapLeaves = (n, a, b) => mapLeaf(n, (p) => (p === a ? b : p === b ? a : p));
function insertAt(n, target, id, side) {
  const dir = side === 'left' || side === 'right' ? 'h' : 'v';
  const before = side === 'left' || side === 'top';
  if (!n) return leaf(id);
  if (n.pane) return n.pane === target ? { dir, sizes: [0.5, 0.5], children: before ? [leaf(id), n] : [n, leaf(id)] } : n;
  const idx = n.children.findIndex((c) => c.pane === target);
  if (idx >= 0 && n.dir === dir) { // become a sibling; split the target's share
    const children = [...n.children]; const sizes = [...n.sizes]; const half = sizes[idx] / 2;
    sizes[idx] = half;
    children.splice(before ? idx : idx + 1, 0, leaf(id)); sizes.splice(before ? idx : idx + 1, 0, half);
    return { dir, sizes, children };
  }
  return { ...n, children: n.children.map((c) => insertAt(c, target, id, side)) };
}
function insertRoot(n, id, side) {
  if (!n) return leaf(id);
  const dir = side === 'left' || side === 'right' ? 'h' : 'v';
  const before = side === 'left' || side === 'top';
  return normalize({ dir, sizes: before ? [0.34, 0.66] : [0.66, 0.34], children: before ? [leaf(id), n] : [n, leaf(id)] });
}

// ---------- layout presets (Layouts menu) ----------
const PRESETS = [
  { id: 'single', name: 'Single', n: 1, build: ([a]) => leaf(a) },
  { id: 'cols2', name: 'Side by side', n: 2, build: ([a, b]) => H([leaf(a), leaf(b)]) },
  { id: 'rows2', name: 'Stacked', n: 2, build: ([a, b]) => V([leaf(a), leaf(b)]) },
  { id: 'main2', name: 'Main + 2', n: 3, build: ([a, b, c]) => H([leaf(a), V([leaf(b), leaf(c)])], [0.6, 0.4]) },
  { id: 'cols3', name: 'Three columns', n: 3, build: (x) => H(x.map(leaf)) },
  { id: 'grid', name: 'Grid', n: 4, build: ([a, b, c, d]) => V([H([leaf(a), leaf(b)]), H([leaf(c), leaf(d)])]) },
  { id: 'main3', name: 'Main + 3', n: 4, build: ([a, ...r]) => H([leaf(a), V(r.map(leaf))], [0.6, 0.4]) },
  { id: 'five', name: 'Five', n: 5, build: (x) => V([H(x.slice(0, 3).map(leaf)), H(x.slice(3).map(leaf))]) },
];
function presetThumb(p) {
  const cells = {}; tileCells(p.build(['a', 'b', 'c', 'd', 'e'].slice(0, p.n)), 1, 1, 26, 18, cells, []);
  return svg(Object.values(cells).map((r) => `<rect x="${r.x + 0.9}" y="${r.y + 0.9}" width="${r.w - 1.8}" height="${r.h - 1.8}" rx="1.6"/>`).join(''), '0 0 28 20', 'currentColor');
}

// ---------- state ----------
let SV = []; let BY = {}; let ALL = []; let APPS = []; let FILES = []; // shown apps, everything by id, every service, apps (no files), open files
let SET = {}; let META = {};
const DL = new Map(); // downloads by id
let SHOTS = [];
let settingsOpen = false; let dlOpen = false;
let L = { mode: 'tile', tile: null, free: [], alive: [], popped: [], focused: null, zoomed: null, splits: [] };
const status = {}; const unread = {}; const statusInfo = {};
let homeOpen = false; let menuOpen = false; let dragging = false; let popoverOpen = false; let overlayOpen = false;
let tipPane = null; // pane showing the one-time "drag to split" tip
const stage = $('#stage');

const visible = () => (L.mode === 'tile' ? leaves(L.tile) : L.free.map((p) => p.id));
const shown = () => (L.zoomed && visible().includes(L.zoomed) ? [L.zoomed] : visible());
const showHome = () => homeOpen || visible().length === 0;
const isLocal = (id) => BY[id]?.kind === 'local';
// Keep remembered splits honest: an app lives in at most one split, and never in one while it's popped out,
// closed, hidden, or part of the split on screen right now.
function cleanSplits() {
  const onScreen = L.mode === 'tile' && visible().length > 1 ? visible() : [];
  const drop = new Set([...onScreen, ...L.popped]);
  const seen = new Set();
  L.splits = L.splits.map((s) => {
    const t = removeMany(s.tile, leaves(s.tile).filter((id) => drop.has(id) || seen.has(id) || !L.alive.includes(id) || !BY[id] || BY[id].hidden));
    leaves(t).forEach((id) => seen.add(id));
    return { tile: t, focused: leaves(t).includes(s.focused) ? s.focused : leaves(t)[0] };
  }).filter((s) => s.tile && !s.tile.pane).slice(0, 6);
}
function commit() {
  L.alive = uniq([...L.alive, ...visible(), ...L.popped]);
  if (L.focused && !L.alive.includes(L.focused)) L.focused = null;
  if (!L.focused || !visible().includes(L.focused)) L.focused = visible()[0] ?? null;
  if (L.zoomed && !visible().includes(L.zoomed)) L.zoomed = null;
  cleanSplits();
  hub.commit(L);
  render();
}

// ---------- geometry ----------
// Splits adapt to the room they have: each pane keeps a usable minimum (scaled with the UI), and panes with room to
// spare give it up first. Your saved proportions are kept, so the layout springs back when the window grows again.
const minOf = (n, dir) => { // smallest width ('h') or height ('v') a subtree can take
  if (n.pane) return dir === 'h' ? scaled(isLocal(n.pane) ? 300 : 340) : scaled(200);
  const m = n.children.map((c) => minOf(c, dir));
  return n.dir === dir ? sum(m) : Math.max(...m);
};
function fitSizes(total, fr, mins) {
  if (sum(mins) >= total) return mins.map((m) => (total * m) / sum(mins)); // not enough room for everyone: share by need
  const size = fr.map((f) => total * f);
  for (let k = 0; k < fr.length; k++) { // a few passes settle it (n is tiny)
    const short = size.reduce((a, s, i) => a + Math.max(0, mins[i] - s), 0); if (short < 0.5) break;
    const spare = size.map((s, i) => Math.max(0, s - mins[i])); const pool = sum(spare);
    size.forEach((s, i) => { size[i] = s < mins[i] ? mins[i] : s - (short * spare[i]) / pool; });
  }
  return size;
}
function tileCells(n, x, y, w, hgt, out, divs, path = []) {
  if (!n) return;
  if (n.pane) { out[n.pane] = { x, y, w, h: hgt }; return; }
  let off = 0; const total = n.dir === 'h' ? w : hgt;
  const sizes = fitSizes(total, n.sizes, n.children.map((c) => minOf(c, n.dir)));
  n.children.forEach((c, i) => {
    const size = sizes[i];
    if (i > 0) divs.push({ node: n, i, dir: n.dir, at: (n.dir === 'h' ? x : y) + off, x, y, w, h: hgt, key: `${path.join('.')}:${i}` });
    if (n.dir === 'h') tileCells(c, x + off, y, size, hgt, out, divs, [...path, i]);
    else tileCells(c, x, y + off, w, size, out, divs, [...path, i]);
    off += size;
  });
}
let R = {}; let DIVS = []; let box = { left: 0, top: 0, width: 0, height: 0 };
function geometry() {
  const W = stage.clientWidth; const Hh = stage.clientHeight;
  R = {}; DIVS = [];
  if (showHome()) return;
  const full = { x: GAP, y: GAP, w: W - 2 * GAP, h: Hh - 2 * GAP };
  if (L.zoomed && visible().includes(L.zoomed)) { R[L.zoomed] = full; return; }
  if (L.mode === 'tile') {
    const cells = {};
    tileCells(L.tile, GAP / 2, GAP / 2, W - GAP, Hh - GAP, cells, DIVS);
    for (const [id, c] of Object.entries(cells)) R[id] = { x: c.x + GAP / 2, y: c.y + GAP / 2, w: c.w - GAP, h: c.h - GAP };
  } else {
    for (const p of L.free) R[p.id] = { x: (p.x * W) / 100, y: (p.y * Hh) / 100, w: (p.w * W) / 100, h: (p.h * Hh) / 100 };
  }
}

// ---------- rendering ----------
const paneEls = new Map(); const divEls = new Map();
const blocked = (id) => ['error', 'crashed', 'hung'].includes(status[id]);

function render(dragFrame = false) {
  if (!SV.length) return; // not initialised yet
  HEADER = scaled(40); document.documentElement.style.setProperty('--hdr', `${HEADER}px`);
  TABH = scaled(34); document.documentElement.style.setProperty('--tabh', `${TABH}px`);
  box = stage.getBoundingClientRect();
  geometry();
  document.body.classList.toggle('mode-free', L.mode === 'free');
  document.body.classList.toggle('zoomed', !!L.zoomed);
  const rail = !!SET.compact || (innerWidth < 860 && !sideOpen); // small windows fold the sidebar to icons by themselves
  if (!document.body.classList.contains('side-drag')) { // while dragging its edge, the drag sets these
    document.body.classList.toggle('compact', rail);
    document.body.classList.toggle('no-labels', !SET.labels || rail);
    if (SET.sideWidth && !rail) document.body.style.setProperty('--side-w', `${SET.sideWidth}px`); else document.body.style.removeProperty('--side-w');
  }
  const tg = $('#sideToggle'); if (tg) { const t = rail ? 'Expand the sidebar' : 'Collapse the sidebar'; tg.title = t; tg.setAttribute('aria-label', t); tg.setAttribute('aria-expanded', String(!rail)); }
  const home = showHome();
  $('#home').hidden = !home;
  if (home && !dragFrame) renderToday();
  const order = L.mode === 'free' ? L.free.map((p) => p.id) : Object.keys(R);
  for (const [id, el] of paneEls) if (!R[id]) el.hidden = true;
  const many = shown().length > 1;
  order.forEach((id, z) => {
    const r = R[id]; if (!r) return;
    const el = paneEl(id);
    el.hidden = false;
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, zIndex: String(z + 1) });
    el.classList.toggle('focused', id === L.focused && many);
    el.classList.toggle('blocked', blocked(id));
    el.classList.toggle('narrow', r.w < scaled(520));
    el.classList.toggle('tiny', r.w < scaled(340));
    const zb = el.querySelector('[data-a="zoom"]');
    const isZ = L.zoomed === id;
    if (zb.dataset.z !== String(isZ)) { zb.dataset.z = String(isZ); zb.innerHTML = btnSvg(isZ ? 'unzoom' : 'zoom'); zb.title = isZ ? 'Back to the split (Ctrl+M)' : 'Fill the window (Ctrl+M)'; zb.setAttribute('aria-label', isZ ? 'Restore' : 'Fill the window'); }
    zb.hidden = !isZ && visible().length < 2;
    $('.tip', el).hidden = tipPane !== id;
  });
  // dividers (keyed, so one being dragged keeps its pointer capture)
  const keep = new Set();
  for (const d of DIVS) {
    keep.add(d.key);
    let el = divEls.get(d.key);
    if (!el) { el = h('div', { class: 'divider', role: 'separator' }); el.addEventListener('pointerdown', (e) => startDivider(e, el)); el.addEventListener('dblclick', () => { const n = el._d.node; n.sizes = n.sizes.map(() => 1 / n.sizes.length); commit(); }); stage.append(el); divEls.set(d.key, el); }
    el._d = d;
    el.className = `divider ${d.dir}${el.classList.contains('active') ? ' active' : ''}`;
    el.setAttribute('aria-orientation', d.dir === 'h' ? 'vertical' : 'horizontal');
    el.title = 'Drag to resize · double-click to even out';
    el.style.cssText = d.dir === 'h' ? `left:${d.at - GAP / 2}px;top:${d.y}px;height:${d.h}px` : `top:${d.at - GAP / 2}px;left:${d.x}px;width:${d.w}px`;
  }
  for (const [k, el] of divEls) if (!keep.has(k) && !el.classList.contains('active')) { el.remove(); divEls.delete(k); }
  if (!dragFrame) updateSidebar();
  setCover(home || menuOpen || dragging || settingsOpen || dlOpen || popoverOpen || overlayOpen);
  queueBounds();
}

let boundsQueued = false;
function queueBounds() {
  if (boundsQueued) return; boundsQueued = true;
  requestAnimationFrame(() => {
    boundsQueued = false;
    const rects = {}; const order = [];
    const ids = L.mode === 'free' ? L.free.map((p) => p.id).filter((id) => R[id]) : Object.keys(R);
    for (const id of ids) {
      if (blocked(id) || isLocal(id)) continue;
      const r = R[id];
      rects[id] = { x: box.left + r.x, y: box.top + r.y + topOf(id), width: r.w, height: r.h - topOf(id) };
      order.push(id);
    }
    hub.bounds({ rects, order });
  });
}
let covered = null;
// ---------- sidebar: collapse, and drag its edge to resize ----------
let sideOpen = false; // expanded by hand while the window is too small for it
function toggleSidebar() {
  const rail = document.body.classList.contains('compact');
  if (rail && SET.compact) hub.setSettings({ compact: false }).then(applyPayload);
  else if (rail) { sideOpen = true; render(); }
  else { sideOpen = false; if (innerWidth >= 860) hub.setSettings({ compact: true }).then(applyPayload); else render(); }
}
function startSideResize(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  const sb = $('#sidebar'); const start = sb.getBoundingClientRect().width; const x0 = e.clientX;
  let w = start;
  document.body.classList.add('resizing', 'col', 'side-drag'); setCover(true);
  track(e, (ev) => {
    w = start + ev.clientX - x0;
    const fold = w < 140; // dragged nearly shut: fold to icons
    document.body.classList.toggle('compact', fold); document.body.classList.toggle('no-labels', fold || !SET.labels);
    if (!fold) document.body.style.setProperty('--side-w', `${clamp(Math.round(w), 180, 480)}px`);
    render(true);
  }, (_ev, ok) => {
    document.body.classList.remove('resizing', 'col', 'side-drag'); setCover(false);
    if (!ok) { render(); return; }
    sideOpen = innerWidth < 860 && w >= 140;
    hub.setSettings(w < 140 ? { compact: true } : { compact: false, sideWidth: clamp(Math.round(w), 180, 480) }).then(applyPayload);
  });
}
function setCover(on) { if (covered !== on) { covered = on; hub.cover(on); } }

const paneSig = (s) => `${s.kind}:${s.name}:${s.color}:${s.icon ? 1 : 0}:${s.local ? 1 : 0}`;
// ---------- attendance QR (v3, A6) ----------
// On a Teams or Google Meet pane, the QR button looks at the pane's screen every 3 seconds (a shared slide with an
// attendance QR) for up to 10 minutes, and offers to open the link it finds. The picture never leaves this computer.
const MEET_HOSTS = /(^|\.)(teams\.microsoft\.com|teams\.live\.com|teams\.cloud\.microsoft|meet\.google\.com)$/;
const isMeeting = (svc) => svc.kind === 'web' && (svc.id === 'teams' || (() => { try { return MEET_HOSTS.test(new URL(svc.url).hostname); } catch { return false; } })());
const QR_SCANS = new Map(); // pane id → {until, timer}
const qrBtn = (id, on) => paneEls.get(id)?.querySelector('[data-a="qr"]')?.classList.toggle('on', on);
function stopQrScan(id) {
  const st = QR_SCANS.get(id); if (!st) return;
  clearTimeout(st.timer); QR_SCANS.delete(id); dismissNotice(`qr:${id}`); qrBtn(id, false);
}
function toggleQrScan(id) {
  if (QR_SCANS.has(id)) { stopQrScan(id); return; }
  const name = BY[id]?.name || 'this app';
  QR_SCANS.set(id, { until: Date.now() + 10 * 60e3, timer: null }); qrBtn(id, true);
  showNotice({ id: `qr:${id}`, kind: 'busy', sticky: true, title: 'Looking for an attendance QR', detail: `On ${name}’s screen. Keep the shared slide in view.`, actions: [{ label: 'Stop', run: () => stopQrScan(id) }] });
  const step = async () => {
    const st = QR_SCANS.get(id); if (!st) return;
    if (Date.now() > st.until) { stopQrScan(id); showNotice({ kind: 'info', title: 'No attendance QR found', detail: 'Looked for 10 minutes. Press the QR button again when it’s on screen.' }); return; }
    let r = null; try { r = await hub.scanQr(id); } catch { /* the pane is busy: try again next time */ }
    if (!QR_SCANS.has(id)) return;
    if (r?.gone) { stopQrScan(id); return; }
    if (r?.text) { stopQrScan(id); qrFound(r.text); return; }
    st.timer = setTimeout(step, 3000);
  };
  step();
}
function qrFound(text) {
  let u = null; try { u = new URL(text); } catch { /* not a link */ }
  const link = u && (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
  const copy = (v) => navigator.clipboard.writeText(v).catch(() => {});
  showNotice(link
    ? { kind: 'success', sticky: true, title: 'Attendance QR found', detail: `${u.hostname}${u.pathname.length > 1 ? u.pathname.slice(0, 40) : ''}`, actions: [{ label: 'Open attendance link', run: () => hub.openLink(link) }, { label: 'Copy link', run: () => copy(link) }] }
    : { kind: 'info', sticky: true, title: 'QR code found', detail: text.slice(0, 160), actions: [{ label: 'Copy text', run: () => copy(text) }] });
}

function paneEl(id) {
  const svc = BY[id];
  const old = paneEls.get(id);
  if (old && old._sig === paneSig(svc)) return old;
  old?.remove();
  const el = h('section', { class: `pane kind-${svc.kind}`, 'aria-label': svc.name });
  el._sig = paneSig(svc);
  el.style.setProperty('--svc', svc.color);
  const b = (a, label, key, icon = a) => `<button class="hbtn" data-a="${a}" title="${label}${key ? ` (${key})` : ''}" aria-label="${label}">${btnSvg(icon)}</button>`;
  const nav = svc.kind === 'web' || (svc.kind === 'file' && !svc.local) ? `${b('back', 'Back')}${svc.kind === 'web' ? b('forward', 'Forward') : ''}${b('reload', 'Reload', 'Ctrl+R')}` : '';
  const ext = svc.kind === 'local' ? '' : svc.kind === 'file' && svc.local ? `${b('folder', 'Show in folder')}${b('external', 'Open with another app', '', 'openwith')}` : b('external', 'Open in your browser');
  el.innerHTML = `
    <header>
      <div class="nav">${nav}</div>
      <span class="glyph">${glyph(svc)}</span>
      <span class="name"></span>
      <span class="pstat" role="status" hidden></span>
      <span class="tip" hidden>Drag an app from the sidebar here to see two side by side <button class="tip-x" aria-label="Dismiss tip">${btnSvg('close')}</button></span>
      <span class="progress" aria-hidden="true"></span>
      <div class="acts">${isMeeting(svc) ? b('qr', 'Scan for an attendance QR on screen') : ''}${svc.kind === 'web' ? b('newtab', 'New tab', 'Ctrl+T', 'plus') : ''}${b('shot', 'Screenshot', '', 'camera')}${b('split', 'Split with another app')}${ext}${b('popout', 'Pop out into its own window', 'Ctrl+Shift+O')}${b('zoom', 'Fill the window', 'Ctrl+M')}${b('close', 'Close', 'Ctrl+W')}</div>
    </header>
    <div class="tabstrip" hidden></div>
    <div class="body">${svc.kind === 'local' ? '<div class="local-root"></div>' : `<span class="ghost-glyph">${glyph(svc)}</span><div class="state" role="status" aria-live="polite"></div>`}</div>
    ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((e) => `<div class="rh ${e}" data-e="${e}"></div>`).join('')}`;
  $('.name', el).textContent = svc.name;
  fillTabStrip($('.tabstrip', el), id, svc.name);
  el.querySelectorAll('.hbtn').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = btn.dataset.a;
      if (a === 'close') closePane(id);
      else if (a === 'zoom') toggleZoom(id);
      else if (a === 'popout') popOut(id);
      else if (a === 'split') openSplitMenu(id, btn);
      else if (a === 'shot') openShotMenu(btn, id);
      else if (a === 'newtab') hub.tab(id, 'new');
      else if (a === 'qr') toggleQrScan(id);
      else hub.nav(id, a);
    });
  });
  $('.tip-x', el).addEventListener('click', (e) => { e.stopPropagation(); dismissTip(); });
  const header = $('header', el);
  if (svc.kind !== 'local') { el._find = FindBar(id, header, (open) => el.classList.toggle('finding', open)); $('.name', el).after(el._find.node); }
  else el._view = id === 'tasks' ? TasksView($('.local-root', el)) : TimetableView($('.local-root', el));
  header.addEventListener('pointerdown', (e) => headerDown(e, id));
  header.addEventListener('dblclick', (e) => { if (!e.target.closest('.findbar, .tip')) toggleZoom(id); });
  el.addEventListener('pointerdown', () => focusPane(id));
  el.querySelectorAll('.rh').forEach((rh) => rh.addEventListener('pointerdown', (e) => startResize(e, id, rh.dataset.e)));
  stage.append(el);
  paneEls.set(id, el);
  renderStatus(id);
  return el;
}

// ---------- per-pane status ----------
function renderStatus(id) {
  const el = paneEls.get(id); if (!el || isLocal(id)) return;
  const st = status[id]; const info = statusInfo[id] || {}; const name = BY[id].name;
  el.classList.toggle('loading', st === 'loading');
  const box2 = $('.state', el);
  const panel = (icon, title, text, actions) => `<div class="msg"><span class="msg-icon">${btnSvg(icon)}</span><h3>${title}</h3><p>${text}</p><div class="actions">${actions}</div></div>`;
  if (st === 'error') {
    const off = !navigator.onLine || info.code === -106;
    const why = { '-105': 'Its address couldn’t be found.', '-118': 'The connection timed out.', '-102': 'The server refused the connection.', '-21': 'Your network changed.', '-100': 'The connection was closed.', '-101': 'The connection was reset.', '-109': 'The site is unreachable.', '-137': 'Its address couldn’t be looked up.' }[info.code] || 'The page didn’t load.';
    box2.innerHTML = panel(off ? 'offline' : 'warn', off ? 'You’re offline' : `Couldn’t load ${esc(name)}`,
      off ? `${esc(name)} will reload by itself when your connection is back.` : `${why} Retrying automatically.<span class="code"></span>`,
      '<button class="btn primary" data-r="retry">Try again</button>');
  } else if (st === 'crashed') {
    box2.innerHTML = panel('warn', `${esc(name)} stopped working`, 'The page crashed. Reloading usually fixes it; you stay signed in.', '<button class="btn primary" data-r="retry">Reload</button>');
  } else if (st === 'hung') {
    box2.innerHTML = panel('pause', `${esc(name)} isn’t responding`, 'It may be busy. You can wait or reload it.', '<button class="btn" data-r="wait">Wait</button><button class="btn primary" data-r="retry">Reload</button>');
  } else box2.innerHTML = '';
  const codeEl = $('.code', box2); if (codeEl) codeEl.textContent = info.desc || '';
  box2.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.r === 'wait') { status[id] = 'ready'; renderStatus(id); render(); } else hub.retry(id);
  }));
  el.classList.toggle('blocked', blocked(id));
  drawPaneStatus(id);
}
// what a pane is doing, in its title bar: signing in, loading, asleep, offline, failed
function drawPaneStatus(id) {
  const el = paneEls.get(id); const chip = el && $('.pstat', el); if (!chip) return;
  const n = paneNotice(id); const st = status[id];
  const [text, tone] = n ? [n.kind === 'error' ? 'Sign-in needed' : 'Signing in…', n.kind === 'error' ? 'bad' : 'busy']
    : st === 'loading' ? ['Loading…', 'busy'] : st === 'sleeping' ? ['Asleep', ''] : st === 'hung' ? ['Not responding', 'warn']
      : st === 'crashed' ? ['Stopped', 'bad'] : st === 'error' ? [navigator.onLine ? 'Couldn’t load' : 'Offline', 'bad'] : ['', ''];
  chip.hidden = !text; chip.textContent = text; chip.className = `pstat ${tone}`;
}

// ---------- sidebar ----------
const sideBtns = new Map();
function sideItem(svc, cls = '') {
  const b = h('button', { class: `svc ${cls}`, 'aria-label': svc.name }, `<span class="tile">${glyph(svc)}</span><span class="lbl"></span><span class="badge" hidden></span>`);
  b.style.setProperty('--svc', svc.color);
  $('.lbl', b).textContent = svc.name;
  b.addEventListener('pointerdown', (e) => dragSource(e, svc.id));
  b.addEventListener('auxclick', (e) => { if (e.button === 1 && L.alive.includes(svc.id)) closePane(svc.id); });
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPane(svc.id); } });
  sideBtns.set(svc.id, b);
  return b;
}
function buildSidebar() {
  if (!$('#brand .home')) {
    const tool = (id, title, label, icon, onclick, extra = {}, key = '') => { const t = h('button', { class: 'tool', id, title, 'aria-label': label, ...extra }, `${btnSvg(icon)}<span class="lbl">${label}</span>${key ? `<kbd>${key}</kbd>` : ''}`); t.onclick = onclick; return t; };
    const home = h('button', { class: 'svc home', title: 'Today (Ctrl+Shift+H)', 'aria-label': 'Today' }, `<span class="tile">${btnSvg('home')}</span><span class="lbl">Today</span>`);
    home.onclick = () => showToday(!(showHome() && !settingsOpen) || !visible().length);
    const grip = h('div', { class: 'side-grip', title: 'Drag to resize the sidebar. Double-click to reset.', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the sidebar' });
    grip.addEventListener('pointerdown', startSideResize);
    grip.addEventListener('dblclick', () => { sideOpen = false; hub.setSettings({ sideWidth: 0, compact: false }).then(applyPayload); });
    $('#sidebar').append(grip);
    $('#brand').append(
      h('div', { class: 'brand-row' }, `<span class="mark">${svg(MARK, MARK_VB, 'none')}</span><b>WakeUp</b><button class="hbtn side-toggle" id="sideToggle" title="Collapse the sidebar" aria-label="Collapse the sidebar">${btnSvg('sidebar')}</button>`),
      tool('searchBtn', 'Jump to an app, file or action (Ctrl+K)', 'Search', 'search', () => openSwitcher(), {}, 'Ctrl K'),
      home,
    );
    $('#sideToggle').onclick = toggleSidebar;
    const dl = tool('dlBtn', 'Downloads (Ctrl+J)', 'Downloads', 'download', (e) => { e.stopPropagation(); toggleDownloads(); }, { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    dl.append(h('span', { class: 'badge', hidden: true }));
    $('#tools').append(
      tool('shotBtn', 'Screenshot (Ctrl+Shift+S)', 'Screenshot', 'camera', (e) => { e.stopPropagation(); openShotMenu(e.currentTarget); }, { 'aria-haspopup': 'menu' }),
      dl,
      tool('layoutsBtn', 'Layouts (Ctrl+Shift+L)', 'Layouts', 'layouts', (e) => { e.stopPropagation(); toggleMenu(undefined, e.detail === 0); }, { 'aria-haspopup': 'true', 'aria-expanded': 'false' }),
      tool('setBtn', 'Settings (Ctrl+,)', 'Settings', 'settings', () => toggleSettings()),
    );
    paintSideAvatar();
  }
  sideBtns.clear();
  $('#services').replaceChildren(...SV.map((svc) => sideItem(svc)));
  $('#files').replaceChildren(h('div', { class: 'nav-h' }, 'Files'), ...FILES.map((f) => {
    const wrap = h('div', { class: 'file-item' });
    const x = h('button', { class: 'fx', title: 'Close', 'aria-label': `Close ${f.name}` }, btnSvg('close'));
    x.onclick = (e) => { e.stopPropagation(); closePane(f.id); };
    wrap.append(sideItem(f, 'file'), x);
    return wrap;
  }));
  $('#files').hidden = !FILES.length;
}
function updateSidebar() {
  const vis = shown(); const home = showHome();
  const tasksDue = taskBadge();
  SV.forEach((s, k) => {
    const b = sideBtns.get(s.id); if (!b) return;
    const id = s.id;
    b.classList.toggle('open', L.alive.includes(id));
    b.classList.toggle('visible', vis.includes(id) && !home);
    b.classList.toggle('focused', id === L.focused && !home && !settingsOpen);
    b.classList.toggle('popped', L.popped.includes(id));
    b.classList.toggle('asleep', status[id] === 'sleeping');
    const n = id === 'tasks' ? tasksDue : unread[id] || 0; const badge = $('.badge', b);
    badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n);
    const sp = L.splits.find((x) => leaves(x.tile).includes(id));
    const st = L.popped.includes(id) ? ' · in its own window' : status[id] === 'sleeping' ? ' · sleeping' : sp ? ` · in a split with ${leaves(sp.tile).filter((x) => x !== id).map((x) => BY[x]?.name).join(', ')}` : L.alive.includes(id) && !vis.includes(id) ? ' · open in the background' : '';
    b.title = `${s.name}${st}${k < 9 ? `  (Ctrl+${k + 1})` : ''}${L.alive.includes(id) ? ' · middle-click to close' : ''}`;
  });
  for (const f of FILES) {
    const b = sideBtns.get(f.id); if (!b) continue;
    b.classList.toggle('visible', vis.includes(f.id) && !home);
    b.classList.toggle('focused', f.id === L.focused && !home && !settingsOpen);
    b.classList.toggle('popped', L.popped.includes(f.id));
    b.title = `${f.name}${L.popped.includes(f.id) ? ' · in its own window' : ''}`;
  }
  // remembered splits (and the one on screen), as combo tiles
  const cur = L.mode === 'tile' && visible().length > 1 ? [{ tile: L.tile, focused: L.focused, current: true }] : [];
  const all = [...cur, ...L.splits];
  const sig = all.map((s) => `${s.current ? '*' : ''}${leaves(s.tile).join('+')}`).join('|') + (home ? 'H' : '');
  const box2 = $('#splits');
  if (box2.dataset.sig !== sig) {
    box2.dataset.sig = sig;
    box2.replaceChildren(h('div', { class: 'nav-h' }, 'Splits'), ...all.map((s) => {
      const ids = leaves(s.tile);
      const b = h('button', { class: `svc split-btn${s.current && !home ? ' focused visible' : ''}`, title: `${s.current ? 'On screen: ' : 'Split: '}${splitTitle(s)}`, 'aria-label': `Split: ${splitTitle(s)}` },
        `<span class="tile combo">${ids.slice(0, 3).map((id) => `<i data-c="${esc(BY[id]?.color || '#999')}">${BY[id] ? glyph(BY[id]) : ''}</i>`).join('')}</span><span class="lbl"></span>`);
      $('.lbl', b).textContent = s.current ? `${splitTitle(s)} (on screen)` : splitTitle(s);
      b.onclick = () => { if (s.current) { homeOpen = false; if (settingsOpen) toggleSettings(false); render(); } else openPane(s.focused); };
      paint(b);
      return b;
    }));
  }
  box2.hidden = !all.length;
  $('#brand .home').classList.toggle('focused', home && !settingsOpen);
  $('#brand .home').classList.toggle('visible', home && !settingsOpen);
  $('#setBtn').classList.toggle('active', settingsOpen);
}

// ---------- layout menu ----------
function toggleMenu(force, viaKeyboard = false) {
  menuOpen = force ?? !menuOpen;
  if (menuOpen) { if (dlOpen) toggleDownloads(false); closePopover(); }
  const m = $('#menu');
  m.hidden = !menuOpen;
  $('#layoutsBtn').setAttribute('aria-expanded', String(menuOpen));
  if (menuOpen) {
    const n = visible().length;
    m.innerHTML = `<h4>Arrange open apps</h4><div class="grid">${PRESETS.map((p) => `<button class="preset${p.n === n ? ' fits' : ''}" data-p="${p.id}" title="${p.name}, ${p.n} app${p.n > 1 ? 's' : ''}">${presetThumb(p)}<span>${p.name}</span></button>`).join('')}</div>
      <div class="row" title="Ctrl+Shift+F switches"><button class="btn small" data-m="tile"${L.mode === 'tile' ? ' aria-pressed="true"' : ''}>${btnSvg('tile')}Tiled</button><button class="btn small" data-m="free"${L.mode === 'free' ? ' aria-pressed="true"' : ''}>${btnSvg('free')}Free-floating</button></div>`;
    m.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { toggleMenu(false); applyPreset(PRESETS.find((p) => p.id === b.dataset.p)); }));
    m.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { toggleMenu(false); if (L.mode !== b.dataset.m) toggleMode(); }));
    if (viaKeyboard) ($('.preset.fits', m) || $('.preset', m)).focus();
  }
  render();
}

// ---------- popovers (split with…, screenshot) and overlays (Ctrl+K, shortcuts, screenshot result) ----------
function openPopover(anchor, html, onPick) {
  if (menuOpen) toggleMenu(false);
  if (dlOpen) toggleDownloads(false);
  const p = $('#popover');
  p.innerHTML = html; p.hidden = false; popoverOpen = true;
  const r = anchor.getBoundingClientRect(); const pw = p.offsetWidth; const ph = p.offsetHeight;
  const side = !!anchor.closest('#sidebar'); // sidebar tools open to the right, header buttons drop down
  p.style.left = `${clamp(side ? r.right + 10 : r.right - pw, 8, innerWidth - pw - 8)}px`;
  p.style.top = `${clamp(side ? r.bottom - ph : r.bottom + 6, 8, innerHeight - ph - 8)}px`;
  p.onclick = (e) => { const b = e.target.closest('[data-pick]'); if (b) { closePopover(); onPick(b.dataset.pick); } };
  render();
  $('button', p)?.focus();
}
function closePopover() { if (!popoverOpen) return; popoverOpen = false; $('#popover').hidden = true; render(); }
function openSplitMenu(id, anchor) {
  const at = anchor || paneEls.get(id)?.querySelector('[data-a="split"]');
  const vis = visible();
  const choices = [...SV, ...FILES].filter((s) => !vis.includes(s.id) && !L.popped.includes(s.id));
  if (!at) return;
  openPopover(at, `<h4>Show beside ${esc(BY[id].name)}</h4>${choices.length ? `<div class="pick-list">${choices.map((s) => `<button data-pick="${esc(s.id)}" data-c="${esc(s.color)}"><span class="mini">${glyph(s)}</span>${esc(s.name)}</button>`).join('')}</div>` : '<p class="muted">Every app is already on screen.</p>'}<p class="hint">Or drag an app from the sidebar onto the page.</p>`, (pick) => splitWith(id, pick));
  paint($('#popover'));
}
function openShotMenu(anchor, paneId = null) {
  const f = paneId ? BY[paneId] : L.focused && shown().includes(L.focused) && !showHome() ? BY[L.focused] : null;
  openPopover(anchor, `<h4>Screenshot</h4><div class="pick-list">${f ? `<button data-pick="app">${btnSvg('camera')}Just ${esc(f.name)}</button>` : ''}<button data-pick="area">${btnSvg('crop')}Select an area…</button>${paneId ? '' : `<button data-pick="all">${btnSvg('camera')}Everything on screen<kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>S</kbd></button>`}<button data-pick="folder">${btnSvg('folder')}Open screenshots folder</button></div>`,
    (pick) => (pick === 'folder' ? hub.app('shots-folder') : pick === 'area' ? pickArea(f?.id) : takeShot(pick, f?.id)));
}
function showOverlay(html) {
  if (menuOpen) toggleMenu(false);
  closePopover(); if (dlOpen) toggleDownloads(false);
  const o = $('#overlay');
  o.innerHTML = `<div class="ov-back" data-act="close-overlay"></div>${html}`; o.hidden = false; overlayOpen = true;
  paint(o);
  o.onclick = (e) => { if (e.target.closest('[data-act="close-overlay"]')) closeOverlay(); };
  render();
  return o;
}
function closeOverlay() { if (!overlayOpen) return; overlayOpen = false; const o = $('#overlay'); o.hidden = true; o.innerHTML = ''; o.className = ''; render(); }
document.addEventListener('pointerdown', (e) => {
  if (menuOpen && !e.target.closest('#menu, #layoutsBtn')) toggleMenu(false);
  if (dlOpen && !e.target.closest('#downloads, #dlBtn')) toggleDownloads(false);
  if (popoverOpen && !e.target.closest('#popover')) closePopover();
});

// ---------- Today ----------
function showToday(open = true) {
  if (settingsOpen) toggleSettings(false);
  closeOverlay();
  homeOpen = open || !visible().length;
  render();
}

// ---------- screenshots ----------
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
async function composeShot({ shell, views }) { // web views aren't part of the shell's own capture: paint each where it sits
  const base = await loadImg(shell); const k = base.naturalWidth / innerWidth;
  const c = document.createElement('canvas'); c.width = base.naturalWidth; c.height = base.naturalHeight;
  const ctx = c.getContext('2d'); ctx.drawImage(base, 0, 0);
  for (const v of views) {
    const img = await loadImg(v.url);
    ctx.save(); ctx.beginPath(); ctx.roundRect(v.x * k, v.y * k, v.width * k, v.height * k, [0, 0, 8 * k, 8 * k]); ctx.clip();
    ctx.drawImage(img, v.x * k, v.y * k, v.width * k, v.height * k); ctx.restore();
  }
  return c.toDataURL('image/png');
}
async function takeShot(kind, forceId = null) {
  closeOverlay(); closePopover(); if (menuOpen) toggleMenu(false); if (dlOpen) toggleDownloads(false); if (settingsOpen) toggleSettings(false);
  render();
  await new Promise((r) => setTimeout(r, 200)); // let the web views come back from under the menu
  const id = forceId && shown().includes(forceId) ? forceId : L.focused && shown().includes(L.focused) && !showHome() ? L.focused : null;
  showNotice({ id: 'shot', kind: 'busy', title: 'Taking a screenshot…' });
  if (kind === 'app' && !id) { showShotResult({ error: 'Open an app first, then take its screenshot.' }); return; }
  const rect = id && R[id] ? { x: box.left + R[id].x, y: box.top + R[id].y + topOf(id), width: R[id].w, height: R[id].h - topOf(id) } : null;
  let r = await hub.capture(kind, id, rect);
  let thumb = null;
  if (r?.compose) { thumb = await composeShot(r.compose); r = await hub.saveShot(thumb); }
  showShotResult(r || { error: 'The screenshot didn’t work. Try again.' }, thumb);
}
function showShotResult(r, thumb) {
  if (r.error) { showNotice({ id: 'shot', kind: 'error', title: 'No screenshot', detail: r.error }); showOverlay(`<div class="shot-sheet" role="alertdialog"><div class="ed-head"><h3>No screenshot</h3><button class="hbtn" data-act="close-overlay" aria-label="Close">${btnSvg('close')}</button></div><p>${esc(r.error)}</p></div>`); return; }
  const s = r.shot;
  showNotice({ id: 'shot', kind: s.copied || !SET.screenshotCopy ? 'success' : 'error', title: s.copied ? 'Screenshot saved and copied' : SET.screenshotCopy ? 'Screenshot saved, but not copied' : 'Screenshot saved',
    detail: s.copied ? 'Ready to paste.' : SET.screenshotCopy ? 'Copying to the clipboard didn’t work. Open it and copy it from there.' : s.name,
    actions: [{ label: 'Open beside', run: () => hub.shotAction(s.id, 'view', 'beside') }, { label: 'Show in folder', run: () => hub.shotAction(s.id, 'show') }] });
  SHOTS = [s, ...SHOTS.filter((x) => x.id !== s.id)].slice(0, 10);
  const o = showOverlay(`<div class="shot-sheet" role="dialog" aria-label="Screenshot saved">
    <div class="ed-head"><h3>Screenshot saved</h3><button class="hbtn" data-act="close-overlay" aria-label="Close">${btnSvg('close')}</button></div>
    ${thumb || s.thumb ? '<img class="shot-img" alt="Screenshot preview">' : ''}
    <p class="muted">${s.copied ? 'Copied to your clipboard, ready to paste. ' : ''}Saved as <b></b></p>
    <div class="actions left"><button class="btn primary" data-how="beside">${btnSvg('split')}Open beside</button><button class="btn" data-how="full">${btnSvg('zoom')}Full screen</button><button class="btn" data-how="window">${btnSvg('popout')}Pop out</button><button class="btn" data-how="show">${btnSvg('folder')}Show in folder</button></div></div>`);
  $('b', o).textContent = s.name;
  const img = $('.shot-img', o); if (img) img.src = s.thumb || thumb;
  o.querySelectorAll('[data-how]').forEach((b) => (b.onclick = () => { closeOverlay(); if (b.dataset.how === 'show') hub.shotAction(s.id, 'show'); else hub.shotAction(s.id, 'view', b.dataset.how); }));
  $('[data-how="beside"]', o).focus();
}

// ---------- one-time tip ----------
function dismissTip() { tipPane = null; store.set('tipSplit', true); render(); }

// ---------- actions ----------
function focusPane(id) {
  if (L.focused === id && (L.mode !== 'free' || L.free.at(-1)?.id === id)) return;
  L.focused = id;
  if (L.mode === 'free') { const i = L.free.findIndex((p) => p.id === id); if (i >= 0) L.free.push(...L.free.splice(i, 1)); }
  commit();
}
// The split on screen is put aside (remembered) before something else takes the screen.
function stashCurrent() {
  if (L.mode !== 'tile' || leaves(L.tile).length < 2) return;
  L.splits = [{ tile: L.tile, focused: L.focused }, ...L.splits];
}
function openPane(id, at) {
  if (!BY[id] || BY[id].hidden) return;
  if (BY[id].external) { hub.openLink(BY[id].url); return; } // set to open in your browser (Settings → Apps)
  homeOpen = false;
  if (settingsOpen) toggleSettings(false);
  closeOverlay();
  if (L.popped.includes(id)) { hub.focusView(id); render(); return; }
  if (visible().includes(id)) { if (L.zoomed && L.zoomed !== id) L.zoomed = id; focusPane(id); hub.focusView(id); render(); return; }
  if (L.mode === 'free') {
    const W = stage.clientWidth || 1; const Hh = stage.clientHeight || 1;
    const base = L.free.find((p) => p.id === L.focused);
    const x = at ? ((at.x - 120) / W) * 100 : base ? base.x + 3 : 6 + L.free.length * 3;
    const y = at ? ((at.y - 14) / Hh) * 100 : base ? base.y + 4 : 6 + L.free.length * 4;
    L.free.push({ id, x: clamp(x, 0, 60), y: clamp(y, 0, 60), w: 46, h: 62 });
  } else {
    const sp = L.splits.find((s) => leaves(s.tile).includes(id));
    const hadOne = visible().length === 1;
    stashCurrent();
    if (sp) { L.splits = L.splits.filter((s) => s !== sp); L.tile = sp.tile; } else L.tile = leaf(id);
    L.zoomed = null;
    if (!sp && hadOne && !store.get('tipSplit') && !tipPane) tipPane = id; // switching apps one at a time: say once that splitting exists
  }
  L.alive = uniq([...L.alive, id]);
  L.focused = id;
  commit();
  hub.focusView(id);
}
function splitWith(target, id) { // show `id` to the right of `target`
  if (!BY[id]) return;
  homeOpen = false; if (settingsOpen) toggleSettings(false);
  if (L.mode === 'free' || !visible().includes(target)) { L.popped = L.popped.filter((x) => x !== id); openPane(id); return; }
  L.zoomed = null;
  applyDrop(id, { kind: 'side', id: target, side: 'right' });
}
function openFileCmd({ id, how } = {}) {
  if (!BY[id]) return;
  if (how === 'window') { homeOpen = false; L.alive = uniq([...L.alive, id]); if (!L.popped.includes(id)) { removeEverywhere(id); L.popped.push(id); } commit(); return; }
  const target = visible().includes(L.focused) ? L.focused : visible()[0];
  if (how === 'full' || !target || visible().includes(id)) openPane(id); else splitWith(target, id);
}
function removeEverywhere(id) {
  L.tile = removeLeaf(L.tile, id);
  L.free = L.free.filter((p) => p.id !== id);
  L.popped = L.popped.filter((x) => x !== id);
  if (L.zoomed === id) L.zoomed = null;
}
function closePane(id = L.focused) {
  if (!id) return;
  const vis = visible(); const i = vis.indexOf(id);
  removeEverywhere(id);
  L.alive = L.alive.filter((x) => x !== id);
  delete status[id]; delete unread[id]; delete statusInfo[id];
  paneEls.get(id)?.remove(); paneEls.delete(id);
  if (tipPane === id) tipPane = null;
  const rest = visible();
  L.focused = rest[Math.min(Math.max(i, 0), rest.length - 1)] ?? null;
  commit();
}
function popOut(id = L.focused) {
  if (!id || !L.alive.includes(id) || L.popped.includes(id)) return;
  removeEverywhere(id);
  L.popped.push(id);
  commit();
}
function dock(id) {
  if (!L.popped.includes(id)) return;
  L.popped = L.popped.filter((x) => x !== id);
  // back next to what's on screen (it was popped out of a split, most likely)
  const target = visible().includes(L.focused) ? L.focused : visible()[0];
  if (target && L.mode === 'tile') applyDrop(id, { kind: 'side', id: target, side: 'right' }); else { L.alive = L.alive.filter((x) => x !== id); openPane(id); }
}
function toggleZoom(id = L.focused) {
  if (!id || !visible().includes(id)) return;
  if (!L.zoomed && visible().length < 2) return; // nothing to zoom away from
  L.zoomed = L.zoomed === id ? null : id; L.focused = id;
  commit();
}
function cycle(dir) {
  const vis = shown().length > 1 ? shown() : visible();
  if (!vis.length) return;
  const id = vis[(vis.indexOf(L.focused) + dir + vis.length) % vis.length];
  if (L.zoomed) L.zoomed = id;
  focusPane(id); hub.focusView(id);
}
function applyPreset(p) {
  const order = uniq([...visible(), ...L.alive.filter((id) => !L.popped.includes(id) && BY[id] && !BY[id].hidden), ...SV.map((s) => s.id)]).slice(0, p.n);
  homeOpen = false;
  if (p.n > 1) store.set('tipSplit', true);
  L.mode = 'tile'; L.zoomed = null;
  L.tile = p.build(order);
  L.alive = uniq([...L.alive, ...order]);
  L.popped = L.popped.filter((id) => !order.includes(id));
  commit();
}
let presetIdx = -1;
function nextPreset() {
  const n = visible().length;
  const fits = PRESETS.filter((p) => p.n === n);
  const list = fits.length > 1 ? fits : PRESETS;
  presetIdx = (list.indexOf(PRESETS[presetIdx]) + 1) % list.length;
  const p = list[presetIdx];
  presetIdx = PRESETS.indexOf(p);
  applyPreset(p);
}
function toggleMode() {
  const W = stage.clientWidth || 1; const Hh = stage.clientHeight || 1;
  if (L.mode === 'tile') {
    const ids = leaves(L.tile);
    const prev = Object.fromEntries(L.free.map((p) => [p.id, p]));
    L.free = ids.map((id) => prev[id] || (R[id] ? { id, x: (R[id].x / W) * 100, y: (R[id].y / Hh) * 100, w: (R[id].w / W) * 100, h: (R[id].h / Hh) * 100 } : { id, x: 10, y: 10, w: 46, h: 60 }));
    if (L.focused) L.free.push(...L.free.splice(L.free.findIndex((p) => p.id === L.focused), 1).filter(Boolean));
    L.mode = 'free';
  } else {
    const ids = L.free.map((p) => p.id);
    let t = L.tile;
    for (const id of leaves(t)) if (!ids.includes(id)) t = removeLeaf(t, id);
    for (const id of ids) if (!leaves(t).includes(id)) t = t ? insertRoot(t, id, 'right') : leaf(id);
    L.tile = t; L.mode = 'tile';
  }
  L.zoomed = null;
  commit();
}

// Pointer tracking that survives losing pointer capture (hiding the web views moves focus, which drops it).
function track(e, onMove, onEnd) {
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture is a bonus, not required */ }
  const move = (ev) => { if (ev.pointerId === e.pointerId) onMove(ev); };
  const done = (ev, ok) => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('keydown', esc, true);
    window.removeEventListener('blur', cancel);
    onEnd(ev, ok);
  };
  const up = (ev) => { if (ev.pointerId === e.pointerId) done(ev, true); };
  const cancel = (ev) => done(ev, false);
  const esc = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); done(ev, false); } };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('keydown', esc, true);
  window.addEventListener('blur', cancel);
}

// ---------- divider drag ----------
function startDivider(e, el) {
  if (e.button !== 0) return;
  e.preventDefault();
  const d = el._d; const n = d.node;
  el.classList.add('active');
  document.body.classList.add('resizing', d.dir === 'h' ? 'col' : 'row');
  const total = d.dir === 'h' ? d.w : d.h; const origin = d.dir === 'h' ? d.x : d.y;
  const before = sum(n.sizes.slice(0, d.i - 1)); const pair = n.sizes[d.i - 1] + n.sizes[d.i];
  const min = Math.min(scaled(MIN_TILE) / total, pair / 2 - 0.001);
  const move = (ev) => {
    const p = ((d.dir === 'h' ? ev.clientX - box.left : ev.clientY - box.top) - origin) / total;
    let a = clamp(p - before, min, pair - min);
    if (!ev.altKey) for (const f of [1 / 3, 1 / 2, 2 / 3]) if (Math.abs(before + a - f) < 0.012 && f - before >= min && pair - (f - before) >= min) a = f - before;
    n.sizes[d.i - 1] = a; n.sizes[d.i] = pair - a;
    render(true);
  };
  const saved = [...n.sizes];
  track(e, move, (_ev, ok) => {
    el.classList.remove('active');
    document.body.classList.remove('resizing', 'col', 'row');
    if (!ok) n.sizes = saved;
    commit();
  });
}

// ---------- free mode: move + resize with snapping ----------
function snapEdges(id) {
  const W = stage.clientWidth; const Hh = stage.clientHeight;
  const xs = [GAP, W - GAP]; const ys = [GAP, Hh - GAP];
  for (const [o, r] of Object.entries(R)) if (o !== id) { xs.push(r.x, r.x + r.w, r.x - GAP, r.x + r.w + GAP); ys.push(r.y, r.y + r.h, r.y - GAP, r.y + r.h + GAP); }
  return { xs, ys };
}
const snapTo = (v, list) => { for (const e of list) if (Math.abs(v - e) < SNAP) return e; return null; };
function freeUpdate(id, r) {
  const W = stage.clientWidth || 1; const Hh = stage.clientHeight || 1;
  const p = L.free.find((q) => q.id === id); if (!p) return;
  Object.assign(p, { x: (r.x / W) * 100, y: (r.y / Hh) * 100, w: (r.w / W) * 100, h: (r.h / Hh) * 100 });
  render(true);
}
function startMove(e, id) {
  const r0 = { ...R[id] }; const sx = e.clientX; const sy = e.clientY;
  const W = stage.clientWidth; const Hh = stage.clientHeight;
  const { xs, ys } = snapEdges(id);
  document.body.classList.add('moving');
  const move = (ev) => {
    let x = r0.x + ev.clientX - sx; let y = r0.y + ev.clientY - sy;
    if (!ev.altKey) {
      const sl = snapTo(x, xs); const sr = snapTo(x + r0.w, xs);
      if (sl != null) x = sl; else if (sr != null) x = sr - r0.w;
      const st = snapTo(y, ys); const sb = snapTo(y + r0.h, ys);
      if (st != null) y = st; else if (sb != null) y = sb - r0.h;
    }
    x = clamp(x, 80 - r0.w, W - 80); y = clamp(y, 0, Hh - HEADER);
    freeUpdate(id, { ...r0, x, y });
  };
  track(e, move, (_ev, ok) => { document.body.classList.remove('moving'); if (!ok) freeUpdate(id, r0); commit(); });
}
function startResize(e, id, edge) {
  if (e.button !== 0 || L.mode !== 'free' || L.zoomed) return;
  e.preventDefault(); e.stopPropagation();
  focusPane(id);
  const r0 = { ...R[id] }; const sx = e.clientX; const sy = e.clientY;
  const W = stage.clientWidth; const Hh = stage.clientHeight;
  const { xs, ys } = snapEdges(id);
  document.body.classList.add('moving');
  const move = (ev) => {
    const dx = ev.clientX - sx; const dy = ev.clientY - sy;
    let { x, y, w, h: hh } = r0;
    let right = x + w; let bottom = y + hh;
    if (edge.includes('e')) right = clamp(r0.x + r0.w + dx, x + MIN_FREE_W, W);
    if (edge.includes('s')) bottom = clamp(r0.y + r0.h + dy, y + MIN_FREE_H, Hh);
    if (edge.includes('w')) x = clamp(r0.x + dx, 0, right - MIN_FREE_W);
    if (edge.includes('n')) y = clamp(r0.y + dy, 0, bottom - MIN_FREE_H);
    if (!ev.altKey) {
      if (edge.includes('e')) right = snapTo(right, xs) ?? right;
      if (edge.includes('s')) bottom = snapTo(bottom, ys) ?? bottom;
      if (edge.includes('w')) x = snapTo(x, xs) ?? x;
      if (edge.includes('n')) y = snapTo(y, ys) ?? y;
    }
    freeUpdate(id, { x, y, w: right - x, h: bottom - y });
  };
  track(e, move, (_ev, ok) => { document.body.classList.remove('moving'); if (!ok) freeUpdate(id, r0); commit(); });
}

// ---------- drag to dock (header in tile mode, or a sidebar icon) ----------
function headerDown(e, id) {
  if (e.button !== 0 || e.target.closest('.hbtn, .tip-x')) return;
  focusPane(id);
  if (L.mode === 'free' && !L.zoomed) startMove(e, id); else armDrag(e, id);
}
function dragSource(e, id) {
  if (e.button !== 0) return;
  armDrag(e, id, () => openPane(id));
}
// Waits for a few px of movement before it becomes a drag; otherwise it's a click.
function armDrag(e, id, onClick) {
  const sx = e.clientX; const sy = e.clientY; let live = false;
  const ghost = $('#ghost'); const zone = $('#dropzone');
  let hit = null;
  const move = (ev) => {
    if (!live) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      live = true; dragging = true;
      ghost.innerHTML = `<i class="gg">${glyph(BY[id])}</i><span></span>`; $('span', ghost).textContent = BY[id].name;
      ghost.style.setProperty('--svc', BY[id].color);
      ghost.hidden = false;
      document.body.classList.add('dragging');
      render();
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
    hit = hitTest(ev.clientX - box.left, ev.clientY - box.top, id);
    if (hit?.preview) { zone.hidden = false; const p = hit.preview; zone.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`; zone.dataset.kind = hit.kind; } else zone.hidden = true;
  };
  track(e, move, (ev, drop) => {
    if (!live) { if (drop && onClick) onClick(); return; }
    dragging = false; ghost.hidden = true; zone.hidden = true;
    document.body.classList.remove('dragging');
    if (drop && hit) applyDrop(id, hit, { x: ev.clientX - box.left, y: ev.clientY - box.top });
    else render();
  });
}
function hitTest(px, py, src) {
  const W = stage.clientWidth; const Hh = stage.clientHeight;
  if (px < 0 || py < 0 || px > W || py > Hh) return null;
  if (showHome() || !visible().length) return { kind: 'empty', preview: { x: GAP, y: GAP, w: W - 2 * GAP, h: Hh - 2 * GAP } };
  if (L.mode === 'free' && !L.zoomed) return { kind: 'free' };
  const E = 28; const half = (s) => ({ left: { x: GAP, y: GAP, w: W / 3, h: Hh - 2 * GAP }, right: { x: (W * 2) / 3 - GAP, y: GAP, w: W / 3, h: Hh - 2 * GAP }, top: { x: GAP, y: GAP, w: W - 2 * GAP, h: Hh / 3 }, bottom: { x: GAP, y: (Hh * 2) / 3 - GAP, w: W - 2 * GAP, h: Hh / 3 } })[s];
  const edge = px < E ? 'left' : px > W - E ? 'right' : py < E ? 'top' : py > Hh - E ? 'bottom' : null;
  if (edge && !L.zoomed) return { kind: 'root', side: edge, preview: half(edge) };
  for (const [id, r] of Object.entries(R)) {
    if (px < r.x || py < r.y || px > r.x + r.w || py > r.y + r.h) continue;
    const fx = (px - r.x) / r.w; const fy = (py - r.y) / r.h;
    if (L.zoomed || (fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7)) return id === src ? null : { kind: 'center', id, preview: r };
    const side = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]].sort((a, b) => a[1] - b[1])[0][0];
    if (id === src) return null;
    const pv = { left: { ...r, w: r.w / 2 }, right: { ...r, x: r.x + r.w / 2, w: r.w / 2 }, top: { ...r, h: r.h / 2 }, bottom: { ...r, y: r.y + r.h / 2, h: r.h / 2 } }[side];
    return { kind: 'side', id, side, preview: pv };
  }
  return null;
}
function applyDrop(id, hit, at) {
  homeOpen = false;
  if (visible().includes(id) && (hit.kind === 'free' || hit.kind === 'empty')) { render(); return; }
  L.popped = L.popped.filter((x) => x !== id); // dropping a popped-out app onto the screen brings it back in
  if (hit.kind === 'free' || (hit.kind === 'empty' && (L.mode === 'free' || visible().length))) { openPane(id, L.mode === 'free' ? at : undefined); return; }
  const wasVisible = visible().includes(id);
  let t = L.tile;
  if (hit.kind === 'empty') t = leaf(id);
  else if (hit.kind === 'center') {
    t = wasVisible ? swapLeaves(t, id, hit.id) : mapLeaf(t, (p) => (p === hit.id ? id : p)); // replaced pane keeps running in the background
    if (L.zoomed) L.zoomed = id;
  } else {
    if (wasVisible) t = removeLeaf(t, id);
    t = hit.kind === 'root' ? insertRoot(t, id, hit.side) : insertAt(t, hit.id, id, hit.side);
    L.zoomed = null;
    store.set('tipSplit', true); tipPane = null; // they know how to split now
  }
  L.tile = normalize(t);
  L.alive = uniq([...L.alive, id]);
  L.focused = id;
  commit();
  hub.focusView(id);
}

// ---------- main → UI ----------
hub.onTabs((info) => {
  const had = hasTabs(info.id);
  TABS[info.id] = info;
  const el = paneEls.get(info.id);
  if (el && BY[info.id]) fillTabStrip($('.tabstrip', el), info.id, BY[info.id].name);
  if (had !== hasTabs(info.id)) render(); // the page below moves down or up
});
hub.tabs?.().then((list) => { for (const t of list || []) { TABS[t.id] = t; const el = paneEls.get(t.id); if (el && BY[t.id]) fillTabStrip($('.tabstrip', el), t.id, BY[t.id].name); } render(); });
hub.onStatus(({ id, status: st, ...info }) => {
  if (!BY[id]) return;
  const was = blocked(id);
  status[id] = st; statusInfo[id] = info;
  renderStatus(id);
  updateSidebar();
  if (was !== blocked(id)) queueBounds();
});
hub.onUnread(({ id, n }) => { if (BY[id]) { unread[id] = n; updateSidebar(); if (showHome()) renderToday(); } });
hub.onFocused((id) => { if (visible().includes(id)) focusPane(id); });
hub.onCmd(({ name, arg }) => {
  if (name === 'open') openPane(arg);
  else if (name === 'close') closePane(arg || L.focused);
  else if (name === 'zoom') toggleZoom();
  else if (name === 'popout') popOut();
  else if (name === 'dock') dock(arg);
  else if (name === 'mode') toggleMode();
  else if (name === 'preset') nextPreset();
  else if (name === 'cycle') cycle(arg);
  else if (name === 'home') showToday(!(showHome() && !settingsOpen) || !visible().length);
  else if (name === 'settings') toggleSettings(true);
  else if (name === 'downloads') toggleDownloads();
  else if (name === 'find') findIn(arg);
  else if (name === 'switcher') { if (overlayOpen) closeOverlay(); else openSwitcher(); }
  else if (name === 'help') openHelp();
  else if (name === 'shot') { if (arg === 'area') pickArea(); else takeShot(arg === 'app' ? 'app' : 'all'); }
  else if (name === 'open-file') openFileCmd(arg);
  else if (name === 'link-drag') linkDragging(arg);
});

// ---------- a link window's grip dragged onto this window: drop it anywhere a split can go ----------
let linkDrag = null; // { token, name, app, color } while one is being dragged
let linkDragTimer = null;
function linkDragging(arg) {
  linkDrag = arg && typeof arg.token === 'string' ? arg : null;
  // a drag that never ends (window closed, drop lost) mustn't leave every app hidden
  clearTimeout(linkDragTimer); if (linkDrag) linkDragTimer = setTimeout(() => linkDragging(null), 15e3);
  dragging = !!linkDrag; // hides the web views (setCover) so the drop reaches this page
  document.body.classList.toggle('dragging', dragging);
  if (!linkDrag) $('#dropzone').hidden = true;
  else if (settingsOpen) toggleSettings(false);
  render();
}
const linkHit = (e) => { box = stage.getBoundingClientRect(); return hitTest(e.clientX - box.left, e.clientY - box.top, null); };
document.addEventListener('dragover', (e) => {
  if (!linkDrag) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const hit = linkHit(e); const zone = $('#dropzone');
  if (hit?.preview) { zone.hidden = false; const p = hit.preview; zone.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`; zone.dataset.kind = hit.kind; } else zone.hidden = true;
});
document.addEventListener('dragleave', (e) => { if (linkDrag && !e.relatedTarget) $('#dropzone').hidden = true; });
document.addEventListener('drop', async (e) => {
  if (!linkDrag) return;
  e.preventDefault();
  const token = e.dataTransfer.getData('application/x-wakeup-link') || linkDrag.token;
  const hit = linkHit(e); const at = { x: e.clientX - box.left, y: e.clientY - box.top };
  linkDragging(null);
  const id = await hub.dockLink(token);
  for (let i = 0; id && !BY[id] && i < 40; i++) await new Promise((r) => setTimeout(r, 25)); // its settings update is on the way
  if (!id || !BY[id]) return;
  if (hit) applyDrop(id, hit, at); else openFileCmd({ id, how: 'beside' });
});
function findIn(id) {
  if (!BY[id] || L.popped.includes(id) || isLocal(id)) return;
  if (settingsOpen) toggleSettings(false);
  if (!shown().includes(id)) openPane(id);
  homeOpen = false; render();
  paneEls.get(id)?._find?.open();
}
hub.onFound((r) => paneEls.get(r.id)?._find?.found(r));
hub.onDownload((d) => { onDownload(d); if (showHome() && d.state !== 'progressing') renderToday(); });
hub.onSettings((p) => applyPayload(p));
hub.onPlanner((p) => plannerUpdated(p));
// Timetable/Tasks data changed (here, in a pop-out, or in main): redraw everything that shows it.
plannerListeners.add(() => {
  for (const el of paneEls.values()) el._view?.render();
  updateSidebar();
  if (showHome()) renderToday();
});
// Settings or the app list changed in main: adopt its (validated) apps, settings and layout.
const svcSig = () => ALL.map((s) => `${s.id}:${s.name}:${s.color}:${s.icon ? 1 : 0}:${s.hidden}`).join();
function applyPayload(p) {
  const before = svcSig();
  ALL = p.services; APPS = ALL.filter((s) => s.kind !== 'file'); SV = APPS.filter((s) => !s.hidden); FILES = ALL.filter((s) => s.kind === 'file');
  BY = Object.fromEntries(ALL.map((x) => [x.id, x]));
  const prevToday = JSON.stringify([SET.today, SET.accent]);
  SET = p.settings; META = { version: p.version, autostart: p.autostart, defaultDownloadDir: p.defaultDownloadDir, defaultShotDir: p.defaultShotDir };
  const ws = WEEK_START; WEEK_START = SET.weekStart;
  const lm = LABEL_MODE; LABEL_MODE = SET.classLabel || 'code';
  if (p.layout) Object.assign(L, p.layout);
  for (const [id, el] of paneEls) if (!L.alive.includes(id) || !BY[id]) { el.remove(); paneEls.delete(id); }
  if (before !== svcSig()) buildSidebar(); // panes re-create themselves if their own name/icon changed
  if (ws !== WEEK_START || lm !== LABEL_MODE) plannerUpdated();
  applyAccent(SET.accent);
  if (settingsOpen) renderSettings();
  render();
  if (prevToday !== JSON.stringify([SET.today, SET.accent]) && showHome()) renderToday();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (overlayOpen) closeOverlay();
  else if (popoverOpen) closePopover();
  else if (dlOpen) toggleDownloads(false);
  else if (settingsOpen) { if (e.target.closest?.('.app-form')) return; toggleSettings(false); }
  else if (menuOpen) toggleMenu(false);
  else if (homeOpen && visible().length) { homeOpen = false; render(); }
});
window.addEventListener('online', () => { hub.retryFailed(); for (const id of Object.keys(status)) if (status[id] === 'error') renderStatus(id); });
window.addEventListener('offline', () => { for (const id of Object.keys(status)) if (status[id] === 'error') renderStatus(id); });
// resizing: lay out once per frame, not once per observer callback
let resizeFrame = 0;
new ResizeObserver(() => { if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; render(); }); }).observe(stage);
// once a minute: countdowns on Today, the timetable's "now" line, and the day rolling over for task badges.
// Nothing to update while the window is hidden; catch up the moment it's shown again.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (showHome() && !overlayOpen) renderToday(); for (const el of paneEls.values()) el._view?.tick?.(); updateSidebar(); } });
setInterval(() => {
  if (document.hidden) return;
  const typing = document.activeElement?.matches?.('#home input');
  if (showHome() && !typing && !overlayOpen) renderToday();
  for (const el of paneEls.values()) el._view?.tick?.();
  updateSidebar();
}, 30e3);

hub.init().then((s) => {
  Object.assign(status, s.status); Object.assign(unread, s.unread);
  for (const d of s.downloads) DL.set(d.id, d);
  SHOTS = s.shots || [];
  PL = s.planner;
  $('#downloads').addEventListener('click', onDownloadsClick);
  applyPayload(s); // apps, settings, layout; builds the sidebar
  commit(); // also re-opens popped-out windows
  renderDlButton();
  if (s.openSettings) toggleSettings(true);
}).catch((e) => {
  document.body.innerHTML = '<div class="fatal"><h1>WakeUp couldn’t start</h1><p></p><p>Quit from the tray and open it again. Details are in ~/.config/WakeUp/logs.</p></div>';
  $('.fatal p').textContent = String(e && e.message || e);
});
