'use strict';
/* global hub */
/* eslint-disable no-unused-vars */
// Helpers shared by the main window (index.html) and pop-out windows (pop.html).

// ---------- icons: 24px filled app glyphs, 16px stroked buttons ----------
const ICONS = {
  ebwise: '<path d="M12 4 2 9l10 5 8-4v6h2V9z"/><path d="M6 12.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.5l-6 3z"/>',
  mail: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zm2 .8v.3l7 4.6 7-4.6v-.3zm0 2.7V17h14v-7l-7 4.6z"/>',
  calendar: '<path d="M7 2h2v2h6V2h2v2h2.5A1.5 1.5 0 0 1 21 5.5v14a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-14A1.5 1.5 0 0 1 4.5 4H7zM5 9v10h14V9zm2 2h3v3H7z"/>',
  todo: '<path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L21.1 7.4 19.7 6z"/>',
  teams: '<circle cx="9" cy="7.5" r="3"/><circle cx="17" cy="8.5" r="2.2"/><path d="M3 18c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5v1H3zm13.5-4.3c2.6.2 4.5 1.9 4.5 4.3v1h-4.5v-1c0-1.6-.6-3.1-1.6-4.2.5-.1 1-.1 1.6-.1z"/>',
  timetable: '<path fill-rule="evenodd" d="M7 2h2v2h6V2h2v2h2.5A1.5 1.5 0 0 1 21 5.5v14a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-14A1.5 1.5 0 0 1 4.5 4H7zM5 9v10h14V9z"/><rect x="6.5" y="10.5" width="5" height="3.5" rx="1"/><rect x="12.5" y="10.5" width="5" height="3.5" rx="1"/><rect x="6.5" y="15" width="5" height="2.5" rx="1"/>',
  tasks: '<path d="M3.3 6.2 4.7 4.8 6 6.1l2.8-2.8 1.4 1.4L6 8.9zM12 5h9v2h-9zM3.3 12.7l1.4-1.4L6 12.6l2.8-2.8 1.4 1.4L6 15.4zM12 11.5h9v2h-9zM4.5 17h3.5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1zM12 18h9v2h-9z"/>',
  file: '<path fill-rule="evenodd" d="M6.5 2H14l5 5v13.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20.5v-17A1.5 1.5 0 0 1 6.5 2zM13 3.5V8h4.5zM8 12h8v1.6H8zm0 3.5h8v1.6H8z"/>',
  image: '<path fill-rule="evenodd" d="M4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-13A1.5 1.5 0 0 1 4.5 4zM5 6v10.5l4.5-5 3 3.5 2-2.3 4.5 4.8V6zm11 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/>',
};
const S16 = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
const BTN = {
  back: S16('M10 3 5 8l5 5'),
  forward: S16('M6 3l5 5-5 5'),
  reload: S16('M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3'),
  // open in browser = a globe; pop out = an arrow leaving its box; split = two columns
  external: S16('M8 2.3a5.7 5.7 0 1 0 0 11.4A5.7 5.7 0 0 0 8 2.3zM2.5 8h11M8 2.3C6.5 4 5.8 5.9 5.8 8s.7 4 2.2 5.7M8 2.3c1.5 1.7 2.2 3.6 2.2 5.7s-.7 4-2.2 5.7'),
  popout: S16('M9 2.5h4.5V7M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3'),
  split: S16('M3.5 3h9a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3zM8 3v10'),
  openwith: S16('M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5'),
  folder: S16('M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z'),
  zoom: S16('M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3'),
  unzoom: S16('M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3'),
  close: S16('M4.5 4.5l7 7M11.5 4.5l-7 7'),
  tile: S16('M2.5 3.5h11v9h-11zM8 3.5v9M8 8h5.5'),
  free: S16('M2.5 2.5h7v6h-7zM6.5 7.5h7v6h-7z'),
  layouts: S16('M2.5 3h11v10h-11zM7 3v10M7 8h6.5'),
  warn: S16('M8 2.5 14 13H2zM8 6.5v3M8 11.3v.2'),
  offline: S16('M2 6a9 9 0 0 1 12 0M4.3 8.5a5.5 5.5 0 0 1 7.4 0M6.6 11a2 2 0 0 1 2.8 0M2.5 2.5l11 11'),
  pause: S16('M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3l2 1.5'),
  download: S16('M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10'),
  settings: '<g transform="scale(.6667)" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></g>', // a cog (Lucide, ISC licence)
  crop: S16('M4 1.5v9.5a1 1 0 0 0 1 1h9.5M1.5 4H11a1 1 0 0 1 1 1v9.5'),
  info: S16('M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 7.3v3.4M8 5.2v.1'),
  ai: S16('M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4zM12.5 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z'),
  cal: S16('M4 3.5h8A1.5 1.5 0 0 1 13.5 5v7a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5zM2.5 6.5h11M5.5 2v3M10.5 2v3'),
  home: S16('M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5z'),
  users: S16('M8 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3.5 13.5c0-2.5 2-4.2 4.5-4.2s4.5 1.7 4.5 4.2'),
  ban: S16('M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM4.2 4.2l7.6 7.6'),
  move: S16('M2.5 8h9M8.5 4.5 12 8l-3.5 3.5M13.5 3v10'),
  undo: S16('M5.5 4 2.5 7l3 3M2.5 7h7a3.5 3.5 0 0 1 0 7H8'),
  sidebar: S16('M3.5 3h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3zM6 3v10'),
  camera: S16('M2.5 5.5h2.6l1-1.6h3.8l1 1.6h2.6v7h-11zM8 7.2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'),
  search: S16('M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3l3.2 3.2'),
  plus: S16('M8 3v10M3 8h10'),
  check: S16('M3.5 8.5l3 3 6-7'),
  more: S16('M3.5 8h.01M8 8h.01M12.5 8h.01'),
  edit: S16('M10.5 3.5l2 2L6 12H4v-2zM9 5l2 2'),
  trash: S16('M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5'),
  link: S16('M6.8 9.2l2.4-2.4M7.6 4.6l1-1a2.6 2.6 0 0 1 3.8 3.8l-1 1M8.4 11.4l-1 1a2.6 2.6 0 0 1-3.8-3.8l1-1'),
  pin: S16('M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14zM8 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z'),
  clock: S16('M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3l2 1.5'),
  video: S16('M2.5 4.5h7.5v7h-7.5zM10 7l3.5-2v6L10 9'),
  chevL: S16('M10 3 5 8l5 5'),
  chevR: S16('M6 3l5 5-5 5'),
  help: S16('M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM6.3 6.4a1.8 1.8 0 0 1 3.5.5c0 1.2-1.8 1.5-1.8 2.6M8 11.4v.1'),
};
// WakeUp mark: the app icon's looping W + sparks (1024 grid, cropped by MARK_VB).
const MARK = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path stroke-width="74" d="M282 372C298 540 336 690 398 690C452 690 470 572 492 520C506 486 536 470 552 492C568 516 546 546 520 534C500 524 506 486 532 488C566 560 572 690 628 690C690 690 716 540 732 372"/><path stroke-width="56" d="M722 236L742 184M790 278L834 246M818 350L870 340"/></g>';
const MARK_VB = '230 140 690 600';
const svg = (body, vb = '0 0 24 24', fill = 'currentColor') => `<svg viewBox="${vb}" fill="${fill}" aria-hidden="true">${body}</svg>`;
const btnSvg = (k) => svg(BTN[k], '0 0 16 16', 'none');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// App glyph: built-in icon, a document/image icon, a custom app's favicon, or its first letter.
function glyph(svc) {
  if (svc.kind === 'file') return svg(ICONS[/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(svc.name) ? 'image' : 'file']);
  if (ICONS[svc.id]) return svg(ICONS[svc.id]);
  if (svc.icon) return `<img class="fav" src="${esc(svc.icon)}" alt="">`;
  return `<span class="letter">${esc((svc.name.trim()[0] || '?').toUpperCase())}</span>`;
}
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, html = '') => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v === true) el.setAttribute(k, ''); else if (v != null && v !== false) el.setAttribute(k, v); } el.innerHTML = html; return el; };
// The UI is sized in rem and the root font size follows the window (see ui.css), so JS-drawn sizes scale the same way.
const scaled = (px) => Math.round((px * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 13)) / 13);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uniq = (a) => [...new Set(a)];
const sum = (a) => a.reduce((x, y) => x + y, 0);
const store = { // per-window conveniences (dismissed tips); never required for anything to work
  get(k) { try { return JSON.parse(localStorage.getItem(`wakeup.${k}`)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`wakeup.${k}`, JSON.stringify(v)); } catch { /* private storage: fine */ } },
};
// CSP forbids inline style attributes; markup marks colour holders with data-c and this applies them.
function paint(root) { for (const el of root.querySelectorAll('[data-c]')) el.style.setProperty('--c', el.dataset.c); }

