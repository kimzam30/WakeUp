'use strict';
// Cloud sync for the desktop app: Google sign-in through Supabase, then timetable, tasks and portable
// settings kept in step with the user's other devices. Local data always comes first: everything works offline,
// edits queue in an outbox (saved in state.json) and upload when the network is back.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const S = require('./shared/sync-core.js');
const { emptyPlanner } = require('./shared/planner-schema.js');
const CFG = require('./shared/cloud-config.js');

// loopback ports Google sign-in returns to; each is allow-listed in Supabase as http://127.0.0.1:<port>/**
const PORTS = [47821, 47822, 47823, 47824];
const PAGE = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#191919;color:#e8e8e6}main{text-align:center}p{color:#a3a3a0}</style><main><h1>${title}</h1><p>${body}</p></main>`;

/**
 * @param {object} o
 * @param {Electron.App} o.app @param {Electron.Shell} o.shell @param {Electron.SafeStorage} o.safeStorage @param {Electron.Net} o.net
 * @param {Electron.PowerMonitor} [o.powerMonitor]
 * @param {object} o.state  the app's persisted state (this module owns state.sync)
 * @param {() => void} o.saveState
 * @param {(planner: object) => void} o.setPlanner  replace the planner with one that came from the cloud (no re-upload)
 * @param {(patch: object) => void} o.applySettings  apply settings that came from the cloud (no re-upload)
 * @param {(planner: object) => object} o.cleanPlanner
 * @param {(who: {email: string}) => Promise<'fresh'|'merge'>} o.confirmSwitch  this device holds another account's data
 * @param {() => boolean} [o.isVisible]  skip background polling while the window is hidden
 * @param {(status: object) => void} o.onStatus
 * @param {(...a: any[]) => void} o.log
 */
