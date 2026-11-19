'use strict';
/* global FocusCore, PL, esc, $, btnSvg, classLabel */
/* eslint-disable no-unused-vars */
// Focus mode on the Tasks page (v3, the same as the Android app): focus, then a break (see focus-core.js), with your
// lengths (25/5, 50/10 or your own) and this week's finished sessions by class. It can be tied to a task. Everything
// is saved on this computer, so it keeps running when you switch views or restart WakeUp, and a notification says
// when each phase ends. The card sits in the Tasks header; clicking it opens the Focus panel.
const Focus = (() => {
  const KEY = 'wakeup.focus';
  const load = () => { try { return FocusCore.clean(JSON.parse(localStorage.getItem(KEY))); } catch { return FocusCore.idle(); } };
  let s = load();
  // lengths in minutes (a long break is three short ones); the presets match the phone
  const PRESETS = [['25 / 5', { focus: 25, short: 5, long: 15 }], ['50 / 10', { focus: 50, short: 10, long: 30 }]];
  const okLen = (v, lo, hi, d) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : d);
  const cleanLengths = (v) => ({ focus: okLen(v?.focus, 5, 180, 25), short: okLen(v?.short, 1, 60, 5), long: okLen(v?.long, 1, 90, 15) });
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private storage off */ } };
  let L = cleanLengths(read(`${KEY}.lengths`, null));
  const setLengths = (v) => { L = cleanLengths(v); write(`${KEY}.lengths`, L); draw(); };
  // finished focus sessions, kept 60 days: when, how long, and the task and class it was for
  let log = (read(`${KEY}.log`, []) || []).filter((x) => x && Date.now() - x.at < 60 * 864e5);
  function record(at) {
    const t = PL.tasks.find((x) => x.id === s.taskId);
    log = [...log, { at, mins: L.focus, taskId: s.taskId, classId: t?.classId ?? null }]; write(`${KEY}.log`, log);
  }
  // this week, from Monday
  function week() {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const list = log.filter((x) => x.at >= d.getTime()); const by = new Map();
    for (const x of list) { const v = by.get(x.classId) || { sessions: 0, mins: 0 }; v.sessions++; v.mins += x.mins; by.set(x.classId, v); }
    return { sessions: list.length, mins: list.reduce((a, x) => a + x.mins, 0), byClass: [...by.entries()].sort((a, b) => b[1].mins - a[1].mins) };
  }
  const hours = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
  let timer = null;
  const views = new Set();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private storage off: the timer still runs */ } };
  const set = (next) => { s = next; save(); schedule(); draw(); };

  function tell(ended) {
    const t = PL.tasks.find((x) => x.id === s.taskId);
    const title = ended === 'focus' ? 'Focus done. Take a break.' : 'Break over. Back to it.';
    const body = ended === 'focus' ? `${FocusCore.label[s.phase]}: ${L[s.phase]} minutes${t ? ` · ${t.text}` : ''}` : t ? t.text : 'Next focus has started.';
    globalThis.showNotice?.({ id: 'focus', kind: 'info', title, detail: body });
    try { if (document.hidden || !document.hasFocus()) new Notification(title, { body, silent: false }); } catch { /* notifications off */ }
  }
  function schedule() {
    clearInterval(timer); timer = null;
    if (s.phase === 'idle' || FocusCore.paused(s)) return;
    timer = setInterval(() => {
      const ends = s.endsAt; const r = FocusCore.tick(s, Date.now(), L);
      if (r.ended) { if (r.ended === 'focus') record(ends); s = r.state; save(); tell(r.ended); }
      if (!document.hidden || r.ended) draw(); // nobody's looking: keep time, skip the redraw
    }, 1000);
  }

  // the timer card (in the Tasks header)
  function html() {
    const now = Date.now(); const run = s.phase !== 'idle'; const p = FocusCore.paused(s);
    const t = PL.tasks.find((x) => x.id === s.taskId && !x.done);
    if (!run) {
      return `<button class="btn small" data-focus="start" title="Focus for ${L.focus} minutes, then take a ${L.short}-minute break">${btnSvg('target')}Focus ${L.focus} min</button><button class="hbtn" data-focus="panel" aria-label="Focus lengths and this week's sessions" title="Lengths and this week">${btnSvg('more')}</button>${s.done ? `<span class="fc-done" title="Focus sessions finished today">${s.done} done</span>` : ''}`;
    }
    const left = FocusCore.remaining(s, now);
    const total = L[s.phase] * 60e3;
    return `<div class="fc ${s.phase}${p ? ' paused' : ''}" role="timer" aria-label="${FocusCore.label[s.phase]}, ${FocusCore.clock(left)} left">
      <button class="fc-open" data-focus="panel" aria-label="Open the Focus panel" title="Open the Focus panel"></button>
      <span class="fc-ring" data-p="${Math.max(0, Math.min(1, 1 - left / total)).toFixed(3)}"></span>
      <span class="fc-main"><b>${FocusCore.clock(left)}</b><small>${FocusCore.label[s.phase]}${t ? ` · ${esc(t.text)}` : ''}</small></span>
      <button class="hbtn" data-focus="${p ? 'resume' : 'pause'}" aria-label="${p ? 'Resume' : 'Pause'}" title="${p ? 'Resume' : 'Pause'}">${btnSvg(p ? 'play' : 'hold')}</button>
      <button class="hbtn" data-focus="skip" aria-label="Skip to ${s.phase === 'focus' ? 'the break' : 'focus'}" title="Skip to ${s.phase === 'focus' ? 'the break' : 'focus'}">${btnSvg('forward')}</button>
      <button class="hbtn" data-focus="stop" aria-label="Stop" title="Stop">${btnSvg('close')}</button></div>`;
  }
  // the Focus panel: a big ring, the controls, your lengths and this week by class
  let panel = null; // the open panel element, if any
  function panelHtml() {
    const now = Date.now(); const run = s.phase !== 'idle'; const p = FocusCore.paused(s);
    const total = (run ? L[s.phase] : L.focus) * 60e3; const left = run ? Math.min(total, FocusCore.remaining(s, now)) : total;
    const t = PL.tasks.find((x) => x.id === s.taskId && !x.done); const k = t?.classId ? PL.classes.find((c) => c.id === t.classId) : null;
    const preset = PRESETS.find(([, v]) => v.focus === L.focus && v.short === L.short)?.[0] || 'Custom';
    const w = week();
    const step = (key, label, by, lo, hi) => `<div class="fp-step"><span>${label}</span><button class="hbtn" data-len="${key}" data-by="-${by}" aria-label="Less ${label.toLowerCase()} time"${L[key] <= lo ? ' disabled' : ''}>−</button><b>${L[key]} min</b><button class="hbtn" data-len="${key}" data-by="${by}" aria-label="More ${label.toLowerCase()} time"${L[key] >= hi ? ' disabled' : ''}>+</button></div>`;
    return `<div class="fp-head"><h3>${run ? FocusCore.label[s.phase] : 'Focus'}</h3><button class="hbtn" data-focus="close-panel" aria-label="Close">${btnSvg('close')}</button></div>
      <div class="fp-ring ${s.phase}${p ? ' paused' : ''}" data-c="${esc(k?.color || '')}" data-p="${(run ? 1 - left / total : 0).toFixed(3)}"><div><b>${FocusCore.clock(left)}</b><small>${run ? (p ? 'Paused' : `${s.done} done today`) : `then a ${L.short}-minute break`}</small></div></div>
      <div class="fp-task">${t ? `<b>${esc(t.text)}</b>${k ? `<span class="cls-chip" data-c="${esc(k.color)}"><i></i>${esc(classLabel(k))}</span>` : ''}` : `<span class="muted">${run ? 'Focusing' : 'Pick a task’s target button to focus on it, or just start.'}</span>`}</div>
      <div class="fp-acts">${run ? `<button class="btn${p ? ' primary' : ''}" data-focus="${p ? 'resume' : 'pause'}">${btnSvg(p ? 'play' : 'hold')}${p ? 'Resume' : 'Pause'}</button><button class="btn" data-focus="skip">${btnSvg('forward')}${s.phase === 'focus' ? 'Break' : 'Focus'}</button><button class="btn ghost" data-focus="stop">Stop</button>` : `<button class="btn primary" data-focus="start">${btnSvg('play')}Start focus</button>`}</div>
      <div class="fp-sec"><h4>Lengths</h4><div class="chips">${PRESETS.map(([n]) => `<button type="button" data-preset="${n}" aria-pressed="${preset === n}">${n}</button>`).join('')}<button type="button" data-preset="Custom" aria-pressed="${preset === 'Custom'}">Custom</button></div>
        ${preset === 'Custom' ? step('focus', 'Focus', 5, 5, 180) + step('short', 'Break', 1, 1, 60) : ''}<p class="muted small">Changes start with the next focus. Every fourth break is a long one.</p></div>
      <div class="fp-sec"><h4>This week <span class="n">${w.sessions}</span></h4>${w.sessions ? `<ul class="rows">${w.byClass.map(([id, v]) => { const c = PL.classes.find((x) => x.id === id); return `<li>${c ? `<span class="cls-chip" data-c="${esc(c.color)}"><i></i>${esc(classLabel(c))}</span>` : '<span class="muted">No class</span>'}<span class="grow"></span><span class="muted small">${v.sessions} · ${hours(v.mins)}</span></li>`; }).join('')}</ul><p class="muted small">${hours(w.mins)} of focus since Monday.</p>` : '<p class="muted small">No focus sessions yet this week. Finished sessions show here by class.</p>'}</div>`;
  }
  function drawPanel() {
    if (!panel?.isConnected) { panel = null; return; }
    panel.innerHTML = panelHtml();
    for (const el of panel.querySelectorAll('[data-c]')) if (el.dataset.c) el.style.setProperty('--c', el.dataset.c);
    const r = $('.fp-ring', panel); if (r) r.style.setProperty('--p', r.dataset.p);
  }
  function openPanel(anchor) {
    if (panel?.isConnected) { closePanel(); return; }
    const host = anchor.closest('.lv') || document.body;
    panel = document.createElement('div'); panel.className = 'focus-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Focus');
    host.append(panel); drawPanel();
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.focus === 'close-panel') { closePanel(); return; }
      if (b.dataset.focus) act(b.dataset.focus);
      if (b.dataset.preset) { const v = PRESETS.find(([n]) => n === b.dataset.preset)?.[1]; setLengths(v || { ...L, focus: L.focus === 25 || L.focus === 50 ? 40 : L.focus }); }
      if (b.dataset.len) { const k = b.dataset.len; const v = { ...L, [k]: L[k] + Number(b.dataset.by) }; if (k === 'short') v.long = v.short * 3; setLengths(v); }
      drawPanel();
    });
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePanel(); anchor.focus?.(); } });
    $('button', panel)?.focus();
  }
  function closePanel() { panel?.remove(); panel = null; }
  // the page's security policy forbids inline styles, so the ring's progress is set from here
  const fill = (el) => { const r = $('.fc-ring', el); if (r) r.style.setProperty('--p', r.dataset.p); };
  function draw() { for (const el of views) if (el.isConnected) { el.innerHTML = html(); fill(el); } else views.delete(el); drawPanel(); }
  function act(a, taskId) {
    const now = Date.now();
    if (a === 'start') set(FocusCore.start(s, now, L, taskId ?? s.taskId));
    if (a === 'pause') set(FocusCore.pause(s, now));
    if (a === 'resume') set(FocusCore.resume(s, now));
    if (a === 'skip') set(FocusCore.skip(s, now, L));
    if (a === 'stop') set(FocusCore.stop(s));
  }
  function mount(el) {
    views.add(el); el.innerHTML = html(); fill(el);
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-focus]'); if (!b) return; if (b.dataset.focus === 'panel') openPanel(b); else act(b.dataset.focus); });
  }
  // a new day starts the count again
  const day = new Date().toDateString();
  if (localStorage.getItem(`${KEY}.day`) !== day) { s = { ...s, done: 0 }; save(); try { localStorage.setItem(`${KEY}.day`, day); } catch { /* ignore */ } }
  // catch up on phases that ended while WakeUp was closed, without a pile of notices
  for (let i = 0; i < 20; i++) { const ends = s.endsAt; const r = FocusCore.tick(s, Date.now(), L); if (!r.ended) break; if (r.ended === 'focus') record(ends); s = r.state; }
  save(); schedule();
  return { mount, act, state: () => s, lengths: () => L, week, taskId: () => (s.phase === 'idle' ? null : s.taskId) };
})();
