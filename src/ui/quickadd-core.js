'use strict';
// Plain-language quick add (v3, A2), shared by both apps: "lab report fri CSP1123" → a task due Friday for CSP1123.
// Everything runs on the device, no AI and no network. It reads, in English:
//   dates   today · tonight · tomorrow / tmr / tmrw · mon…sun (the next one, today included) · next fri (the week after)
//           this fri · in 3 days · in 2 weeks · next week (its first day) · 25/11 · 25 nov · nov 25 · 2026-11-25
//   class   a class code (CSP1123) or "next class" / "next CSP1123" (due when that class next meets)
//   exams   exam · test · quiz · midterm · final → an exam; then a time (5pm, 5:30pm, 17:00) and "@CQAR1009" count too
// Words it used are taken out of the title ("by", "on", "due" before them too); the exam word stays in the title.
// No dependencies.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.QuickAdd = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)';
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const EXAM_RE = /\b(exams?|tests?|quiz(?:zes)?|mid-?terms?|finals?)\b/i;

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dayIdx = (w) => DAYS.indexOf(w.slice(0, 3).toLowerCase());
  const realDate = (y, m, d) => { const x = new Date(y, m - 1, d, 12); return x.getMonth() === m - 1 && x.getDate() === d ? ymd(x) : null; };
  // a day and month without a year: this year, or next year if that date has already passed
  const upcomingDate = (today, m, d) => {
    const y = parseYmd(today).getFullYear();
    const a = realDate(y, m, d); if (a && a >= today) return a;
    return realDate(y + 1, m, d);
  };
  const time = (h, min, ap) => {
    let hh = Number(h); const mm = min ? Number(min) : 0;
    if (mm > 59) return null;
    if (ap) { if (hh < 1 || hh > 12) return null; ap = ap.toLowerCase(); if (ap === 'pm' && hh !== 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0; }
    else if (hh > 23) return null;
    return `${pad(hh)}:${pad(mm)}`;
  };

  // opts: { today: 'YYYY-MM-DD', weekStart: 0|1, classes: [{id, code, name}], nextMeeting(classId, today) → date|null }
  // → { text, due (undefined = not said), classId (undefined = not said), exam, at, venue, found: [{kind, label}] }
  function parse(input, opts = {}) {
    const today = opts.today || ymd(new Date());
    const weekStart = opts.weekStart === 0 ? 0 : 1;
    const classes = (opts.classes || []).filter((c) => c && c.id && c.code);
    let s = ` ${String(input || '').replace(/\s+/g, ' ').trim()} `;
    const out = { text: '', due: undefined, classId: undefined, exam: false, at: null, venue: '', found: [] };
    // cut one match out of the text (with a "by/on/due/at" just before it)
    const take = (re, fn) => {
      const m = s.match(re); if (!m) return false;
      const r = fn(m); if (r === false) return false;
      s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`.replace(/ (by|on|due|at|for|before) +$/i, ' ');
      return true;
    };
    const setDue = (d, label) => { if (out.due === undefined && d) { out.due = d; out.found.push({ kind: 'due', label }); return true; } return false; };

    out.exam = EXAM_RE.test(s);
    if (out.exam) out.found.push({ kind: 'exam', label: 'Exam' });

    // class: "next class" needs a class, so read the class first
    const byCode = new Map(classes.map((c) => [c.code.toLowerCase(), c]));
    let nextOf = null;
    // the first word that is one of your class codes (a room like CQAR1009 looks the same, so check each)
    const codeAt = (prefix) => {
      for (const m of s.matchAll(new RegExp(` ${prefix}#?([A-Za-z]{2,5}\\d{3,5}[A-Za-z]?)(?= )`, 'gi'))) {
        const c = byCode.get(m[1].toLowerCase()); if (c) return { c, re: new RegExp(` ${prefix}#?${m[1]}(?= )`, 'i') };
      }
      return null;
    };
    const nx = codeAt('next ');
    if (nx) take(nx.re, () => { out.classId = nx.c.id; nextOf = nx.c; return undefined; });
    else { const k = codeAt(''); if (k) take(k.re, () => { out.classId = k.c.id; return undefined; }); }
    if (out.classId) out.found.push({ kind: 'class', label: classes.find((c) => c.id === out.classId).code });
    if (!nextOf && out.classId) take(/ (?:by |before |for )?(?:the )?next (?:class|lecture|tutorial|lab|meeting)(?= )/i, () => { nextOf = classes.find((c) => c.id === out.classId); return undefined; });
    if (nextOf && opts.nextMeeting) setDue(opts.nextMeeting(nextOf.id, today), `Next ${nextOf.code}`);

    // dates
    if (out.due === undefined) take(/ (\d{4})-(\d{2})-(\d{2})(?= )/, (m) => setDue(realDate(+m[1], +m[2], +m[3]), m[0].trim()) || false);
    if (out.due === undefined) take(/ (?:today|tonight|tdy)(?= )/i, () => setDue(today, 'Today') || false);
    if (out.due === undefined) take(/ (?:tomorrow|tmrw?|tmr|tmw)(?= )/i, () => setDue(addDays(today, 1), 'Tomorrow') || false);
    if (out.due === undefined) take(/ in (\d{1,3}) (day|days|week|weeks)(?= )/i, (m) => setDue(addDays(today, +m[1] * (/week/i.test(m[2]) ? 7 : 1)), `In ${m[1]} ${m[2].toLowerCase()}`) || false);
    if (out.due === undefined) take(/ next week(?= )/i, () => {
      const wd = parseYmd(today).getDay(); const toStart = (7 + weekStart - wd) % 7 || 7;
      return setDue(addDays(today, toStart), 'Next week') || false;
    });
    if (out.due === undefined) take(new RegExp(` (next |this )?${DAY_RE}(?= )`, 'i'), (m) => {
      const want = dayIdx(m[2]); const wd = parseYmd(today).getDay();
      let n = (7 + want - wd) % 7; if (/next/i.test(m[1] || '')) n += 7;
      return setDue(addDays(today, n), `${m[1] ? `${m[1].trim()[0].toUpperCase()}${m[1].trim().slice(1)} ` : ''}${DAYS[want][0].toUpperCase()}${DAYS[want].slice(1)}`) || false;
    });
    if (out.due === undefined) take(/ (\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?= )/, (m) => { // day/month (Malaysia writes the day first)
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
      return setDue(y ? realDate(y, +m[2], +m[1]) : upcomingDate(today, +m[2], +m[1]), m[0].trim()) || false;
    });
    if (out.due === undefined) take(new RegExp(` (\\d{1,2})(?:st|nd|rd|th)? ${MON_RE}(?= )`, 'i'), (m) => setDue(upcomingDate(today, MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]), m[0].trim()) || false);
    if (out.due === undefined) take(new RegExp(` ${MON_RE} (\\d{1,2})(?:st|nd|rd|th)?(?= )`, 'i'), (m) => setDue(upcomingDate(today, MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]), m[0].trim()) || false);

    // exams only: a time and a venue
    if (out.exam) {
      take(/ (?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)(?= )/i, (m) => { const t = time(m[1], m[2], m[3]); if (!t) return false; out.at = t; return undefined; })
        || take(/ (?:at )?([01]?\d|2[0-3]):([0-5]\d)(?= )/, (m) => { out.at = time(m[1], m[2]); return undefined; })
        || take(/ (?:at )?noon(?= )/i, () => { out.at = '12:00'; return undefined; });
      if (out.at) out.found.push({ kind: 'at', label: out.at });
      take(/ @ ?([^@\s]+)(?= )/, (m) => { out.venue = m[1].slice(0, 80); return undefined; });
      if (out.venue) out.found.push({ kind: 'venue', label: out.venue });
    }

    const text = s.replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '').trim();
    out.text = text || String(input || '').trim();
    return out;
  }

  return { parse };
}));
