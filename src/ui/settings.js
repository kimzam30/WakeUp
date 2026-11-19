'use strict';
/* global LookCore, hub, $, h, svg, S16, btnSvg, esc, glyph, APPS, SV, SET, META, DL, render, commit, L, settingsOpen:writable, dlOpen:writable, menuOpen, toggleMenu, applyPayload, KEYS_HTML, closePopover, closeOverlay */
// Settings page (Ctrl+,) and Downloads panel (Ctrl+J). Every change goes to main, which validates,
// applies and sends the result back through applyPayload().

// ---------- settings ----------
const SECTIONS = [['general', 'General'], ['apps', 'Apps'], ['timetable', 'Timetable'], ['performance', 'Performance'], ['downloads', 'Downloads & screenshots'], ['links', 'Links & documents'], ['appearance', 'Appearance'], ['about', 'About']];
let setTab = 'general';
let appForm = null; // null | {id?, name, url, color, own, error}
let confirmRemove = null; // custom app id waiting for confirmation
let SYNC = { signedIn: false, phase: 'off' }; // cloud sync status from main
const syncAgo = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return !iso ? 'not yet' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };
function syncRow() {
  const y = SYNC;
  if (!y.signedIn) {
    const busy = y.signingIn || y.phase === 'signing';
    return row('Sync with Google', `See the same timetable, tasks and settings on your phone, tablet and other computers. Your Microsoft and Ebwise sign-ins stay on this device.${y.error ? `<br><span class="bad-text">Sign-in didn’t finish: ${esc(y.error)}</span>` : ''}`,
      busy ? '<span class="set-desc">Finish signing in in your browser…</span><button class="btn small" data-act="sync-cancel">Cancel</button>'
        : '<button class="btn small primary" data-act="sync-in">Sign in with Google</button>');
  }
  const n = (k, one) => `${k} ${one}${k === 1 ? '' : 's'}`;
  const state = y.phase === 'syncing' ? 'Syncing…' : y.phase === 'offline' ? `Offline. ${y.pending ? `${n(y.pending, 'change')} will upload` : 'Changes will sync'} when you’re back online.`
    : y.phase === 'expired' ? `<span class="bad-text">Your sign-in expired.</span> ${y.pending ? `${n(y.pending, 'change')} waiting. ` : ''}Sign in again to keep syncing.`
    : y.phase === 'error' ? `<span class="bad-text">Sync stopped: ${esc(y.error || 'unknown error')}</span>` : `Up to date · synced ${syncAgo(y.lastSync)}`;
  const actions = y.phase === 'expired'
    ? `<button class="btn small primary" data-act="sync-in">Sign in again</button><button class="btn small" data-act="sync-out">Sign out</button>`
    : `<button class="btn small" data-act="sync-now"${y.phase === 'syncing' ? ' disabled' : ''}>Sync now</button><button class="btn small" data-act="sync-out">Sign out</button>`;
  return row(`${avatarHtml(y)}Signed in as ${esc(y.name || y.email)}`, `${y.name ? `${esc(y.email)} · ` : ''}${state}${y.rejected ? `<br><span class="bad-text">${n(y.rejected, 'item')} couldn’t sync and stay${y.rejected === 1 ? 's' : ''} on this computer only.</span>` : ''}`, actions)
    + row('What syncs', 'Your timetable, semester, tasks, theme, nickname, reminders and your own apps. Window layout, folders, notification choices and app sign-ins stay on each device. Signing out keeps everything on this computer.')
    + (y.weakKeyring ? row('Sign-in storage', '<span class="bad-text">No system keyring found</span>, so your WakeUp sign-in is stored without encryption on this computer. Install and unlock GNOME Keyring or KWallet to protect it.') : '');
}
// only the Sync card changes when sync status does; the rest of the page stays as it is (keeps focus and scroll)
function refreshSyncCard() {
  const card = document.querySelector('#settings [data-sync-card]');
  if (card) card.innerHTML = syncRow(); else if (settingsOpen && setTab === 'general') renderSettings();
}
// your Google profile picture (main fetches it); the first letter of your name until it arrives
function avatarHtml(st, cls = '') {
  if (!st?.signedIn) return '';
  return st.avatar ? `<img class="avatar ${cls}" src="${esc(st.avatar)}" alt="">` : `<span class="avatar ${cls} letter" aria-hidden="true">${esc((st.name || st.email || '?')[0].toUpperCase())}</span>`;
}
// beside Settings at the bottom of the sidebar
function paintSideAvatar() {
  const b = $('#setBtn'); if (!b) return;
  b.querySelector('.avatar')?.remove();
  b.classList.toggle('has-av', !!SYNC.signedIn);
  if (SYNC.signedIn) { b.insertAdjacentHTML('beforeend', avatarHtml(SYNC, 'side')); b.title = `Settings · signed in as ${SYNC.name || SYNC.email} (Ctrl+,)`; } else b.title = 'Settings (Ctrl+,)';
}
hub.onSync?.((st) => { SYNC = st; paintSideAvatar(); if (settingsOpen && setTab === 'general') refreshSyncCard(); });

