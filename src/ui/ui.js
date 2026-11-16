'use strict';
/* global hub */
// WakeUp shell UI. The layout lives here; main validates/persists it and places the native web views
// where this file says the pane bodies are (web views always paint above this HTML).

const GAP = 8; const HEADER = 34; const MIN_TILE = 200; const MIN_FREE_W = 280; const MIN_FREE_H = 180; const SNAP = 10;

// ---------- icons (24px glyphs, 16px header buttons) ----------
const ICONS = {
  ebwise: '<path d="M12 4 2 9l10 5 8-4v6h2V9z"/><path d="M6 12.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.5l-6 3z"/>',
  mail: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zm2 .8v.3l7 4.6 7-4.6v-.3zm0 2.7V17h14v-7l-7 4.6z"/>',
  calendar: '<path d="M7 2h2v2h6V2h2v2h2.5A1.5 1.5 0 0 1 21 5.5v14a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-14A1.5 1.5 0 0 1 4.5 4H7zM5 9v10h14V9zm2 2h3v3H7z"/>',
  todo: '<path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L21.1 7.4 19.7 6z"/>',
  teams: '<circle cx="9" cy="7.5" r="3"/><circle cx="17" cy="8.5" r="2.2"/><path d="M3 18c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5v1H3zm13.5-4.3c2.6.2 4.5 1.9 4.5 4.3v1h-4.5v-1c0-1.6-.6-3.1-1.6-4.2.5-.1 1-.1 1.6-.1z"/>',
};
const S16 = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
const BTN = {
  back: S16('M10 3 5 8l5 5'),
  reload: S16('M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3'),
  external: S16('M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5'),
  popout: S16('M6 3H3.5A.5.5 0 0 0 3 3.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V10M9 3h4v4M13 3 8 8'),
  zoom: S16('M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3'),
  unzoom: S16('M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3'),
  close: S16('M4.5 4.5l7 7M11.5 4.5l-7 7'),
  tile: S16('M2.5 3.5h11v9h-11zM8 3.5v9M8 8h5.5'),
  free: S16('M2.5 2.5h7v6h-7zM6.5 7.5h7v6h-7z'),
  layouts: S16('M2.5 3h11v10h-11zM7 3v10M7 8h6.5'),
  warn: S16('M8 2.5 14 13H2zM8 6.5v3M8 11.3v.2'),
  offline: S16('M2 6a9 9 0 0 1 12 0M4.3 8.5a5.5 5.5 0 0 1 7.4 0M6.6 11a2 2 0 0 1 2.8 0M2.5 2.5l11 11'),
  pause: S16('M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3l2 1.5'),
};
// WakeUp mark: the app icon's looping W + sparks (1024 grid, cropped by MARK_VB).
const MARK = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path stroke-width="74" d="M282 372C298 540 336 690 398 690C452 690 470 572 492 520C506 486 536 470 552 492C568 516 546 546 520 534C500 524 506 486 532 488C566 560 572 690 628 690C690 690 716 540 732 372"/><path stroke-width="56" d="M722 236L742 184M790 278L834 246M818 350L870 340"/></g>';
const MARK_VB = '230 140 690 600';
const svg = (body, vb = '0 0 24 24', fill = 'currentColor') => `<svg viewBox="${vb}" fill="${fill}" aria-hidden="true">${body}</svg>`;
const btnSvg = (k) => svg(BTN[k], '0 0 16 16', 'none');

// ---------- tiny helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, html = '') => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v === true) el.setAttribute(k, ''); else if (v != null && v !== false) el.setAttribute(k, v); } el.innerHTML = html; return el; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uniq = (a) => [...new Set(a)];
const sum = (a) => a.reduce((x, y) => x + y, 0);

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

