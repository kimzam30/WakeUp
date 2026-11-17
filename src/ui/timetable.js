'use strict';
/* global hub, PL, WEEK_START, Planner, savePlanner, esc, h, $, $$, paint, newId, fmtDate, fmtTime, classLabel, classSub, classFull, classIcon, classSvg, emptyArt, KIND, DAYS, DAYS_LONG, MONTHS, btnSvg */
/* eslint-disable no-unused-vars */
// Timetable: the semester's weekly classes, with one-off changes (cancelled, online, moved, replacement).

const CLASS_ICONS = Planner.ICON_KEYS;
const CLASS_COLORS = ['#2f6fde', '#7c5cd6', '#1f9d63', '#d0573a', '#c2410c', '#0f8a8a', '#b4417a', '#b7791f'];
const STATUS_CHIP = { cancelled: ['Cancelled', 'bad'], online: ['Online today', 'info'], moved: ['Moved', 'warn'], 'moved-in': ['Moved here', 'warn'], replacement: ['Replacement', 'good'] };
let HOUR = 56; // px per hour in the week grid; follows the UI scale (layoutWeek)

function weekLabel(first, sem) {
  const last = Planner.addDays(first, 6); const a = Planner.parse(first); const b = Planner.parse(last);
  const range = a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}` : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
  const probe = sem.start && sem.start > first && sem.start <= last ? sem.start : first;
  const w = Planner.weekOf(probe, sem, WEEK_START);
  const tag = !w ? '' : w.before ? `Semester starts in ${w.days} day${w.days === 1 ? '' : 's'}` : w.after ? 'Semester over' : w.break ? w.break : `Week ${w.week}`;
  return { range, tag };
}

function TimetableView(root) {
  const st = { first: Planner.startOfWeek(Planner.today(), WEEK_START), view: 'week', sheet: null };
  root.classList.add('lv', 'tt-view');
  root.innerHTML = `
    <header class="lv-head">
      <div class="lv-title"><h2>Timetable</h2><span class="lv-sub"></span></div>
      <div class="tt-tools">
        <div class="tt-nav"><button class="hbtn" data-act="prev" aria-label="Previous week" title="Previous week">${btnSvg('chevL')}</button><button class="btn small" data-act="this">This week</button><button class="hbtn" data-act="next" aria-label="Next week" title="Next week">${btnSvg('chevR')}</button></div>
        <div class="seg" role="radiogroup" aria-label="View"><button role="radio" data-view="week">Week</button><button role="radio" data-view="list">List</button></div>
        <button class="btn small ghost" data-act="semester" title="Semester dates and breaks">Semester</button>
        <button class="btn small primary" data-act="add-class">${btnSvg('plus')}Add class</button>
      </div>
    </header>
    <div class="tt-body"></div>
    <div class="tt-sheet" hidden></div>`;
  const body = $('.tt-body', root); const sheet = $('.tt-sheet', root);

  // ---------- week grid ----------
  function weekHtml() {
    const days = Array.from({ length: 7 }, (_, i) => Planner.addDays(st.first, i));
    const occ = Object.fromEntries(days.map((d) => [d, Planner.occurrencesOn(d, PL)]));
    const usedDays = new Set(PL.classes.flatMap((c) => c.sessions.map((s) => s.day)));
    const show = days.filter((d) => { const w = Planner.weekday(d); return (w !== 0 && w !== 6) || occ[d].length || usedDays.has(w); });
    const all = show.flatMap((d) => occ[d]);
    const from = Math.min(8, ...all.map((o) => Math.floor(Planner.mins(o.start) / 60)));
    const to = Math.max(18, ...all.map((o) => Math.ceil(Planner.mins(o.end) / 60)));
    const today = Planner.today();
    const hours = Array.from({ length: to - from }, (_, i) => from + i);
    const head = show.map((d) => { const p = Planner.parse(d); const br = Planner.inBreak(d, PL.semester); return `<div class="tt-dh${d === today ? ' today' : ''}${br ? ' break' : ''}"><span>${DAYS[p.getDay()]}</span><b>${p.getDate()}</b></div>`; }).join('');
    const cols = show.map((d) => {
      const list = occ[d]; const lanes = []; // simple lane packing for overlapping classes
      for (const o of list) { let i = lanes.findIndex((end) => end <= Planner.mins(o.start)); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = Planner.mins(o.end); o.lane = i; }
      const br = Planner.inBreak(d, PL.semester);
      return `<div class="tt-col${d === today ? ' today' : ''}${br ? ' break' : ''}" data-date="${d}" data-lanes="${lanes.length || 1}">${br ? `<span class="br-tag">${esc(br.label)}</span>` : ''}${list.map((o) => blockHtml(o, from)).join('')}</div>`;
    }).join('');
    return `<div class="tt-week" data-cols="${show.length}" data-from="${from}">
      <div class="tt-days"><div class="tt-corner"></div>${head}</div>
      <div class="tt-scroll"><div class="tt-grid" data-hours="${hours.length}"><div class="tt-times">${hours.map((x) => `<span>${fmtTime(`${String(x).padStart(2, '0')}:00`)}</span>`).join('')}</div>${cols}<i class="tt-now" hidden></i></div></div></div>`;
  }
  function blockHtml(o, from) {
    const chip = STATUS_CHIP[o.status];
    return `<button class="tt-block st-${o.status}${o.mode === 'online' ? ' online' : ''}" data-key="${esc(o.key)}" data-date="${o.date}" data-c="${esc(o.cls.color)}"
      data-top="${(Planner.mins(o.start) - from * 60) / 60}" data-len="${(Planner.mins(o.end) - Planner.mins(o.start)) / 60}" data-lane="${o.lane}"
      title="${esc(`${classFull(o.cls)} · ${fmtTime(o.start)}–${fmtTime(o.end)}`)}">
      <span class="b-top"><span class="b-ico">${classIcon(o.cls)}</span><b>${esc(classLabel(o.cls))}</b></span>
      ${classSub(o.cls) ? `<em class="b-name">${esc(classSub(o.cls))}</em>` : ''}
      <span class="b-sub">${esc([KIND[o.kind], o.section].filter(Boolean).join(' · '))}</span>
      <span class="b-sub">${esc(o.mode === 'online' ? 'Online' : o.venue || '')}</span>
      ${chip ? `<span class="chip ${chip[1]}">${chip[0]}</span>` : ''}</button>`;
  }
  function layoutWeek() {
    const wk = $('.tt-week', body); if (!wk) return;
    HOUR = scaled(56); $('.tt-grid', wk).style.setProperty('--hour', `${HOUR}px`);
    wk.style.setProperty('--cols', wk.dataset.cols);
    $('.tt-grid', wk).style.setProperty('--hours', $('.tt-grid', wk).dataset.hours);
    for (const col of $$('.tt-col', wk)) {
      const n = Number(col.dataset.lanes);
      for (const b of $$('.tt-block', col)) {
        b.style.top = `${Number(b.dataset.top) * HOUR}px`; b.style.height = `${Math.max(0.5, Number(b.dataset.len)) * HOUR - 3}px`;
        b.style.left = `calc(${(Number(b.dataset.lane) * 100) / n}% + 2px)`; b.style.width = `calc(${100 / n}% - 4px)`;
        b.classList.toggle('short', Number(b.dataset.len) < 1.1);
      }
      for (let i = 1; i < Number($('.tt-grid', wk).dataset.hours); i++) { const r = h('i', { class: 'hr' }); r.style.top = `${i * HOUR}px`; col.prepend(r); } // hour rules
    }
    paint(wk); tick();
  }
  function tick() { // the "now" line in today's column
    const line = $('.tt-now', body); const col = $('.tt-col.today', body); if (!line) return;
    const from = Number($('.tt-week', body).dataset.from); const now = new Date(); const y = (now.getHours() + now.getMinutes() / 60 - from) * HOUR;
    line.hidden = !col || y < 0 || y > Number($('.tt-grid', body).dataset.hours) * HOUR;
    if (!line.hidden) { if (line.parentElement !== col) col.append(line); line.style.top = `${y}px`; } // lives in today's column, so it needs no measuring
  }

  // ---------- list ----------
  function listHtml() {
    const today = Planner.today(); let html = '';
    for (let i = 0; i < 14; i++) {
      const d = Planner.addDays(st.first, i); const list = Planner.occurrencesOn(d, PL);
      const br = Planner.inBreak(d, PL.semester);
      if (!list.length && !(br && Planner.weekday(d) === WEEK_START)) continue;
      html += `<section class="ag-day${d === today ? ' today' : ''}${d < today ? ' past' : ''}"><h3>${d === today ? 'Today · ' : ''}${fmtDate(d, true)}${br ? ` <span class="chip warn">${esc(br.label)}</span>` : ''}</h3>
        ${list.map((o) => { const chip = STATUS_CHIP[o.status]; return `<button class="ag-row st-${o.status}" data-key="${esc(o.key)}" data-date="${d}" data-c="${esc(o.cls.color)}">
          <span class="ag-time">${fmtTime(o.start)}<small>${fmtTime(o.end)}</small></span><span class="ag-ico">${classIcon(o.cls)}</span>
          <span class="ag-main"><b>${esc(classLabel(o.cls))}</b> ${esc(classSub(o.cls))}<small>${esc([KIND[o.kind], o.section, o.mode === 'online' ? 'Online' : o.venue].filter(Boolean).join(' · '))}</small></span>
          ${chip ? `<span class="chip ${chip[1]}">${chip[0]}</span>` : ''}</button>`; }).join('')}</section>`;
    }
    return html || `<div class="empty small">${emptyArt('cal')}<h3>No classes in these two weeks</h3><p>Nothing is scheduled. Use the arrows to look further ahead.</p></div>`;
  }

  function emptyHtml() {
    return `<div class="empty">${emptyArt('cal')}<h3>Set up your semester</h3>
      <p>Add each class once with its lecture and tutorial times. WakeUp repeats them every week until the semester ends, skipping breaks.</p>
      <div class="actions"><button class="btn primary" data-act="add-class">${btnSvg('plus')}Add your first class</button><button class="btn" data-act="semester">Set semester dates</button><button class="btn" data-act="import">Import a file</button></div></div>`;
  }

  // ---------- sheets (editors inside the pane) ----------
  const findOcc = (key, date) => Planner.occurrencesOn(date, PL).find((o) => o.key === key);
  function openSheet(s) { st.sheet = s; renderSheet(); requestAnimationFrame(() => $('input:not([type=hidden]), button.primary', sheet)?.focus()); }
  function closeSheet() { st.sheet = null; renderSheet(); }
  const field = (label, html, cls = '') => `<label class="fld ${cls}"><span>${label}</span>${html}</label>`;
  const inp = (f, v, attrs = '') => `<input data-f="${f}" value="${esc(v ?? '')}" ${attrs}>`;

  function sheetHtml() {
    const s = st.sheet;
    if (s.type === 'occ') {
      const o = findOcc(s.key, s.date); if (!o) return '';
      const c = o.cls; const chip = STATUS_CHIP[o.status];
      const note = o.status === 'cancelled' ? 'This class is cancelled on this date.'
        : o.status === 'moved' ? `Moved to ${fmtDate(o.toDate, true)}${o.change.start ? `, ${fmtTime(o.change.start)}` : ''}.`
          : o.status === 'moved-in' ? `Moved here from ${fmtDate(o.fromDate, true)}.`
            : o.status === 'replacement' ? `Replacement class${o.note ? `: ${o.note}` : '.'}` : o.status === 'online' ? 'Online for this date only.' : '';
      const sub = s.sub;
      let form = '';
      if (sub === 'online') form = `<div class="subform">${field('Meeting link', inp('link', s.form.link, 'type="url" placeholder="https://teams.microsoft.com/…"'), 'wide')}<div class="actions left"><button class="btn primary small" data-act="do-online">Make it online</button><button class="btn small" data-act="sub-cancel">Cancel</button></div></div>`;
      if (sub === 'move' || sub === 'replace') {
        form = `<div class="subform"><div class="row3">${field(sub === 'move' ? 'New date' : 'Date', inp('date', s.form.date, 'type="date"'))}${field('Starts', inp('start', s.form.start, 'type="time"'))}${field('Ends', inp('end', s.form.end, 'type="time"'))}</div>
          <div class="row2">${field('Venue', inp('venue', s.form.venue, 'placeholder="Same as usual"'))}${field('Meeting link (if online)', inp('link', s.form.link, 'type="url" placeholder="https://…"'))}</div>
          ${sub === 'replace' ? field('Note', inp('note', s.form.note, 'maxlength="200" placeholder="e.g. replaces the cancelled lecture on Tuesday"'), 'wide') : ''}
          <p class="form-error" role="alert">${esc(s.error || '')}</p>
          <div class="actions left"><button class="btn primary small" data-act="${sub === 'move' ? 'do-move' : 'do-replace'}">${sub === 'move' ? 'Move class' : 'Add replacement'}</button><button class="btn small" data-act="sub-cancel">Cancel</button></div></div>`;
      }
      const changeable = o.status === 'normal' || o.status === 'online';
      return `<div class="sheet-card occ" data-c="${esc(c.color)}" role="dialog" aria-label="${esc(c.name)}">
        <div class="occ-hero"><span class="occ-ico">${classIcon(c)}</span><div class="occ-title"><h3>${esc(classLabel(c))}${classSub(c) ? ` <span>${esc(classSub(c))}</span>` : ''}</h3><p>${esc([KIND[o.kind], o.section].filter(Boolean).join(' · '))}${chip ? ` <span class="chip ${chip[1]}">${chip[0]}</span>` : ''}</p></div>
          <button class="hbtn" data-act="close" aria-label="Close">${btnSvg('close')}</button></div>
        <div class="facts">
          <div>${btnSvg('clock')}<span>${fmtDate(o.date, true)}, ${fmtTime(o.start)} – ${fmtTime(o.end)}</span></div>
          <div>${btnSvg(o.mode === 'online' ? 'video' : 'pin')}<span>${esc(o.mode === 'online' ? 'Online' : o.venue || 'No venue set')}</span></div>
          ${o.link ? `<div>${btnSvg('link')}<button class="btn small primary" data-act="join" data-link="${esc(o.link)}">Join meeting</button></div>` : ''}
        </div>
        ${note ? `<p class="occ-note">${esc(note)}</p>` : ''}
        ${form || `<div class="occ-actions">
          ${o.change && o.status !== 'replacement' && o.status !== 'moved-in' ? `<button class="btn small" data-act="undo">Undo this change</button>` : ''}
          ${o.status === 'replacement' ? '<button class="btn small danger" data-act="undo">Remove replacement</button>' : ''}
          ${o.status === 'moved-in' ? '<button class="btn small" data-act="undo">Undo move</button>' : ''}
          ${changeable ? `<span class="lbl">Just this date</span><button class="btn small" data-act="cancel-occ">Cancelled</button>${o.status === 'normal' ? '<button class="btn small" data-act="sub-online">Online</button>' : ''}<button class="btn small" data-act="sub-move">Postpone / move…</button>` : ''}
          <span class="grow"></span><button class="btn small" data-act="sub-replace">Add replacement…</button><button class="btn small" data-act="edit-class" data-id="${esc(c.id)}">${btnSvg('edit')}Edit class</button>
        </div>`}</div>`;
    }
    if (s.type === 'class') {
      const d = s.draft;
      return `<form class="sheet-card editor" data-c="${esc(d.color)}" novalidate role="dialog" aria-label="${s.isNew ? 'New class' : 'Edit class'}">
        <div class="ed-head"><h3>${s.isNew ? 'New class' : 'Edit class'}</h3><button type="button" class="hbtn" data-act="close" aria-label="Close">${btnSvg('close')}</button></div>
        <div class="row2">${field('Code', inp('code', d.code, 'maxlength="20" placeholder="e.g. CSP1123"'))}${field('Name', inp('name', d.name, 'maxlength="80" placeholder="e.g. Mini IT Project"'))}</div>
        <div class="pick-row"><span class="lbl">Icon</span><div class="icons" data-c="${esc(d.color)}">${CLASS_ICONS.map((i) => `<button type="button" data-icon="${i}" aria-pressed="${d.icon === i}" aria-label="Icon: ${i}" title="${i}">${classSvg(i)}</button>`).join('')}</div></div>
        <div class="pick-row"><span class="lbl">Colour</span><div class="colors">${CLASS_COLORS.map((col) => `<button type="button" data-color="${col}" data-c="${col}" aria-pressed="${d.color === col}" aria-label="Colour ${col}"></button>`).join('')}</div></div>
        <h4>Weekly sessions</h4>
        <div class="sessions">${d.sessions.map((x, i) => `<div class="sess">
          <div class="sess-row">
            <select data-f="s.${i}.kind" aria-label="Type">${Object.entries(KIND).map(([k, l]) => `<option value="${k}"${x.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
            ${inp(`s.${i}.section`, x.section, 'maxlength="20" placeholder="Section (TC1L)" aria-label="Section"')}
            <select data-f="s.${i}.day" aria-label="Day">${[1, 2, 3, 4, 5, 6, 0].map((k) => `<option value="${k}"${x.day === k ? ' selected' : ''}>${DAYS_LONG[k]}</option>`).join('')}</select>
            ${inp(`s.${i}.start`, x.start, 'type="time" aria-label="Starts"')}<span class="to">to</span>${inp(`s.${i}.end`, x.end, 'type="time" aria-label="Ends"')}
            <button type="button" class="hbtn del" data-act="del-sess" data-i="${i}" aria-label="Remove session" title="Remove">${btnSvg('trash')}</button>
          </div>
          <div class="sess-row">
            <div class="seg" role="radiogroup" aria-label="Where"><button type="button" role="radio" data-mode="${i}:campus" aria-checked="${x.mode === 'campus'}">On campus</button><button type="button" role="radio" data-mode="${i}:online" aria-checked="${x.mode === 'online'}">Online</button></div>
            ${x.mode === 'online' ? inp(`s.${i}.link`, x.link, 'type="url" class="grow" placeholder="Meeting link, e.g. https://teams.microsoft.com/…" aria-label="Meeting link"') : inp(`s.${i}.venue`, x.venue, 'class="grow" maxlength="80" placeholder="Venue, e.g. CQAR2004" aria-label="Venue"')}
          </div></div>`).join('')}</div>
        <button type="button" class="btn small" data-act="add-sess">${btnSvg('plus')}Add a lecture, tutorial or lab</button>
        <p class="form-error" role="alert">${esc(s.error || '')}</p>
        <div class="actions left"><button type="submit" class="btn primary">${s.isNew ? 'Add class' : 'Save'}</button><button type="button" class="btn" data-act="close">Cancel</button>
          <span class="grow"></span>${s.isNew ? '' : s.confirmDel ? '<span class="lbl">Delete this class and its changes?</span><button type="button" class="btn small danger" data-act="del-yes">Delete</button><button type="button" class="btn small" data-act="del-no">Keep</button>' : '<button type="button" class="btn small danger" data-act="del-class">Delete class</button>'}</div>
      </form>`;
    }
    if (s.type === 'semester') {
      const d = s.draft;
      return `<form class="sheet-card editor" novalidate role="dialog" aria-label="Semester">
        <div class="ed-head"><h3>Semester</h3><button type="button" class="hbtn" data-act="close" aria-label="Close">${btnSvg('close')}</button></div>
        ${field('Name', inp('name', d.name, 'maxlength="60" placeholder="e.g. Trimester 2530"'), 'wide')}
        <div class="row2">${field('First day of classes', inp('start', d.start, 'type="date"'))}${field('Last day', inp('end', d.end, 'type="date"'))}</div>
        <h4>Breaks <small>No classes on these days; week numbers skip them.</small></h4>
        <div class="breaks">${d.breaks.map((b, i) => `<div class="sess-row">${inp(`b.${i}.label`, b.label, 'maxlength="40" placeholder="Mid-semester break" aria-label="Break name" class="grow"')}${inp(`b.${i}.start`, b.start, 'type="date" aria-label="From"')}<span class="to">to</span>${inp(`b.${i}.end`, b.end, 'type="date" aria-label="To"')}<button type="button" class="hbtn del" data-act="del-break" data-i="${i}" aria-label="Remove break">${btnSvg('trash')}</button></div>`).join('')}</div>
        <button type="button" class="btn small" data-act="add-break">${btnSvg('plus')}Add a break</button>
        <h4>Weeks start on</h4>
        <div class="seg" role="radiogroup" aria-label="Weeks start on"><button type="button" role="radio" data-ws="1" aria-checked="${WEEK_START === 1}">Monday</button><button type="button" role="radio" data-ws="0" aria-checked="${WEEK_START === 0}">Sunday</button></div>
        <h4>Backup and sharing</h4>
        <div class="actions left"><button type="button" class="btn small" data-act="export">Export to a file…</button><button type="button" class="btn small" data-act="import">Import from a file…</button></div>
        <p class="form-error" role="alert">${esc(s.error || '')}</p>
        <div class="actions left"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-act="close">Cancel</button></div>
      </form>`;
    }
    return '';
  }
  function renderSheet() {
    sheet.hidden = !st.sheet;
    if (!st.sheet) { sheet.innerHTML = ''; return; }
    const a = document.activeElement; const key = a && sheet.contains(a) ? a.dataset.f : null;
    sheet.innerHTML = `<div class="sheet-back" data-act="close"></div>${sheetHtml()}`;
    if (!$('.sheet-card', sheet)) { st.sheet = null; sheet.hidden = true; return; }
    paint(sheet);
    if (key) { const el = $(`[data-f="${key}"]`, sheet); el?.focus(); }
  }

  // ---------- actions ----------
  const setChange = (o, change) => { // one change per class session per date
    const rest = PL.changes.filter((x) => x !== o.change && !(x.sessionId && x.sessionId === o.sessionId && x.date === o.date && x.type !== 'replacement'));
    return savePlanner({ changes: change ? [...rest, { id: newId('x'), ...change }] : rest });
  };
  const plusHour = (hm) => `${String(Math.min(23, Number(hm.slice(0, 2)) + 1)).padStart(2, '0')}:${hm.slice(3)}`;
  const blankSession = (last) => (last
    ? { id: newId('s'), kind: 'tutorial', section: '', day: last.day, start: last.end, end: plusHour(last.end), venue: '', mode: 'campus', link: '' }
    : { id: newId('s'), kind: 'lecture', section: '', day: 1, start: '09:00', end: '11:00', venue: '', mode: 'campus', link: '' });
  function editClass(id) {
    const c = PL.classes.find((k) => k.id === id);
    openSheet(c ? { type: 'class', draft: structuredClone(c) } : { type: 'class', isNew: true, draft: { id: newId('k'), code: '', name: '', icon: CLASS_ICONS[PL.classes.length % CLASS_ICONS.length], color: CLASS_COLORS[PL.classes.length % CLASS_COLORS.length], sessions: [blankSession()] } });
  }
  const isLink = (v) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act],[data-view],[data-key],[data-icon],[data-color],[data-mode],[data-ws]'); if (!t || !root.contains(t)) return;
    const s = st.sheet; const act = t.dataset.act;
    if (t.dataset.view) { st.view = t.dataset.view; render(); return; }
    if (t.dataset.key && !act) { const o = findOcc(t.dataset.key, t.dataset.date); if (o) openSheet({ type: 'occ', key: o.key, date: o.date }); return; }
    if (t.dataset.icon) { s.draft.icon = s.draft.icon === t.dataset.icon ? '' : t.dataset.icon; renderSheet(); return; }
    if (t.dataset.color) { s.draft.color = t.dataset.color; renderSheet(); return; }
    if (t.dataset.mode) { const [i, m] = t.dataset.mode.split(':'); s.draft.sessions[i].mode = m; renderSheet(); return; }
    if (t.dataset.ws) { hub.setSettings({ weekStart: Number(t.dataset.ws) }); return; }
    const o = s?.type === 'occ' ? findOcc(s.key, s.date) : null;
    switch (act) {
      case 'prev': st.first = Planner.addDays(st.first, st.view === 'list' ? -14 : -7); render(); break;
      case 'next': st.first = Planner.addDays(st.first, st.view === 'list' ? 14 : 7); render(); break;
      case 'this': st.first = Planner.startOfWeek(Planner.today(), WEEK_START); render(); break;
      case 'add-class': editClass(null); break;
      case 'edit-class': editClass(t.dataset.id); break;
      case 'semester': openSheet({ type: 'semester', draft: structuredClone(PL.semester) }); break;
      case 'close': closeSheet(); break;
      case 'join': hub.openLink(t.dataset.link); break;
      case 'cancel-occ': setChange(o, { type: 'cancelled', sessionId: o.sessionId, date: o.date }); break;
      case 'undo': setChange(o, null).then(() => { if (o.status === 'replacement' || o.status === 'moved-in') closeSheet(); }); break;
      case 'sub-online': s.sub = 'online'; s.form = { link: o.link || '' }; renderSheet(); $('[data-f="link"]', sheet)?.focus(); break;
      case 'sub-move': s.sub = 'move'; s.form = { date: Planner.addDays(o.date, 7), start: o.start, end: o.end, venue: '', link: '' }; renderSheet(); break;
      case 'sub-replace': s.sub = 'replace'; s.form = { date: Planner.addDays(o.date, 1), start: o.start, end: o.end, venue: o.venue, link: '', note: '' }; renderSheet(); break;
      case 'sub-cancel': s.sub = null; s.error = ''; renderSheet(); break;
      case 'do-online':
        if (s.form.link && !isLink(s.form.link)) { s.error = 'Use a full https:// meeting link.'; renderSheet(); break; }
        s.sub = null; setChange(o, { type: 'online', sessionId: o.sessionId, date: o.date, link: s.form.link }); break;
      case 'do-move': case 'do-replace': {
        const f = s.form;
        s.error = !f.date ? 'Pick a date.' : !f.start || !f.end || f.end <= f.start ? 'The end time has to be after the start.' : f.link && !isLink(f.link) ? 'Use a full https:// meeting link.' : '';
        if (s.error) { renderSheet(); break; }
        if (act === 'do-move') { setChange(o, { type: 'moved', sessionId: o.sessionId, date: o.date, toDate: f.date, start: f.start, end: f.end, venue: f.venue, link: f.link }); s.sub = null; } else {
          savePlanner({ changes: [...PL.changes, { id: newId('x'), type: 'replacement', classId: o.classId, date: f.date, start: f.start, end: f.end, venue: f.venue, link: f.link, note: f.note }] });
          closeSheet();
        }
        break;
      }
      case 'add-sess': s.draft.sessions.push(blankSession(s.draft.sessions.at(-1))); renderSheet(); break;
      case 'del-sess': s.draft.sessions.splice(Number(t.dataset.i), 1); renderSheet(); break;
      case 'del-class': s.confirmDel = true; renderSheet(); break;
      case 'del-no': s.confirmDel = false; renderSheet(); break;
      case 'del-yes': {
        const id = s.draft.id; const sids = new Set((PL.classes.find((c) => c.id === id)?.sessions || []).map((x) => x.id));
        savePlanner({ classes: PL.classes.filter((c) => c.id !== id), changes: PL.changes.filter((x) => x.classId !== id && !sids.has(x.sessionId)), tasks: PL.tasks.map((x) => (x.classId === id ? { ...x, classId: null } : x)) });
        closeSheet(); break;
      }
      case 'add-break': { const b = s.draft.breaks.at(-1); s.draft.breaks.push({ label: 'Mid-semester break', start: b ? Planner.addDays(b.end, 7) : s.draft.start || Planner.today(), end: b ? Planner.addDays(b.end, 13) : Planner.addDays(s.draft.start || Planner.today(), 6) }); renderSheet(); break; }
      case 'del-break': s.draft.breaks.splice(Number(t.dataset.i), 1); renderSheet(); break;
      case 'export': hub.exportPlanner(); break;
      case 'import': {
        if (PL.classes.length && !(s?.type === 'semester' && s.confirmImport)) { if (s?.type === 'semester') { s.confirmImport = true; s.error = 'Importing replaces your current timetable (your tasks stay). Click Import again to go ahead.'; renderSheet(); } else openSheet({ type: 'semester', draft: structuredClone(PL.semester), confirmImport: true, error: 'Importing replaces your current timetable (your tasks stay). Click Import again to go ahead.' }); break; }
        const r = await hub.importPlanner();
        if (r?.error) { if (st.sheet) { st.sheet.error = r.error; renderSheet(); } else openSheet({ type: 'semester', draft: structuredClone(PL.semester), error: r.error }); } else if (r?.planner) closeSheet(); // main broadcasts the new planner
        break;
      }
      default: break;
    }
  });
  root.addEventListener('input', (e) => {
    const f = e.target.dataset.f; const s = st.sheet; if (!f || !s) return;
    const v = e.target.value;
    if (s.type === 'occ') { s.form[f] = v; return; }
    const parts = f.split('.');
    if (parts[0] === 's') s.draft.sessions[parts[1]][parts[2]] = parts[2] === 'day' ? Number(v) : v;
    else if (parts[0] === 'b') s.draft.breaks[parts[1]][parts[2]] = v;
    else s.draft[f] = v;
  });
  root.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = st.sheet; if (!s) return;
    if (s.type === 'class') {
      const d = s.draft;
      s.error = !d.code.trim() && !d.name.trim() ? 'Give the class a code or a name.'
        : d.sessions.some((x) => !x.start || !x.end || x.end <= x.start) ? 'Each session needs an end time after its start time.'
          : d.sessions.some((x) => x.mode === 'online' && x.link && !isLink(x.link)) ? 'Meeting links need to be full https:// addresses.' : '';
      if (s.error) { renderSheet(); return; }
      const clean = { ...d, code: d.code.trim(), name: d.name.trim() || d.code.trim() };
      savePlanner({ classes: s.isNew ? [...PL.classes, clean] : PL.classes.map((c) => (c.id === d.id ? clean : c)) });
      if (s.isNew && !PL.semester.start) { openSheet({ type: 'semester', draft: structuredClone(PL.semester), error: '' }); return; } // first class: next, the semester dates
      closeSheet();
    } else if (s.type === 'semester') {
      const d = s.draft;
      s.error = d.start && d.end && d.end < d.start ? 'The last day has to be after the first.' : d.breaks.some((b) => !b.start || !b.end || b.end < b.start) ? 'Each break needs a start and an end date.' : '';
      if (s.error) { renderSheet(); return; }
      savePlanner({ semester: { ...d, start: d.start || null, end: d.end || null } });
      if (d.start && Planner.today() < d.start) st.first = Planner.startOfWeek(d.start, WEEK_START);
      closeSheet();
    }
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.sheet) { e.stopPropagation(); if (st.sheet.sub) { st.sheet.sub = null; renderSheet(); } else closeSheet(); } });

  const tooNarrow = () => root.clientWidth > 0 && root.clientWidth < scaled(470);
  let lastWeekStart = WEEK_START;
  function render() {
    if (lastWeekStart !== WEEK_START) { lastWeekStart = WEEK_START; st.first = Planner.startOfWeek(st.first, WEEK_START); }
    const { range, tag } = weekLabel(st.first, PL.semester);
    $('.lv-sub', root).textContent = PL.classes.length ? [tag, st.view === 'list' ? `from ${range.split(/–| – /)[0]}` : range, PL.semester.name].filter(Boolean).join(' · ') : 'Your weekly classes';
    $$('[data-view]', root).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === st.view)));
    $('.tt-tools', root).classList.toggle('bare', !PL.classes.length);
    const scroll = $('.tt-scroll', body)?.scrollTop;
    const view = st.view === 'week' && tooNarrow() ? 'list' : st.view; // a week grid doesn't fit a narrow pane
    $$('[data-view]', root).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === view)));
    body.innerHTML = !PL.classes.length ? emptyHtml() : view === 'week' ? weekHtml() : listHtml();
    body.className = `tt-body ${PL.classes.length ? view : 'none'}`;
    if (view === 'week') {
      layoutWeek();
      const sc = $('.tt-scroll', body);
      if (sc) sc.scrollTop = scroll ?? Math.max(0, (Math.min(...$$('.tt-block', body).map((b) => Number(b.dataset.top)), 1) - 0.5) * HOUR);
    } else paint(body);
    if (st.sheet) renderSheet();
  }
  // re-draw when the pane gets narrow or wide enough to switch between week and list, or when the UI scale changes
  let shape = '';
  new ResizeObserver(() => { const s = `${tooNarrow()}:${scaled(56)}`; if (s !== shape) { const first = !shape; shape = s; if (!first) render(); } }).observe(root);
  render();
  return { render, tick };
}
