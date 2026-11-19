'use strict';
/* global hub, fillTabStrip, TABS, FindBar, PL:writable, WEEK_START:writable, LABEL_MODE:writable, plannerListeners, plannerUpdated, TasksView, TimetableView, $ */
// A popped-out pane's window. For a web app the view fills it and this page only holds the find bar;
// Timetable and Tasks are drawn right here.
const id = new URLSearchParams(location.search).get('id');
if (id === 'tasks' || id === 'timetable') {
  document.body.classList.add('pop-local');
  const root = document.createElement('div'); root.className = 'local-root'; document.body.append(root);
  hub.init().then((s) => {
    PL = s.planner; WEEK_START = s.settings.weekStart; LABEL_MODE = s.settings.classLabel || 'code'; applyAccent(s.settings.accent);
    const view = id === 'tasks' ? TasksView(root) : TimetableView(root);
    plannerListeners.add(() => view.render());
    hub.onPlanner(plannerUpdated);
    hub.onSettings((p) => {
      const lm = p.settings.classLabel || 'code'; applyAccent(p.settings.accent);
      if (p.settings.weekStart !== WEEK_START || lm !== LABEL_MODE) { WEEK_START = p.settings.weekStart; LABEL_MODE = lm; view.render(); }
    });
    setInterval(() => view.tick?.(), 30e3);
  });
  $('#popbar').remove();
} else {
  const bar = FindBar(id, document.getElementById('popbar'), (open) => { document.body.classList.toggle('finding', open); if (open) hub.findBar(id, true); });
  // the app's tabs sit just above the page (main moves the page down to make room)
  const strip = document.createElement('div'); strip.className = 'tabstrip pop-tabs'; strip.hidden = true; document.body.append(strip);
  const fill = () => fillTabStrip(strip, id, TABS[id]?.name || 'App');
  hub.onTabs((info) => { if (info.id === id) { TABS[id] = info; fill(); } });
  hub.tabs().then((list) => { const t = (list || []).find((x) => x.id === id); if (t) { TABS[id] = t; fill(); } });
  hub.onCmd(({ name, arg }) => { if (name === 'find' && arg === id) bar.open(); });
  hub.onFound((r) => { if (r.id === id) bar.found(r); });
}
