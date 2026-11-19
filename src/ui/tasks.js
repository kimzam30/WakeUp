'use strict';
/* global showNotice, Focus, FocusCore, PL, Planner, savePlanner, esc, h, $, $$, paint, newId, fmtDate, classLabel, classFull, classIcon, emptyArt, btnSvg */
/* eslint-disable no-unused-vars */
// Tasks: a fast local to-do list. Each task can have a due date and belong to a class.

const TASK_GROUPS = [
  ['overdue', 'Late', 'late'], ['today', 'Today', ''], ['upcoming', 'Coming up', ''], ['someday', 'Someday', ''], ['done', 'Done', 'done'],
];
function dueLabel(due, today) {
  if (!due) return '';
  const d = Planner.daysBetween(today, due);
  return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : d < 0 ? `${-d} days late` : d < 7 ? fmtDate(due).split(' ')[0] : fmtDate(due);
}

function TasksView(root) {
  const st = { due: 'today', classId: '', exam: false, showDone: false, editing: null };
  // Undo for finishing and deleting (only the main window has the notice area)
  const undo = (title, run) => { if (typeof showNotice === 'function') showNotice({ kind: 'success', title, actions: [{ label: 'Undo', run }] }); };
  root.classList.add('lv', 'tasks-view');
  root.innerHTML = `
    <header class="lv-head"><div class="lv-title"><h2>Tasks</h2><span class="lv-sub"></span></div><div class="focus-box"></div></header>
    <form class="task-add" autocomplete="off">
      <span class="add-ico">${btnSvg('plus')}</span>
      <input name="text" maxlength="300" placeholder="Add a task, then press Enter" aria-label="New task">
      <div class="add-opts">
        <div class="chips" role="radiogroup" aria-label="Due">
          <button type="button" role="radio" data-due="today">Today</button><button type="button" role="radio" data-due="tomorrow">Tomorrow</button><button type="button" role="radio" data-due="">No date</button><button type="button" role="radio" data-due="next" hidden title="The next time this class meets">Next class</button>
          <label class="chip-date" title="Pick a date">${btnSvg('cal')}<span class="cd-lbl"></span><input type="date" name="date" aria-label="Due date"></label>
          <button type="button" class="exam-tog" data-exam aria-pressed="false" title="An exam or test: shows a countdown on Today">${btnSvg('exam')}Exam</button>
        </div>
        <select name="cls" aria-label="Class"></select>
      </div>
    </form>
    <div class="task-groups"></div>`;
  const form = $('.task-add', root); const input = $('[name="text"]', form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    const today = Planner.today();
    const due = st.due === 'today' ? today : st.due === 'tomorrow' ? Planner.addDays(today, 1) : st.due === 'next' ? Planner.nextMeeting(PL, st.classId, today) : st.due || null;
    savePlanner({ tasks: [{ id: newId('t'), text, done: false, due, classId: st.classId || null, created: Date.now(), doneAt: null, ...(st.exam ? { exam: true, at: null, venue: '' } : null) }, ...PL.tasks] });
    input.value = '';
    // the next task starts fresh: no class, due today, not an exam (audit M1)
    st.classId = ''; st.due = 'today'; st.exam = false; $('[name="date"]', form).value = ''; render();
  });
  form.addEventListener('click', (e) => { if (e.target.closest('[data-exam]')) { st.exam = !st.exam; render(); input.focus(); return; } const b = e.target.closest('[data-due]'); if (b) { st.due = b.dataset.due; $('[name="date"]', form).value = ''; render(); input.focus(); } });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'date' && e.target.value) { st.due = e.target.value; render(); }
    if (e.target.name === 'cls') { st.classId = e.target.value; if (!st.classId && st.due === 'next') st.due = 'today'; render(); }
  });

  const list = $('.task-groups', root);
  const update = (id, patch) => savePlanner({ tasks: PL.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.closest('[data-id]')?.dataset.id;
    if (b.dataset.act === 'toggle') {
      const t = PL.tasks.find((x) => x.id === id); if (!t) return;
      if (!t.done) {
        b.closest('.task').classList.add('just-done');
        setTimeout(() => { update(id, { done: true, doneAt: Date.now() }); undo(`Done: ${t.text}`, () => update(id, { done: false, doneAt: null })); }, 250);
      } else update(id, { done: false, doneAt: null });
    } else if (b.dataset.act === 'del') {
      const at = PL.tasks.findIndex((t) => t.id === id); const t = PL.tasks[at]; if (!t) return;
      savePlanner({ tasks: PL.tasks.filter((x) => x.id !== id) });
      undo(`Deleted: ${t.text}`, () => { if (PL.tasks.some((x) => x.id === id)) return; const tasks = [...PL.tasks]; tasks.splice(Math.min(at, tasks.length), 0, t); savePlanner({ tasks }); });
    } else if (b.dataset.act === 'exam') {
      // turning it off removes the exam fields, so the task goes back to its old shape
      savePlanner({ tasks: PL.tasks.map((x) => { if (x.id !== id) return x; if (!x.exam) return { ...x, exam: true, at: null, venue: '' }; const y = { ...x }; delete y.exam; delete y.at; delete y.venue; return y; }) });
    }
    else if (b.dataset.act === 'show-done') { st.showDone = !st.showDone; render(); }
    else if (b.dataset.act === 'clear-done') savePlanner({ tasks: PL.tasks.filter((t) => !t.done) });
    else if (b.dataset.act === 'focus-add') input.focus();
    else if (b.dataset.act === 'focus-task') Focus.act('start', id);
  });
  list.addEventListener('dblclick', (e) => { const t = e.target.closest('.t-text'); if (t) { st.editing = t.closest('[data-id]').dataset.id; render(); } });
  list.addEventListener('change', (e) => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (e.target.name === 'due') update(id, { due: e.target.value || null });
    if (e.target.name === 'at') update(id, { at: e.target.value || null });
    if (e.target.name === 'venue') update(id, { venue: e.target.value.trim().slice(0, 80) });
  });
  list.addEventListener('keydown', (e) => {
    if (e.target.name !== 'edit') return;
    if (e.key === 'Enter') { const v = e.target.value.trim(); const id = st.editing; st.editing = null; if (v) update(id, { text: v }); else render(); }
    if (e.key === 'Escape') { e.stopPropagation(); st.editing = null; render(); }
  });
  list.addEventListener('focusout', (e) => { if (e.target.name === 'edit' && st.editing) { const v = e.target.value.trim(); const id = st.editing; st.editing = null; if (v) update(id, { text: v }); else render(); } });

  function taskRow(t, today) {
    const c = PL.classes.find((k) => k.id === t.classId);
    const late = !t.done && t.due && t.due < today;
    const text = st.editing === t.id ? `<input name="edit" value="${esc(t.text)}" maxlength="300" aria-label="Edit task">` : `<span class="t-text" title="Double-click to edit">${esc(t.text)}</span>`;
    return `<li class="task${t.done ? ' done' : ''}" data-id="${esc(t.id)}">
      <button class="check" data-act="toggle" aria-pressed="${t.done}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}">${btnSvg('check')}</button>
      <div class="t-main">${text}<div class="t-meta">
        ${t.exam ? `<span class="exam-chip">${btnSvg('exam')}Exam</span><input class="mini-in" type="time" name="at" value="${esc(t.at || '')}" aria-label="Exam start time"><input class="mini-in venue" name="venue" value="${esc(t.venue || '')}" placeholder="Where" maxlength="80" aria-label="Exam venue">` : ''}
        ${c ? `<span class="cls-chip" data-c="${esc(c.color)}"><i></i>${esc(classFull(c))}</span>` : ''}
        <label class="due-chip${late ? ' late' : ''}"><span>${t.due ? esc(dueLabel(t.due, today)) : 'Add date'}</span><input type="date" name="due" value="${esc(t.due || '')}" aria-label="Due date"></label>
      </div></div>
      ${t.done ? '' : `<button class="hbtn fo${Focus.taskId() === t.id ? ' on' : ''}" data-act="focus-task" aria-label="Focus on this task" title="Focus on this task for ${Focus.lengths().focus} minutes">${btnSvg('target')}</button>`}
      ${t.done ? '' : `<button class="hbtn ex${t.exam ? ' on' : ''}" data-act="exam" aria-pressed="${!!t.exam}" aria-label="${t.exam ? 'Not an exam' : 'Mark as an exam'}" title="${t.exam ? 'Not an exam' : 'Mark as an exam (countdown on Today)'}">${btnSvg('exam')}</button>`}
      <button class="hbtn del" data-act="del" aria-label="Delete task" title="Delete">${btnSvg('trash')}</button></li>`;
  }

  function render() {
    const today = Planner.today();
    const groups = Object.fromEntries(TASK_GROUPS.map(([k]) => [k, []]));
    for (const t of PL.tasks) groups[Planner.bucket(t, today)].push(t);
    groups.upcoming.sort((a, b) => a.due.localeCompare(b.due));
    groups.overdue.sort((a, b) => a.due.localeCompare(b.due));
    groups.done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    const open = PL.tasks.length - groups.done.length;
    $('.lv-sub', root).textContent = !PL.tasks.length ? 'Your to-do list'
      : [groups.overdue.length && `${groups.overdue.length} late`, groups.today.length && `${groups.today.length} due today`, `${open} to do`].filter(Boolean).join(' · ');
    // add form
    $$('[data-due]', form).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.due === st.due)));
    $('[data-exam]', form).setAttribute('aria-pressed', String(st.exam));
    const custom = st.due && !['today', 'tomorrow', 'next'].includes(st.due);
    $('.chip-date', form).classList.toggle('on', custom);
    $('.cd-lbl', form).textContent = custom ? fmtDate(st.due) : '';
    const sel = $('[name="cls"]', form);
    if (st.classId && !PL.classes.some((c) => c.id === st.classId)) st.classId = '';
    sel.innerHTML = `<option value="">No class</option>${PL.classes.map((c) => `<option value="${esc(c.id)}"${c.id === st.classId ? ' selected' : ''}>${esc(classFull(c))}</option>`).join('')}`;
    sel.hidden = !PL.classes.length;
    const nextBtn = $('[data-due="next"]', form); const nextDate = st.classId ? Planner.nextMeeting(PL, st.classId, today) : null;
    nextBtn.hidden = !nextDate; nextBtn.title = nextDate ? `Due ${fmtDate(nextDate)}, the next time this class meets` : '';
    if (st.due === 'next' && !nextDate) st.due = 'today';
    // groups
    if (!open && !groups.done.length) {
      list.innerHTML = `<div class="empty">${emptyArt('check')}<h3>No tasks yet</h3><p>Type a task above and press Enter. Give it a date or a class if you like.</p></div>`;
      return;
    }
    let html = '';
    for (const [k, label, tone] of TASK_GROUPS) {
      const items = groups[k]; if (!items.length) continue;
      if (k === 'done') {
        html += `<section class="t-group done"><div class="t-head"><button class="link" data-act="show-done" aria-expanded="${st.showDone}">${st.showDone ? 'Hide' : 'Show'} ${items.length} done</button>${st.showDone ? '<button class="link" data-act="clear-done">Clear done</button>' : ''}</div>${st.showDone ? `<ul>${items.map((t) => taskRow(t, today)).join('')}</ul>` : ''}</section>`;
      } else html += `<section class="t-group${tone ? ` ${tone}` : ''}"><div class="t-head"><h3>${label}</h3><span class="n">${items.length}</span></div><ul>${items.map((t) => taskRow(t, today)).join('')}</ul></section>`;
    }
    if (!open) html = `<div class="empty small">${emptyArt('check')}<h3>All done</h3><p>Nothing left to do. Add the next thing above.</p></div>${html}`;
    const editing = st.editing;
    list.innerHTML = html;
    paint(list);
    if (editing) { const i = $('[name="edit"]', list); i?.focus(); i?.select(); }
  }
  Focus.mount($('.focus-box', root));
  render();
  return { render, focus: () => input.focus() };
}
