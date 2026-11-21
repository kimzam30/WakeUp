// Focus mode (v3, A3): the shared rules (src/ui/focus-core.js) plus this device's saved state, your chosen lengths
// (25/5, 50/10 or your own), a log of finished sessions for the week's stats, and a notification when each phase
// ends, so it works with the app closed. Not synced between devices.
// While a phase runs, a pinned notification shows it with Pause/Resume and Stop (handled in lib/reminders.ts); at the
// end, the "Focus done" notice takes its place. Optionally, Do Not Disturb is on during focus (modules/wakeup-dnd).
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Focus, type FocusState } from './shared';
import { getState, kv } from './store';
import { notificationsReady, permission } from './reminders';
import { fmtTime } from './format';
import Dnd from '../../modules/wakeup-dnd';

const KEY = 'focus.state';
const NOTE = 'focus-end';
let s: FocusState = Focus.clean(kv.get<unknown>(KEY, null));

// lengths in minutes; a long break is three short ones
export type Lengths = { focus: number; short: number; long: number };
export const PRESETS: [string, Lengths][] = [['25 / 5', { focus: 25, short: 5, long: 15 }], ['50 / 10', { focus: 50, short: 10, long: 30 }]];
const okLen = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && v >= lo && v <= hi ? Math.round(v) : d);
const cleanLengths = (v: Partial<Lengths> | null): Lengths => ({ focus: okLen(v?.focus, 5, 180, 25), short: okLen(v?.short, 1, 60, 5), long: okLen(v?.long, 1, 90, 15) });
let lengths: Lengths = cleanLengths(kv.get<Partial<Lengths> | null>('focus.lengths', null));
export const getLengths = () => lengths;
export function setLengths(l: Lengths) { lengths = cleanLengths(l); kv.set('focus.lengths', lengths); emitSoon(); }

// finished focus sessions (kept 60 days): when, how long, and the task and class it was for
export type Session = { at: number; mins: number; taskId: string | null; classId: string | null };
let log: Session[] = kv.get<Session[]>('focus.log', []).filter((x) => x && Date.now() - x.at < 60 * 864e5);
function record(endedAt: number) {
  const t = getState().planner.tasks.find((x) => x.id === s.taskId);
  log = [...log, { at: endedAt, mins: lengths.focus, taskId: s.taskId, classId: t?.classId ?? s.classId ?? null }];
  kv.set('focus.log', log);
}
// this week (Monday on) by class, plus the total
export function weekStats() {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const week = log.filter((x) => x.at >= d.getTime());
  const by = new Map<string | null, { sessions: number; mins: number }>();
  for (const x of week) { const v = by.get(x.classId) ?? { sessions: 0, mins: 0 }; v.sessions++; v.mins += x.mins; by.set(x.classId, v); }
  return { sessions: week.length, mins: week.reduce((a, x) => a + x.mins, 0), byClass: [...by.entries()].sort((a, b) => b[1].mins - a[1].mins) };
}
let version = 0;
const emitSoon = () => { version++; emit(); };
export const useFocusVersion = () => useSyncExternalStore(subscribe, () => version, () => version);
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

// a new day starts the count again: checked at load, on every change and every tick, so an app left open overnight resets too
function newDay() {
  const day = new Date().toDateString();
  if (kv.get<string>('focus.day', '') === day) return;
  kv.set('focus.day', day);
  if (s.done) { s = { ...s, done: 0 }; kv.set(KEY, s); emit(); }
}
newDay();
// catch up on phases that ended while the app was closed
function catchUp() {
  newDay();
  let moved = false;
  for (let i = 0; i < 20; i++) { const ended = s.endsAt; const r = Focus.tick(s, Date.now(), lengths); if (!r.ended) break; if (r.ended === 'focus' && ended) record(ended); s = r.state; moved = true; }
  if (moved) { kv.set(KEY, s); emit(); notify().catch(() => {}); }
}
catchUp();
AppState.addEventListener('change', (st) => { if (st === 'active') catchUp(); });