// ---- updates (Settings → About): what's installed, what's out, one button to get it
let UPD = null;
function updateRow() {
  const u = UPD;
  if (!u) return row('Updates', 'Checking how WakeUp was installed…');
  if (u.phase === 'unsupported') {
    return row('Updates', u.mode === 'dev' ? 'You’re running WakeUp from its source code. Pull the latest code to update.'
      : 'One-click updates work when WakeUp is installed with scripts/install.sh or run as an AppImage. Download the latest version from GitHub to update.',
    '<button class="btn small" data-act="upd-page">Releases</button>');
  }
  const pct = Math.round((u.progress || 0) * 100);
  const desc = u.phase === 'checking' ? 'Checking for updates…'
    : u.phase === 'available' ? `WakeUp ${esc(u.latest)} is ready to install.${u.notes ? `<br><span class="upd-notes">${esc(u.notes).replace(/\n/g, '<br>')}</span>` : ''}`
      : u.phase === 'downloading' ? `Downloading ${esc(u.latest)}… ${pct}%`
        : u.phase === 'installing' ? `Installing ${esc(u.latest)}…`
          : u.phase === 'ready' ? `WakeUp ${esc(u.latest)} is installed. Restart to start using it; your apps and layout come back as they are.`
            : u.phase === 'error' ? `<span class="bad-text">${esc(u.error || 'The update didn’t work.')}</span> Nothing was changed.`
              : u.phase === 'current' ? `You have the latest version.${u.checkedAt ? ` Checked ${syncAgo(new Date(u.checkedAt).toISOString())}.` : ''}`
                : 'WakeUp checks GitHub for a new version a few times a day.';
  const ctl = u.phase === 'available' ? '<button class="btn small primary" data-act="upd-install">Update now</button><button class="btn small" data-act="upd-page">What’s new</button>'
    : u.phase === 'downloading' ? '<button class="btn small" data-act="upd-cancel">Cancel</button>'
      : u.phase === 'ready' ? '<button class="btn small primary" data-act="upd-restart">Restart now</button>'
        : u.phase === 'installing' ? '' : `<button class="btn small" data-act="upd-check"${u.phase === 'checking' ? ' disabled' : ''}>Check for updates</button>`;
  return row('Updates', desc, ctl) + row('Check for updates automatically', 'Looks on GitHub when WakeUp starts and every few hours. Nothing installs until you click Update.', sw('autoUpdate', SET.autoUpdate !== false, 'Check for updates automatically'));
}
function refreshUpdateCard() {
  const card = document.querySelector('#settings [data-update-card]');
  if (card) card.innerHTML = updateRow();
}
hub.onUpdate?.((st) => { UPD = st; if (settingsOpen && setTab === 'about') refreshUpdateCard(); });
hub.update?.('status').then((st) => { if (st) UPD = st; });
hub.sync?.('status').then((st) => { if (st) { SYNC = st; paintSideAvatar(); } });
const AI_PRESETS = [ // a starting point; any AI that works in a browser can be added with 'Other'
  ['ChatGPT', 'https://chatgpt.com/', '#10a37f'], ['Claude', 'https://claude.ai/', '#d97757'], ['Gemini', 'https://gemini.google.com/', '#4285f4'],
  ['Copilot', 'https://copilot.microsoft.com/', '#2b63d9'], ['Perplexity', 'https://www.perplexity.ai/', '#20808d'], ['DeepSeek', 'https://chat.deepseek.com/', '#4d6bfe'],
  ['Grok', 'https://grok.com/', '#1f1f1e'], ['Le Chat', 'https://chat.mistral.ai/', '#fa520f'], ['NotebookLM', 'https://notebooklm.google.com/', '#202124'],
];
const nextName = (base) => { const names = new Set(SET.customApps.map((c) => c.name)); if (!names.has(base)) return base; let n = 2; while (names.has(`${base} ${n}`)) n++; return `${base} ${n}`; };

