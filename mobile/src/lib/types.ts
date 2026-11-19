export type Kind = 'lecture' | 'tutorial' | 'lab';
export type Session = { id: string; kind: Kind; section: string; day: number; start: string; end: string; venue: string; mode: 'campus' | 'online'; link: string };
export type ClassItem = { id: string; code: string; name: string; icon: string; color: string; sessions: Session[] };
export type NoteTag = 'quiz' | 'test' | 'consultation' | 'presentation' | 'bring' | 'other';
export type Change = {
  id: string; type: 'cancelled' | 'online' | 'moved' | 'replacement' | 'note'; sessionId: string | null; classId: string | null; date: string; toDate: string | null;
  start: string | null; end: string | null; venue: string; link: string; note: string;
  kind?: Kind; section?: string; // replacement
  tag?: NoteTag; ref?: string | null; // note: what it is, and which class meeting (a session id, or a replacement or move id)
};
export type Task = { id: string; text: string; done: boolean; due: string | null; classId: string | null; created: number; doneAt: number | null; exam?: boolean; at?: string | null; venue?: string };
export type Semester = { name: string; start: string | null; end: string | null; breaks: { start: string; end: string; label: string }[] };
export type Planner = { semester: Semester; classes: ClassItem[]; changes: Change[]; tasks: Task[] };
export type Occurrence = {
  key: string; ref: string; date: string; classId: string; cls: ClassItem; sessionId: string | null; kind: Kind; section: string; start: string; end: string;
  venue: string; mode: 'campus' | 'online'; link: string; status: 'normal' | 'cancelled' | 'online' | 'moved' | 'moved-in' | 'replacement'; live: boolean; change: Change | null;
  toDate?: string | null; fromDate?: string; note?: string; notes?: Change[];
};
export type WebApp = { id: string; name: string; url: string; color: string; icon?: string | null; custom?: boolean; ai?: boolean; external?: boolean; tabOf?: string };
export type Settings = {
  theme: 'system' | 'light' | 'dark'; weekStart: 0 | 1; nickname: string; reminders: 0 | 5 | 10 | 15; classLabel: 'code' | 'name' | 'both';
  notify: Record<string, boolean>; customApps: WebApp[]; apps: string[]; // apps: built-in apps shown on this device
  taskReminder: string; // 'HH:MM' on the due day, '' = off
  haptics?: 'off' | 'subtle' | 'full'; // this device only
  teamsCache?: boolean; // this device only: let Teams keep its offline worker (off by default: it breaks on Android)
  accent?: string; // a preset id from look-core.js
  today?: { order: string[]; hidden: string[] }; // Today's sections: order and hidden (synced)
};
