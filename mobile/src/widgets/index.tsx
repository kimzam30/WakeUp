// Widget plumbing: Android asks for a widget's picture (added, resized, every 30 minutes) through a background
// task; WakeUp also redraws them whenever the timetable, tasks or focus timer change.
import { AppState } from 'react-native';
import { registerWidgetTaskHandler, requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import { getState, onPlanner, onSettings, setPlanner } from '../lib/store';
import { Focus } from '../lib/shared';
import { focus, getFocusState, getLengths, onFocusChange, weekStats } from '../lib/focus';
import { CoverScreen, DueToday, ExamCountdown, FocusWidget, NextClass, TodayTimeline, type FocusInfo } from './widgets';

type Box = { width: number; height: number; now: number; dark: boolean };
function focusInfo(now: number): FocusInfo {
  const s = getFocusState();
  const t = s.taskId ? getState().planner.tasks.find((x) => x.id === s.taskId) : undefined;
  const cls = t?.classId ? getState().planner.classes.find((k) => k.id === t.classId) : undefined;
  return {
    phase: s.phase, paused: Focus.paused(s), left: Focus.remaining(s, now), total: focus.total(s.phase), endsAt: s.endsAt ?? null,
    task: t?.text ?? null, color: cls?.color ?? null, label: Focus.label[s.phase], week: weekStats(), lengths: getLengths(),
  };
}
const WIDGETS = {
  NextClass: (b: Box) => <NextClass {...b} />,
  DueToday: (b: Box) => <DueToday {...b} />,
  TodayTimeline: (b: Box) => <TodayTimeline {...b} />,
  ExamCountdown: (b: Box) => <ExamCountdown {...b} />,
  FocusWidget: (b: Box) => <FocusWidget {...b} f={focusInfo(b.now)} />,
  CoverScreen: (b: Box) => <CoverScreen {...b} />,
} as const;
type Name = keyof typeof WIDGETS;
const draw = (name: Name, w: { width: number; height: number }) => {
  const now = Date.now(); const W = WIDGETS[name];
  return { light: W({ width: w.width, height: w.height, now, dark: false }), dark: W({ width: w.width, height: w.height, now, dark: true }) };
};

// redraw every placed widget (cheap when none are placed)
export async function refreshWidgets(only?: Name[]) {
  await Promise.all(((only ?? Object.keys(WIDGETS)) as Name[]).map((name) =>
    requestWidgetUpdate({ widgetName: name, renderWidget: (info) => draw(name, info) }).catch(() => {})));
}

let timer: ReturnType<typeof setTimeout> | null = null;
const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; refreshWidgets(); }, 400); };

export function startWidgets() {
  onPlanner(soon);
  onSettings(soon);
  onFocusChange(() => { refreshWidgets(['FocusWidget']); });
  AppState.addEventListener('change', (s) => { if (s === 'background' || s === 'active') soon(); });
  soon();
}

// Android starts this in the background, with or without the app open
async function handler({ widgetInfo, widgetAction, clickAction, clickActionData, renderWidget }: WidgetTaskHandlerProps) {
  const name = widgetInfo.widgetName as Name;
  if (!(name in WIDGETS) || widgetAction === 'WIDGET_DELETED') return;
  if (widgetAction === 'WIDGET_CLICK') {
    if (clickAction === 'DONE' && typeof clickActionData?.id === 'string') {
      const id = clickActionData.id;
      // sign-in first, so the change is queued for your other devices, not just saved here
      const sync = await import('../lib/sync');
      await sync.startSync().catch(() => {});
      if (getState().planner.tasks.some((t) => t.id === id && !t.done)) {
        setPlanner((p) => ({ tasks: p.tasks.map((t) => (t.id === id ? { ...t, done: true, doneAt: Date.now() } : t)) }));
        await sync.flush().catch(() => {});
      }
      renderWidget(draw(name, widgetInfo));
      await refreshWidgets(); // the other widgets show the same tasks
      return;
    }
    if (clickAction === 'FOCUS_START') focus.start(null);
    else if (clickAction === 'FOCUS_PAUSE') focus.pause();
    else if (clickAction === 'FOCUS_RESUME') focus.resume();
  }
  renderWidget(draw(name, widgetInfo));
}
registerWidgetTaskHandler(handler);
