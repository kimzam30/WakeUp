'use strict';
/* global hub, $, h, svg, S16, btnSvg, esc, glyph, ALL, SV, SET, META, DL, render, commit, L, settingsOpen:writable, dlOpen:writable, menuOpen, toggleMenu, applyPayload, KEYS_HTML */
// Settings page (Ctrl+,) and Downloads panel (Ctrl+J). Every change goes to main, which validates,
// applies and sends the result back through applyPayload().

// ---------- settings ----------
const SECTIONS = [['general', 'General'], ['apps', 'Apps'], ['performance', 'Performance'], ['downloads', 'Downloads'], ['links', 'Links'], ['appearance', 'Appearance'], ['about', 'About']];
let setTab = 'general';
let appForm = null; // null | {id?, name, url, color, own, error}
let confirmRemove = null; // custom app id waiting for confirmation

function toggleSettings(open = !settingsOpen) {
  settingsOpen = open;
  if (open && dlOpen) toggleDownloads(false);
  if (open && menuOpen) toggleMenu(false);
  $('#settings').hidden = !open;
  if (open) { renderSettings(); $(`#settings .set-nav [data-tab="${setTab}"]`)?.focus(); }
  render();
}
async function save(patch) {
  try { applyPayload(await hub.setSettings(patch)); } catch (e) { console.error('settings not saved', e); }
}

