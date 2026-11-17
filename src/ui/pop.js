'use strict';
/* global hub, FindBar, PL:writable, WEEK_START:writable, plannerListeners, plannerUpdated, TasksView, TimetableView, $ */
// A popped-out pane's window. For a web app the view fills it and this page only holds the find bar;
// Timetable and Tasks are drawn right here.
const id = new URLSearchParams(location.search).get('id');
if (id === 'tasks' || id === 'timetable') {
  document.body.classList.add('pop-local');
  const root = document.createElement('div'); root.className = 'local-root'; document.body.append(root);
  hub.init().then((s) => {
    PL = s.planner; WEEK_START = s.settings.weekStart;
    const view = id === 'tasks' ? TasksView(root) : TimetableView(root);
    plannerListeners.add(() => view.render());
    hub.onPlanner(plannerUpdated);
    hub.onSettings((p) => { if (p.settings.weekStart !== WEEK_START) { WEEK_START = p.settings.weekStart; view.render(); } });
    setInterval(() => view.tick?.(), 30e3);
  });
  $('#popbar').remove();
} else {
  const bar = FindBar(id, document.getElementById('popbar'), (open) => { if (open) hub.findBar(id, true); });
  hub.onCmd(({ name, arg }) => { if (name === 'find' && arg === id) bar.open(); });
  hub.onFound((r) => { if (r.id === id) bar.found(r); });
}