function toggleSettings(open = !settingsOpen) {
  settingsOpen = open;
  if (open && dlOpen) toggleDownloads(false);
  if (open && menuOpen) toggleMenu(false);
  if (open) { closePopover(); closeOverlay(); }
  $('#settings').hidden = !open;
  if (open) { renderSettings(); $(`#settings .set-nav [data-tab="${setTab}"]`)?.focus(); }
  render();
}
async function save(patch) {
  try { applyPayload(await hub.setSettings(patch)); return true; } catch (e) {
    console.error('settings not saved', e);
    showNotice({ id: 'settings-save', kind: 'error', title: 'That setting didn’t save', detail: 'Try again. If it keeps happening, the log folder (Settings, About) has details.' });
    return false;
  }
}

const row = (title, desc, control = '') => `<div class="set-row"><div class="set-text"><div class="set-title">${title}</div>${desc ? `<div class="set-desc">${desc}</div>` : ''}</div>${control ? `<div class="set-ctl">${control}</div>` : ''}</div>`;
const sw = (k, on, label, disabled = false) => `<button class="switch" role="switch" aria-checked="${!!on}" data-k="${k}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}><span></span></button>`;
const seg = (k, val, opts, label) => `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${opts.map(([v, l]) => `<button role="radio" aria-checked="${String(v) === String(val)}" data-k="${k}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
const sel = (k, val, opts, label) => `<select data-k="${k}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const group = (title, body) => `<section class="set-group">${title ? `<h2>${title}</h2>` : ''}<div class="set-card">${body}</div></section>`;

function sectionHtml(tab) {
  const S = SET;
  if (tab === 'general') {
    return `<section class="set-group"><h2>Sync</h2><div class="set-card" data-sync-card>${syncRow()}</div></section>`
      + group('You',
      row('Your nickname', 'WakeUp greets you with it on the Today screen and in class reminders.', `<form class="nick-set" data-form="nickname" autocomplete="off"><input class="text-in" name="nickname" maxlength="30" placeholder="e.g. Kim" value="${esc(S.nickname)}" aria-label="Your nickname"><button class="hbtn tick" type="submit" title="Save nickname" aria-label="Save nickname">${btnSvg('check')}</button><span class="save-state" role="status"></span></form>`))
      + group('Starting up',
      row('Start at login', 'WakeUp opens hidden in the tray when you sign in to your computer.', sw('autostart', META.autostart, 'Start at login'))
      + row('Start hidden in the tray', 'Launch without showing the window. Click the tray icon to bring it up.', sw('startHidden', S.startHidden, 'Start hidden'))
      + row('At launch, open', 'Pick one app if you usually only need, say, Ebwise.', sel('launch', S.launch, [['last', 'Whatever I had open'], ['home', 'Today'], ...SV.map((s) => [s.id, `${s.name} only`])], 'At launch, open')))
      + group('Closing the window',
        row('When you close the window', S.onClose === 'tray' ? 'WakeUp keeps running in the tray, so mail and Teams notifications still arrive.' : S.onClose === 'minimize' ? 'The window goes to the dock instead of closing.' : 'WakeUp quits completely. You won’t get notifications until you open it again.',
          seg('onClose', S.onClose, [['tray', 'Keep in tray'], ['minimize', 'Minimise'], ['quit', 'Quit']], 'When you close the window')))
      + group('', row('Just one app', 'Right-click WakeUp in the dock and pick an app to open only that app. Everything else stays unloaded.'));
  }
  if (tab === 'apps') {
    const rows = APPS.map((s, i) => {
      if (confirmRemove === s.id) {
        return `<div class="app-row confirm" data-id="${esc(s.id)}"><span class="app-ico">${glyph(s)}</span><div class="app-name">Remove ${esc(s.name)}?</div>
          <div class="app-confirm"><button class="btn small danger" data-act="remove-yes">Remove</button>${s.own ? '<button class="btn small danger" data-act="remove-clear">Remove and sign out</button>' : ''}<button class="btn small" data-act="remove-no">Cancel</button></div></div>`;
      }
      return `<div class="app-row${s.hidden ? ' off' : ''}" data-id="${esc(s.id)}">
        <span class="app-ico">${glyph(s)}</span>
        <div class="app-name"><span>${esc(s.name)}</span>${s.custom ? `<small>${s.ai ? 'AI · ' : ''}${esc(new URL(s.url).host)}${s.own ? ' · own sign-in' : ' · Microsoft 365 sign-in'}${s.mic ? ' · microphone' : ''}${s.external ? ' · opens in your browser' : ''}</small>` : s.kind === 'local' ? '<small>Built into WakeUp · works offline</small>' : ''}</div>
        ${sw(`show:${s.id}`, !s.hidden, `Show ${s.name}`, !s.hidden && SV.length === 1)}
        ${s.kind === 'local' ? '<span></span>' : sw(`bg:${s.id}`, s.keepAlive, `Keep ${s.name} running`)}
        ${s.id === 'tasks' ? '<span></span>' : sw(`notify:${s.id}`, SET.notify[s.id] !== false, s.id === 'timetable' ? 'Class reminders' : `${s.name} notifications`)}
        <div class="app-move">
          <button class="hbtn" data-act="up" aria-label="Move ${esc(s.name)} up" title="Move up"${i === 0 ? ' disabled' : ''}>${svg(S16('M4 10l4-4 4 4'), '0 0 16 16', 'none')}</button>
          <button class="hbtn" data-act="down" aria-label="Move ${esc(s.name)} down" title="Move down"${i === APPS.length - 1 ? ' disabled' : ''}>${svg(S16('M4 6l4 4 4-4'), '0 0 16 16', 'none')}</button>
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
        ${f.ai ? `<div class="set-row tight"><div class="set-text"><div class="set-title">Microphone</div><div class="set-desc">Lets ${esc(f.name || 'this AI')} hear you for voice chat. It never gets your camera or screen.</div></div><div class="set-ctl">${sw('form-mic', f.mic, 'Allow the microphone')}</div></div>` : ''}
        <div class="set-row tight"><div class="set-text"><div class="set-title">Open in my browser</div><div class="set-desc">For sites that won’t let you sign in inside WakeUp, like Google’s (NotebookLM). Clicking the app opens it in your browser instead.</div></div><div class="set-ctl">${sw('form-ext', f.external, 'Open in my browser')}</div></div>
        <div class="set-row tight"><div class="set-text"><div class="set-title">Sign-in</div><div class="set-desc">${f.own ? `Its own sign-in, separate from everything else.${f.ai ? ' Add the same AI again under another name (say “ChatGPT Work”) to use a second account side by side.' : ''}` : 'Uses the Microsoft 365 account you’re signed in with in Outlook and Teams.'}</div></div>
          <div class="set-ctl">${seg('form-own', f.own ? 'own' : 'm365', [['own', 'Separate'], ['m365', 'Microsoft 365']], 'Sign-in')}</div></div>
        <p class="form-error" role="alert">${esc(f.error || '')}</p>
        <div class="actions left"><button class="btn primary" type="submit">${f.id ? 'Save changes' : 'Add app'}</button><button class="btn" type="button" data-act="form-cancel">Cancel</button></div>
      </form>` : '<button class="btn" data-act="add">+ Add an app</button>';
    return `<section class="set-group"><h2>Your apps</h2><p class="set-lead">Hidden apps disappear from the sidebar and stop running. Order sets their <kbd>Ctrl</kbd> number.</p>
      <div class="set-card apps"><div class="app-row head" aria-hidden="true"><span></span><span></span><span>Show</span><span>Keep running</span><span>Notify</span><span></span></div>${rows}</div></section>
      <section class="set-group"><h2>AI assistants</h2><p class="set-lead">Pick one to add it. Each one you add has its own sign-in, so you can add the same AI twice for two accounts (for example personal and work). Google often blocks “Continue with Google” inside apps; if it does, sign in with your email instead.</p>
        <div class="set-card pad"><div class="ai-grid">${AI_PRESETS.map(([n, u, c]) => `<button class="ai-pick" data-act="add-ai" data-name="${esc(n)}" data-url="${esc(u)}" data-color="${esc(c)}"><span class="ai-dot" data-c="${esc(c)}">${esc(n[0])}</span><span>${esc(n)}</span>${SET.customApps.some((a) => a.url === u) ? '<small>Add another account</small>' : ''}</button>`).join('')}<button class="ai-pick" data-act="add-ai" data-name="" data-url="" data-color="#6b6a67"><span class="ai-dot other">${btnSvg('plus')}</span><span>Other AI…</span></button></div></div></section>
      <section class="set-group"><h2>Add your own</h2><p class="set-lead">Any website that works in a browser: Notion, your MMU portal, a class forum…</p><div class="set-card pad">${form}</div></section>`;
  }
  if (tab === 'timetable') {
    return group('Reminders',
      row('Remind me before each class', 'A notification with the venue, or a Join button for online classes. Cancelled classes are skipped.',
        sel('reminders', S.reminders, [[0, 'Off'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before']], 'Class reminders')))
      + group('Calendar',
        row('Show classes as', S.classLabel === 'name' ? 'Subject name only, e.g. “Mini IT Project”.' : S.classLabel === 'both' ? 'Code and name, e.g. “CSP1123 · Mini IT Project”.' : 'Subject code only, e.g. “CSP1123”. Classes without a code show their name.',
          seg('classLabel', S.classLabel, [['code', 'Code'], ['name', 'Name'], ['both', 'Both']], 'Show classes as'))
        + row('Weeks start on', '', seg('weekStart', S.weekStart, [[1, 'Monday'], [0, 'Sunday']], 'Weeks start on')))
      + group('Backup and sharing',
        row('Export your timetable', 'Save your classes, changes and tasks to a file, to back them up or share the timetable with classmates.', '<button class="btn small" data-act="tt-export">Export…</button>')
        + row('Import a timetable', 'Replaces your classes with the ones in the file. Your tasks are kept, and any tasks in the file are added.', '<button class="btn small" data-act="tt-import">Import…</button>'));
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
      + row('Notify me when a download finishes', 'Click the notification to open the file. PDFs and pictures open right inside WakeUp.', sw('notifyDownload', S.notifyDownload && !S.openDownload, 'Notify when finished', S.openDownload)))
      + group('Screenshots',
        row('Save screenshots to', `<code class="path">${esc(S.screenshotDir || META.defaultShotDir)}</code>`, `<button class="btn small" data-act="pick-shots">Change…</button>${S.screenshotDir ? '<button class="btn small" data-act="reset-shots">Use Pictures</button>' : ''}`)
        + row('Copy to the clipboard', 'So you can paste a screenshot straight into Teams or an email.', sw('screenshotCopy', S.screenshotCopy, 'Copy screenshots to the clipboard'))
        + row('Taking one', 'Press <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>S</kbd> or the camera in the sidebar. Then open it beside your app, full screen, or in its own window.'));
  }
  if (tab === 'links') {
    return group('Opening links',
      row('Links to other websites', 'Ctrl+click or middle-click a link to always open it in your browser.', seg('externalLinks', S.externalLinks, [['browser', 'My browser'], ['window', 'WakeUp window']], 'Links to other websites'))
      + row('Ebwise files (PDFs, slides)', S.docLinks === 'beside' ? 'Opens next to Ebwise, so you can read and browse at the same time.' : S.docLinks === 'full' ? 'Fills the WakeUp window. Click Ebwise in the sidebar to go back.' : S.docLinks === 'window' ? 'Opens in its own window that stays signed in.' : 'Opens in your browser, which may ask you to sign in again.',
        sel('docLinks', S.docLinks, [['beside', 'Beside the app'], ['full', 'Full screen'], ['window', 'Own window'], ['browser', 'My browser']], 'Ebwise files'))
      + row('SharePoint and OneDrive previews', 'Open in a WakeUp window that stays signed in, unless Ebwise files are set to open in your browser.')
      + row('Email addresses', 'Clicking an email address starts a new message in Outlook.')
      + row('Teams meeting links', 'Links to Teams meetings and chats open in the Teams app.'))
      + group('', row('Right-click menu', 'Right-click a link to open it in your browser or a WakeUp window, copy it, or save it. Right-click a misspelled word for suggestions.'));
  }
  if (tab === 'appearance') {
    return group('Look',
      row('Theme', '', seg('theme', S.theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], 'Theme'))
      + row('Page zoom', 'How big pages inside your apps appear.', sel('zoom', S.zoom, [80, 90, 100, 110, 125, 150].map((z) => [z, `${z}%`]), 'Page zoom'))
      + row('Show app names in the sidebar', '', sw('labels', S.labels && !S.compact, 'Show app names', S.compact))
      + row('Icons-only sidebar', 'Folds the sidebar to just the app icons, for more room. Small windows do this by themselves.', sw('compact', S.compact, 'Icons-only sidebar')))
      + group('Colour', row('Accent colour', 'Buttons, links and highlights. It follows you to your phone and tablet.', accentPicker(S.accent)))
      + todayGroup(S.today);
  }
  return `<section class="set-group"><h2>Updates</h2><div class="set-card" data-update-card>${updateRow()}</div></section>` + group('WakeUp',
    row(`Version ${esc(META.version || '')}`, 'Problems are written to a log file. Attach it if you report a bug.', '<button class="btn small" data-act="logs">Open log folder</button>')
    + row('Reset layout', 'Close every app and split and go back to Today. Your sign-ins, timetable and tasks stay.', '<button class="btn small" data-act="reset-layout">Reset</button>'))
    + `<section class="set-group"><h2>Keyboard shortcuts</h2><div class="set-card pad">${KEYS_HTML}</div></section>`;
}

const accentPicker = (val) => `<div class="swatches" role="radiogroup" aria-label="Accent colour">${LookCore.ACCENTS.map(([id, name, light]) => `<button role="radio" class="swatch" aria-checked="${id === (val || 'blue')}" data-k="accent" data-v="${id}" data-c="${light[0]}" title="${name}" aria-label="${name}"></button>`).join('')}</div>`;
// Today's sections: order and which show. Synced; each device draws them its own way.
function todayGroup(v) {
  const t = LookCore.cleanToday(v); const up = svg(S16('M4 10l4-4 4 4'), '0 0 16 16', 'none'); const down = svg(S16('M4 6l4 4 4-4'), '0 0 16 16', 'none');
  const rows = t.order.map((id, i) => {
    const [, name, desc] = LookCore.TODAY.find((x) => x[0] === id); const on = !t.hidden.includes(id);
    return `<div class="set-row today-row${on ? '' : ' off'}" data-id="${id}"><div class="set-text"><div class="set-title">${esc(name)}</div><div class="set-desc">${esc(desc)}</div></div>
      <div class="set-ctl"><div class="app-move"><button class="hbtn" data-act="today-up" aria-label="Move ${esc(name)} up" title="Move up"${i === 0 ? ' disabled' : ''}>${up}</button><button class="hbtn" data-act="today-down" aria-label="Move ${esc(name)} down" title="Move down"${i === t.order.length - 1 ? ' disabled' : ''}>${down}</button></div>${sw(`today:${id}`, on, `Show ${name}`)}</div></div>`;
  }).join('');
  return `<section class="set-group" data-today><h2>Today page</h2><p class="set-lead">Choose what Today shows and in what order. It syncs; the computer, tablet and phone each lay it out to fit.</p><div class="set-card">${rows}</div><div class="actions left today-reset"><button class="btn small" data-act="today-reset">Reset to default</button></div></section>`;
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
    el.addEventListener('submit', (e) => { if (e.target.dataset.form === 'nickname') saveNickname(e); else onAppSubmit(e); });
    el.addEventListener('input', (e) => {
      if (e.target.name === 'nickname') { const f = e.target.form; const dirty = e.target.value.trim() !== (SET.nickname || ''); f.classList.toggle('dirty', dirty); f.classList.remove('saved', 'failed'); $('.save-state', f).textContent = dirty ? 'Not saved yet' : ''; return; }
      if (appForm && e.target.name in appForm) appForm[e.target.name] = e.target.value;
    });
  }
  el.querySelectorAll('[data-tab]').forEach((b) => b.toggleAttribute('aria-current', b.dataset.tab === setTab));
  // keep keyboard focus on the same control across re-renders
  const a = document.activeElement; const key = a?.closest('#settings .set-content') ? (a.dataset.k ? `[data-k="${a.dataset.k}"]${a.dataset.v ? `[data-v="${a.dataset.v}"]` : ''}` : a.name ? `[name="${a.name}"]` : null) : null;
  $('.set-content', el).innerHTML = sectionHtml(setTab);
  paint($('.set-content', el));
  el.querySelectorAll('.app-row[data-id] .app-ico').forEach((i) => i.style.setProperty('--svc', APPS.find((s) => s.id === i.parentElement.dataset.id)?.color || '#888'));
  if (key) $(`.set-content ${key}`, el)?.focus();
}

async function saveNickname(e) {
  e.preventDefault();
  const f = e.target; const v = f.nickname.value.trim(); const st = $('.save-state', f);
  f.classList.remove('dirty', 'saved', 'failed'); f.classList.add('saving'); st.textContent = 'Saving…';
  const ok = await save({ nickname: v });
  const f2 = $('#settings form.nick-set') || f; const st2 = $('.save-state', f2); // the page re-renders after saving
  f2.classList.remove('saving'); f2.classList.add(ok ? 'saved' : 'failed');
  st2.textContent = ok ? (v ? `Saved. WakeUp will call you ${v}.` : 'Saved. No nickname.') : 'Not saved. Try again.';
  if (ok) showNotice({ id: 'nickname', kind: 'success', title: 'Nickname saved', detail: v ? `Hi, ${v}.` : 'The greeting won’t use a name.' });
}
function moveApp(id, dir) {
  const order = APPS.map((s) => s.id); const i = order.indexOf(id); const j = i + dir;
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
    if (kind === 'form-mic') { appForm.mic = on; renderSettings(); return; }
    if (kind === 'form-ext') { appForm.external = on; renderSettings(); return; }
    if (kind === 'autostart') save({ autostart: on });
    else if (kind === 'outlookOne') save({ hidden: on ? [...SET.hidden, 'calendar'] : SET.hidden.filter((x) => x !== 'calendar') });
    else if (kind === 'show') save({ hidden: on ? SET.hidden.filter((x) => x !== sid) : [...SET.hidden, sid] });
    else if (kind === 'bg') save({ keepAlive: { ...SET.keepAlive, [sid]: on } });
    else if (kind === 'notify') save({ notify: { ...SET.notify, [sid]: on } });
    else if (kind === 'today') save({ today: LookCore.showToday(SET.today, sid, on) });
    else save({ [k]: on });
    return;
  }
  if (k && t.getAttribute('role') === 'radio') {
    if (k === 'form-own') { appForm.own = t.dataset.v === 'own'; renderSettings(); return; }
    save({ [k]: k === 'weekStart' ? Number(t.dataset.v) : t.dataset.v });
    return;
  }
  if (act === 'close') toggleSettings(false);
  else if (act === 'up' || act === 'down') moveApp(id, act === 'up' ? -1 : 1);
  else if (act === 'today-up' || act === 'today-down') save({ today: LookCore.moveToday(SET.today, t.closest('[data-id]').dataset.id, act === 'today-up' ? -1 : 1) });
  else if (act === 'today-reset') save({ today: LookCore.todayDefault() });
  else if (act === 'add') { appForm = { name: '', url: '', color: '#5e6ad2', own: true, error: '' }; renderSettings(); $('#settings [name="name"]')?.focus(); }
  else if (act === 'add-ai') {
    appForm = { name: t.dataset.name ? nextName(t.dataset.name) : '', url: t.dataset.url, color: t.dataset.color, own: true, ai: true, mic: false, error: '' };
    renderSettings(); const f = $('#settings .app-form'); f?.scrollIntoView({ block: 'center' }); $(`#settings [name="${t.dataset.name ? 'name' : 'url'}"]`)?.focus();
  }
  else if (act === 'edit') { const c = SET.customApps.find((x) => x.id === id); appForm = { ...c, orig: c.url, error: '' }; setTimeout(() => $('#settings [name="name"]')?.focus()); renderSettings(); }
  else if (act === 'form-cancel') { appForm = null; renderSettings(); }
  else if (act === 'remove') { confirmRemove = id; renderSettings(); $('#settings [data-act="remove-no"]')?.focus(); }
  else if (act === 'remove-no') { confirmRemove = null; renderSettings(); }
  else if (act === 'remove-yes' || act === 'remove-clear') {
    confirmRemove = null;
    if (appForm?.id === id) appForm = null;
    save({ customApps: SET.customApps.filter((c) => c.id !== id), order: SET.order.filter((x) => x !== id) }).then(() => { if (act === 'remove-clear') hub.clearAppData(id); });
  } else if (act === 'pick-folder') hub.pickFolder('downloads').then((dir) => { if (dir) save({ downloadDir: dir }); });
  else if (act === 'reset-folder') save({ downloadDir: '' });
  else if (act === 'pick-shots') hub.pickFolder('screenshots').then((dir) => { if (dir) save({ screenshotDir: dir }); });
  else if (act === 'reset-shots') save({ screenshotDir: '' });
  else if (act === 'tt-export') hub.exportPlanner();
  else if (act === 'sync-in') { SYNC = { ...SYNC, signingIn: true, error: null }; refreshSyncCard(); hub.sync('sign-in').then((st) => { if (st) { SYNC = st; refreshSyncCard(); } }); }
  else if (act === 'sync-cancel') hub.sync('cancel').then((st) => { if (st) { SYNC = st; refreshSyncCard(); } });
  else if (act === 'sync-now') hub.sync('now');
  else if (act === 'sync-out') {
    const go = () => hub.sync('sign-out').then((st) => { if (st) { SYNC = st; refreshSyncCard(); } });
    if (SYNC.pending && !confirm(`${SYNC.pending} change${SYNC.pending === 1 ? ' hasn’t' : 's haven’t'} synced yet. Sign out anyway? They stay on this computer but won’t reach your other devices.`)) return;
    go();
  }
  else if (act === 'tt-import') hub.importPlanner().then((r) => { if (r?.error) t.closest('.set-row').querySelector('.set-desc').textContent = r.error; else if (r?.planner) t.textContent = 'Imported'; });
  else if (act === 'logs') hub.app('logs');
  else if (act === 'upd-check') { UPD = { ...UPD, phase: 'checking' }; refreshUpdateCard(); hub.update('check'); }
  else if (act === 'upd-install') hub.update('install');
  else if (act === 'upd-cancel') hub.update('cancel');
  else if (act === 'upd-restart') hub.update('restart');
  else if (act === 'upd-page') hub.openLink(UPD?.page || 'https://github.com/kimzam30/WakeUp/releases');
  else if (act === 'reset-layout') { Object.assign(L, { tile: null, free: [], popped: [], alive: [], zoomed: null, focused: null, splits: [] }); toggleSettings(false); commit(); }
}
function onSettingsChange(e) {
  const t = e.target; const k = t.dataset?.k; if (!k) return;
  if (t.tagName !== 'SELECT') return;
  save({ [k]: ['sleepMinutes', 'zoom', 'reminders'].includes(k) ? Number(t.value) : t.value });
}
function onAppSubmit(e) {
  e.preventDefault();
  const f = appForm; if (!f) return;
  const name = f.name.trim(); let url = f.url.trim();
  if (url && !/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
  let u = null; try { u = new URL(url); } catch { /* invalid */ }
  f.error = !name ? 'Give the app a name.' : !u || !u.hostname.includes('.') ? 'That doesn’t look like a web address. Try something like https://www.notion.so' : u.protocol !== 'https:' ? 'Only secure (https://) addresses can be added.' : '';
  if (f.error) { renderSettings(); return; }
  const entry = { id: f.id, name, url: u.href, color: f.color, own: f.own, icon: f.id && f.orig === u.href ? f.icon : null, ai: !!f.ai, mic: !!f.mic, external: !!f.external };
  const apps = f.id ? SET.customApps.map((c) => (c.id === f.id ? entry : c)) : [...SET.customApps, entry];
  const before = new Set(SET.customApps.map((c) => c.id)); appForm = null;
  save({ customApps: apps }).then((ok) => {
    if (!ok) return;
    const added = SET.customApps.find((c) => !before.has(c.id));
    if (added) showNotice({ kind: 'success', title: `${added.name} added`, detail: added.own ? 'Open it and sign in. This sign-in is only for this app.' : 'It uses your Microsoft 365 sign-in.', actions: [{ label: 'Open it', run: () => { toggleSettings(false); openPane(added.id); } }] });
    else showNotice({ kind: 'success', title: `${name} updated` });
  });
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
        : d.state === 'completed' ? `${d.viewable ? `<button class="btn small view" data-act="view" title="Open it beside your app">View</button>` : ''}${btn('open', d.viewable ? 'Open with another app' : 'Open', 'M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5')}${btn('show', 'Show in folder', 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z')}${btn('remove', 'Remove from list', 'M4.5 4.5l7 7M11.5 4.5l-7 7')}`
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
    if (act === 'view') hub.viewDownload(id, 'beside'); else hub.download(id, act);
    if (act === 'open' || act === 'show' || act === 'view') toggleDownloads(false);
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
