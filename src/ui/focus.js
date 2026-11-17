'use strict';
/* global FocusCore, PL, esc, $, btnSvg */
/* eslint-disable no-unused-vars */
// The focus timer on the Tasks page: 25 minutes of focus, then a break (see focus-core.js). It can be tied to a
// task. The state is saved on this computer, so it keeps running when you switch views or restart WakeUp, and a
// notification says when each phase ends.
const Focus = (() => {
  const KEY = 'wakeup.focus';
  const load = () => { try { return FocusCore.clean(JSON.parse(localStorage.getItem(KEY))); } catch { return FocusCore.idle(); } };
  let s = load();
  let timer = null;
  const views = new Set();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private storage off: the timer still runs */ } };
  const set = (next) => { s = next; save(); schedule(); draw(); };

  function tell(ended) {
    const t = PL.tasks.find((x) => x.id === s.taskId);
    const title = ended === 'focus' ? 'Focus done. Take a break.' : 'Break over. Back to it.';
    const body = ended === 'focus' ? `${FocusCore.label[s.phase]}: ${FocusCore.LENGTHS[s.phase]} minutes${t ? ` · ${t.text}` : ''}` : t ? t.text : 'Next focus has started.';
    globalThis.showNotice?.({ id: 'focus', kind: 'info', title, detail: body });
    try { if (document.hidden || !document.hasFocus()) new Notification(title, { body, silent: false }); } catch { /* notifications off */ }
  }
  function schedule() {
    clearInterval(timer); timer = null;
    if (s.phase === 'idle' || FocusCore.paused(s)) return;
    timer = setInterval(() => {
      const r = FocusCore.tick(s, Date.now());
      if (r.ended) { s = r.state; save(); tell(r.ended); }
      draw();
    }, 1000);
  }

  // the timer card (in the Tasks header)
  function html() {
    const now = Date.now(); const run = s.phase !== 'idle'; const p = FocusCore.paused(s);
    const t = PL.tasks.find((x) => x.id === s.taskId && !x.done);
    if (!run) {
      return `<button class="btn small" data-focus="start" title="Focus for ${FocusCore.LENGTHS.focus} minutes, then take a ${FocusCore.LENGTHS.short}-minute break">${btnSvg('target')}Focus ${FocusCore.LENGTHS.focus} min</button>${s.done ? `<span class="fc-done" title="Focus sessions finished today">${s.done} done</span>` : ''}`;
    }
    const left = FocusCore.remaining(s, now);
    const total = FocusCore.LENGTHS[s.phase] * 60e3;
    return `<div class="fc ${s.phase}${p ? ' paused' : ''}" role="timer" aria-label="${FocusCore.label[s.phase]}, ${FocusCore.clock(left)} left">
      <span class="fc-ring" data-p="${Math.max(0, Math.min(1, 1 - left / total)).toFixed(3)}"></span>
      <span class="fc-main"><b>${FocusCore.clock(left)}</b><small>${FocusCore.label[s.phase]}${t ? ` · ${esc(t.text)}` : ''}</small></span>
      <button class="hbtn" data-focus="${p ? 'resume' : 'pause'}" aria-label="${p ? 'Resume' : 'Pause'}" title="${p ? 'Resume' : 'Pause'}">${btnSvg(p ? 'play' : 'hold')}</button>
      <button class="hbtn" data-focus="skip" aria-label="Skip to ${s.phase === 'focus' ? 'the break' : 'focus'}" title="Skip to ${s.phase === 'focus' ? 'the break' : 'focus'}">${btnSvg('forward')}</button>
      <button class="hbtn" data-focus="stop" aria-label="Stop" title="Stop">${btnSvg('close')}</button></div>`;
  }
  // the page's security policy forbids inline styles, so the ring's progress is set from here
  const fill = (el) => { const r = $('.fc-ring', el); if (r) r.style.setProperty('--p', r.dataset.p); };
  function draw() { for (const el of views) if (el.isConnected) { el.innerHTML = html(); fill(el); } else views.delete(el); }
  function act(a, taskId) {
    const now = Date.now();
    if (a === 'start') set(FocusCore.start(s, now, {}, taskId ?? s.taskId));
    if (a === 'pause') set(FocusCore.pause(s, now));
    if (a === 'resume') set(FocusCore.resume(s, now));
    if (a === 'skip') set(FocusCore.skip(s, now));
    if (a === 'stop') set(FocusCore.stop(s));
  }
  function mount(el) {
    views.add(el); el.innerHTML = html(); fill(el);
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-focus]'); if (b) act(b.dataset.focus); });
  }
  // a new day starts the count again
  const day = new Date().toDateString();
  if (localStorage.getItem(`${KEY}.day`) !== day) { s = { ...s, done: 0 }; save(); try { localStorage.setItem(`${KEY}.day`, day); } catch { /* ignore */ } }
  // catch up on phases that ended while WakeUp was closed, without a pile of notices
  for (let i = 0; i < 20; i++) { const r = FocusCore.tick(s, Date.now()); if (!r.ended) break; s = r.state; }
  save(); schedule();
  return { mount, act, state: () => s, taskId: () => (s.phase === 'idle' ? null : s.taskId) };
})();