// ---------- layout presets ----------
const PRESETS = [
  { id: 'single', name: 'Single', n: 1, build: ([a]) => leaf(a) },
  { id: 'cols2', name: 'Side by side', n: 2, build: ([a, b]) => H([leaf(a), leaf(b)]) },
  { id: 'rows2', name: 'Stacked', n: 2, build: ([a, b]) => V([leaf(a), leaf(b)]) },
  { id: 'main2', name: 'Main + 2', n: 3, build: ([a, b, c]) => H([leaf(a), V([leaf(b), leaf(c)])], [0.6, 0.4]) },
  { id: 'cols3', name: 'Three columns', n: 3, build: (x) => H(x.map(leaf)) },
  { id: 'grid', name: 'Grid', n: 4, build: ([a, b, c, d]) => V([H([leaf(a), leaf(b)]), H([leaf(c), leaf(d)])]) },
  { id: 'main3', name: 'Main + 3', n: 4, build: ([a, ...r]) => H([leaf(a), V(r.map(leaf))], [0.6, 0.4]) },
  { id: 'five', name: 'All five', n: 5, build: (x) => V([H(x.slice(0, 3).map(leaf)), H(x.slice(3).map(leaf))]) },
];
const DEFAULT_PRESET = { 1: 'single', 2: 'cols2', 3: 'main2', 4: 'grid', 5: 'five' };
function presetThumb(p) {
  const cells = {}; tileCells(p.build(['a', 'b', 'c', 'd', 'e'].slice(0, p.n)), 1, 1, 26, 18, cells, []);
  return svg(Object.values(cells).map((r) => `<rect x="${r.x + 0.9}" y="${r.y + 0.9}" width="${r.w - 1.8}" height="${r.h - 1.8}" rx="1.6"/>`).join(''), '0 0 28 20', 'currentColor');
}

// ---------- state ----------
let SV = []; let BY = {};
let L = { mode: 'tile', tile: null, free: [], alive: [], popped: [], focused: null, zoomed: null };
let last = null;
const status = {}; const unread = {}; const statusInfo = {};
let homeOpen = false; let menuOpen = false; let dragging = false;
const stage = $('#stage');

const visible = () => (L.mode === 'tile' ? leaves(L.tile) : L.free.map((p) => p.id));
const shown = () => (L.zoomed && visible().includes(L.zoomed) ? [L.zoomed] : visible());
const showHome = () => homeOpen || visible().length === 0;
function commit() {
  L.alive = uniq([...L.alive, ...visible(), ...L.popped]);
  if (L.focused && !L.alive.includes(L.focused)) L.focused = null;
  if (!L.focused || !visible().includes(L.focused)) L.focused = visible()[0] ?? null;
  if (L.zoomed && !visible().includes(L.zoomed)) L.zoomed = null;
  hub.commit(L);
  render();
}

// ---------- geometry ----------
function tileCells(n, x, y, w, hgt, out, divs, path = []) {
  if (!n) return;
  if (n.pane) { out[n.pane] = { x, y, w, h: hgt }; return; }
  let off = 0; const total = n.dir === 'h' ? w : hgt;
  n.children.forEach((c, i) => {
    const size = total * n.sizes[i];
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
  box = stage.getBoundingClientRect();
  geometry();
  document.body.classList.toggle('mode-free', L.mode === 'free');
  document.body.classList.toggle('zoomed', !!L.zoomed);
  const home = showHome();
  $('#home').hidden = !home;
  if (home && !dragFrame) renderHome();
  const order = L.mode === 'free' ? L.free.map((p) => p.id) : Object.keys(R);
  for (const [id, el] of paneEls) if (!R[id]) el.hidden = true;
  order.forEach((id, z) => {
    const r = R[id]; if (!r) return;
    const el = paneEl(id);
    el.hidden = false;
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, zIndex: String(z + 1) });
    el.classList.toggle('focused', id === L.focused && shown().length > 1);
    el.classList.toggle('blocked', blocked(id));
    const zb = el.querySelector('[data-a="zoom"]');
    const isZ = L.zoomed === id;
    if (zb.dataset.z !== String(isZ)) { zb.dataset.z = String(isZ); zb.innerHTML = btnSvg(isZ ? 'unzoom' : 'zoom'); zb.title = isZ ? 'Restore (Ctrl+M)' : 'Zoom (Ctrl+M)'; zb.setAttribute('aria-label', isZ ? 'Restore' : 'Zoom'); }
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
  setCover(home || menuOpen || dragging);
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
      if (blocked(id)) continue;
      const r = R[id];
      rects[id] = { x: box.left + r.x, y: box.top + r.y + HEADER, width: r.w, height: r.h - HEADER };
      order.push(id);
    }
    hub.bounds({ rects, order });
  });
}
let covered = null;
function setCover(on) { if (covered !== on) { covered = on; hub.cover(on); } }

