// The planner logic the desktop app uses, loaded from the repo so both apps behave the same.
/* eslint-disable @typescript-eslint/no-require-imports */
import type { Planner as PlannerData } from './types';

type Occurrence = import('./types').Occurrence;
export const Planner: {
  ymd: (d: Date) => string; parse: (s: string) => Date; addDays: (s: string, n: number) => string; mins: (hm: string) => number;
  at: (date: string, hm: string) => number; weekday: (s: string) => number; startOfWeek: (s: string, weekStart?: number) => string;
  daysBetween: (a: string, b: string) => number; today: () => string;
  weekOf: (date: string, sem: PlannerData['semester'], weekStart?: number) => { week?: number; break?: string | null; before?: boolean; days?: number; after?: boolean } | null;
  occurrencesOn: (date: string, p: PlannerData) => Occurrence[];
  upcoming: (p: PlannerData, from?: Date, days?: number) => (Occurrence & { startsAt: number; endsAt: number })[];
  bucket: (t: { done: boolean; due: string | null }, today: string) => 'done' | 'someday' | 'overdue' | 'today' | 'upcoming';
  nextMeeting: (p: PlannerData, classId: string, from: string, days?: number) => string | null;
  venues: (p: PlannerData) => string[];
  NOTE_TAGS: Record<import('./types').NoteTag, [string, '' | 'bad' | 'info' | 'warn' | 'good']>;
  noteText: (n: import('./types').Change) => string; notesLine: (list?: import('./types').Change[]) => string;
  clashes: (p: PlannerData, date: string | null, start: string, end: string, skip?: string | null) => Occurrence[];
  ICON_KEYS: string[];
  STATUS: Record<string, [string, 'bad' | 'info' | 'warn' | 'good']>; CLASS_COLORS: string[];
} = require('../../../src/ui/planner-core.js');

export const Schema: { cleanPlanner: (raw: unknown) => PlannerData; emptyPlanner: () => PlannerData; newId: (prefix: string) => string } = require('../../../src/shared/planner-schema.js');

type Row = { kind: string; id: string; data: unknown; deleted?: boolean };
export const SyncCore: {
  SYNCED_SETTINGS: string[];
  diff: (a: PlannerData | null, b: PlannerData) => { upserts: Row[]; deletes: { kind: string; id: string }[] };
  apply: (p: PlannerData, rows: Row[], pending?: Set<string>) => { planner: PlannerData; changed: boolean };
  queue: (outbox: Row[], d: { upserts: Row[]; deletes: { kind: string; id: string }[] }) => Row[];
  noteRefused: (refused: string[], row: { kind: string; id: string }) => string[]; clearRefused: (refused: string[], rows: { kind: string; id: string }[]) => string[];
  refusedRows: (p: PlannerData, refused: string[]) => Row[]; refusedNames: (p: PlannerData, refused: string[]) => string[];
  pendingKeys: (outbox: Row[]) => Set<string>;
  pickSettings: (s: object) => Record<string, unknown>;
  settingsDiffer: (a: object, b: object) => boolean;
  settingsKeysChanged: (a: object, b: object) => string[];
  remoteSettingsPatch: (local: object, remote: object, dirty?: string[]) => Record<string, unknown>;
  stillDirty: (dirty: string[], sentKeys: string[], body: Record<string, unknown>, now: object) => string[];
  trackOffline: (list: string[], d: { upserts: Row[]; deletes: { kind: string; id: string }[] }) => string[];
  hasContent: (rows: Row[]) => boolean;
  plannerHasContent: (p: PlannerData) => boolean;
  mergeFirst: (local: PlannerData, rows: Row[], removed?: string[]) => PlannerData;
  firstOutbox: (rows: Row[], merged: PlannerData, removed?: string[]) => Row[];
  key: (kind: string, id: string) => string;
} = require('../../../src/shared/sync-core.js');

export const Cloud: { url: string; key: string } = require('../../../src/shared/cloud-config.js');

