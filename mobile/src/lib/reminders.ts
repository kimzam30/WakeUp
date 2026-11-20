// Reminders, scheduled on the device: one before each class, and one a day listing the tasks due that day.
// Covers the next 14 days and is topped up by a once-a-day background task, so reminders keep coming even if the
// app isn't opened. Rescheduled when the timetable, tasks or reminder settings change (also from another device).
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { router } from 'expo-router';
import { getState, kv, onPlanner, onSettings, setPlanner } from './store';
import { Planner } from './shared';
import { classLabel, fmtTime } from './format';
import type { Planner as PlannerData, Settings } from './types';

const DAYS = 14;
const MAX = 60; // Android caps scheduled alarms per app; stay well under it
const TOPUP = 'wakeup-reminders-topup';
const EVENING = '20:00'; // heads-up for class notes, the day before
const SNOOZE_CLASS = 5; // minutes
const SNOOZE_TASKS = 60;
const ACTIONS = 'wakeup-notification-actions';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Channels exist from the first launch, so reminders work even when permission is granted from system settings
/* eslint-disable import/namespace -- AndroidImportance reaches Notifications through expo-notifications' `export *`, which this rule can't follow */
async function channels() {
  await Notifications.setNotificationChannelAsync('classes', { name: 'Class reminders', description: 'A heads-up before each class', importance: Notifications.AndroidImportance.HIGH });
  await Notifications.setNotificationChannelAsync('tasks', { name: 'Tasks due', description: 'Tasks due today, once a day', importance: Notifications.AndroidImportance.DEFAULT });
  await Notifications.setNotificationChannelAsync('focus', { name: 'Focus timer', description: 'When a focus session or a break ends', importance: Notifications.AndroidImportance.HIGH });
  await Notifications.setNotificationChannelAsync('focus-live', { name: 'Focus in progress', description: 'The running timer, with Pause and Stop', importance: Notifications.AndroidImportance.LOW, showBadge: false });
  // buttons under a reminder. Only Join opens WakeUp; the others work without opening it (see `act` below)
  const bg = { opensAppToForeground: false };
  const snooze = { identifier: 'snooze', buttonTitle: `Snooze ${SNOOZE_CLASS} min`, options: bg };
  await Notifications.setNotificationCategoryAsync('class-online', [{ identifier: 'join', buttonTitle: 'Join', options: { opensAppToForeground: true } }, snooze]);
  await Notifications.setNotificationCategoryAsync('class', [snooze]);
  await Notifications.setNotificationCategoryAsync('task-one', [{ identifier: 'done', buttonTitle: 'Done', options: bg }, { identifier: 'later', buttonTitle: 'In an hour', options: bg }]);
  await Notifications.setNotificationCategoryAsync('tasks', [{ identifier: 'later', buttonTitle: 'Remind me in an hour', options: bg }]);
  const stop = { identifier: 'focus-stop', buttonTitle: 'Stop', options: bg };
  await Notifications.setNotificationCategoryAsync('focus-running', [{ identifier: 'focus-pause', buttonTitle: 'Pause', options: bg }, stop]);
  await Notifications.setNotificationCategoryAsync('focus-paused', [{ identifier: 'focus-resume', buttonTitle: 'Resume', options: bg }, stop]);
}
/* eslint-enable import/namespace */
export const notificationsReady = () => ready;
const ready = channels().catch(() => {});

export type Permission = 'granted' | 'denied' | 'undetermined';
export async function permission(): Promise<Permission> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' || !canAskAgain ? 'denied' : 'undetermined';
}
export async function askPermission(): Promise<Permission> {
  await ready;
  const { status } = await Notifications.requestPermissionsAsync();
  rescheduleSoon(200);
  return status === 'granted' ? 'granted' : 'denied';
}
export const openSystemSettings = () => Linking.openSettings().catch(() => {});