function paneEl(id) {
  if (paneEls.has(id)) return paneEls.get(id);
  const svc = BY[id];
  const el = h('section', { class: 'pane', 'aria-label': svc.name });
  el.style.setProperty('--svc', svc.color);
  const b = (a, label, key) => `<button class="hbtn" data-a="${a}" title="${label}${key ? ` (${key})` : ''}" aria-label="${label}">${btnSvg(a)}</button>`;
  el.innerHTML = `
    <header>
      <span class="glyph">${svg(ICONS[id] || '<circle cx="12" cy="12" r="6"/>')}</span>
      <span class="name"></span>
      <span class="progress" aria-hidden="true"></span>
      ${b('back', 'Back')}${b('reload', 'Reload', 'Ctrl+R')}${b('external', 'Open in browser')}
      <span class="sep"></span>
      ${b('popout', 'Pop out to its own window', 'Ctrl+Shift+O')}${b('zoom', 'Zoom', 'Ctrl+M')}${b('close', 'Close', 'Ctrl+W')}
    </header>
    <div class="body"><span class="ghost-glyph">${svg(ICONS[id] || '')}</span><div class="state" role="status" aria-live="polite"></div></div>
    ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((e) => `<div class="rh ${e}" data-e="${e}"></div>`).join('')}`;
  $('.name', el).textContent = svc.name;
  el.querySelectorAll('.hbtn').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = btn.dataset.a;
      if (a === 'close') closePane(id);
      else if (a === 'zoom') toggleZoom(id);
      else if (a === 'popout') popOut(id);
      else hub.nav(id, a);
    });
  });
  const header = $('header', el);
  header.addEventListener('pointerdown', (e) => headerDown(e, id));
  header.addEventListener('dblclick', () => toggleZoom(id));
  el.addEventListener('pointerdown', () => focusPane(id));
  el.querySelectorAll('.rh').forEach((rh) => rh.addEventListener('pointerdown', (e) => startResize(e, id, rh.dataset.e)));
  stage.append(el);
  paneEls.set(id, el);
  renderStatus(id);
  return el;
}

// ---------- per-pane status ----------
function renderStatus(id) {
  const el = paneEls.get(id); if (!el) return;
  const st = status[id]; const info = statusInfo[id] || {}; const name = BY[id].name;
  el.classList.toggle('loading', st === 'loading');
  const box2 = $('.state', el);
  const panel = (icon, title, text, actions) => `<div class="msg"><span class="msg-icon">${btnSvg(icon)}</span><h3>${title}</h3><p>${text}</p><div class="actions">${actions}</div></div>`;
  if (st === 'error') {
    const off = !navigator.onLine || info.code === -106;
    const why = { '-105': 'Its address couldn’t be found.', '-118': 'The connection timed out.', '-102': 'The server refused the connection.', '-21': 'Your network changed.', '-100': 'The connection was closed.', '-101': 'The connection was reset.', '-109': 'The site is unreachable.', '-137': 'Its address couldn’t be looked up.' }[info.code] || 'The page didn’t load.';
    box2.innerHTML = panel(off ? 'offline' : 'warn', off ? 'You’re offline' : `Couldn’t load ${name}`,
      off ? `${name} will reload by itself when your connection is back.` : `${why} Retrying automatically.<span class="code"></span>`,
      '<button class="btn primary" data-r="retry">Try again</button>');
  } else if (st === 'crashed') {
    box2.innerHTML = panel('warn', `${name} stopped working`, 'The page crashed. Reloading usually fixes it; you stay signed in.', '<button class="btn primary" data-r="retry">Reload</button>');
  } else if (st === 'hung') {
    box2.innerHTML = panel('pause', `${name} isn’t responding`, 'It may be busy. You can wait or reload it.', '<button class="btn" data-r="wait">Wait</button><button class="btn primary" data-r="retry">Reload</button>');
  } else box2.innerHTML = '';
  const codeEl = $('.code', box2); if (codeEl) codeEl.textContent = info.desc || '';
  box2.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.r === 'wait') { status[id] = 'ready'; renderStatus(id); render(); } else hub.retry(id);
  }));
  el.classList.toggle('blocked', blocked(id));
}

