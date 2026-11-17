'use strict';
/* global $, $$, esc, glyph, btnSvg, svg, MARK, MARK_VB, SV, FILES, L, leaves, BY, openPane, showToday, toggleSettings, toggleDownloads, takeShot, popOut, openSplitMenu, closeOverlay, showOverlay, KEYS_HTML, visible */
/* eslint-disable no-unused-vars */
// Ctrl+K: jump to an app, a split, a file, Today, or run an action. Type to filter, arrows + Enter to go.

// label matches first (earlier match = better), then hint-only matches
const rank = (i, q) => { const n = i.label.toLowerCase().indexOf(q); return n < 0 ? 1000 : n; };
const splitTitle = (s) => leaves(s.tile).map((id) => BY[id]?.name || '').filter(Boolean).join(' + ');
function switcherItems() {
  const items = [{ k: 'today', label: 'Today', hint: 'Start screen', icon: svg(MARK, MARK_VB, 'none'), run: showToday }];
  for (const s of SV) items.push({ k: s.id, label: s.name, hint: s.kind === 'local' ? 'Built in' : 'App', icon: glyph(s), color: s.color, run: () => openPane(s.id) });
  L.splits.forEach((s) => items.push({ k: `split:${splitTitle(s)}`, label: splitTitle(s), hint: 'Split', icon: btnSvg('split'), run: () => openPane(s.focused) }));
  for (const f of FILES) items.push({ k: f.id, label: f.name, hint: 'Open file', icon: glyph(f), color: f.color, run: () => openPane(f.id) });
  const focused = L.focused && visible().includes(L.focused) ? BY[L.focused] : null;
  items.push(
    { k: 'shot-all', label: 'Take a screenshot of everything', hint: 'Ctrl+Shift+S', icon: btnSvg('camera'), run: () => takeShot('all') },
    { k: 'shot-area', label: 'Screenshot an area you select', hint: 'Action', icon: btnSvg('crop'), run: () => pickArea() },
    ...(focused ? [
      { k: 'shot-app', label: `Screenshot ${focused.name}`, hint: 'Action', icon: btnSvg('camera'), run: () => takeShot('app') },
      { k: 'split-with', label: `Split ${focused.name} with…`, hint: 'Action', icon: btnSvg('split'), run: () => openSplitMenu(focused.id) },
      { k: 'pop', label: `Pop out ${focused.name}`, hint: 'Ctrl+Shift+O', icon: btnSvg('popout'), run: () => popOut(focused.id) },
    ] : []),
    { k: 'downloads', label: 'Downloads', hint: 'Ctrl+J', icon: btnSvg('download'), run: () => toggleDownloads(true) },
    { k: 'settings', label: 'Settings', hint: 'Ctrl+,', icon: btnSvg('settings'), run: () => toggleSettings(true) },
    { k: 'help', label: 'Keyboard shortcuts', hint: 'Ctrl+/', icon: btnSvg('help'), run: openHelp },
  );
  return items;
}

function openSwitcher() {
  const items = switcherItems(); let sel = 0; let shown = items;
  const box = showOverlay(`<div class="switcher" role="dialog" aria-label="Jump to"><div class="sw-input">${btnSvg('search')}<input placeholder="Jump to an app, file or action…" aria-label="Search" spellcheck="false" autocomplete="off"><kbd>Esc</kbd></div><ul class="sw-list" role="listbox"></ul></div>`);
  const input = $('input', box); const list = $('.sw-list', box);
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = !q ? items : items.filter((i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q))
      .sort((a, b) => rank(a, q) - rank(b, q));
    sel = clampSel(sel);
    list.innerHTML = shown.length ? shown.map((i, n) => `<li role="option" aria-selected="${n === sel}" data-n="${n}"><span class="sw-ico"${i.color ? ` data-c="${esc(i.color)}"` : ''}>${i.icon}</span><span class="sw-label">${esc(i.label)}</span><span class="sw-hint">${esc(i.hint)}</span></li>`).join('') : '<li class="sw-none">Nothing matches.</li>';
    for (const li of $$('[data-c]', list)) li.style.setProperty('--c', li.dataset.c);
    $('[aria-selected="true"]', list)?.scrollIntoView({ block: 'nearest' });
  };
  const clampSel = (n) => Math.max(0, Math.min(shown.length - 1, n));
  const go = (n) => { const i = shown[n]; if (!i) return; closeOverlay(); i.run(); };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = clampSel(sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = clampSel(sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-n]'); if (li) go(Number(li.dataset.n)); });
  list.addEventListener('pointermove', (e) => { const li = e.target.closest('[data-n]'); if (li && Number(li.dataset.n) !== sel) { sel = Number(li.dataset.n); draw(); } });
  draw(); input.focus();
}

function openHelp() {
  showOverlay(`<div class="help-sheet" role="dialog" aria-label="Keyboard shortcuts"><div class="ed-head"><h3>Keyboard shortcuts</h3><button class="hbtn" data-act="close-overlay" aria-label="Close">${btnSvg('close')}</button></div>${KEYS_HTML}</div>`);
}