function createSync(o) {
  const { state, log } = o;
  const AUTH_FILE = path.join(o.app.getPath('userData'), 'auth.bin');
  const sy = state.sync = Object.assign({
    outbox: [], lastPull: null, settingsAt: null, dirtyKeys: [], device: crypto.randomUUID().slice(0, 8),
    owner: null, needsFirst: false, offlineDeletes: [], rejected: 0,
  }, state.sync);
  if (!Array.isArray(sy.outbox)) sy.outbox = [];
  if (!Array.isArray(sy.offlineDeletes)) sy.offlineDeletes = [];
  if (!Array.isArray(sy.dirtyKeys)) sy.dirtyKeys = sy.settingsDirty ? [...S.SYNCED_SETTINGS] : [];
  delete sy.settingsDirty;

  // ---- the signed-in session lives in one file, encrypted with the OS keyring when it's available
  const backend = (() => { try { return o.safeStorage.getSelectedStorageBackend?.() || ''; } catch { return ''; } })();
  const weakKeyring = !o.safeStorage.isEncryptionAvailable() || backend === 'basic_text';
  const mem = {};
  try {
    const raw = fs.readFileSync(AUTH_FILE);
    const txt = o.safeStorage.isEncryptionAvailable() && raw[0] !== 0x7b ? o.safeStorage.decryptString(raw) : raw.toString('utf8');
    Object.assign(mem, JSON.parse(txt));
  } catch { /* not signed in yet */ }
  const persist = () => {
    try {
      const txt = JSON.stringify(mem);
      fs.writeFileSync(AUTH_FILE, o.safeStorage.isEncryptionAvailable() ? o.safeStorage.encryptString(txt) : txt, { mode: 0o600 });
    } catch (e) { log('could not save sign-in', e.message); }
  };
  const storage = {
    getItem: (k) => mem[k] ?? null,
    setItem: (k, v) => { mem[k] = v; persist(); },
    removeItem: (k) => { delete mem[k]; persist(); },
  };
  const sb = createClient(CFG.url, CFG.key, {
    auth: { storage, flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  let user = null; let phase = 'off'; let error = null; let lastSync = sy.lastSyncAt || null; let channel = null;
  let gen = 0; // bumps on every sign-in / sign-out, so work started for an earlier session can't write its results
  const status = () => ({
    signedIn: !!user, email: user?.email || '', name: user?.user_metadata?.full_name || user?.user_metadata?.name || '',
    avatar: user?.user_metadata?.avatar_url || '', phase, error, lastSync, pending: sy.outbox.length + (sy.dirtyKeys.length ? 1 : 0),
    rejected: sy.rejected || 0, signingIn: !!signingIn, weakKeyring,
  });
  const report = (p, err = null) => { phase = p; error = err; o.onStatus(status()); };

  // ---- sign in: the browser does Google, then comes back to a one-shot server on 127.0.0.1
  let signingIn = null; let cancelSignIn = null;
  function listen(server) {
    return new Promise((resolve, reject) => {
      let i = 0;
      const tryNext = () => {
        if (i >= PORTS.length) { reject(new Error('the sign-in ports are busy; close other WakeUp windows and try again')); return; }
        const port = PORTS[i++];
        server.once('error', (e) => (e.code === 'EADDRINUSE' ? tryNext() : reject(e)));
        server.listen(port, '127.0.0.1', () => { server.removeAllListeners('error'); resolve(port); });
      };
      tryNext();
    });
  }
  function signIn() {
    if (signingIn) return signingIn;
    const myGen = ++gen;
    signingIn = new Promise((resolve) => {
      let done = false; let port = 0;
      const sockets = new Set();
      const finish = (r) => {
        if (done) return; done = true; clearTimeout(timer); cancelSignIn = null;
        server.close(); for (const s of sockets) s.destroy();
        resolve(r);
      };
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, `http://127.0.0.1:${port}`);
        if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
        const code = u.searchParams.get('code'); const err = u.searchParams.get('error_description') || u.searchParams.get('error');
        if (!code) { res.writeHead(400, { 'content-type': 'text/html' }).end(PAGE('Sign-in cancelled', 'You can close this tab and try again from WakeUp.')); finish({ error: err || 'cancelled' }); return; }
        try {
          const { data, error: e } = await sb.auth.exchangeCodeForSession(code);
          if (e || !data?.user) throw e || new Error('no account in the reply');
          res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE('You’re signed in', 'You can close this tab and go back to WakeUp.'));
          finish({ user: data.user });
        } catch (e) {
          res.writeHead(400, { 'content-type': 'text/html' }).end(PAGE('Sign-in didn’t work', esc(e.message)));
          finish({ error: e.message });
        }
      });
      server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
      const timer = setTimeout(() => finish({ error: 'Sign-in timed out' }), 5 * 60e3);
      cancelSignIn = () => finish({ error: null, cancelled: true });
      listen(server).then(async (p) => {
        port = p;
        const { data, error: e } = await sb.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `http://127.0.0.1:${port}/callback`, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
        });
        if (e || !data?.url) { finish({ error: e?.message || 'no sign-in address' }); return; }
        o.shell.openExternal(data.url).catch((x) => finish({ error: x.message }));
      }, (e) => finish({ error: e.message }));
    }).then(async (r) => {
      signingIn = null;
      if (myGen !== gen) return status();
      if (r.error || r.cancelled) { report(user ? 'idle' : 'off', r.error || null); return status(); }
      await stopRealtime();
      user = r.user; expired = false; log('signed in to sync as', user.email);
      if (sy.owner && sy.owner !== user.id && S.plannerHasContent(state.planner)) {
        const pick = await o.confirmSwitch({ email: user.email }).catch(() => 'fresh');
        if (myGen !== gen) return status();
        if (pick !== 'merge') { o.setPlanner(emptyPlanner()); sy.outbox = []; sy.offlineDeletes = []; sy.dirtyKeys = []; }
      }
      sy.owner = user.id; sy.needsFirst = true; o.saveState();
      await firstSync(myGen);
      return status();
    });
    o.onStatus(status());
    return signingIn;
  }

  async function signOut() {
    gen++;
    cancelSignIn?.();
    await stopRealtime();
    clearTimeout(flushTimer); retryIn = 5;
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    // the local timetable stays (and stays owned by this account: signing in as someone else asks first)
    user = null; Object.assign(sy, { outbox: [], lastPull: null, settingsAt: null, dirtyKeys: [], lastSyncAt: null, needsFirst: false, offlineDeletes: [], rejected: 0 });
    lastSync = null; o.saveState(); report('off');
    return status();
  }

  // ---- first sync on this device: merge both sides so nothing is lost, then upload what the cloud lacks.
  // Stays pending (sy.needsFirst) until it finishes, so a failure here is retried rather than forgotten.
  async function firstSync(myGen = gen) {
    report('syncing');
    try {
      const rows = await fetchRows(null);
      if (myGen !== gen) return;
      const local = state.planner;
      // deleted here while signed out, or still waiting to upload from before (an expired sign-in): this device wins
      const removed = [...sy.offlineDeletes, ...sy.outbox.filter((r) => r.deleted).map((r) => S.key(r.kind, r.id))];
      const keep = [...removed, ...sy.outbox.filter((r) => !r.deleted).map((r) => S.key(r.kind, r.id))];
      const merged = o.cleanPlanner(rows.length ? S.mergeFirst(local, rows, keep) : local);
      sy.outbox = S.firstOutbox(rows, merged, removed);
      sy.offlineDeletes = [];
      if (JSON.stringify(merged) !== JSON.stringify(local)) o.setPlanner(merged);
      const remote = await fetchSettings();
      if (myGen !== gen) return;
      if (remote) { sy.settingsAt = remote.updated_at; applyRemoteSettings(remote.data); } else sy.dirtyKeys = [...S.SYNCED_SETTINGS];
      sy.lastPull = maxTime(rows) || sy.lastPull;
      sy.needsFirst = false;
      o.saveState();
      await flush();
      startRealtime();
    } catch (e) { log('first sync failed', e.message); fail(e); }
  }

  // ---- reading
  async function fetchRows(since) {
    const out = []; const PAGE_SIZE = 1000;
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = sb.from('wakeup_planner_items').select('kind,id,data,deleted,updated_at,device').order('updated_at').order('kind').order('id').range(from, from + PAGE_SIZE - 1);
      if (since) q = q.gt('updated_at', since);
      const { data, error: e } = await q;
      if (e) throw e;
      out.push(...data);
      if (data.length < PAGE_SIZE) return out;
    }
  }
  async function fetchSettings() {
    const { data, error: e } = await sb.from('wakeup_settings').select('data,updated_at').maybeSingle();
    if (e) throw e;
    return data;
  }
  const maxTime = (rows) => rows.reduce((m, r) => (!m || r.updated_at > m ? r.updated_at : m), null);

  function applyRows(rows) {
    if (!rows.length) return;
    const { planner, changed } = S.apply(state.planner, rows, S.pendingKeys(sy.outbox));
    if (changed) o.setPlanner(o.cleanPlanner(planner));
    const t = maxTime(rows); if (t && (!sy.lastPull || t > sy.lastPull)) sy.lastPull = t;
    o.saveState();
  }
  // remote settings win key by key, except keys this device changed and hasn't uploaded yet
  function applyRemoteSettings(data) {
    if (!data || typeof data !== 'object') return;
    const patch = S.remoteSettingsPatch(state.settings, data, sy.dirtyKeys);
    if (Object.keys(patch).length) o.applySettings(patch);
  }

  async function pull() {
    if (!user) return;
    // overlap generously: a row stamped just before the last one we saw can commit a little later
    const since = sy.lastPull ? new Date(Date.parse(sy.lastPull) - 30e3).toISOString() : null;
    applyRows(await fetchRows(since));
    const remote = await fetchSettings();
    if (remote && remote.updated_at !== sy.settingsAt) { sy.settingsAt = remote.updated_at; applyRemoteSettings(remote.data); }
  }

  // ---- writing
  let flushing = null; let flushTimer = null; let retryIn = 5;
  function scheduleFlush(ms = 800) { clearTimeout(flushTimer); flushTimer = setTimeout(() => { flush(); }, ms); }
  const upsertRows = (rows) => sb.from('wakeup_planner_items').upsert(rows.map((r) => ({ kind: r.kind, id: r.id, data: r.data, deleted: !!r.deleted, device: sy.device })), { onConflict: 'user_id,kind,id' });
  async function flush() {
    if (!user || expired) return;
    if (sy.needsFirst) { if (!flushing) await firstSync(); return; }
    if (flushing) { await flushing; if (sy.outbox.length || sy.dirtyKeys.length) scheduleFlush(50); return; }
    const myGen = gen;
    flushing = (async () => {
      report('syncing');
      try {
        while (sy.outbox.length && myGen === gen) {
          const batch = sy.outbox.slice(0, 200);
          const { error: e } = await upsertRows(batch);
          if (e && kindOf(e) === 'bad') {
            // one bad row mustn't hold up the rest: send them one by one and set aside what the server refuses
            for (const r of batch) {
              const { error: e1 } = await upsertRows([r]);
              if (e1 && kindOf(e1) !== 'bad') throw e1;
              if (e1) { sy.rejected = (sy.rejected || 0) + 1; log('sync refused a row', r.kind, r.id, e1.message); }
            }
          } else if (e) throw e;
          if (myGen !== gen) return;
          const sent = new Set(batch); sy.outbox = sy.outbox.filter((r) => !sent.has(r));
          o.saveState();
        }
        if (sy.dirtyKeys.length && myGen === gen) {
          // send this device's values for the keys it changed, on top of what the cloud already has
          const remote = await fetchSettings();
          const mine = Object.fromEntries(sy.dirtyKeys.filter((k) => k in state.settings).map((k) => [k, state.settings[k]]));
          const body = { ...S.pickSettings(remote?.data || {}), ...S.pickSettings(remote ? mine : state.settings) };
          const sentKeys = [...sy.dirtyKeys];
          const { data, error: e } = await sb.from('wakeup_settings').upsert({ data: body, device: sy.device }, { onConflict: 'user_id' }).select('updated_at').single();
          if (e) throw e;
          if (myGen !== gen) return;
          sy.dirtyKeys = sy.dirtyKeys.filter((k) => !sentKeys.includes(k)); sy.settingsAt = data.updated_at;
          if (remote) applyRemoteSettings(remote.data);
        }
        await pull();
        lastSync = sy.lastSyncAt = new Date().toISOString(); retryIn = 5;
        o.saveState(); report('idle');
      } catch (e) {
        log('sync failed', e.message);
        if (myGen === gen) fail(e);
      }
    })();
    try { await flushing; } finally { flushing = null; }
  }
  // network down: wait for it to come back; signed out on the server: stop and ask; anything else: back off
  function fail(e) {
    const k = kindOf(e);
    if (k === 'auth') { lost(); return; }
    if (k === 'offline') { report('offline'); return; }
    report('error', String(e?.message || e).slice(0, 160));
    scheduleFlush(retryIn * 1000); retryIn = Math.min(retryIn * 2, 300);
  }
  function kindOf(e) {
    const m = String(e?.message || e); const code = String(e?.code || ''); const st = Number(e?.status || 0);
    if (!o.net.isOnline() || /fetch failed|network|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(m)) return 'offline';
    if (st === 401 || code === 'PGRST301' || code === 'PGRST302' || /JWT|refresh token|not authenticated/i.test(m)) return 'auth';
    if (code === '42501' || /^(22|23)/.test(code) || st === 400 || st === 403) return 'bad';
    return 'other';
  }

  // ---- the server signed us out (revoked, expired refresh token): keep local data and the outbox, ask to sign in
  let expired = false;
  function lost() {
    if (!user || expired) return;
    expired = true; clearTimeout(flushTimer);
    stopRealtime();
    log('sync sign-in expired');
    report('expired', 'Your sign-in expired. Sign in again to keep syncing.');
  }

  // ---- live updates from other devices, gathered for a moment and applied together
  let inbox = []; let inboxTimer = null;
  function receive(row) {
    if (!row?.kind) return;
    if (row.device === sy.device) { if (row.updated_at && (!sy.lastPull || row.updated_at > sy.lastPull)) sy.lastPull = row.updated_at; return; }
    inbox.push(row);
    clearTimeout(inboxTimer);
    inboxTimer = setTimeout(() => { const rows = inbox; inbox = []; applyRows(rows); }, 300);
  }
  function startRealtime() {
    if (!user || channel || expired) return;
    channel = sb.channel(`wakeup-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wakeup_planner_items', filter: `user_id=eq.${user.id}` }, (m) => receive(m.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wakeup_settings', filter: `user_id=eq.${user.id}` }, (m) => {
        if (m.new?.data && m.new.updated_at !== sy.settingsAt && m.new.device !== sy.device) { sy.settingsAt = m.new.updated_at; applyRemoteSettings(m.new.data); o.saveState(); }
      })
      .subscribe((st) => { if (st === 'SUBSCRIBED') pull().catch(() => {}); });
  }
  async function stopRealtime() { if (channel) { const c = channel; channel = null; await sb.removeChannel(c).catch(() => {}); } }

  // ---- hooks the app calls when the user edits something
  function plannerChanged(prev, next) {
    const d = S.diff(prev, next);
    if (!d.upserts.length && !d.deletes.length) return;
    if (!user) { if (sy.owner) { sy.offlineDeletes = S.trackOffline(sy.offlineDeletes, d); o.saveState(); } return; }
    sy.outbox = S.queue(sy.outbox, d); o.saveState(); scheduleFlush();
  }
  function settingsChanged(prev, next) {
    if (!user) return;
    const keys = S.settingsKeysChanged(prev, next);
    if (!keys.length) return;
    sy.dirtyKeys = [...new Set([...sy.dirtyKeys, ...keys])]; o.saveState(); scheduleFlush();
  }

  // ---- start: restore the session, catch up, listen; check again whenever the network or the laptop comes back
  async function start() {
    const { data } = await sb.auth.getSession();
    user = data.session?.user || null;
    // a session that couldn't refresh (offline at start) still has its user: keep syncing once the network is back
    if (!user && mem && Object.keys(mem).length) {
      try { const k = Object.keys(mem).find((x) => x.endsWith('-auth-token')); user = k ? JSON.parse(mem[k])?.user || null : null; } catch { user = null; }
    }
    if (!user) { report('off'); return; }
    if (!sy.owner) sy.owner = user.id;
    report('syncing');
    await flush();
    startRealtime();
  }
  const catchUp = () => { if (user && !expired && o.net.isOnline()) { flush(); if (!channel && !sy.needsFirst) startRealtime(); } };
  let wasOnline = true;
  setInterval(() => {
    if (o.isVisible && !o.isVisible()) return;
    const on = o.net.isOnline();
    if (on && !wasOnline) catchUp();
    wasOnline = on;
  }, 15e3).unref?.();
  o.powerMonitor?.on('resume', () => setTimeout(catchUp, 3000));
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'SIGNED_OUT') { if (user) lost(); return; }
    if (session?.user && (ev === 'TOKEN_REFRESHED' || ev === 'SIGNED_IN')) { user = session.user; if (expired && session.user.id === sy.owner) { expired = false; catchUp(); } }
  });

  return {
    start, signIn, signOut, syncNow: () => { if (expired) return Promise.resolve(); return flush(); }, status, plannerChanged, settingsChanged,
    cancelSignIn: () => { cancelSignIn?.(); return status(); },
    onShow: catchUp,
  };
}

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = { createSync };
