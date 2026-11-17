// Reminders, scheduled on the device: one before each class, and one a day listing the tasks due that day.
// Covers the next 14 days and is topped up by a once-a-day background task, so reminders keep coming even if the
// app isn't opened. Rescheduled when the timetable, tasks or reminder settings change (also from another device).
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { router } from 'expo-router';
import { getState, onPlanner, onSettings } from './store';
import { Planner } from './shared';
import { classLabel, fmtTime } from './format';
import type { Planner as PlannerData, Settings } from './types';

const DAYS = 14;
const MAX = 60; // Android caps scheduled alarms per app; stay well under it
const TOPUP = 'wakeup-reminders-topup';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Channels exist from the first launch, so reminders work even when permission is granted from system settings
async function channels() {
  await Notifications.setNotificationChannelAsync('classes', { name: 'Class reminders', description: 'A heads-up before each class', importance: Notifications.AndroidImportance.HIGH });
  await Notifications.setNotificationChannelAsync('tasks', { name: 'Tasks due', description: 'Tasks due today, once a day', importance: Notifications.AndroidImportance.DEFAULT });
  await Notifications.setNotificationChannelAsync('focus', { name: 'Focus timer', description: 'When a focus session or a break ends', importance: Notifications.AndroidImportance.HIGH });
}
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
type Plan = { id: string; at: number; channel: 'classes' | 'tasks'; title: string; body: string; data: Record<string, string | null> };
function plan(p: PlannerData, s: Settings, now = Date.now()): Plan[] {
  const out: Plan[] = [];
  const mins = s.reminders;
  if (mins && s.notify.timetable !== false) {
    for (const o of Planner.upcoming(p, new Date(now), DAYS)) {
      const at = o.startsAt - mins * 60e3;
      if (at <= now) continue;
      const where = o.mode === 'online' ? 'Online' : o.venue || '';
      out.push({
        id: `c-${o.cls.id}-${o.date}-${o.start}`, at, channel: 'classes',
        title: `${classLabel(o.cls, s.classLabel)} in ${mins} minutes`,
        body: [`${fmtTime(o.start)}–${fmtTime(o.end)}`, where].filter(Boolean).join(' · '),
        data: { kind: 'class', link: o.mode === 'online' && o.link ? o.link : null, classId: o.cls.id, date: o.date },
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
      out.push({ id: `t-${day}`, at, channel: 'tasks', title, body: names.join(' · ') + (more > 0 ? ` +${more} more` : ''), data: { kind: 'tasks' } });
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
    if (n.identifier.startsWith('focus')) continue; // the focus timer's own (lib/focus.ts)
    const w = wantById.get(n.identifier);
    const same = w && n.content.title === w.title && n.content.body === w.body && (n.trigger as { value?: number })?.value === w.at;
    if (same) keep.add(n.identifier); else await Notifications.cancelScheduledNotificationAsync(n.identifier);
    if (again) return;
  }
  for (const w of want) {
    if (keep.has(w.id)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: w.id,
      content: { title: w.title, body: w.body, data: w.data },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(w.at), channelId: w.channel },
    });
    if (again) return;
  }
  lastSig = sig;
}
let soon: ReturnType<typeof setTimeout> | null = null;
export function rescheduleSoon(ms = 1500) { if (soon) clearTimeout(soon); soon = setTimeout(() => { reschedule().catch(() => {}); }, ms); }

// ---- tapping a reminder: open the class link, or the class in the timetable, or Tasks
function handle(r: Notifications.NotificationResponse | null) {
  const d = r?.notification.request.content.data as Record<string, string | null> | undefined;
  if (!d) return;
  if (d.kind === 'class' && d.link) { Linking.openURL(d.link).catch(() => router.navigate('/timetable')); return; }
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
