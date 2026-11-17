'use strict';
/* global hub, $, h, esc, btnSvg, BY, DL, status, statusInfo, visible, renderStatus, openPane */
/* eslint-disable no-unused-vars */
// Notices: one clear place for what's happening. Progress (downloads, signing in), results (saved, copied, downloaded)
// and errors (with what to do next). They live at the bottom of the sidebar, which web pages never cover.
// Progress updates in place, successes fade after a few seconds, errors stay until you close them.

const NOTICES = new Map(); // id -> {id, kind, title, detail, progress, actions, pane, ts}
const NOTICE_ICON = { info: 'info', success: 'check', error: 'warn', progress: 'download', busy: 'reload' };
const NOTICE_LIFE = { success: 4500, info: 6000 };
let noticeSeq = 0;

// showNotice({ id?, kind: 'info'|'success'|'error'|'progress'|'busy', title, detail?, progress? 0..1, actions? [{label, run}], pane? })
function showNotice(n) {
  const id = n.id || `n${++noticeSeq}`;
  const prev = NOTICES.get(id);
  clearTimeout(prev?.timer);
  const next = { ...prev, ...n, id, ts: Date.now() };
  NOTICES.set(id, next);
  if (NOTICE_LIFE[next.kind]) next.timer = setTimeout(() => dismissNotice(id), NOTICE_LIFE[next.kind]);
  drawNotices();
  if (next.pane && BY[next.pane]) renderStatus(next.pane);
  return id;
}
function dismissNotice(id) {
  const n = NOTICES.get(id); if (!n) return;
  clearTimeout(n.timer); NOTICES.delete(id); drawNotices();
  if (n.pane && BY[n.pane]) renderStatus(n.pane);
}
const paneNotice = (id) => [...NOTICES.values()].reverse().find((n) => n.pane === id && (n.kind === 'busy' || n.kind === 'progress' || n.kind === 'error'));

function drawNotices() {
  const box = $('#notices'); if (!box) return;
  const list = [...NOTICES.values()].sort((a, b) => (a.kind === 'error') - (b.kind === 'error') || a.ts - b.ts).slice(-4); // newest at the bottom, errors last
  box.hidden = !list.length;
  box.replaceChildren(...list.map((n) => {
    const el = h('div', { class: `notice ${n.kind}`, role: n.kind === 'error' ? 'alert' : 'status', title: [n.title, n.detail].filter(Boolean).join('\n') },
      `<span class="n-ico${n.kind === 'busy' ? ' spin' : ''}">${btnSvg(NOTICE_ICON[n.kind] || 'info')}</span>
       <div class="n-main"><div class="n-title"></div>${n.detail ? '<div class="n-detail"></div>' : ''}
         ${n.progress != null ? `<div class="n-bar${n.progress < 0 ? ' indeterminate' : ''}"><i></i></div>` : ''}
         ${n.actions?.length ? `<div class="n-acts">${n.actions.map((a, i) => `<button class="link" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>
       <button class="n-x" aria-label="Dismiss">${btnSvg('close')}</button>`);
    $('.n-title', el).textContent = n.title;
    if (n.detail) $('.n-detail', el).textContent = n.detail;
    const bar = $('.n-bar i', el); if (bar && n.progress >= 0) bar.style.width = `${Math.round(n.progress * 100)}%`;
    el.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { n.actions[Number(b.dataset.i)].run(); if (!n.actions[Number(b.dataset.i)].keep) dismissNotice(n.id); }));
    $('.n-x', el).onclick = () => dismissNotice(n.id);
    return el;
  }));
}

// ---------- sources ----------
// main: signing in, clipboard, import/export, anything else it wants you to know
hub.onNotice?.((n) => { if (n.dismiss) dismissNotice(n.dismiss); else showNotice(n); });

// downloads: progress while they run, then the result with what you can do next
const dlSeen = new Map();
hub.onDownload((d) => {
  const id = `dl:${d.id}`;
  if (d.removed) { dismissNotice(id); return; }
  const cur = { ...DL.get(d.id), ...d };
  const was = dlSeen.get(d.id); dlSeen.set(d.id, cur.state);
  if (cur.state === 'progressing' || cur.state === 'paused') {
    showNotice({ id, kind: 'progress', title: `${cur.state === 'paused' ? 'Paused' : 'Downloading'} ${cur.name || 'a file'}`,
      detail: cur.total ? `${Math.round((100 * cur.received) / cur.total)}% of ${(cur.total / 1048576).toFixed(1)} MB` : 'Starting…',
      progress: cur.total ? cur.received / cur.total : -1, actions: [{ label: 'Cancel', run: () => hub.download(d.id, 'cancel') }] });
  } else if (cur.state === 'completed' && was && was !== 'completed') {
    showNotice({ id, kind: 'success', title: `Downloaded ${cur.name}`, detail: 'Saved to your downloads folder.',
      actions: [...(cur.viewable ? [{ label: 'View', run: () => hub.viewDownload(d.id, 'beside') }] : [{ label: 'Open', run: () => hub.download(d.id, 'open') }]), { label: 'Show in folder', run: () => hub.download(d.id, 'show') }] });
  } else if (cur.state === 'interrupted' && was !== 'interrupted') {
    showNotice({ id, kind: 'error', title: `${cur.name || 'A download'} didn’t finish`, detail: 'The connection dropped or the file moved on the server.', actions: [{ label: 'Try again', run: () => hub.download(d.id, 'retry') }] });
  } else if (cur.state === 'cancelled') dismissNotice(id);
});

// apps that fail while you're looking elsewhere (the pane itself explains it when it's on screen)
hub.onStatus(({ id, status: st }) => {
  const nid = `app:${id}`; const name = BY[id]?.name || 'An app';
  if (st === 'crashed' || st === 'error' || st === 'hung') {
    if (visible().includes(id)) return;
    showNotice({ id: nid, kind: 'error', title: st === 'hung' ? `${name} isn’t responding` : st === 'crashed' ? `${name} stopped working` : `${name} couldn’t load`,
      detail: st === 'error' ? 'It will retry by itself when it can.' : 'Reloading usually fixes it. You stay signed in.', actions: [{ label: 'Reload', run: () => hub.retry(id) }, { label: 'Show', run: () => openPane(id) }] });
  } else if (st === 'ready') dismissNotice(nid);
});

// the network
const offlineNotice = () => showNotice({ id: 'net', kind: 'error', title: 'You’re offline', detail: 'Your apps will reload by themselves when the connection is back.' });
window.addEventListener('offline', offlineNotice);
window.addEventListener('online', () => showNotice({ id: 'net', kind: 'success', title: 'Back online', detail: 'Reloading anything that didn’t load.' }));
if (!navigator.onLine) setTimeout(offlineNotice, 500);
