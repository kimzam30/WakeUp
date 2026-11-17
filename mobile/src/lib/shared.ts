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