const taskText = () => getState().planner.tasks.find((t) => t.id === s.taskId)?.text;
const hm = (ms: number) => { const d = new Date(ms); return fmtTime(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`); };
// The pinned notification and the end notice share one id, so the notice replaces the pinned one when the phase ends
// (even with WakeUp closed) instead of leaving a stale "until 10:45" behind.
async function notify() {
  await notificationsReady();
  await Notifications.cancelScheduledNotificationAsync(NOTE).catch(() => {});
  if (s.phase === 'idle') { await Notifications.dismissNotificationAsync(NOTE).catch(() => {}); return; }
  if ((await permission()) !== 'granted') return;
  const t = taskText();
  const name = Focus.label[s.phase];
  const paused = Focus.paused(s);
  if (!paused && (s.endsAt == null || s.endsAt <= Date.now())) return;
  await Notifications.scheduleNotificationAsync({
    identifier: NOTE,
    content: {
      title: paused ? `${name} paused · ${Focus.clock(s.left ?? 0)} left` : `${name} until ${hm(s.endsAt!)}`,
      body: t ?? (s.phase === 'focus' ? 'Stay with it.' : 'Time to rest.'),
      data: { url: '/focus' }, sticky: true, autoDismiss: false,
      categoryIdentifier: paused ? 'focus-paused' : 'focus-running',
    },
    trigger: { channelId: 'focus-live' },
  });
  if (paused) return;
  const focusEnds = s.phase === 'focus';
  await Notifications.scheduleNotificationAsync({
    identifier: NOTE,
    content: { title: focusEnds ? 'Focus done. Take a break.' : 'Break over. Back to it.', body: t ?? (focusEnds ? 'Nice work.' : 'Next focus starts now.'), data: { url: '/tasks' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(s.endsAt!), channelId: 'focus' },
  });
}
// Do Not Disturb (off unless you turn it on): on while a focus phase runs, off for breaks, pauses and stops. Android
// turns it back off at the phase's end by itself, so a closed WakeUp never leaves your phone silent.
let dndOn = kv.get<boolean>('focus.dnd', false);
export const dndAvailable = () => !!Dnd;
export const dndAccess = () => !!Dnd?.hasAccess();
export const openDndAccess = () => Dnd?.openAccessSettings();
export const getDnd = () => dndOn;
export const refreshDnd = () => quiet();
export function setDnd(on: boolean) { dndOn = on; kv.set('focus.dnd', on); quiet(); emitSoon(); }
function quiet() {
  if (!Dnd) return;
  try {
    if (dndOn && s.phase === 'focus' && !Focus.paused(s) && s.endsAt) Dnd.quietUntil(s.endsAt); else Dnd.restore();
  } catch { /* no access: nothing changes */ }
}
function set(next: FocusState) { s = next; kv.set(KEY, s); emit(); quiet(); notify().catch(() => {}); }

export const focus = {
  // a task, or (from the class page) a class with no task; a new task drops the old class
  start: (taskId?: string | null, classId?: string | null) => { newDay(); set(Focus.start(s, Date.now(), lengths, taskId === undefined ? s.taskId : taskId, classId !== undefined ? classId : taskId !== undefined ? null : s.classId)); },
  pause: () => { newDay(); set(Focus.pause(s, Date.now())); },
  resume: () => { newDay(); set(Focus.resume(s, Date.now())); },
  skip: () => { newDay(); set(Focus.skip(s, Date.now(), lengths)); },
  stop: () => { newDay(); set(Focus.stop(s)); },
  // called every second by the focus screen and card while they're on screen
  tick: () => { newDay(); const ended = s.endsAt; const r = Focus.tick(s, Date.now(), lengths); if (r.ended) { if (r.ended === 'focus' && ended) record(ended); set(r.state); } return r.ended; },
  total: (phase: FocusState['phase']) => (phase === 'idle' ? 1 : lengths[phase] * 60e3),
};
export const useFocus = () => useSyncExternalStore(subscribe, () => s, () => s);
// for the widgets: the current state outside React, and a callback when it changes
export const getFocusState = () => s;
export const onFocusChange = (l: () => void) => subscribe(l);