// ---- what to schedule (pure, so it can be reasoned about)
type Plan = { id: string; at: number; channel: 'classes' | 'tasks'; category?: string; title: string; body: string; data: Record<string, string | number | null> };
function plan(p: PlannerData, s: Settings, now = Date.now()): Plan[] {
  const out: Plan[] = [];
  const mins = s.reminders;
  if (mins && s.notify.timetable !== false) {
    for (const o of Planner.upcoming(p, new Date(now), DAYS)) {
      const at = o.startsAt - mins * 60e3;
      if (at <= now) continue;
      const where = o.mode === 'online' ? 'Online' : o.venue || '';
      const link = o.mode === 'online' && o.link ? o.link : null;
      out.push({
        id: `c-${o.cls.id}-${o.date}-${o.start}`, at, channel: 'classes', category: link ? 'class-online' : 'class',
        title: `${classLabel(o.cls, s.classLabel)} in ${mins} minutes`,
        body: [`${fmtTime(o.start)}–${fmtTime(o.end)}`, where, Planner.notesLine(o.notes)].filter(Boolean).join(' · '),
        data: { kind: 'class', link, classId: o.cls.id, date: o.date, label: classLabel(o.cls, s.classLabel), startsAt: o.startsAt, start: o.start },
      });
    }
  }
  // the evening before a class with notes (a quiz, a test, something to bring): a heads-up at 8pm, while there's time
  if (s.notify.timetable !== false) {
    const today = Planner.ymd(new Date(now));
    for (let i = 0; i < DAYS; i++) {
      const day = Planner.addDays(today, i + 1);
      const withNotes = Planner.occurrencesOn(day, p).filter((o) => o.live && o.notes?.length);
      const at = Planner.at(Planner.addDays(day, -1), EVENING);
      if (!withNotes.length || at <= now) continue;
      out.push({
        id: `n-${day}`, at, channel: 'classes',
        title: `Tomorrow: ${withNotes.map((o) => classLabel(o.cls, s.classLabel)).join(', ')}`,
        body: withNotes.map((o) => `${classLabel(o.cls, s.classLabel)} ${fmtTime(o.start)}: ${Planner.notesLine(o.notes)}`).join('\n'),
        data: { kind: 'notes', date: day },
      });
    }
  }
  if (s.taskReminder && s.notify.tasks !== false) {
    const today = Planner.ymd(new Date(now));
    const open = p.tasks.filter((t) => !t.done && t.due);
    for (let i = 0; i < DAYS; i++) {
      const day = Planner.addDays(today, i);
      const due = open.filter((t) => t.due === day);
      const late = i === 0 ? open.filter((t) => t.due! < day) : [];
      if (!due.length && !late.length) continue;
      const at = Planner.at(day, s.taskReminder);
      if (at <= now) continue;
      const title = due.length ? `${due.length} task${due.length === 1 ? '' : 's'} due today` : `${late.length} late task${late.length === 1 ? '' : 's'}`;
      const names = [...due, ...late].slice(0, 4).map((t) => t.text);
      const more = due.length + late.length - names.length;
      const one = due.length + late.length === 1 ? [...due, ...late][0] : null; // Done only makes sense for a single task
      out.push({ id: `t-${day}`, at, channel: 'tasks', category: one ? 'task-one' : 'tasks', title, body: names.join(' · ') + (more > 0 ? ` +${more} more` : ''), data: { kind: 'tasks', taskId: one?.id ?? null } });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX);
}

// ---- schedule: one run at a time; a newer request makes an older run stop early
let running: Promise<void> | null = null; let again = false; let lastSig = '';
export function reschedule(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await run(); } while (again);
    } finally { running = null; }
  })();
  return running;
}
async function run() {
  await ready;
  const { planner, settings } = getState();
  if ((await permission()) !== 'granted') { await Notifications.cancelAllScheduledNotificationsAsync(); lastSig = ''; return; }
  const want = plan(planner, settings);
  const sig = JSON.stringify(want);
  if (sig === lastSig) return; // nothing changed (ticking off a task with no date, a sync that changed nothing…)
  // only touch what changed: keep reminders that are still right, cancel the rest, add the new ones
  const have = await Notifications.getAllScheduledNotificationsAsync();
  const wantById = new Map(want.map((w) => [w.id, w]));
  const keep = new Set<string>();
  for (const n of have) {
    if (n.identifier.startsWith('focus') || n.identifier.includes(SNOOZED)) continue; // the focus timer's own (lib/focus.ts), and snoozes
    const w = wantById.get(n.identifier);
    const same = w && n.content.title === w.title && n.content.body === w.body && (n.trigger as { value?: number })?.value === w.at
      && (n.content.categoryIdentifier ?? undefined) === w.category;
    if (same) keep.add(n.identifier); else await Notifications.cancelScheduledNotificationAsync(n.identifier);
    if (again) return;
  }
  for (const w of want) {
    if (keep.has(w.id)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: w.id,
      content: { title: w.title, body: w.body, data: w.data, ...(w.category ? { categoryIdentifier: w.category } : {}) },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(w.at), channelId: w.channel },
    });
    if (again) return;
  }
  lastSig = sig;
}
let soon: ReturnType<typeof setTimeout> | null = null;
export function rescheduleSoon(ms = 1500) { if (soon) clearTimeout(soon); soon = setTimeout(() => { reschedule().catch(() => {}); }, ms); }

