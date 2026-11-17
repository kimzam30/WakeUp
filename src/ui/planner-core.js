'use strict';
// Timetable + task logic shared by the shell UI (window.Planner) and main (require). Dates are local, 'YYYY-MM-DD'.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Planner = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const mins = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const at = (date, hm) => { const d = parse(date); d.setMinutes(mins(hm)); return d.getTime(); };
  const weekday = (s) => parse(s).getDay(); // 0 = Sunday
  const startOfWeek = (s, weekStart = 1) => addDays(s, -((weekday(s) - weekStart + 7) % 7));
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);

  const inBreak = (date, sem) => (sem.breaks || []).find((b) => date >= b.start && date <= b.end) || null;
  // classes run every week inside the semester (or forever, if no semester dates are set), except during breaks
  const teaching = (date, sem) => (!sem.start || date >= sem.start) && (!sem.end || date <= sem.end) && !inBreak(date, sem);

  // Teaching week number: weeks from the semester's first week, not counting whole break weeks before this one.
  function weekOf(date, sem, weekStart = 1) {
    if (!sem.start) return null;
    const first = startOfWeek(sem.start, weekStart); const wk = startOfWeek(date, weekStart);
    if (date < sem.start) return { before: true, days: daysBetween(date, sem.start) };
    if (sem.end && date > sem.end) return { after: true };
    const br = inBreak(date, sem);
    let n = Math.floor(daysBetween(first, wk) / 7) + 1;
    for (let w = first; w < wk; w = addDays(w, 7)) {
      let off = 0; for (let i = 0; i < 7; i++) if (inBreak(addDays(w, i), sem)) off++;
      if (off >= 5) n--; // a break covering the working week doesn't count as a teaching week
    }
    return { week: n, break: br ? br.label : null };
  }

  const byClass = (p) => Object.fromEntries(p.classes.map((c) => [c.id, c]));

  // Everything happening on a date, with one-off changes applied. Cancelled/moved-away classes stay in the list
  // (shown struck through) so the change is visible; `live` says whether it actually takes place.
  function occurrencesOn(date, p) {
    const classes = byClass(p); const out = [];
    const dow = weekday(date); const sem = p.semester;
    const changesFor = (sid, d) => p.changes.filter((x) => x.sessionId === sid && x.date === d);
    for (const c of p.classes) {
      for (const s of c.sessions) {
        if (s.day === dow && teaching(date, sem)) {
          const o = { key: `${s.id}@${date}`, date, classId: c.id, cls: c, sessionId: s.id, kind: s.kind, section: s.section, start: s.start, end: s.end, venue: s.venue, mode: s.mode, link: s.link, status: 'normal', live: true, change: null };
          for (const x of changesFor(s.id, date)) {
            o.change = x;
            if (x.type === 'cancelled') { o.status = 'cancelled'; o.live = false; }
            if (x.type === 'online') { o.status = 'online'; o.mode = 'online'; o.link = x.link || s.link; }
            if (x.type === 'moved') { o.status = 'moved'; o.live = false; o.toDate = x.toDate; }
          }
          out.push(o);
        }
      }
    }
    for (const x of p.changes) {
      if (x.type === 'moved' && x.toDate === date) { // a class moved here from another day
        const c = p.classes.find((k) => k.sessions.some((s) => s.id === x.sessionId)); if (!c) continue;
        const s = c.sessions.find((k) => k.id === x.sessionId);
        out.push({ key: `${x.id}@${date}`, date, classId: c.id, cls: c, sessionId: s.id, kind: s.kind, section: s.section, start: x.start || s.start, end: x.end || s.end, venue: x.venue || s.venue, mode: x.link ? 'online' : s.mode, link: x.link || s.link, status: 'moved-in', fromDate: x.date, live: true, change: x });
      }
      if (x.type === 'replacement' && x.date === date && classes[x.classId]) {
        const c = classes[x.classId];
        out.push({ key: `${x.id}@${date}`, date, classId: c.id, cls: c, sessionId: null, kind: 'lecture', section: '', start: x.start, end: x.end, venue: x.venue, mode: x.link ? 'online' : 'campus', link: x.link, status: 'replacement', live: true, change: x, note: x.note });
      }
    }
    return out.sort((a, b) => mins(a.start) - mins(b.start) || a.cls.name.localeCompare(b.cls.name));
  }

  // Classes that will take place from `from` over the next `days` days, soonest first.
  function upcoming(p, from = new Date(), days = 7) {
    const today = ymd(from); const now = from.getTime(); const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(today, i);
      for (const o of occurrencesOn(d, p)) {
        if (!o.live) continue;
        const startsAt = at(d, o.start); const endsAt = at(d, o.end);
        if (endsAt > now) out.push({ ...o, startsAt, endsAt });
      }
    }
    return out.sort((a, b) => a.startsAt - b.startsAt);
  }

  // Task buckets for grouping and badges.
  function bucket(t, today) {
    if (t.done) return 'done';
    if (!t.due) return 'someday';
    return t.due < today ? 'overdue' : t.due === today ? 'today' : 'upcoming';
  }

  // Class icons are line-icon keys. Older versions stored an emoji and a pastel colour; map those across.
  const ICON_KEYS = ['code', 'sigma', 'flask', 'chart', 'book', 'cpu', 'brief', 'pen', 'globe', 'chat', 'db', 'music', 'palette', 'scale'];
  const LEGACY_ICON = { '📘': 'book', '📗': 'book', '📕': 'book', '📙': 'book', '💻': 'code', '🧪': 'flask', '🧬': 'flask', '🔬': 'flask', '📐': 'sigma', '📊': 'chart',
    '🧮': 'sigma', '🌍': 'globe', '🎨': 'palette', '🎵': 'music', '⚙️': 'cpu', '🤖': 'cpu', '🧠': 'book', '💼': 'brief', '⚖️': 'scale', '🗣️': 'chat', '📝': 'pen', '🏛️': 'scale', '📡': 'db', '🎬': 'palette' };
  const LEGACY_COLOR = { '#ff7a6b': '#d0573a', '#ff9f43': '#c2410c', '#f2b100': '#b7791f', '#4fd1a5': '#0f8a8a', '#22b07d': '#1f9d63', '#4aa8ff': '#2f6fde', '#8b6cf6': '#7c5cd6', '#e86fb5': '#b4417a' };
  const classIconKey = (v) => (ICON_KEYS.includes(v) ? v : LEGACY_ICON[v] || '');
  const classColor = (v) => LEGACY_COLOR[String(v).toLowerCase()] || v;

  return { ymd, parse, addDays, mins, at, weekday, startOfWeek, daysBetween, inBreak, teaching, weekOf, occurrencesOn, upcoming, bucket, today: () => ymd(new Date()), ICON_KEYS, classIconKey, classColor };
}));
