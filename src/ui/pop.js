'use strict';
/* global hub, FindBar */
// A popped-out pane's window: the web view fills it; this page only shows the find bar above it.
const id = new URLSearchParams(location.search).get('id');
const bar = FindBar(id, document.getElementById('popbar'), (open) => { if (open) hub.findBar(id, true); });
hub.onCmd(({ name, arg }) => { if (name === 'find' && arg === id) bar.open(); });
hub.onFound((r) => { if (r.id === id) bar.found(r); });
