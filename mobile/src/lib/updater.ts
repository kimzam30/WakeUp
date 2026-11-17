// One-tap updates on Android, from this repository's GitHub releases (rules shared with the desktop app in
// src/shared/update-core.js). WakeUp downloads the new APK, checks it against the release's SHA256SUMS, then hands it
// to Android's installer, which shows one Install button. Android itself refuses an APK that isn't signed with the
// same key as the installed app, so a file from anywhere else can't replace WakeUp.
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Update as U } from './shared';
import { kv } from './store';

export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
export type UpdateState = {
  phase: UpdatePhase; current: string; latest: string | null; notes: string; page: string | null;
  progress: number; error: string | null; checkedAt: number | null; auto: boolean; skipped: string | null;
};

const CHECK_EVERY = 6 * 3600e3;
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const dir = new Directory(Paths.cache, 'updates');

let st: UpdateState = {
  phase: 'idle', current: Constants.expoConfig?.version ?? '0.0.0', latest: null, notes: '', page: null, progress: 0, error: null,
  checkedAt: kv.get<number | null>('update.checkedAt', null), auto: kv.get<boolean>('update.auto', true), skipped: kv.get<string | null>('update.skip', null),
};
let release: ReturnType<typeof U.pick> = null;
let apk: File | null = null;
let task: { cancel: () => void } | null = null;
let etag: string | null = null; let cached: unknown = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<UpdateState>) => { st = { ...st, ...patch }; for (const l of listeners) l(); };

export function useUpdate() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => st, () => st);
}

const friendly = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  return /network|fetch|timed? ?out|unable to resolve/i.test(m) ? 'You seem to be offline. Try again when you’re connected.' : m.slice(0, 160);
};

export async function checkForUpdate({ quiet = false } = {}): Promise<UpdateState> {
  if (st.phase === 'downloading' || st.phase === 'ready') return st;
  if (!quiet) set({ phase: 'checking', error: null });
  try {
    const r = await fetch(U.LATEST, { headers: { Accept: 'application/vnd.github+json', ...(etag ? { 'If-None-Match': etag } : {}) } });
    let json: unknown = null;
    if (r.status === 304 && cached) json = cached;
    else if (r.ok) { etag = r.headers.get('etag'); json = cached = await r.json(); } else if (r.status !== 404) throw new Error(r.status === 403 ? 'GitHub is limiting update checks; try again later.' : `GitHub said ${r.status}`);
    const rel = U.pick(json, 'apk');
    const checkedAt = Date.now(); kv.set('update.checkedAt', checkedAt);
    if (rel && U.isNewer(rel.version, st.current)) { release = rel; set({ phase: 'available', latest: rel.version, notes: rel.notes, page: rel.page, checkedAt, error: null }); }
    else { release = null; set({ phase: 'current', latest: rel?.version ?? st.current, checkedAt, error: null }); }
  } catch (e) {
    set(quiet ? { phase: st.phase === 'checking' ? 'idle' : st.phase } : { phase: 'error', error: friendly(e) });
  }
  return st;
}

export async function installUpdate() {
  if (st.phase === 'ready' && apk?.exists) { await openInstaller(apk); return; }
  if (!release || st.phase === 'downloading') return;
  const rel = release;
  try {
    set({ phase: 'downloading', progress: 0, error: null });
    const sums = await fetch(rel.sumsUrl);
    if (!sums.ok) throw new Error(`Couldn’t get the checksums (${sums.status})`);
    const want = U.parseSums(await sums.text())[rel.name];
    if (!want) throw new Error('The release has no checksum for the app.');
    if (dir.exists) dir.delete();
    dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, rel.name);
    const t = File.createDownloadTask(rel.url, dest, { onProgress: ({ bytesWritten, totalBytes }) => set({ progress: totalBytes ? bytesWritten / totalBytes : 0 }) });
    task = t;
    const file = await t.downloadAsync();
    task = null;
    if (!file) { set({ phase: 'available', progress: 0 }); return; } // cancelled
    const got = await file.digest('SHA-256');
    if (got.toLowerCase() !== want) { file.delete(); throw new Error('The download was damaged (checksum mismatch). Nothing was installed.'); }
    apk = file;
    set({ phase: 'ready', progress: 1 });
    await openInstaller(file);
  } catch (e) {
    task = null;
    set({ phase: 'error', error: friendly(e), progress: 0 });
  }
}
export function cancelUpdate() { task?.cancel(); task = null; set({ phase: release ? 'available' : 'idle', progress: 0 }); }

// Android's own installer: the first time, it asks to allow installs from WakeUp (one switch), then shows Install
async function openInstaller(file: File) {
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri, type: 'application/vnd.android.package-archive', flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

export function skipUpdate() { if (st.latest) { kv.set('update.skip', st.latest); set({ skipped: st.latest }); } }
export function setAutoUpdate(auto: boolean) { kv.set('update.auto', auto); set({ auto }); if (auto) checkForUpdate({ quiet: true }); }

// After launch, and when WakeUp comes back to the screen, at most every few hours. An APK left over from an update
// that has since been installed is removed.
let started = false;
export function startUpdates() {
  if (started) return; started = true;
  try { if (dir.exists) dir.delete(); } catch { /* best effort */ }
  const due = () => st.auto && (!st.checkedAt || Date.now() - st.checkedAt > CHECK_EVERY);
  setTimeout(() => { if (due()) checkForUpdate({ quiet: true }); }, 15e3);
  AppState.addEventListener('change', (s) => { if (s === 'active' && due()) checkForUpdate({ quiet: true }); });
}
