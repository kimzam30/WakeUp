// Cloud sync on Android: Google sign-in through Supabase in a browser tab (Custom Tab), then the same
// row-per-item, newest-wins sync as the desktop app (shared logic in src/shared/sync-core.js).
import 'react-native-url-polyfill/auto';
import { Alert, AppState } from 'react-native';
import { createClient, type RealtimeChannel, type User } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import NetInfo from '@react-native-community/netinfo';
import Storage from 'expo-sqlite/kv-store';
import * as Crypto from 'expo-crypto';
import { Cloud, Schema, SyncCore as S } from './shared';
import { getState, kv, onLocalChange, setPlanner, setSettings, setSyncStatus, type SyncStatus } from './store';
import type { Settings } from './types';

type Row = { kind: string; id: string; data: unknown; deleted?: boolean; updated_at?: string; device?: string };
const REDIRECT = 'wakeup://auth-callback';

const sb = createClient(Cloud.url, Cloud.key, {
  auth: {
    storage: { getItem: (k) => Storage.getItem(k), setItem: (k, v) => Storage.setItem(k, v), removeItem: (k) => Storage.removeItem(k).then(() => {}) },
    flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false,
  },
});

let user: User | null = null;
let channel: RealtimeChannel | null = null;
let device = kv.get<string>('sync.device', '');
if (!device) { device = Math.random().toString(36).slice(2, 10); kv.set('sync.device', device); }
let outbox = kv.get<Row[]>('sync.outbox', []);
let lastPull = kv.get<string | null>('sync.lastPull', null);
let settingsAt = kv.get<string | null>('sync.settingsAt', null);
let dirtyKeys = kv.get<string[]>('sync.dirtyKeys', kv.get<boolean>('sync.settingsDirty', false) ? [...S.SYNCED_SETTINGS] : []);
let lastSync = kv.get<string | null>('sync.lastSync', null);
let owner = kv.get<string | null>('sync.owner', null); // the account the data on this device belongs to
let needsFirst = kv.get<boolean>('sync.needsFirst', false); // first sync hasn't finished yet: retried until it does
let offlineDeletes = kv.get<string[]>('sync.offlineDeletes', []); // deleted while signed out
let rejected = kv.get<number>('sync.rejected', 0);
const save = () => {
  kv.set('sync.outbox', outbox); kv.set('sync.lastPull', lastPull); kv.set('sync.settingsAt', settingsAt); kv.set('sync.dirtyKeys', dirtyKeys);
  kv.set('sync.lastSync', lastSync); kv.set('sync.owner', owner); kv.set('sync.needsFirst', needsFirst); kv.set('sync.offlineDeletes', offlineDeletes);
  kv.set('sync.rejected', rejected);
};

let expired = false;
let gen = 0; // bumps on every sign-in / sign-out so work started for an earlier session can't write its results
let online = true;
let active = AppState.currentState === 'active';