const row = (title, desc, control = '') => `<div class="set-row"><div class="set-text"><div class="set-title">${title}</div>${desc ? `<div class="set-desc">${desc}</div>` : ''}</div>${control ? `<div class="set-ctl">${control}</div>` : ''}</div>`;
const sw = (k, on, label, disabled = false) => `<button class="switch" role="switch" aria-checked="${!!on}" data-k="${k}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}><span></span></button>`;
const seg = (k, val, opts, label) => `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${opts.map(([v, l]) => `<button role="radio" aria-checked="${String(v) === String(val)}" data-k="${k}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
const sel = (k, val, opts, label) => `<select data-k="${k}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const group = (title, body) => `<section class="set-group">${title ? `<h2>${title}</h2>` : ''}<div class="set-card">${body}</div></section>`;

function sectionHtml(tab) {
  const S = SET;
  if (tab === 'general') {
    return group('Starting up',
      row('Start at login', 'WakeUp opens hidden in the tray when you sign in to your computer.', sw('autostart', META.autostart, 'Start at login'))
      + row('Start hidden in the tray', 'Launch without showing the window. Click the tray icon to bring it up.', sw('startHidden', S.startHidden, 'Start hidden'))
      + row('At launch, open', 'Pick one app if you usually only need, say, Ebwise.', sel('launch', S.launch, [['last', 'My last workspace'], ['home', 'The start screen'], ...SV.map((s) => [s.id, `${s.name} only`])], 'At launch, open')))
      + group('Closing the window',
        row('When you close the window', S.onClose === 'tray' ? 'WakeUp keeps running in the tray, so mail and Teams notifications still arrive.' : S.onClose === 'minimize' ? 'The window goes to the dock instead of closing.' : 'WakeUp quits completely. You won’t get notifications until you open it again.',
          seg('onClose', S.onClose, [['tray', 'Keep in tray'], ['minimize', 'Minimise'], ['quit', 'Quit']], 'When you close the window')))
      + group('', row('Just one app', 'Right-click WakeUp in the dock and pick an app to open only that app. Everything else stays unloaded.'));
  }
  if (tab === 'apps') {
    const rows = ALL.map((s, i) => {
      if (confirmRemove === s.id) {
        return `<div class="app-row confirm" data-id="${esc(s.id)}"><span class="app-ico">${glyph(s)}</span><div class="app-name">Remove ${esc(s.name)}?</div>
          <div class="app-confirm"><button class="btn small danger" data-act="remove-yes">Remove</button>${s.own ? '<button class="btn small danger" data-act="remove-clear">Remove and sign out</button>' : ''}<button class="btn small" data-act="remove-no">Cancel</button></div></div>`;
      }
      return `<div class="app-row${s.hidden ? ' off' : ''}" data-id="${esc(s.id)}">
        <span class="app-ico">${glyph(s)}</span>
        <div class="app-name"><span>${esc(s.name)}</span>${s.custom ? `<small>${esc(new URL(s.url).host)}${s.own ? '' : ' · Microsoft 365 sign-in'}</small>` : ''}</div>
        ${sw(`show:${s.id}`, !s.hidden, `Show ${s.name}`, !s.hidden && SV.length === 1)}
        ${sw(`bg:${s.id}`, s.keepAlive, `Keep ${s.name} running`)}
        ${sw(`notify:${s.id}`, SET.notify[s.id] !== false, `${s.name} notifications`)}
        <div class="app-move">
          <button class="hbtn" data-act="up" aria-label="Move ${esc(s.name)} up" title="Move up"${i === 0 ? ' disabled' : ''}>${svg(S16('M4 10l4-4 4 4'), '0 0 16 16', 'none')}</button>
          <button class="hbtn" data-act="down" aria-label="Move ${esc(s.name)} down" title="Move down"${i === ALL.length - 1 ? ' disabled' : ''}>${svg(S16('M4 6l4 4 4-4'), '0 0 16 16', 'none')}</button>
          ${s.custom ? `<button class="hbtn" data-act="edit" aria-label="Edit ${esc(s.name)}" title="Edit">${svg(S16('M10.5 3.5l2 2L6 12H4v-2zM9 5l2 2'), '0 0 16 16', 'none')}</button><button class="hbtn del" data-act="remove" aria-label="Remove ${esc(s.name)}" title="Remove">${btnSvg('close')}</button>` : ''}
        </div></div>`;
    }).join('');
    const f = appForm;
    const form = f ? `<form class="app-form" novalidate>
        <div class="fields">
          <label><span>Name</span><input name="name" maxlength="32" placeholder="Notion" value="${esc(f.name)}" required></label>
          <label class="wide"><span>Web address</span><input name="url" type="url" placeholder="https://www.notion.so" value="${esc(f.url)}" required></label>
          <label class="color"><span>Colour</span><input name="color" type="color" value="${esc(f.color)}"></label>
        </div>
        <div class="set-row tight"><div class="set-text"><div class="set-title">Sign-in</div><div class="set-desc">${f.own ? 'This app keeps its own sign-in, separate from everything else.' : 'Uses the Microsoft 365 account you’re signed in with in Outlook and Teams.'}</div></div>
          <div class="set-ctl">${seg('form-own', f.own ? 'own' : 'm365', [['own', 'Separate'], ['m365', 'Microsoft 365']], 'Sign-in')}</div></div>
        <p class="form-error" role="alert">${esc(f.error || '')}</p>
        <div class="actions left"><button class="btn primary" type="submit">${f.id ? 'Save changes' : 'Add app'}</button><button class="btn" type="button" data-act="form-cancel">Cancel</button></div>
      </form>` : '<button class="btn" data-act="add">+ Add an app</button>';
    return `<section class="set-group"><h2>Your apps</h2><p class="set-lead">Hidden apps disappear from the sidebar and stop running. Order sets their <kbd>Ctrl</kbd> number.</p>
      <div class="set-card apps"><div class="app-row head" aria-hidden="true"><span></span><span></span><span>Show</span><span>Keep running</span><span>Notify</span><span></span></div>${rows}</div></section>
      <section class="set-group"><h2>Add your own</h2><p class="set-lead">Any website that works in a browser: Notion, ChatGPT, your MMU portal…</p><div class="set-card pad">${form}</div></section>`;
  }
  if (tab === 'performance') {
    return group('Memory',
      row('Sleep apps you can’t see after', 'They unload to free memory and reload where you left off when you open them. Apps set to “Keep running” never sleep.',
        sel('sleepMinutes', S.sleepMinutes, [[0, 'Never'], [5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour']], 'Sleep after'))
      + row('Count time in the tray', 'Apps also fall asleep while WakeUp is hidden or minimised.', sw('sleepWhenHidden', S.sleepWhenHidden, 'Count time in the tray', !S.sleepMinutes))
      + row('One Outlook for Mail and Calendar', 'Hides the separate Calendar app. Use the calendar button inside Outlook instead. Saves a whole copy of Outlook, about 200 MB.', sw('outlookOne', S.hidden.includes('calendar'), 'One Outlook for Mail and Calendar')));
  }
  if (tab === 'downloads') {
    const dir = S.downloadDir || META.defaultDownloadDir;
    return group('Saving files',
      row('Save files to', `<code class="path">${esc(dir)}</code>`, `<button class="btn small" data-act="pick-folder">Change…</button>${S.downloadDir ? '<button class="btn small" data-act="reset-folder">Use Downloads</button>' : ''}`)
      + row('Ask where to save each file', 'Otherwise files go straight to the folder above. “Save link as…” in the right-click menu always asks.', sw('askDownload', S.askDownload, 'Ask where to save'))
      + row('Open files when they finish', '', sw('openDownload', S.openDownload, 'Open files when they finish'))
      + row('Notify me when a download finishes', 'Click the notification to open the file.', sw('notifyDownload', S.notifyDownload && !S.openDownload, 'Notify when finished', S.openDownload)));
  }
  if (tab === 'links') {
    return group('Opening links',
      row('Links to other websites', 'Ctrl+click or middle-click a link to always open it in your browser.', seg('externalLinks', S.externalLinks, [['browser', 'My browser'], ['window', 'WakeUp window']], 'Links to other websites'))
      + row('Files and documents', 'Ebwise course files, SharePoint and OneDrive previews. A WakeUp window keeps you signed in; your browser may ask you to sign in again.', seg('docLinks', S.docLinks, [['window', 'WakeUp window'], ['browser', 'My browser']], 'Files and documents'))
      + row('Email addresses', 'Clicking an email address starts a new message in Outlook.')
      + row('Teams meeting links', 'Links to Teams meetings and chats open in the Teams app.'))
      + group('', row('Right-click menu', 'Right-click a link to open it in your browser or a WakeUp window, copy it, or save it. Right-click a misspelled word for suggestions.'));
  }
  if (tab === 'appearance') {
    return group('Look',
      row('Theme', '', seg('theme', S.theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], 'Theme'))
      + row('Page zoom', 'How big pages inside your apps appear.', sel('zoom', S.zoom, [80, 90, 100, 110, 125, 150].map((z) => [z, `${z}%`]), 'Page zoom'))
      + row('Compact sidebar', 'Smaller app icons for more room.', sw('compact', S.compact, 'Compact sidebar')));
  }
  return group('WakeUp',
    row(`Version ${esc(META.version || '')}`, 'Problems are written to a log file. Attach it if you report a bug.', '<button class="btn small" data-act="logs">Open log folder</button>')
    + row('Reset layout', 'Close every pane and go back to the start screen. “Restore last workspace” brings it back.', '<button class="btn small" data-act="reset-layout">Reset</button>'))
    + `<section class="set-group"><h2>Keyboard shortcuts</h2><div class="set-card pad">${KEYS_HTML}</div></section>`;
}

function renderSettings() {
  const el = $('#settings');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `<div class="set-wrap">
      <nav class="set-nav" aria-label="Settings sections"><h1>Settings</h1>${SECTIONS.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</nav>
      <div class="set-body"><button class="hbtn set-close" data-act="close" title="Close (Esc)" aria-label="Close settings">${btnSvg('close')}</button><div class="set-content"></div></div></div>`;
    el.addEventListener('click', onSettingsClick);
    el.addEventListener('change', onSettingsChange);
    el.addEventListener('submit', onAppSubmit);
    el.addEventListener('input', (e) => { if (appForm && e.target.name in appForm) appForm[e.target.name] = e.target.value; });
  }
  el.querySelectorAll('[data-tab]').forEach((b) => b.toggleAttribute('aria-current', b.dataset.tab === setTab));
  // keep keyboard focus on the same control across re-renders
  const a = document.activeElement; const key = a?.closest('#settings .set-content') ? (a.dataset.k ? `[data-k="${a.dataset.k}"]${a.dataset.v ? `[data-v="${a.dataset.v}"]` : ''}` : a.name ? `[name="${a.name}"]` : null) : null;
  $('.set-content', el).innerHTML = sectionHtml(setTab);
  el.querySelectorAll('.app-row[data-id] .app-ico').forEach((i) => i.style.setProperty('--svc', ALL.find((s) => s.id === i.parentElement.dataset.id)?.color || '#888'));
  if (key) $(`.set-content ${key}`, el)?.focus();
}

function moveApp(id, dir) {
  const order = ALL.map((s) => s.id); const i = order.indexOf(id); const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  save({ order });
}
function onSettingsClick(e) {
  const t = e.target.closest('button'); if (!t || t.disabled) return;
  if (t.dataset.tab) { setTab = t.dataset.tab; appForm = null; confirmRemove = null; renderSettings(); $('.set-body', $('#settings')).scrollTop = 0; return; }
  const k = t.dataset.k; const act = t.dataset.act;
  const id = t.closest('.app-row')?.dataset.id;
  if (k && t.getAttribute('role') === 'switch') {
    const on = t.getAttribute('aria-checked') !== 'true';
    const [kind, sid] = k.split(':');
    if (kind === 'autostart') save({ autostart: on });
    else if (kind === 'outlookOne') save({ hidden: on ? [...SET.hidden, 'calendar'] : SET.hidden.filter((x) => x !== 'calendar') });
    else if (kind === 'show') save({ hidden: on ? SET.hidden.filter((x) => x !== sid) : [...SET.hidden, sid] });
    else if (kind === 'bg') save({ keepAlive: { ...SET.keepAlive, [sid]: on } });
    else if (kind === 'notify') save({ notify: { ...SET.notify, [sid]: on } });
    else save({ [k]: on });
    return;
  }
  if (k && t.getAttribute('role') === 'radio') {
    if (k === 'form-own') { appForm.own = t.dataset.v === 'own'; renderSettings(); return; }
    save({ [k]: t.dataset.v });
    return;
  }
  if (act === 'close') toggleSettings(false);
  else if (act === 'up' || act === 'down') moveApp(id, act === 'up' ? -1 : 1);
  else if (act === 'add') { appForm = { name: '', url: '', color: '#5e6ad2', own: true, error: '' }; renderSettings(); $('#settings [name="name"]')?.focus(); }
  else if (act === 'edit') { const c = SET.customApps.find((x) => x.id === id); appForm = { ...c, orig: c.url, error: '' }; setTimeout(() => $('#settings [name="name"]')?.focus()); renderSettings(); }
  else if (act === 'form-cancel') { appForm = null; renderSettings(); }
  else if (act === 'remove') { confirmRemove = id; renderSettings(); $('#settings [data-act="remove-no"]')?.focus(); }
  else if (act === 'remove-no') { confirmRemove = null; renderSettings(); }
  else if (act === 'remove-yes' || act === 'remove-clear') {
    confirmRemove = null;
    if (appForm?.id === id) appForm = null;
    save({ customApps: SET.customApps.filter((c) => c.id !== id), order: SET.order.filter((x) => x !== id) }).then(() => { if (act === 'remove-clear') hub.clearAppData(id); });
  } else if (act === 'pick-folder') hub.pickFolder().then((dir) => { if (dir) save({ downloadDir: dir }); });
  else if (act === 'reset-folder') save({ downloadDir: '' });
  else if (act === 'logs') hub.app('logs');
  else if (act === 'reset-layout') { Object.assign(L, { tile: null, free: [], popped: [], alive: [], zoomed: null, focused: null }); toggleSettings(false); commit(); }
}
function onSettingsChange(e) {
  const t = e.target; const k = t.dataset?.k; if (!k || t.tagName !== 'SELECT') return;
  save({ [k]: k === 'sleepMinutes' || k === 'zoom' ? Number(t.value) : t.value });
}
function onAppSubmit(e) {
  e.preventDefault();
  const f = appForm; if (!f) return;
  const name = f.name.trim(); let url = f.url.trim();
  if (url && !/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
  let u = null; try { u = new URL(url); } catch { /* invalid */ }
  f.error = !name ? 'Give the app a name.' : !u || !u.hostname.includes('.') ? 'That doesn’t look like a web address. Try something like https://www.notion.so' : u.protocol !== 'https:' ? 'Only secure (https://) addresses can be added.' : '';
  if (f.error) { renderSettings(); return; }
  const entry = { id: f.id, name, url: u.href, color: f.color, own: f.own, icon: f.id && f.orig === u.href ? f.icon : null };
  const apps = f.id ? SET.customApps.map((c) => (c.id === f.id ? entry : c)) : [...SET.customApps, entry];
  appForm = null;
  save({ customApps: apps });
}

// ---------- downloads ----------
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ts).toLocaleDateString();
}
const dlList = () => [...DL.values()].sort((a, b) => b.ts - a.ts);
const activeDl = () => dlList().filter((d) => d.state === 'progressing' || d.state === 'paused');

function toggleDownloads(open = !dlOpen) {
  dlOpen = open;
  if (open && menuOpen) toggleMenu(false);
  if (open && settingsOpen) toggleSettings(false);
  $('#downloads').hidden = !open;
  $('#dlBtn')?.setAttribute('aria-expanded', String(open));
  if (open) { renderDownloads(); ($('#downloads .dl button') || $('#downloads button'))?.focus(); }
  render();
}
function renderDlButton() {
  const b = $('#dlBtn'); if (!b) return;
  const act = activeDl();
  const total = act.reduce((a, d) => a + (d.total || 0), 0); const got = act.reduce((a, d) => a + d.received, 0);
  b.classList.toggle('busy', act.length > 0);
  b.style.setProperty('--p', total ? String(got / total) : '0.15');
  const badge = $('.badge', b); badge.hidden = !act.length; badge.textContent = String(act.length);
  b.title = act.length ? `Downloading ${act.length} file${act.length > 1 ? 's' : ''} (Ctrl+J)` : 'Downloads (Ctrl+J)';
}
function renderDownloads() {
  renderDlButton();
  const el = $('#downloads'); if (!dlOpen) return;
  const list = dlList();
  const btn = (act, label, icon) => `<button class="hbtn" data-act="${act}" title="${label}" aria-label="${label}">${svg(S16(icon), '0 0 16 16', 'none')}</button>`;
  el.innerHTML = `<div class="dl-head"><h4>Downloads</h4><button class="btn small" data-act="folder">Open folder</button>${list.some((d) => !['progressing', 'paused'].includes(d.state)) ? '<button class="btn small" data-act="clear">Clear</button>' : ''}</div>
    ${list.length ? `<div class="dl-list">${list.map((d) => {
      const ext = (d.name.match(/\.([a-z0-9]{1,4})$/i)?.[1] || 'file').toUpperCase();
      const live = d.state === 'progressing' || d.state === 'paused';
      const sub = d.missing ? 'File was moved or deleted'
        : live ? (d.total ? `${fmtSize(d.received)} of ${fmtSize(d.total)}` : `${fmtSize(d.received)}`)
          : d.state === 'completed' ? `${fmtSize(d.total || d.received)} · ${ago(d.ts)}` : d.state === 'cancelled' ? 'Cancelled' : 'Failed';
      const acts = live ? btn('cancel', 'Cancel', 'M4.5 4.5l7 7M11.5 4.5l-7 7')
        : d.state === 'completed' ? `${btn('open', 'Open', 'M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5')}${btn('show', 'Show in folder', 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z')}${btn('remove', 'Remove from list', 'M4.5 4.5l7 7M11.5 4.5l-7 7')}`
          : `${d.retry ? btn('retry', 'Try again', 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3') : ''}${btn('remove', 'Remove from list', 'M4.5 4.5l7 7M11.5 4.5l-7 7')}`;
      return `<div class="dl ${esc(d.state)}${d.missing ? ' missing' : ''}" data-id="${esc(d.id)}"><span class="dl-ico">${esc(ext)}</span>
        <div class="dl-main"><div class="dl-name" title="${esc(d.path || d.name)}">${esc(d.name)}</div><div class="dl-sub">${esc(sub)}</div>${live ? '<div class="dl-bar"><i></i></div>' : ''}</div>
        <div class="dl-act">${acts}</div></div>`;
    }).join('')}</div>` : `<p class="dl-empty">Files you download from your apps go to your Downloads folder and show up here.</p>`}`;
  el.querySelectorAll('.dl').forEach((row) => {
    const d = DL.get(row.dataset.id); const bar = $('.dl-bar i', row);
    if (bar) bar.style.width = d.total ? `${Math.min(100, (100 * d.received) / d.total)}%` : '30%';
    if (bar && !d.total) bar.parentElement.classList.add('indeterminate');
  });
}
function onDownloadsClick(e) {
  const t = e.target.closest('button[data-act]'); if (!t) return;
  const act = t.dataset.act; const id = t.closest('.dl')?.dataset.id;
  if (act === 'folder') hub.app('downloads-folder');
  else if (act === 'clear') for (const d of DL.values()) { if (!['progressing', 'paused'].includes(d.state)) hub.download(d.id, 'remove'); }
  else if (id) {
    hub.download(id, act);
    if (act === 'open' || act === 'show') toggleDownloads(false);
  }
}
function onDownload(d) {
  if (d.removed) DL.delete(d.id);
  else {
    const isNew = !DL.has(d.id);
    DL.set(d.id, { ...DL.get(d.id), ...d });
    if (isNew) { const b = $('#dlBtn'); b?.classList.remove('bump'); void b?.offsetWidth; b?.classList.add('bump'); }
  }
  renderDownloads();
}