// ---------- sidebar ----------
const sideBtns = new Map();
function buildSidebar() {
  const home = h('button', { class: 'home', title: 'Start screen (Ctrl+Shift+H)', 'aria-label': 'Start screen' }, svg(MARK, MARK_VB, 'none'));
  home.onclick = () => { homeOpen = !homeOpen || visible().length === 0; render(); };
  $('#brand').append(home);
  SV.forEach((svc, i) => {
    const b = h('button', { class: 'svc', title: `${svc.name}  (Ctrl+${i + 1})`, 'aria-label': svc.name }, svg(ICONS[svc.id] || '<circle cx="12" cy="12" r="6"/>'));
    b.style.setProperty('--svc', svc.color);
    b.append(h('span', { class: 'badge', hidden: true }));
    b.addEventListener('pointerdown', (e) => dragSource(e, svc.id));
    b.addEventListener('auxclick', (e) => { if (e.button === 1 && L.alive.includes(svc.id)) closePane(svc.id); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPane(svc.id); } });
    $('#services').append(b);
    sideBtns.set(svc.id, b);
  });
  const lay = h('button', { class: 'tool', id: 'layoutsBtn', title: 'Layouts (Ctrl+Shift+L)', 'aria-label': 'Layouts', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, btnSvg('layouts'));
  lay.onclick = (e) => { e.stopPropagation(); toggleMenu(undefined, e.detail === 0); };
  $('#tools').append(lay);
}
function updateSidebar() {
  const vis = shown();
  for (const [id, b] of sideBtns) {
    b.classList.toggle('open', L.alive.includes(id));
    b.classList.toggle('visible', vis.includes(id) && !showHome());
    b.classList.toggle('focused', id === L.focused && !showHome());
    b.classList.toggle('popped', L.popped.includes(id));
    b.classList.toggle('asleep', status[id] === 'sleeping');
    const n = unread[id] || 0; const badge = $('.badge', b);
    badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n);
    const st = L.popped.includes(id) ? ' — in its own window' : status[id] === 'sleeping' ? ' — sleeping' : L.alive.includes(id) && !vis.includes(id) ? ' — in background' : '';
    b.title = `${BY[id].name}${st}  (Ctrl+${SV.indexOf(BY[id]) + 1})${L.alive.includes(id) ? ' · middle-click to close' : ''}`;
  }
  $('#brand .home').classList.toggle('active', showHome());
}

// ---------- layout menu ----------
function toggleMenu(force, viaKeyboard = false) {
  menuOpen = force ?? !menuOpen;
  const m = $('#menu');
  m.hidden = !menuOpen;
  $('#layoutsBtn').setAttribute('aria-expanded', String(menuOpen));
  if (menuOpen) {
    const n = visible().length;
    m.innerHTML = `<h4>Arrange</h4><div class="grid">${PRESETS.map((p) => `<button class="preset${p.n === n ? ' fits' : ''}" data-p="${p.id}" title="${p.name} — ${p.n} pane${p.n > 1 ? 's' : ''}">${presetThumb(p)}<span>${p.name}</span></button>`).join('')}</div>
      <div class="row" title="Ctrl+Shift+F switches"><button class="btn small" data-m="tile"${L.mode === 'tile' ? ' aria-pressed="true"' : ''}>${btnSvg('tile')}Tiled</button><button class="btn small" data-m="free"${L.mode === 'free' ? ' aria-pressed="true"' : ''}>${btnSvg('free')}Free-floating</button></div>`;
    m.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { toggleMenu(false); applyPreset(PRESETS.find((p) => p.id === b.dataset.p)); }));
    m.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { toggleMenu(false); if (L.mode !== b.dataset.m) toggleMode(); }));
    if (viaKeyboard) ($('.preset.fits', m) || $('.preset', m)).focus();
  }
  render();
}
document.addEventListener('pointerdown', (e) => { if (menuOpen && !e.target.closest('#menu, #layoutsBtn')) toggleMenu(false); });