// ---------- timetable + tasks data, shared by every view in this window ----------
let PL = { semester: { name: '', start: null, end: null, breaks: [] }, classes: [], changes: [], tasks: [] };
let WEEK_START = 1;
let LABEL_MODE = 'code'; // how classes are named: 'code', 'name' or 'both' (Settings → Timetable)
const plannerListeners = new Set();
function plannerUpdated(p) { if (p) PL = p; for (const f of plannerListeners) f(); }
function savePlanner(patch) { // optimistic: draw now, then adopt main's validated copy
  PL = { ...PL, ...patch }; plannerUpdated();
  return hub.setPlanner(patch).then(plannerUpdated).catch((e) => {
    console.error('not saved', e);
    globalThis.showNotice?.({ id: 'planner-save', kind: 'error', title: 'Your timetable or tasks didn’t save', detail: 'Your last change may be lost if WakeUp closes. Try it again.' });
  });
}
const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const KIND = { lecture: 'Lecture', tutorial: 'Tutorial', lab: 'Lab' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s, long = false) => { const d = Planner.parse(s); return `${(long ? DAYS_LONG : DAYS)[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fmtTime = (hm) => { const [hh, mm] = hm.split(':').map(Number); return `${((hh + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${hh < 12 ? 'am' : 'pm'}`; };
// The main label for a class. 'both' shows the code here and the name as classSub() beside or under it.
const classLabel = (c) => (LABEL_MODE === 'name' ? c.name || c.code : c.code || c.name);
const classSub = (c) => (LABEL_MODE === 'both' && c.code && c.name && c.name !== c.code ? c.name : '');
// code and name together where there's room (tooltips, task chips, pickers): "CSP1123 · Mini IT Project"
const classFull = (c) => (LABEL_MODE === 'both' && c.code && c.name && c.name !== c.code ? `${c.code} · ${c.name}` : classLabel(c));
// class icons: 16px line icons, drawn in the class colour (keys validated in planner-core)
const CLASS_ICON = {
  code: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13',
  sigma: 'M12 3H4l4.5 5L4 13h8',
  flask: 'M6 2.5h4M6.5 2.5v4L3 12.5a1 1 0 0 0 .9 1.5h8.2a1 1 0 0 0 .9-1.5L9.5 6.5v-4M4.8 10h6.4',
  chart: 'M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5',
  book: 'M3 3.5A1 1 0 0 1 4 2.5h8.5v9H4a1 1 0 0 0-1 1zM3 12.5a1 1 0 0 0 1 1h8.5v-2',
  cpu: 'M5 4h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM6.5 6.5h3v3h-3zM6 2v2M10 2v2M6 12v2M10 12v2M2 6h2M2 10h2M12 6h2M12 10h2',
  brief: 'M3.2 5h9.6A1.2 1.2 0 0 1 14 6.2v6.1a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 12.3V6.2A1.2 1.2 0 0 1 3.2 5zM5.5 5V3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V5M2 9h12',
  pen: 'M10.5 2.5l3 3-7.5 7.5H3v-3z',
  globe: 'M8 2.3a5.7 5.7 0 1 0 0 11.4A5.7 5.7 0 0 0 8 2.3zM2.5 8h11M8 2.3C6.5 4 5.8 5.9 5.8 8s.7 4 2.2 5.7M8 2.3c1.5 1.7 2.2 3.6 2.2 5.7s-.7 4-2.2 5.7',
  chat: 'M3.5 3h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11h-.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
  db: 'M3 4c0-1 2.2-1.8 5-1.8s5 .8 5 1.8-2.2 1.8-5 1.8S3 5 3 4zM3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8',
  music: 'M6 12V3.5l7-1.5v8.5M3 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM10 10.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z',
  palette: 'M8 2.5a5.5 5.5 0 0 0 0 11c.8 0 1.2-.5 1.2-1.1 0-.7-.5-1-.5-1.6 0-.6.5-1 1.1-1h1.4a2.3 2.3 0 0 0 2.3-2.3C13.5 4.6 11 2.5 8 2.5zM5 7.5h.01M6.5 5h.01M9.5 5h.01',
  scale: 'M8 2.5v11M5 13.5h6M3.5 5h9M3.5 5 2 9h3zM12.5 5 11 9h3z',
};
const classSvg = (k) => svg(S16(CLASS_ICON[k]), '0 0 16 16', 'none');
const emptyArt = (k) => `<div class="empty-art" aria-hidden="true">${btnSvg(k)}</div>`;
const classIcon = (c) => (CLASS_ICON[c.icon] ? classSvg(c.icon) : `<span class="letter">${esc(classLabel(c).trim()[0]?.toUpperCase() || '?')}</span>`);
const taskBadge = () => { const t = Planner.today(); return PL.tasks.filter((x) => ['overdue', 'today'].includes(Planner.bucket(x, t))).length; };
