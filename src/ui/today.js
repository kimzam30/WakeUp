'use strict';
/* global hub, PL, WEEK_START, Planner, savePlanner, esc, $, $$, paint, svg, glyph, btnSvg, newId, fmtDate, fmtTime, classLabel, classSub, classIcon, KIND, DAYS_LONG, MONTHS, store,
   SV, BY, L, SET, DL, SHOTS, unread, leaves, openPane, toggleSettings, toggleDownloads, splitTitle */
/* eslint-disable no-unused-vars */
// Today: the start screen. Reads like a page: greeting, next class, today's classes beside tasks due, apps, recent files.

function greeting() { const hr = new Date().getHours(); return hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; }
const untilText = (ms) => { const m = Math.round(ms / 60000); return m < 1 ? 'now' : m < 60 ? `in ${m} min` : m < 1440 ? `in ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `in ${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? '' : 's'}`; };

function renderToday() {
  const el = $('#home');
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.addEventListener('click', onTodayClick);
    el.addEventListener('submit', onTodaySubmit);
  }
  const today = Planner.today(); const now = new Date();
  const week = Planner.weekOf(today, PL.semester, WEEK_START);
  const weekChip = !week ? '' : week.before ? `Semester starts ${untilText(Planner.parse(PL.semester.start) - now)}` : week.after ? 'Semester finished' : week.break ? week.break : `Week ${week.week}`;
  const name = SET.nickname;
  const askName = !name && !store.get('nickDismissed');
  const head = (title, right = '') => `<div class="sec-h"><h2>${title}</h2>${right}</div>`;

  // next class
  const up = Planner.upcoming(PL, now, 8);
  const cur = up.find((o) => o.startsAt <= now.getTime());
  const nxt = cur || up[0];
  let next;
  if (!PL.classes.length) {
    next = `${head('Classes')}<div class="next empty-next"><span class="cls-ico plain">${btnSvg('cal')}</span><div><h3>Add your timetable</h3><p class="muted">See your next class, where it is, and a Join button for online classes, right here.</p></div><button class="btn primary" data-act="app" data-id="timetable">${btnSvg('plus')}Set up timetable</button></div>`;
  } else if (!nxt) {
    next = `${head('Next class')}<div class="next empty-next"><span class="cls-ico plain">${btnSvg('cal')}</span><div><h3>No classes coming up</h3><p class="muted">Nothing on your timetable for the next few days.</p></div><button class="btn" data-act="app" data-id="timetable">Open timetable</button></div>`;
  } else {
    const c = nxt.cls; const isNow = nxt === cur;
    const when = isNow ? `Now, until ${fmtTime(nxt.end)}` : nxt.date === today ? untilText(nxt.startsAt - now) : fmtDate(nxt.date, true);
    const chip = { 'moved-in': ['Moved here', 'warn'], replacement: ['Replacement', 'good'], online: ['Online today', 'info'] }[nxt.status];
    next = `${head(isNow ? 'Happening now' : 'Next class', `<span class="muted small">${esc(when)}</span>`)}
      <div class="next" data-c="${esc(c.color)}"><span class="cls-ico">${classIcon(c)}</span>
      <div class="next-main"><h3>${esc(classLabel(c))}${classSub(c) ? ` <span>${esc(classSub(c))}</span>` : ''}${chip ? ` <span class="chip ${chip[1]}">${chip[0]}</span>` : ''}</h3>
      <div class="facts-row"><span>${btnSvg('clock')}${fmtTime(nxt.start)} – ${fmtTime(nxt.end)}</span>${KIND[nxt.kind] || nxt.section ? `<span>${btnSvg('users')}${esc([KIND[nxt.kind], nxt.section].filter(Boolean).join(' · '))}</span>` : ''}<span>${btnSvg(nxt.mode === 'online' ? 'video' : 'pin')}${esc(nxt.mode === 'online' ? 'Online' : nxt.venue || 'Venue not set')}</span></div></div>
      ${nxt.link ? `<button class="btn primary" data-act="join" data-link="${esc(nxt.link)}">${btnSvg('video')}Join meeting</button>` : ''}</div>`;
  }

  // today's classes
  const todays = Planner.occurrencesOn(today, PL);
  const STATUS = Planner.STATUS;
  const classesCol = PL.classes.length ? `<div>${head('Today’s classes', '<button class="link" data-act="app" data-id="timetable">Timetable</button>')}
    ${todays.length ? `<ul class="rows">${todays.map((o) => {
      const done = Planner.at(today, o.end) < now.getTime(); const live = Planner.at(today, o.start) <= now.getTime() && !done;
      const chip = STATUS[o.status];
      return `<li class="${o.live ? '' : 'off'}${done ? ' past' : ''}${live ? ' live' : ''}" data-c="${esc(o.cls.color)}"><span class="time">${fmtTime(o.start)}</span><span class="rail"></span>
        <span class="main-t"><b>${esc(classLabel(o.cls))}${classSub(o.cls) ? ` <span class="sub-name">${esc(classSub(o.cls))}</span>` : ''}</b><small>${esc([KIND[o.kind], o.section, o.status === 'cancelled' ? '' : o.mode === 'online' ? 'Online' : o.venue].filter(Boolean).join(' · '))}</small></span>${chip ? `<span class="chip ${chip[1]}">${chip[0]}</span>` : ''}</li>`;
    }).join('')}</ul>` : `<p class="muted rows-empty">${Planner.inBreak(today, PL.semester) ? 'It’s a break. No classes today.' : 'No classes today.'}</p>`}</div>` : '';

  // tasks
  const tasks = PL.tasks.filter((t) => ['overdue', 'today'].includes(Planner.bucket(t, today)));
  const soon = PL.tasks.filter((t) => Planner.bucket(t, today) === 'upcoming').sort((a, b) => a.due.localeCompare(b.due)).slice(0, Math.max(0, 4 - tasks.length));
  const taskLi = (t) => { const c = PL.classes.find((k) => k.id === t.classId);
    return `<li class="task mini" data-id="${esc(t.id)}"><button class="check" data-act="task" aria-pressed="false" aria-label="Mark done">${btnSvg('check')}</button><span class="t-text">${esc(t.text)}</span>${c ? `<span class="cls-chip" data-c="${esc(c.color)}"><i></i>${esc(classLabel(c))}</span>` : ''}${t.due && t.due < today ? '<span class="chip bad">Late</span>' : t.due && t.due > today ? `<span class="chip">${esc(fmtDate(t.due))}</span>` : ''}</li>`; };
  const tasksCol = `<div>${head(tasks.length || !soon.length ? 'Due today' : 'Coming up', '<button class="link" data-act="app" data-id="tasks">All tasks</button>')}
    <ul class="rows">${tasks.map(taskLi).join('')}${soon.length && tasks.length ? '<li class="sub">Coming up</li>' : ''}${soon.map(taskLi).join('')}
    <li class="add"><form class="quick-add" autocomplete="off">${btnSvg('plus')}<input name="task" maxlength="300" placeholder="Add a task for today" aria-label="Add a task for today"></form></li></ul></div>`;

  // apps + remembered splits
  const splits = L.splits.map((s, i) => `<button class="tile-b" data-act="split" data-i="${i}" title="${esc(splitTitle(s))}"><span class="pair">${leaves(s.tile).slice(0, 3).map((id) => `<i class="app-mini" data-c="${esc(BY[id]?.color || '#999')}">${BY[id] ? glyph(BY[id]) : ''}</i>`).join('')}</span><span class="tb-text"><b>${esc(splitTitle(s))}</b><small>Split</small></span></button>`).join('');
  const apps = `${head('Jump back in')}<div class="tiles">
    ${SV.map((s) => `<button class="tile-b" data-act="app" data-id="${esc(s.id)}"><span class="app-sq" data-c="${esc(s.color)}">${glyph(s)}</span><span class="tb-text"><b>${esc(s.name)}</b>${unread[s.id] ? `<small>${unread[s.id] > 99 ? '99+' : unread[s.id]} unread</small>` : ''}</span></button>`).join('')}${splits}</div>`;

  // recent files
  const recent = [...[...DL.values()].filter((x) => x.state === 'completed').map((x) => ({ kind: 'dl', id: x.id, name: x.name, ts: x.ts, viewable: x.viewable })),
    ...SHOTS.map((x) => ({ kind: 'shot', id: x.id, name: x.name, ts: x.ts, viewable: true }))].sort((a, b) => b.ts - a.ts).slice(0, 4);
  const recentSec = recent.length ? `${head('Recent files', '<button class="link" data-act="downloads">Downloads</button>')}<ul class="rows">${recent.map((r) => `<li><button class="file-row" data-act="${r.kind}" data-id="${esc(r.id)}" data-view="${r.viewable}"><span class="ext">${esc((r.name.match(/\.([a-z0-9]{1,4})$/i)?.[1] || 'file').toUpperCase())}</span><span class="nm">${esc(r.name)}</span><span class="muted small">${esc(ago(r.ts))}</span><span class="go">${r.viewable ? 'View' : 'Open'}</span></button></li>`).join('')}</ul>` : '';

  const keep = document.activeElement?.name === 'task' && el.contains(document.activeElement) ? document.activeElement.value : null;
  el.innerHTML = `<div class="today-page">
    <div class="eyebrow">${DAYS_LONG[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}${weekChip ? ` <span class="chip">${esc(weekChip)}</span>` : ''}</div>
    <h1>${esc(greeting())}${name ? `, ${esc(name)}` : ''}</h1>
    ${askName ? `<form class="nick" autocomplete="off"><label for="nick">What should WakeUp call you?</label><input id="nick" name="nick" maxlength="30" placeholder="Your nickname"><button class="btn primary small">Save</button><button type="button" class="btn small ghost" data-act="nick-skip">Not now</button></form>` : ''}
    <section>${next}</section>
    <section class="cols${classesCol ? '' : ' one'}">${classesCol}${tasksCol}</section>
    <section>${apps}</section>
    ${recentSec ? `<section>${recentSec}</section>` : ''}
  </div>`;
  paint(el);
  if (keep !== null) { const i = $('[name="task"]', el); i.value = keep; i.focus(); }
}

function onTodayClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act; const id = b.dataset.id;
  if (act === 'app') openPane(id);
  else if (act === 'split') { const s = L.splits[Number(b.dataset.i)]; if (s) openPane(s.focused); }
  else if (act === 'join') hub.openLink(b.dataset.link);
  else if (act === 'downloads') toggleDownloads(true);
  else if (act === 'dl') { if (b.dataset.view === 'true') hub.viewDownload(id, 'full'); else hub.download(id, 'open'); }
  else if (act === 'shot') hub.shotAction(id, 'view', 'full');
  else if (act === 'nick-skip') { store.set('nickDismissed', true); renderToday(); }
  else if (act === 'task') {
    const tid = b.closest('[data-id]').dataset.id;
    b.closest('.task').classList.add('just-done');
    setTimeout(() => savePlanner({ tasks: PL.tasks.map((t) => (t.id === tid ? { ...t, done: true, doneAt: Date.now() } : t)) }), 250);
  }
}
function onTodaySubmit(e) {
  e.preventDefault();
  const f = e.target;
  if (f.classList.contains('nick')) { const v = f.nick.value.trim(); if (v) hub.setSettings({ nickname: v }); return; }
  if (f.classList.contains('quick-add')) {
    const text = f.task.value.trim(); if (!text) return;
    f.task.value = '';
    savePlanner({ tasks: [{ id: newId('t'), text, done: false, due: Planner.today(), classId: null, created: Date.now(), doneAt: null }, ...PL.tasks] });
  }
}
