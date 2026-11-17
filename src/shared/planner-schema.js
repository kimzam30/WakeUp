'use strict';
// Validates a timetable + task list ("planner") wherever it comes from: disk, the UI, an imported file or the cloud.
// Shared by the desktop app and the Android app, so both accept exactly the same data.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../ui/planner-core.js'));
  else root.PlannerSchema = factory(root.Planner);
}(typeof self !== 'undefined' ? self : this, (Planner) => {
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  const num = (v, lo, hi, d) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const oneOf = (v, list, d) => (list.includes(v) ? v : d);
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const safeUrl = (u) => { try { return new URL(u); } catch { return null; } };
  const YMD = /^\d{4}-\d{2}-\d{2}$/; const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const ymd = (v) => (typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  const hm = (v) => (typeof v === 'string' && HM.test(v) ? v : null);
  const httpsLink = (v) => { const u = safeUrl(text(v, 2000)); return u && u.protocol === 'https:' ? u.href : ''; };
  const ident = (v, prefix) => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? v : `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  const emptyPlanner = () => ({ semester: { name: '', start: null, end: null, breaks: [] }, classes: [], changes: [], tasks: [] });
  function cleanPlanner(raw) {
    const r = isObj(raw) ? raw : {};
    const sem = isObj(r.semester) ? r.semester : {};
    let start = ymd(sem.start); let end = ymd(sem.end);
    if (start && end && end < start) [start, end] = [end, start];
    const semester = {
      name: text(sem.name, 60), start, end,
      breaks: (Array.isArray(sem.breaks) ? sem.breaks : []).slice(0, 10).filter(isObj)
        .map((b) => ({ start: ymd(b.start), end: ymd(b.end) || ymd(b.start), label: text(b.label, 40) || 'Break' }))
        .filter((b) => b.start && b.end >= b.start),
    };
    const seen = new Set(); const sessionIds = new Set();
    const classes = (Array.isArray(r.classes) ? r.classes : []).slice(0, 40).filter(isObj).map((c) => {
      let id = ident(c.id, 'k'); if (seen.has(id)) id = ident('', 'k'); seen.add(id);
      const sessions = (Array.isArray(c.sessions) ? c.sessions : []).slice(0, 12).filter(isObj).map((x) => {
        let sid = ident(x.id, 's'); if (sessionIds.has(sid)) sid = ident('', 's'); sessionIds.add(sid);
        return {
          id: sid, kind: oneOf(x.kind, ['lecture', 'tutorial', 'lab'], 'lecture'), section: text(x.section, 20),
          day: Math.round(num(x.day, 0, 6, 1)), start: hm(x.start) || '09:00', end: hm(x.end) || '10:00',
          venue: text(x.venue, 80), mode: oneOf(x.mode, ['campus', 'online'], 'campus'), link: httpsLink(x.link),
        };
      }).filter((x) => x.end > x.start);
      return {
        id, code: text(c.code, 20), name: text(c.name, 80) || text(c.code, 20) || 'Class',
        icon: Planner.classIconKey(c.icon), color: /^#[0-9a-f]{6}$/i.test(c.color) ? Planner.classColor(c.color) : '#2f6fde', sessions,
      };
    });
    const classIds = new Set(classes.map((c) => c.id));
    // One-off changes to a class meeting, plus notes on one ('note': a quiz, a test, something to bring…).
    // A replacement has its own kind and section; a note points at its meeting with `ref` (a session id, or the id
    // of the replacement or move that created the meeting) and the date.
    const changes = (Array.isArray(r.changes) ? r.changes : []).slice(-1000).filter(isObj).map((x) => {
      const type = oneOf(x.type, ['cancelled', 'online', 'moved', 'replacement', 'note'], null);
      const c = {
        id: ident(x.id, 'x'), type,
        sessionId: sessionIds.has(x.sessionId) ? x.sessionId : null, classId: classIds.has(x.classId) ? x.classId : null,
        date: ymd(x.date), toDate: ymd(x.toDate), start: hm(x.start), end: hm(x.end),
        venue: text(x.venue, 80), link: httpsLink(x.link), note: text(x.note, 200),
      };
      if (type === 'replacement') { c.kind = oneOf(x.kind, ['lecture', 'tutorial', 'lab'], 'lecture'); c.section = text(x.section, 20); }
      if (type === 'note') { c.tag = oneOf(x.tag, Object.keys(Planner.NOTE_TAGS), 'other'); c.ref = typeof x.ref === 'string' && /^[a-z0-9-]{1,40}$/.test(x.ref) ? x.ref : null; }
      return c;
    }).filter((x) => x.type && x.date && (x.type === 'replacement' ? x.classId && x.start && x.end > x.start : x.type === 'note' ? x.classId && x.ref && (x.note || x.tag !== 'other') : x.sessionId)
      && (x.type !== 'moved' || x.toDate) && (!x.start || !x.end || x.end > x.start));
    const tasks = (Array.isArray(r.tasks) ? r.tasks : []).slice(0, 1000).filter(isObj).map((t) => ({
      id: ident(t.id, 't'), text: text(t.text, 300), done: bool(t.done, false), due: ymd(t.due),
      classId: classIds.has(t.classId) ? t.classId : null, created: num(t.created, 0, 1e14, Date.now()), doneAt: t.done ? num(t.doneAt, 0, 1e14, Date.now()) : null,
    })).filter((t) => t.text);
    return { semester, classes, changes, tasks };
  }
  return { cleanPlanner, emptyPlanner, newId: (prefix) => ident('', prefix) };
}));