// ---------- start screen ----------
const pick = new Set();
let pickPreset = null;
function greeting() { const hr = new Date().getHours(); return hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; }
function renderHome() {
  const el = $('#home');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `
      <div class="home-inner">
        <div class="hello"><span class="mark">${svg(MARK, MARK_VB, 'none')}</span><div><h1></h1><p>Pick what you need for class. You can rearrange everything later.</p></div></div>
        <div class="picker" role="group" aria-label="Apps to open"></div>
        <div class="arrange"><span class="lbl">Arrange as</span><div class="presets" role="radiogroup" aria-label="Layout"></div></div>
        <div class="cta"><button class="btn primary big" id="openBtn"></button><button class="btn big" id="restoreBtn">Restore last workspace</button><button class="btn big" id="backBtn">Back to workspace</button></div>
        <dl class="keys">
          <div><dt><kbd>Ctrl</kbd><kbd>1</kbd>–<kbd>5</kbd></dt><dd>Open or focus an app</dd></div>
          <div><dt><kbd>Ctrl</kbd><kbd>W</kbd></dt><dd>Close pane</dd></div>
          <div><dt><kbd>Ctrl</kbd><kbd>M</kbd></dt><dd>Zoom pane</dd></div>
          <div><dt><kbd>Ctrl</kbd><kbd>Tab</kbd></dt><dd>Next pane</dd></div>
          <div><dt><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>O</kbd></dt><dd>Pop out / dock back</dd></div>
          <div><dt><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>F</kbd></dt><dd>Tiled ↔ free-floating</dd></div>
          <div><dt><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>L</kbd></dt><dd>Next layout</dd></div>
          <div><dt>Drag a pane’s title</dt><dd>Edge to split, centre to swap</dd></div>
        </dl>
      </div>`;
    SV.forEach((svc, i) => {
      const b = h('button', { class: 'pick', 'aria-pressed': 'false' }, `<span class="tile">${svg(ICONS[svc.id] || '')}</span><span class="nm"></span><span class="k">Ctrl ${i + 1}</span><span class="tick">${svg(S16('M3.5 8.5l3 3 6-7'), '0 0 16 16', 'none')}</span>`);
      b.style.setProperty('--svc', svc.color);
      $('.nm', b).textContent = svc.name;
      b.onclick = () => { if (pick.has(svc.id)) pick.delete(svc.id); else pick.add(svc.id); pickPreset = null; renderHome(); };
      b.ondblclick = () => { pick.clear(); pick.add(svc.id); openPicked(); };
      b.dataset.id = svc.id;
      $('.picker', el).append(b);
    });
    $('#openBtn', el).onclick = openPicked;
    $('#restoreBtn', el).onclick = restoreLast;
    $('#backBtn', el).onclick = () => { homeOpen = false; render(); };
    if (!pick.size) (last?.alive?.length ? last.alive : visible().length ? visible() : ['ebwise', 'teams']).filter((id) => BY[id]).forEach((id) => pick.add(id));
  }
  $('h1', el).textContent = greeting();
  el.querySelectorAll('.pick').forEach((b) => b.setAttribute('aria-pressed', String(pick.has(b.dataset.id))));
  const n = pick.size;
  const fits = PRESETS.filter((p) => p.n === n);
  if (!fits.some((p) => p.id === pickPreset)) pickPreset = DEFAULT_PRESET[n] || null;
  $('.arrange', el).hidden = fits.length < 2;
  $('.presets', el).innerHTML = fits.map((p) => `<button class="preset" role="radio" aria-checked="${p.id === pickPreset}" data-p="${p.id}">${presetThumb(p)}<span>${p.name}</span></button>`).join('');
  el.querySelectorAll('.presets [data-p]').forEach((b) => (b.onclick = () => { pickPreset = b.dataset.p; renderHome(); }));
  const ob = $('#openBtn', el);
  ob.disabled = !n;
  ob.textContent = n ? `Open ${n === 1 ? BY[[...pick][0]].name : `${n} apps`}` : 'Pick at least one app';
  const hasPanes = visible().length > 0;
  $('#restoreBtn', el).hidden = hasPanes || !last || !(last.alive || []).some((id) => BY[id]);
  $('#backBtn', el).hidden = !hasPanes;
}
function openPicked() {
  const ids = SV.map((s) => s.id).filter((id) => pick.has(id));
  if (!ids.length) return;
  const p = PRESETS.find((x) => x.id === pickPreset) || PRESETS.find((x) => x.id === DEFAULT_PRESET[ids.length]);
  // keep the user's picks, put the previously focused one in the main slot
  const order = uniq([...(ids.includes(L.focused) ? [L.focused] : []), ...ids]);
  homeOpen = false;
  L.mode = 'tile'; L.zoomed = null;
  L.tile = p.build(order);
  L.alive = uniq([...order, ...L.alive]);
  L.popped = L.popped.filter((id) => !order.includes(id));
  L.focused = order[0];
  commit();
}
function restoreLast() {
  if (!last) return;
  homeOpen = false;
  let tile = last.tile;
  for (const id of L.popped) tile = removeLeaf(tile, id);
  Object.assign(L, { mode: last.mode === 'free' ? 'free' : 'tile', tile, free: (last.free || []).filter((p) => !L.popped.includes(p.id)), zoomed: null });
  L.alive = uniq([...(last.alive || []).filter((id) => BY[id]), ...L.alive]);
  commit();
}