type UpdateRelease = { version: string; name: string; url: string; size: number; sumsUrl: string; notes: string; page: string } | null;
export const Update: {
  LATEST: string; isNewer: (latest: string, current: string) => boolean; parseSums: (text: string) => Record<string, string>;
  pick: (release: unknown, kind: 'apk' | 'tarball' | 'appimage') => UpdateRelease;
} = require('../../../src/shared/update-core.js');

export type FocusPhase = 'idle' | 'focus' | 'short' | 'long';
export type FocusState = { phase: FocusPhase; endsAt: number | null; left: number | null; taskId: string | null; classId: string | null; done: number };
type Lengths = Partial<Record<'focus' | 'short' | 'long', number>>;
export const Focus: {
  LENGTHS: Record<'focus' | 'short' | 'long', number>; idle: () => FocusState; clean: (raw: unknown) => FocusState;
  start: (s: FocusState, now: number, o?: Lengths, taskId?: string | null, classId?: string | null) => FocusState; pause: (s: FocusState, now: number) => FocusState;
  resume: (s: FocusState, now: number) => FocusState; stop: (s: FocusState) => FocusState; next: (s: FocusState, now: number, o?: Lengths, skip?: boolean) => FocusState; skip: (s: FocusState, now: number, o?: Lengths) => FocusState;
  tick: (s: FocusState, now: number, o?: Lengths) => { state: FocusState; ended: FocusPhase | null };
  remaining: (s: FocusState, now: number) => number; paused: (s: FocusState) => boolean; label: Record<FocusPhase, string>; clock: (ms: number) => string;
} = require('../../../src/ui/focus-core.js');

// Plain-language quick add, shared with the desktop app: "lab report fri CSP1123" → text, due, class, exam
export type QuickParsed = { text: string; due?: string | null; classId?: string; exam: boolean; at: string | null; venue: string; found: { kind: 'due' | 'class' | 'exam' | 'at' | 'venue'; label: string }[] };
export const QuickAddCore: {
  parse: (text: string, o: { today: string; weekStart?: 0 | 1; classes: { id: string; code: string }[]; nextMeeting?: (classId: string, today: string) => string | null }) => QuickParsed;
} = require('../../../src/ui/quickadd-core.js');

// Accent colours, the Today layout and app-icon helpers, shared with the desktop app
export type TodayLayout = { order: string[]; hidden: string[] };
export const Look: {
  ACCENTS: [string, string, [string, string, string], [string, string, string]][]; ACCENT_IDS: string[];
  accent: (id: string | undefined, dark: boolean) => { accent: string; accentText: string; accentSoft: string };
  TODAY: [string, string, string][]; TODAY_IDS: string[]; todayDefault: () => TodayLayout; cleanToday: (v: unknown) => TodayLayout;
  todaySections: (v: unknown, has?: string[]) => string[]; moveToday: (v: unknown, id: string, dir: 1 | -1) => TodayLayout; showToday: (v: unknown, id: string, on: boolean) => TodayLayout;
  ICON_MAX: number; isIcon: (s: unknown) => boolean; RASTER: RegExp; iconCandidates: (html: string, pageUrl: string) => string[];
} = require('../../../src/ui/look-core.js');

// the privacy policy and legal notes; the desktop app and PRIVACY.md show the same text
export const Legal: {
  OWNER: string; REPO: string; UPDATED: string; CONTACT: string; NOTICES: string; LICENSE: string; COPYRIGHT: string; DISCLAIMER: string;
  PRIVACY: { h: string; p?: string[]; list?: [string, string][] }[];
} = require('../../../src/ui/legal.js');

// the built-in apps' sign-in rules (the desktop's src/services.json): which page is the login page, what to click
export const SignIn: Record<string, { page: string; click: string; docs?: string }> = Object.fromEntries(
  (require('../../../src/services.json') as { id: string; signIn?: { page: string; click: string; docs?: string } }[])
    .filter((x) => x.signIn).map((x) => [x.id, x.signIn!]));
