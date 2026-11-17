// The focus timer (Pomodoro) on the Tasks page: the shared rules (src/ui/focus-core.js) plus this device's saved
// state and a notification when each phase ends, so it works with the app closed. Not synced between devices.
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Focus, type FocusState } from './shared';
import { getState, kv } from './store';
import { notificationsReady, permission } from './reminders';

const KEY = 'focus.state';
const NOTE = 'focus-end';
let s: FocusState = Focus.clean(kv.get<unknown>(KEY, null));
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

// a new day starts the count again
const day = new Date().toDateString();
if (kv.get<string>('focus.day', '') !== day) { s = { ...s, done: 0 }; kv.set('focus.day', day); }
// catch up on phases that ended while the app was closed
function catchUp() {
  let moved = false;
  for (let i = 0; i < 20; i++) { const r = Focus.tick(s, Date.now()); if (!r.ended) break; s = r.state; moved = true; }
  if (moved) { kv.set(KEY, s); emit(); notify().catch(() => {}); }
}
catchUp();
AppState.addEventListener('change', (st) => { if (st === 'active') catchUp(); });

const taskText = () => getState().planner.tasks.find((t) => t.id === s.taskId)?.text;
// one notification, at the end of the current phase (replaced whenever the timer changes)
async function notify() {
  await notificationsReady();
  await Notifications.cancelScheduledNotificationAsync(NOTE).catch(() => {});
  if (s.phase === 'idle' || s.endsAt == null || s.endsAt <= Date.now()) return;
  if ((await permission()) !== 'granted') return;
  const t = taskText();
  const focusEnds = s.phase === 'focus';
  await Notifications.scheduleNotificationAsync({
    identifier: NOTE,
    content: { title: focusEnds ? 'Focus done. Take a break.' : 'Break over. Back to it.', body: t ?? (focusEnds ? 'Nice work.' : 'Next focus starts now.'), data: { url: '/tasks' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(s.endsAt), channelId: 'focus' },
  });
}
function set(next: FocusState) { s = next; kv.set(KEY, s); emit(); notify().catch(() => {}); }

export const focus = {
  start: (taskId?: string | null) => set(Focus.start(s, Date.now(), {}, taskId === undefined ? s.taskId : taskId)),
  pause: () => set(Focus.pause(s, Date.now())),
  resume: () => set(Focus.resume(s, Date.now())),
  skip: () => set(Focus.skip(s, Date.now())),
  stop: () => set(Focus.stop(s)),
  // called every second by the timer card while it's on screen
  tick: () => { const r = Focus.tick(s, Date.now()); if (r.ended) set(r.state); return r.ended; },
};
export const useFocus = () => useSyncExternalStore(subscribe, () => s, () => s);
