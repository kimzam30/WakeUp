'use strict';
/* global hub */
const GAP = 8;
const HEADER = 32;
const ICONS = {
  ebwise: '<path d="M12 4 2 9l10 5 8-4v6h2V9z"/><path d="M6 12.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.5l-6 3z"/>',
  mail: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zm2 .8v.3l7 4.6 7-4.6v-.3zm0 2.7V17h14v-7l-7 4.6z"/>',
  calendar: '<path d="M7 2h2v2h6V2h2v2h2.5A1.5 1.5 0 0 1 21 5.5v14a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-14A1.5 1.5 0 0 1 4.5 4H7zM5 9v10h14V9zm2 2h3v3H7z"/>',
  todo: '<path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L21.1 7.4 19.7 6z"/>',
  teams: '<circle cx="9" cy="7.5" r="3"/><circle cx="17" cy="8.5" r="2.2"/><path d="M3 18c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5v1H3zm13.5-4.3c2.6.2 4.5 1.9 4.5 4.3v1h-4.5v-1c0-1.6-.6-3.1-1.6-4.2.5-.1 1-.1 1.6-.1z"/>',
};
const LAYOUT_ICONS = {
  single: '<rect x="1" y="1" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  cols2: '<rect x="1" y="1" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 1v14" stroke="currentColor" stroke-width="1.6"/>',
  cols3: '<rect x="1" y="1" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.7 1v14M14.3 1v14" stroke="currentColor" stroke-width="1.6"/>',
  grid: '<rect x="1" y="1" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 1v14M1 8h20" stroke="currentColor" stroke-width="1.6"/>',
};
const LAYOUT_NAMES = { single: 'Single', cols2: 'Two columns', cols3: 'Three columns', grid: 'Grid 2×2' };
const BTN = {
  back: '<path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  reload: '<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  external: '<path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  max: '<path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  min: '<path d="M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="currentColor" aria-hidden="true">${body}</svg>`;
const $ = (s) => document.querySelector(s);
let S = null;

function sizesFor(layout) {
  const s = S.sizes || {};
  if (layout === 'cols2') return Array.isArray(s.cols2) ? s.cols2 : [50];
  if (layout === 'cols3') return Array.isArray(s.cols3) ? s.cols3 : [33.3, 66.7];
  if (layout === 'grid') return s.grid && typeof s.grid.col === 'number' ? s.grid : { col: 50, row: 50 };
  return null;
}

// Returns pane rects (in stage px) and divider descriptors for the current layout.
function geometry(W, H) {
  const L = S.layout;
  const rects = []; const dividers = [];
  if (S.maximized != null) return { rects: { [S.maximized]: { x: GAP, y: GAP, w: W - 2 * GAP, h: H - 2 * GAP } }, dividers };
  if (L === 'single') rects[0] = { x: GAP, y: GAP, w: W - 2 * GAP, h: H - 2 * GAP };
  if (L === 'cols2' || L === 'cols3') {
    const cuts = [0, ...sizesFor(L), 100];
    for (let i = 0; i < cuts.length - 1; i++) {
      const x0 = (W * cuts[i]) / 100; const x1 = (W * cuts[i + 1]) / 100;
      rects[i] = { x: x0 + (i === 0 ? GAP : GAP / 2), y: GAP, w: x1 - x0 - (i === 0 || i === cuts.length - 2 ? GAP * 1.5 : GAP), h: H - 2 * GAP };
      if (i > 0) dividers.push({ dir: 'v', at: x0, index: i - 1 });
    }
  }
  if (L === 'grid') {
    const { col, row } = sizesFor('grid');
    const cx = (W * col) / 100; const cy = (H * row) / 100;
    rects[0] = { x: GAP, y: GAP, w: cx - GAP * 1.5, h: cy - GAP * 1.5 };
    rects[1] = { x: cx + GAP / 2, y: GAP, w: W - cx - GAP * 1.5, h: cy - GAP * 1.5 };
    rects[2] = { x: GAP, y: cy + GAP / 2, w: cx - GAP * 1.5, h: H - cy - GAP * 1.5 };
    rects[3] = { x: cx + GAP / 2, y: cy + GAP / 2, w: W - cx - GAP * 1.5, h: H - cy - GAP * 1.5 };
    dividers.push({ dir: 'v', at: cx, index: 'col' }, { dir: 'h', at: cy, index: 'row' });
  }
  return { rects, dividers };
}

function renderSidebar() {
  const visible = S.slots.slice(0, S.slotCount);
  $('#services').innerHTML = '';
  S.services.forEach((svc, i) => {
    const b = document.createElement('button');
    b.className = 'svc';
    b.style.background = svc.color;
    b.title = `${svc.name}  (Ctrl+${i + 1})`;
    b.setAttribute('aria-label', svc.name);
    b.draggable = true;
    b.innerHTML = svg(ICONS[svc.id] || '<circle cx="12" cy="12" r="6"/>');
    if (visible.includes(svc.id)) b.classList.add('visible');
    if (visible[S.focused] === svc.id) b.classList.add('focused');
    const n = S.unread[svc.id];
    if (n) b.insertAdjacentHTML('beforeend', `<span class="badge">${n > 99 ? '99+' : n}</span>`);
    b.onclick = () => {
      const at = visible.indexOf(svc.id);
      if (at >= 0) hub.focus(at); else hub.assign(S.focused, svc.id);
    };
    b.ondragstart = (e) => { e.dataTransfer.setData('text/service', svc.id); startDrag(); };
    b.ondragend = endDrag;
    $('#services').append(b);
  });
  $('#layouts').innerHTML = '';
  for (const l of Object.keys(LAYOUT_ICONS)) {
    const b = document.createElement('button');
    b.className = 'lay';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(S.layout === l));
    b.title = `${LAYOUT_NAMES[l]}  (Ctrl+Shift+L cycles)`;
    b.innerHTML = svg(LAYOUT_ICONS[l], '0 0 22 16');
    b.onclick = () => hub.layout(l);
    $('#layouts').append(b);
  }
}

