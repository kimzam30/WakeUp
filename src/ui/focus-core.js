'use strict';
// The focus timer (Pomodoro) shared by both apps: focus for a while, then a short break, and a longer break after
// every fourth focus. The state is plain data with an end time, so it survives switching tabs or restarting the app;
// each device keeps its own (it isn't synced). No dependencies.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FocusCore = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const LENGTHS = { focus: 25, short: 5, long: 15 }; // minutes
  const LONG_EVERY = 4;

  // classId: focus on a class with no task (from the class page); a task's own class wins when there is one
  const idle = () => ({ phase: 'idle', endsAt: null, left: null, taskId: null, classId: null, done: 0 });
  const minutes = (phase, o = {}) => (o[phase] || LENGTHS[phase]) * 60e3;

  function clean(raw) {
    const s = { ...idle(), ...(raw && typeof raw === 'object' ? raw : {}) };
    if (!['idle', 'focus', 'short', 'long'].includes(s.phase)) return idle();
    if (s.phase !== 'idle' && !Number.isFinite(s.endsAt) && !Number.isFinite(s.left)) return idle();
    s.done = Number.isInteger(s.done) && s.done >= 0 ? s.done : 0;
    s.taskId = typeof s.taskId === 'string' ? s.taskId : null;
    s.classId = typeof s.classId === 'string' ? s.classId : null;
    return s;
  }

  const start = (s, now, o, taskId = s.taskId, classId = s.classId) => ({ ...s, phase: 'focus', endsAt: now + minutes('focus', o), left: null, taskId, classId: classId ?? null });
  const pause = (s, now) => (s.phase === 'idle' || s.left != null ? s : { ...s, left: Math.max(0, s.endsAt - now), endsAt: null });
  const resume = (s, now) => (s.left == null ? s : { ...s, endsAt: now + s.left, left: null });
  const stop = (s) => ({ ...idle(), done: s.done, taskId: s.taskId });
  const remaining = (s, now) => (s.phase === 'idle' ? 0 : s.left != null ? s.left : Math.max(0, s.endsAt - now));
  const paused = (s) => s.phase !== 'idle' && s.left != null;

  // What comes after the current phase ends: focus → break, break → focus. A skipped focus (`skip`) doesn't count.
  function next(s, now, o, skip = false) {
    if (s.phase === 'focus') {
      const done = s.done + (skip ? 0 : 1);
      const brk = !skip && done % LONG_EVERY === 0 ? 'long' : 'short';
      return { ...s, phase: brk, done, endsAt: now + minutes(brk, o), left: null };
    }
    if (s.phase === 'short' || s.phase === 'long') return start(s, now, o);
    return s;
  }
  // Called on a timer: moves on when the phase has run out. `ended` says which phase just finished, for a notice.
  function tick(s, now, o) {
    if (s.phase === 'idle' || s.left != null || s.endsAt > now) return { state: s, ended: null };
    return { state: next(s, s.endsAt, o), ended: s.phase };
  }

  const label = { focus: 'Focus', short: 'Short break', long: 'Long break', idle: 'Focus' };
  const clock = (ms) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

  const skip = (s, now, o) => next(s, now, o, true);
  return { LENGTHS, LONG_EVERY, idle, clean, start, pause, resume, stop, next, skip, tick, remaining, paused, label, clock };
}));