const report = (phase: SyncStatus['phase'], error: string | null = null) => setSyncStatus({
  signedIn: !!user, email: user?.email ?? '', name: (user?.user_metadata?.full_name || user?.user_metadata?.name || '') as string,
  avatar: (/^https:\/\//.test(String(user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? '')) ? String(user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture) : ''),
  phase, error, lastSync, pending: outbox.length + (dirtyKeys.length ? 1 : 0), rejected,
});
type Kind = 'offline' | 'auth' | 'bad' | 'other';
function kindOf(e: unknown): Kind {
  const x = e as { message?: string; code?: string; status?: number };
  const m = String(x?.message ?? e); const code = String(x?.code ?? ''); const st = Number(x?.status ?? 0);
  if (!online || /network|fetch|timed? ?out|Failed to fetch|Network request failed/i.test(m)) return 'offline';
  if (st === 401 || code === 'PGRST301' || code === 'PGRST302' || /JWT|refresh token|not authenticated/i.test(m)) return 'auth';
  if (code === '42501' || /^(22|23)/.test(code) || st === 400 || st === 403) return 'bad';
  return 'other';
}

// ---- sign in / out
// PKCE done here with expo-crypto (real SHA-256): Hermes has no WebCrypto, so supabase-js would fall back to the
// "plain" method, which failed the server's verifier check on Android.
const b64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function pkce() {
  // 64 unreserved characters (RFC 7636 §4.1); 256 is a multiple of 64, so every character is equally likely
  const verifier = Array.from(Crypto.getRandomBytes(64), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');
  const challenge = b64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  return { verifier, challenge };
}

// This device holds another account's timetable: start fresh (default) or merge it in
const askSwitch = (email: string) => new Promise<'fresh' | 'merge'>((resolve) => {
  Alert.alert(
    'Another account',
    `This device has a timetable from another account. Start fresh to see only ${email}’s timetable and tasks, or merge this device’s classes and tasks into ${email}.`,
    [{ text: 'Keep and merge', onPress: () => resolve('merge') }, { text: 'Start fresh', style: 'default', onPress: () => resolve('fresh') }],
    { cancelable: true, onDismiss: () => resolve('fresh') },
  );
});

let signingIn: Promise<boolean> | null = null;
export function signIn(): Promise<boolean> {
  if (!signingIn) signingIn = doSignIn().finally(() => { signingIn = null; });
  return signingIn;
}
async function doSignIn(): Promise<boolean> {
  const myGen = ++gen;
  report('signing');
  try {
    const { verifier, challenge } = await pkce();
    const q = new URLSearchParams({ provider: 'google', redirect_to: REDIRECT, code_challenge: challenge, code_challenge_method: 's256', prompt: 'select_account' });
    const res = await WebBrowser.openAuthSessionAsync(`${Cloud.url}/auth/v1/authorize?${q}`, REDIRECT);
    if (myGen !== gen) return false;
    if (res.type !== 'success') { report(user ? 'idle' : 'off', res.type === 'cancel' || res.type === 'dismiss' ? null : 'Sign-in didn’t finish'); return false; }
    const { queryParams } = Linking.parse(res.url);
    const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
    if (!code) throw new Error(String(queryParams?.error_description || 'Sign-in was cancelled'));
    const r = await fetch(`${Cloud.url}/auth/v1/token?grant_type=pkce`, {
      method: 'POST', headers: { apikey: Cloud.key, 'content-type': 'application/json' },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
    const tok = await r.json();
    if (!r.ok) throw new Error(tok.msg || tok.error_description || `Sign-in failed (${r.status})`);
    const { data: s, error: e2 } = await sb.auth.setSession({ access_token: tok.access_token, refresh_token: tok.refresh_token });
    if (e2 || !s.user) throw e2 || new Error('No account in the sign-in reply');
    if (myGen !== gen) return false;
    await stopRealtime();
    user = s.user; expired = false;
    if (owner && owner !== user.id && S.plannerHasContent(getState().planner)) {
      const pick = await askSwitch(user.email ?? 'this account');
      if (myGen !== gen) return false;
      if (pick === 'fresh') { setPlanner(Schema.emptyPlanner(), { fromCloud: true }); outbox = []; offlineDeletes = []; dirtyKeys = []; }
    }
    owner = user.id; needsFirst = true; save();
    return await firstSync(myGen);
  } catch (e) { if (myGen === gen) report(user ? 'error' : 'off', String((e as Error)?.message ?? e).slice(0, 160)); return false; }
}

export async function signOut() {
  gen++;
  await stopRealtime();
  if (timer) clearTimeout(timer); retryIn = 5;
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  // the local timetable stays, still owned by this account (signing in as someone else asks first)
  user = null; expired = false; outbox = []; lastPull = null; settingsAt = null; dirtyKeys = []; lastSync = null; needsFirst = false; offlineDeletes = []; rejected = 0; save();
  report('off');
}

// ---- first sync on this device: merge, nothing lost. Returns false (and stays pending) if it didn't finish.
// one first sync at a time: a local edit made while it runs waits for it instead of starting another
let firstRun: Promise<boolean> | null = null;
export function firstSync(myGen = gen): Promise<boolean> {
  if (!firstRun) firstRun = runFirstSync(myGen).finally(() => { firstRun = null; });
  return firstRun;
}
async function runFirstSync(myGen: number): Promise<boolean> {
  report('syncing');
  try {
    const rows = await fetchRows(null);
    if (myGen !== gen) return false;
    const local = getState().planner;
    const removed = [...offlineDeletes, ...outbox.filter((r) => r.deleted).map((r) => S.key(r.kind, r.id))];
    const keep = [...removed, ...outbox.filter((r) => !r.deleted).map((r) => S.key(r.kind, r.id))];
    const merged = rows.length ? S.mergeFirst(local, rows, keep) : local;
    outbox = S.firstOutbox(rows, merged, removed); offlineDeletes = [];
    setPlanner(merged, { fromCloud: true });
    const remote = await fetchSettings();
    if (myGen !== gen) return false;
    if (remote) { settingsAt = remote.updated_at; applyRemoteSettings(remote.data); } else dirtyKeys = [...S.SYNCED_SETTINGS];
    lastPull = maxTime(rows) ?? lastPull; needsFirst = false; save();
    await flush();
    if (active) startRealtime();
    return true;
  } catch (e) { if (myGen === gen) fail(e); return false; }
}
// Does the cloud already have a timetable for this account? (onboarding skips ahead when it does)
export async function cloudSummary(): Promise<{ classes: number; tasks: number; has: boolean }> {
  const count = async (kind: string, extra?: (q: any) => any) => {
    let q = sb.from('wakeup_planner_items').select('id', { count: 'exact', head: true }).eq('kind', kind).eq('deleted', false);
    if (extra) q = extra(q);
    const { count: n, error } = await q; if (error) throw error; return n ?? 0;
  };
  const [classes, tasks, changes] = await Promise.all([count('class'), count('task', (q) => q.contains('data', { done: false })), count('change')]);
  const { data: sem } = await sb.from('wakeup_planner_items').select('data').eq('kind', 'semester').eq('deleted', false).maybeSingle();
  const has = classes + tasks + changes > 0 || !!(sem?.data as { start?: string } | undefined)?.start;
  return { classes, tasks, has };
}

// ---- reading
async function fetchRows(since: string | null): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('wakeup_planner_items').select('kind,id,data,deleted,updated_at,device').order('updated_at').order('kind').order('id').range(from, from + 999);
    if (since) q = q.gt('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data as Row[]));
    if (data.length < 1000) return out;
  }
}
async function fetchSettings() {
  const { data, error } = await sb.from('wakeup_settings').select('data,updated_at').maybeSingle();
  if (error) throw error;
  return data as { data: Partial<Settings>; updated_at: string } | null;
}
const maxTime = (rows: Row[]) => rows.reduce<string | null>((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), null);

function applyRows(rows: Row[]) {
  if (!rows.length) return;
  const { planner, changed } = S.apply(getState().planner, rows, S.pendingKeys(outbox));
  if (changed) setPlanner(planner, { fromCloud: true });
  const t = maxTime(rows); if (t && (!lastPull || t > lastPull)) lastPull = t;
  save();
}
// remote settings win key by key, except keys changed here and not uploaded yet
function applyRemoteSettings(data: unknown) {
  if (!data || typeof data !== 'object') return;
  const patch = S.remoteSettingsPatch(getState().settings, data, dirtyKeys) as Partial<Settings>;
  if (Object.keys(patch).length) setSettings(patch, { fromCloud: true });
}
async function pull() {
  if (!user) return;
  const since = lastPull ? new Date(Date.parse(lastPull) - 30e3).toISOString() : null;
  applyRows(await fetchRows(since));
  const remote = await fetchSettings();
  if (remote && remote.updated_at !== settingsAt) { settingsAt = remote.updated_at; applyRemoteSettings(remote.data); }
}

// ---- writing
let flushing: Promise<void> | null = null; let timer: ReturnType<typeof setTimeout> | null = null; let retryIn = 5;
const scheduleFlush = (ms = 800) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { flush(); }, ms); };
const upsertRows = (rows: Row[]) => sb.from('wakeup_planner_items').upsert(rows.map((r) => ({ kind: r.kind, id: r.id, data: r.data, deleted: !!r.deleted, device })), { onConflict: 'user_id,kind,id' });
export async function flush(): Promise<void> {
  if (!user || expired) return;
  if (!online) { report('offline'); return; }
  if (needsFirst) { await firstSync(); return; }
  if (flushing) { await flushing; if (outbox.length || dirtyKeys.length) scheduleFlush(50); return; }
  const myGen = gen;
  flushing = (async () => {
    report('syncing');
    try {
      while (outbox.length && myGen === gen) {
        const batch = outbox.slice(0, 200);
        const { error } = await upsertRows(batch);
        if (error && kindOf(error) === 'bad') {
          // one bad row mustn't hold up the rest: send one by one and set aside what the server refuses
          for (const r of batch) {
            const { error: e1 } = await upsertRows([r]);
            if (e1 && kindOf(e1) !== 'bad') throw e1;
            if (e1) { rejected += 1; console.warn('sync refused', r.kind, r.id, e1.message); }
          }
        } else if (error) throw error;
        if (myGen !== gen) return;
        const sent = new Set(batch); outbox = outbox.filter((r) => !sent.has(r)); save();
      }
      if (dirtyKeys.length && myGen === gen) {
        const remote = await fetchSettings();
        const st = getState().settings as unknown as Record<string, unknown>;
        const mine = Object.fromEntries(dirtyKeys.filter((k) => k in st).map((k) => [k, st[k]]));
        const body = { ...S.pickSettings(remote?.data ?? {}), ...S.pickSettings(remote ? mine : st) };
        const sentKeys = [...dirtyKeys];
        const { data, error } = await sb.from('wakeup_settings').upsert({ data: body, device }, { onConflict: 'user_id' }).select('updated_at').single();
        if (error) throw error;
        if (myGen !== gen) return;
        // what was uploaded is the cloud's copy now: take its other keys, keep anything edited during the upload
        dirtyKeys = S.stillDirty(dirtyKeys, sentKeys, body, getState().settings); settingsAt = data.updated_at;
        applyRemoteSettings(body);
      }
      await pull();
      lastSync = new Date().toISOString(); retryIn = 5; save(); report('idle');
    } catch (e) { if (myGen === gen) fail(e); }
  })();
  try { await flushing; } finally { flushing = null; }
}
// offline: wait for the network to come back (NetInfo wakes us); signed out on the server: stop and ask; else back off
function fail(e: unknown) {
  const k = kindOf(e);
  if (k === 'auth') { lost(); return; }
  if (k === 'offline') { report('offline'); return; }
  report('error', String((e as Error)?.message ?? e).slice(0, 160));
  if (active) { scheduleFlush(retryIn * 1000); retryIn = Math.min(retryIn * 2, 300); }
}
function lost() {
  if (!user || expired) return;
  expired = true; if (timer) clearTimeout(timer);
  stopRealtime();
  report('expired', 'Your sign-in expired. Sign in again to keep syncing.');
}

// ---- live updates (only while the app is on screen), gathered for a moment and applied together
let inbox: Row[] = []; let inboxTimer: ReturnType<typeof setTimeout> | null = null;
function receive(r: Row | undefined) {
  if (!r?.kind) return;
  if (r.device === device) { if (r.updated_at && (!lastPull || r.updated_at > lastPull)) lastPull = r.updated_at; return; }
  inbox.push(r);
  if (inboxTimer) clearTimeout(inboxTimer);
  inboxTimer = setTimeout(() => { const rows = inbox; inbox = []; applyRows(rows); }, 300);
}
function startRealtime() {
  if (!user || channel || expired || needsFirst) return;
  channel = sb.channel(`wakeup-${user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wakeup_planner_items', filter: `user_id=eq.${user.id}` }, (m) => receive(m.new as Row))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wakeup_settings', filter: `user_id=eq.${user.id}` }, (m) => {
      const r = m.new as { data?: unknown; updated_at?: string; device?: string };
      if (r?.data && r.updated_at !== settingsAt && r.device !== device) { settingsAt = r.updated_at ?? null; applyRemoteSettings(r.data); save(); }
    })
    .subscribe((st) => { if (st === 'SUBSCRIBED') pull().catch(() => {}); });
}
async function stopRealtime() { if (channel) { const c = channel; channel = null; await sb.removeChannel(c).catch(() => {}); } }

// ---- edits made on this phone/tablet
onLocalChange({
  planner: (prev, next) => {
    const d = S.diff(prev, next);
    if (!d.upserts.length && !d.deletes.length) return;
    if (!user) { if (owner) { offlineDeletes = S.trackOffline(offlineDeletes, d); save(); } return; }
    outbox = S.queue(outbox, d); save(); report(online ? 'syncing' : 'offline'); scheduleFlush();
  },
  settings: (prev, next) => {
    if (!user) return;
    const keys = S.settingsKeysChanged(prev, next);
    if (!keys.length) return;
    dirtyKeys = [...new Set([...dirtyKeys, ...keys])]; save(); scheduleFlush();
  },
});

// ---- start: restore the session and catch up. In the background: no socket, no timers, no retries.
export async function startSync() {
  const { data } = await sb.auth.getSession();
  user = data.session?.user ?? null;
  if (!user) { report('off'); return; }
  if (!owner) { owner = user.id; save(); }
  report('syncing');
  await flush();
  if (active) startRealtime();
}
const catchUp = () => { if (user && !expired && online && active) { flush(); startRealtime(); } };
AppState.addEventListener('change', (s) => {
  const now = s === 'active';
  if (now === active) return;
  active = now;
  if (active) { sb.auth.startAutoRefresh(); catchUp(); } else { sb.auth.stopAutoRefresh(); stopRealtime(); if (timer) clearTimeout(timer); }
});
NetInfo.addEventListener((n) => {
  const was = online;
  online = n.isConnected !== false && n.isInternetReachable !== false;
  if (online && !was) catchUp();
  else if (!online && was && user) report('offline');
});
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'SIGNED_OUT') { if (user) lost(); return; }
  if (session?.user && (ev === 'TOKEN_REFRESHED' || ev === 'SIGNED_IN') && user && session.user.id === user.id) user = session.user;
});
WebBrowser.maybeCompleteAuthSession();