function startDrag() { document.body.classList.add('dragging'); hub.dragging(true); }
function endDrag() { document.body.classList.remove('dragging'); document.querySelectorAll('.drop').forEach((n) => n.classList.remove('drop')); hub.dragging(false); }

function renderStage() {
  const stage = $('#stage');
  const W = stage.clientWidth; const H = stage.clientHeight;
  const { rects, dividers } = geometry(W, H);
  stage.innerHTML = '';
  const bounds = {};
  Object.entries(rects).forEach(([iStr, r]) => {
    const i = Number(iStr);
    const id = S.slots[i]; const svc = S.services.find((s) => s.id === id);
    if (!svc) return;
    const el = document.createElement('section');
    el.className = 'slot' + (i === S.focused ? ' focused' : '');
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    const maxed = S.maximized === i;
    el.innerHTML = `
      <header draggable="true" title="Drag onto another pane to swap">
        <span class="dot"></span>
        <span class="name">${svc.name}</span>
        <span class="key">${i + 1}</span>
        <button class="hbtn" data-a="back" title="Back" aria-label="Back">${svg(BTN.back, '0 0 16 16')}</button>
        <button class="hbtn" data-a="reload" title="Reload (Ctrl+R)" aria-label="Reload">${svg(BTN.reload, '0 0 16 16')}</button>
        <button class="hbtn" data-a="external" title="Open in browser" aria-label="Open in browser">${svg(BTN.external, '0 0 16 16')}</button>
        <button class="hbtn" data-a="max" title="${maxed ? 'Restore' : 'Maximise'} (Ctrl+M)" aria-label="${maxed ? 'Restore' : 'Maximise'}">${svg(maxed ? BTN.min : BTN.max, '0 0 16 16')}</button>
      </header>
      <div class="body"><span>Drop here</span></div>`;
    el.querySelector('.dot').style.background = svc.color;
    el.querySelectorAll('.hbtn').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        if (b.dataset.a === 'max') hub.maximize(i); else hub.nav(i, b.dataset.a);
      };
    });
    el.onmousedown = () => { if (i !== S.focused) hub.focus(i); };
    const header = el.querySelector('header');
    header.ondblclick = () => hub.maximize(i);
    header.ondragstart = (e) => { e.dataTransfer.setData('text/service', id); startDrag(); };
    header.ondragend = endDrag;
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('drop'); };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = (e) => { e.preventDefault(); const sid = e.dataTransfer.getData('text/service'); endDrag(); if (sid) hub.assign(i, sid); };
    stage.append(el);
    const body = el.querySelector('.body').getBoundingClientRect();
    bounds[i] = { x: body.left, y: body.top, width: body.width, height: body.height };
  });
  for (const d of dividers) addDivider(stage, d, W, H);
  if (!resizing) hub.bounds(bounds);
}
let resizing = false;

function addDivider(stage, d, W, H) {
  const el = document.createElement('div');
  el.className = `divider ${d.dir}`;
  if (d.dir === 'v') Object.assign(el.style, { left: `${d.at - 4}px`, top: '0', height: `${H}px` });
  else Object.assign(el.style, { top: `${d.at - 4}px`, left: '0', width: `${W}px` });
  el.onpointerdown = (e) => {
    el.setPointerCapture(e.pointerId);
    el.classList.add('active');
    resizing = true;
    hub.dragging(true);
    const box = stage.getBoundingClientRect();
    const move = (ev) => {
      const pct = d.dir === 'v' ? ((ev.clientX - box.left) / box.width) * 100 : ((ev.clientY - box.top) / box.height) * 100;
      const sizes = structuredClone(S.sizes || {});
      if (S.layout === 'grid') {
        sizes.grid = { ...sizesFor('grid'), [d.index]: clamp(pct, 20, 80) };
      } else {
        const arr = [...sizesFor(S.layout)];
        const lo = (arr[d.index - 1] ?? 0) + 15; const hi = (arr[d.index + 1] ?? 100) - 15;
        arr[d.index] = clamp(pct, lo, hi);
        sizes[S.layout] = arr;
      }
      S.sizes = sizes;
      renderStage();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      resizing = false;
      hub.sizes(S.sizes);
      hub.dragging(false);
      renderStage();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up, { once: true });
    el.addEventListener('pointercancel', up, { once: true });
  };
  stage.append(el);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

hub.onState((s) => { S = s; renderSidebar(); renderStage(); });
new ResizeObserver(() => { if (S) renderStage(); }).observe($('#stage'));
hub.ready();
