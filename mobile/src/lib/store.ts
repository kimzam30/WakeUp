// App state, local first: everything is saved on the device (SQLite key-value store) the moment it changes,
// and the sync module (sync.ts) mirrors it to the cloud when the user is signed in.
import { useRef, useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { Schema } from './shared';
import type { Planner, Settings, WebApp } from './types';

export type SyncStatus = {
  signedIn: boolean; email: string; name: string; phase: 'off' | 'signing' | 'syncing' | 'idle' | 'offline' | 'error' | 'expired';
  error: string | null; lastSync: string | null; pending: number; rejected: number;
};

export const BUILTIN_APPS: WebApp[] = [
  { id: 'ebwise', name: 'Ebwise', url: 'https://ebwise.mmu.edu.my/my/courses.php', color: '#e8590c' },
  { id: 'mail', name: 'Outlook', url: 'https://outlook.office.com/mail/', color: '#0f6cbd' },
  { id: 'calendar', name: 'Calendar', url: 'https://outlook.office.com/calendar/', color: '#2b88d8' },
  { id: 'teams', name: 'Teams', url: 'https://teams.microsoft.com/v2/', color: '#5b5fc7' },
];

const defaultSettings = (): Settings => ({
  theme: 'system', weekStart: 1, nickname: '', reminders: 10, classLabel: 'code', notify: {}, customApps: [], apps: ['ebwise', 'mail', 'teams'], taskReminder: '08:00',
});

export type State = {
  planner: Planner;
  settings: Settings;
  onboarded: boolean;
  sync: SyncStatus;
  openApps: string[]; // web apps loaded this session (kept alive in the Apps tab)
  activeApp: string | null;
  split: Split | null; // two apps on screen at once (Apps tab), kept across launches
};
export type Split = { a: string; b: string; ratio: number; focus: 'a' | 'b' };

const read = <T,>(k: string, d: T): T => {
  try { const v = Storage.getItemSync(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; }
};
const readArr = <T,>(k: string, d: T): T => { try { const v = Storage.getItemSync(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { Storage.setItemSync(k, JSON.stringify(v)); } catch (e) { console.warn('save failed', k, e); } };

let state: State = {
  planner: Schema.cleanPlanner(readArr('planner', Schema.emptyPlanner())),
  settings: read('settings', defaultSettings()),
  onboarded: readArr('onboarded', false),
  sync: { signedIn: false, email: '', name: '', phase: 'off', error: null, lastSync: null, pending: 0, rejected: 0 },
  openApps: [],
  activeApp: null,
  split: null,
};
// a split from last time comes back with both apps loaded
{
  const sp = readArr<Split | null>('apps.split', null);
  if (sp && sp.a && sp.b && sp.a !== sp.b) state = { ...state, split: sp, activeApp: sp.a, openApps: [sp.a, sp.b] };
}
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const getState = () => state;
// Pass `isEqual` (e.g. `shallow`) when the selector builds a new array/object, so unrelated changes don't re-render
export function useStore<T>(sel: (s: State) => T, isEqual?: (a: T, b: T) => boolean): T {
  const last = useRef<{ v: T } | null>(null);
  const get = () => {
    const v = sel(state);
    if (last.current && (isEqual ? isEqual(last.current.v, v) : Object.is(last.current.v, v))) return last.current.v;
    last.current = { v };
    return v;
  };
  return useSyncExternalStore(subscribe, get, get);
}
export function shallow<T>(a: T, b: T) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a as object); const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// the sync module listens here for edits made on this device
type Hooks = { planner?: (prev: Planner, next: Planner) => void; settings?: (prev: Settings, next: Settings) => void };
const hooks: Hooks = {};
export const onLocalChange = (h: Hooks) => Object.assign(hooks, h);
const plannerListeners = new Set<(p: Planner) => void>();
export const onPlanner = (fn: (p: Planner) => void) => { plannerListeners.add(fn); return () => { plannerListeners.delete(fn); }; };
const settingsListeners = new Set<(prev: Settings, next: Settings) => void>();
export const onSettings = (fn: (prev: Settings, next: Settings) => void) => { settingsListeners.add(fn); return () => { settingsListeners.delete(fn); }; };

export function setPlanner(next: Partial<Planner> | ((p: Planner) => Partial<Planner>), { fromCloud = false } = {}) {
  const prev = state.planner;
  const patch = typeof next === 'function' ? next(prev) : next;
  const planner = Schema.cleanPlanner({ ...prev, ...patch });
  state = { ...state, planner };
  write('planner', planner);
  if (!fromCloud) hooks.planner?.(prev, planner);
  for (const fn of plannerListeners) fn(planner);
  emit();
}

export function setSettings(patch: Partial<Settings>, { fromCloud = false } = {}) {
  const prev = state.settings;
  const settings = { ...prev, ...patch };
  state = { ...state, settings };
  write('settings', settings);
  if (!fromCloud) hooks.settings?.(prev, settings);
  for (const fn of settingsListeners) fn(prev, settings);
  emit();
}

export function setOnboarded(v: boolean) { state = { ...state, onboarded: v }; write('onboarded', v); emit(); }
export function setSyncStatus(s: Partial<SyncStatus>) { state = { ...state, sync: { ...state.sync, ...s } }; emit(); }

const MAX_LOADED = 4; // apps kept loaded in the background; the least recently used one unloads past this
const saveSplit = (sp: Split | null) => write('apps.split', sp);
// the app the toolbar and the back button act on
export const focusedApp = (s: State) => (s.split ? s.split[s.split.focus] : s.activeApp);

function touch(openApps: string[], id: string, keep: (string | null)[]) {
  const list = [...openApps.filter((x) => x !== id), id]; // most recent last
  while (list.length > MAX_LOADED) { const i = list.findIndex((x) => !keep.includes(x)); if (i < 0) break; list.splice(i, 1); }
  return list;
}
// Open an app. With a split on screen it goes into the focused half (or just takes focus if it's already showing).
export function openApp(id: string | null) {
  const sp = state.split;
  if (id && sp) {
    if (sp.a === id || sp.b === id) { const split = { ...sp, focus: sp.a === id ? 'a' as const : 'b' as const }; state = { ...state, split, openApps: touch(state.openApps, id, [sp.a, sp.b]) }; saveSplit(split); emit(); return; }
    const split = { ...sp, [sp.focus]: id };
    state = { ...state, split, activeApp: split.a, openApps: touch(state.openApps, id, [split.a, split.b]) }; saveSplit(split); emit(); return;
  }
  if (!id && sp) { state = { ...state, split: null }; saveSplit(null); }
  state = { ...state, activeApp: id, openApps: id ? touch(state.openApps, id, [id]) : state.openApps };
  emit();
}
export function closeApp(id: string) {
  const sp = state.split;
  const openApps = state.openApps.filter((x) => x !== id);
  if (sp && (sp.a === id || sp.b === id)) {
    const other = sp.a === id ? sp.b : sp.a;
    state = { ...state, openApps, split: null, activeApp: other }; saveSplit(null); emit(); return;
  }
  state = { ...state, openApps, activeApp: state.activeApp === id ? openApps.at(-1) ?? null : state.activeApp };
  emit();
}
// Put `b` beside the app on screen (both load if they weren't already)
export function openSplit(b: string) {
  const a = focusedApp(state) ?? state.openApps.at(-1);
  if (!a || a === b) { openApp(b); return; }
  const split: Split = { a, b, ratio: state.split?.ratio ?? 0.5, focus: 'b' };
  state = { ...state, split, activeApp: a, openApps: touch(touch(state.openApps, a, [a, b]), b, [a, b]) };
  saveSplit(split); emit();
}
// Leave split view keeping one half (the focused one by default)
export function closeSplit(keep?: 'a' | 'b') {
  const sp = state.split; if (!sp) return;
  state = { ...state, split: null, activeApp: sp[keep ?? sp.focus] }; saveSplit(null); emit();
}
export function updateSplit(p: Partial<Split>) {
  const sp = state.split; if (!sp) return;
  const split = { ...sp, ...p }; state = { ...state, split };
  if (p.ratio === undefined || p.focus !== undefined || p.a !== undefined) saveSplit(split); else saveSplitSoon(split);
  emit();
}
let splitTimer: ReturnType<typeof setTimeout> | null = null;
const saveSplitSoon = (sp: Split) => { if (splitTimer) clearTimeout(splitTimer); splitTimer = setTimeout(() => saveSplit(sp), 400); };

export const allApps = (s: Settings): WebApp[] => [...BUILTIN_APPS.filter((a) => s.apps.includes(a.id)), ...s.customApps];

// small persisted values the sync module keeps (outbox, last pull time…)
export const kv = { get: <T,>(k: string, d: T) => readArr(k, d), set: write };