// ---- the buttons: Join, Snooze, Done, Later
// A button that doesn't open WakeUp reaches `act` through a background task (Android starts the JavaScript just for it
// when WakeUp is closed). When WakeUp is running but not on screen, Android also tells the in-app listener, so each
// press is handled once (`seen`). Done is only recorded here and applied once sync has restored your sign-in
// (`startNotificationActions`), so it uploads to your other devices like a normal tick.
const SNOOZED = '-snz-';
const PENDING_DONE = 'notify.pendingDone';
let live = false;
function seen(key: string) {
  const list = kv.get<string[]>('notify.handled', []);
  if (list.includes(key)) return true;
  kv.set('notify.handled', [...list.slice(-30), key]);
  return false;
}
function applyPendingDone() {
  const ids = kv.get<string[]>(PENDING_DONE, []);
  if (!ids.length) return;
  kv.set(PENDING_DONE, []);
  setPlanner((p) => ({ tasks: p.tasks.map((t) => (ids.includes(t.id) && !t.done ? { ...t, done: true, doneAt: Date.now() } : t)) }));
}
// called once sync has restored your sign-in (app/_layout.tsx)
export function startNotificationActions() { live = true; applyPendingDone(); }
// A background task gets the notification as Android stored it: a scheduled notification's data arrives as a JSON
// string (`dataString`), not as `data` (seen on the emulator: Done did nothing until this read both).
type Data = Record<string, string | number | null>;
function dataOf(n: Notifications.Notification): Data {
  const c = n.request.content as Notifications.NotificationContent & { dataString?: string };
  if (c.data && Object.keys(c.data).length) return c.data as Data;
  try { return c.dataString ? (JSON.parse(c.dataString) as Data) : {}; } catch { return {}; }
}
async function snoozeCopy(n: Notifications.Notification, minutes: number) {
  const c = n.request.content; const d = dataOf(n);
  const at = Date.now() + minutes * 60e3;
  let title = c.title ?? '';
  if (d.kind === 'class' && typeof d.startsAt === 'number') {
    if (d.startsAt <= at + 30e3) title = `${d.label} is starting`; else title = `${d.label} at ${fmtTime(String(d.start))}`;
  }
  const base = n.request.identifier.split(SNOOZED)[0];
  await Notifications.scheduleNotificationAsync({
    identifier: `${base}${SNOOZED}${at}`,
    content: { title, body: c.body ?? '', data: d, ...(c.categoryIdentifier ? { categoryIdentifier: c.categoryIdentifier } : {}) },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: d.kind === 'class' ? 'classes' : 'tasks' },
  });
}
async function act(r: Notifications.NotificationResponse) {
  const n = r.notification; const a = r.actionIdentifier;
  if (a === Notifications.DEFAULT_ACTION_IDENTIFIER || seen(`${n.request.identifier}:${n.date}:${a}`)) return; // one press, once
  const d = dataOf(n);
  await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {});
  if (a === 'join' && typeof d.link === 'string') Linking.openURL(d.link).catch(() => router.navigate('/timetable'));
  else if (a.startsWith('focus-')) {
    // loaded here, not at the top: lib/focus.ts imports this file
    const { focus } = await import('./focus');
    if (a === 'focus-pause') focus.pause(); else if (a === 'focus-resume') focus.resume(); else if (a === 'focus-stop') focus.stop();
  }
  else if (a === 'snooze') await snoozeCopy(n, SNOOZE_CLASS);
  else if (a === 'later') await snoozeCopy(n, SNOOZE_TASKS);
  else if (a === 'done' && typeof d.taskId === 'string') {
    kv.set(PENDING_DONE, [...kv.get<string[]>(PENDING_DONE, []), d.taskId]);
    if (live) applyPendingDone();
  }
}
TaskManager.defineTask<Notifications.NotificationTaskPayload>(ACTIONS, async ({ data }) => {
  if (data && 'actionIdentifier' in data) await act(data).catch(() => {});
});
Notifications.registerTaskAsync(ACTIONS).catch(() => {});

// ---- tapping a reminder: open the class link, or the class in the timetable, or Tasks
function handle(r: Notifications.NotificationResponse | null) {
  if (r && r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) { act(r).catch(() => {}); return; }
  const d = r?.notification.request.content.data as Record<string, string | null> | undefined;
  if (!d) return;
  if (d.kind === 'class' && d.link) { Linking.openURL(d.link).catch(() => router.navigate('/timetable')); return; }
  if (d.kind === 'class' && d.classId) { router.navigate({ pathname: '/classes/[id]', params: { id: d.classId } }); return; }
  if (d.kind === 'class') { router.navigate('/timetable'); return; }
  if (d.kind === 'tasks') router.navigate('/tasks');
}
let handledLaunch = false;
export function listenForTaps() {
  if (!handledLaunch) { handledLaunch = true; Notifications.getLastNotificationResponseAsync().then((r) => { if (r) { handle(r); Notifications.clearLastNotificationResponseAsync?.().catch(() => {}); } }).catch(() => {}); }
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

// ---- once-a-day top-up in the background (WorkManager decides the exact time; it batches with other apps)
TaskManager.defineTask(TOPUP, async () => {
  try { await reschedule(); return BackgroundTask.BackgroundTaskResult.Success; } catch { return BackgroundTask.BackgroundTaskResult.Failed; }
});
export async function registerTopUp() {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(TOPUP)) return;
    await BackgroundTask.registerTaskAsync(TOPUP, { minimumInterval: 12 * 60 }); // minutes
  } catch (e) { console.warn('reminder top-up not registered', e); }
}

// timetable and tasks changes, and the reminder settings (also when they arrive from another device)
onPlanner(() => rescheduleSoon());
onSettings((prev, next) => {
  if (prev.reminders !== next.reminders || prev.classLabel !== next.classLabel || prev.taskReminder !== next.taskReminder
    || prev.notify.timetable !== next.notify.timetable || prev.notify.tasks !== next.notify.tasks) rescheduleSoon(300);
});