// ---------- actions ----------
function focusPane(id) {
  if (L.focused === id && (L.mode !== 'free' || L.free.at(-1)?.id === id)) return;
  L.focused = id;
  if (L.mode === 'free') { const i = L.free.findIndex((p) => p.id === id); if (i >= 0) L.free.push(...L.free.splice(i, 1)); }
  commit();
}
function openPane(id, at) {
  if (!BY[id]) return;
  homeOpen = false;
  if (L.popped.includes(id)) { hub.focusView(id); return; }
  if (visible().includes(id)) { if (L.zoomed && L.zoomed !== id) L.zoomed = id; focusPane(id); hub.focusView(id); render(); return; }
  L.zoomed = null;
  if (L.mode === 'tile') {
    const target = visible().includes(L.focused) ? L.focused : visible().at(-1);
    const r = R[target];
    L.tile = target ? insertAt(L.tile, target, id, r && r.w < r.h * 1.1 ? 'bottom' : 'right') : leaf(id);
  } else {
    const W = stage.clientWidth || 1; const Hh = stage.clientHeight || 1;
    const base = L.free.find((p) => p.id === L.focused);
    const x = at ? ((at.x - 120) / W) * 100 : base ? base.x + 3 : 6 + L.free.length * 3;
    const y = at ? ((at.y - 14) / Hh) * 100 : base ? base.y + 4 : 6 + L.free.length * 4;
    L.free.push({ id, x: clamp(x, 0, 60), y: clamp(y, 0, 60), w: 46, h: 62 });
  }
  L.alive = uniq([...L.alive, id]);
  L.focused = id;
  commit();
  hub.focusView(id);
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
  L.alive = L.alive.filter((x) => x !== id); // re-added by openPane
  openPane(id);
}
function toggleZoom(id = L.focused) {
  if (!id || !visible().includes(id)) return;
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
  const order = uniq([...visible(), ...L.alive.filter((id) => !L.popped.includes(id)), ...SV.map((s) => s.id)]).slice(0, p.n);
  homeOpen = false;
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
  const min = Math.min(MIN_TILE / total, pair / 2 - 0.001);
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
  if (e.button !== 0 || e.target.closest('.hbtn')) return;
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
      ghost.innerHTML = `${svg(ICONS[id] || '')}<span></span>`; $('span', ghost).textContent = BY[id].name;
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
  if (L.popped.includes(id) || (visible().includes(id) && (hit.kind === 'free' || hit.kind === 'empty'))) { render(); return; } // popped panes come back with Ctrl+Shift+O or by closing their window
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
  }
  L.tile = normalize(t);
  L.alive = uniq([...L.alive, id]);
  L.focused = id;
  commit();
  hub.focusView(id);
}

// ---------- main → UI ----------
hub.onStatus(({ id, status: st, ...info }) => {
  if (!BY[id]) return;
  const was = blocked(id);
  status[id] = st; statusInfo[id] = info;
  renderStatus(id);
  updateSidebar();
  if (was !== blocked(id)) queueBounds();
});
hub.onUnread(({ id, n }) => { if (BY[id]) { unread[id] = n; updateSidebar(); } });
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
  else if (name === 'home') { homeOpen = !homeOpen || !visible().length; render(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (menuOpen) toggleMenu(false);
  else if (homeOpen && visible().length) { homeOpen = false; render(); }
});
window.addEventListener('online', () => { hub.retryFailed(); for (const id of Object.keys(status)) if (status[id] === 'error') renderStatus(id); });
window.addEventListener('offline', () => { for (const id of Object.keys(status)) if (status[id] === 'error') renderStatus(id); });
new ResizeObserver(() => render()).observe(stage);

hub.init().then((s) => {
  SV = s.services; BY = Object.fromEntries(SV.map((x) => [x.id, x]));
  Object.assign(L, s.layout); last = s.last;
  Object.assign(status, s.status); Object.assign(unread, s.unread);
  buildSidebar();
  commit(); // also re-opens popped-out windows
}).catch((e) => {
  document.body.innerHTML = `<div class="fatal"><h1>WakeUp couldn’t start its layout</h1><p></p><p>Quit from the tray and open it again. Details are in ~/.config/WakeUp/logs.</p></div>`;
  $('.fatal p').textContent = String(e && e.message || e);
});
