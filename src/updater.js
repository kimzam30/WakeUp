'use strict';
// One-click updates for the desktop app, from this repository's GitHub releases (see src/shared/update-core.js).
//
// How the app was installed decides what an update replaces:
//   ~/.local/lib/wakeup (scripts/install.sh)  the tarball is unpacked next to it, then swapped in with two renames
//   an AppImage                               the new AppImage replaces the file you started
//   anything else (npm start, a dev build)    no updates; it says how to update instead
// Every file is checked against the release's SHA256SUMS before anything is replaced. Nothing is replaced while the
// app is running from it except by rename, so a failed update leaves the old version in place.
// Inside Electron, `fs` treats app.asar as a folder, so deleting an old install fails with ENOTEMPTY
// (it can't empty resources/). `original-fs` is the plain Node one; tests run in Node and get node:fs.
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const U = require('./shared/update-core.js');

const CHECK_EVERY = 6 * 3600e3;
const DEFAULT_LIB = path.join(os.homedir(), '.local', 'lib', 'wakeup');

// `lib` and `exePath` are for tests; the app uses the defaults.
function createUpdater({ app, net, log, getSettings, onState, lib: LIB = DEFAULT_LIB, exePath = process.execPath }) {
  const exe = exePath;
  const appImage = process.env.APPIMAGE && fs.existsSync(process.env.APPIMAGE) ? process.env.APPIMAGE : null;
  const mode = !app.isPackaged ? 'dev' : appImage ? 'appimage' : path.dirname(exe) === LIB ? 'installed' : 'other';
  const kind = mode === 'appimage' ? 'appimage' : 'tarball';
  const current = app.getVersion();
  let st = { phase: mode === 'installed' || mode === 'appimage' ? 'idle' : 'unsupported', mode, current, latest: null, notes: '', page: null, progress: 0, error: null, checkedAt: null };
  let release = null; let etag = null; let cached = null; let busy = null; let timer = null; let abort = null;
  const set = (patch) => { st = { ...st, ...patch }; onState(st); };
  const temp = path.join(app.getPath('temp'), 'wakeup-update');

  // a previous update leaves the old version beside the new one until the next start
  if (mode === 'installed') fs.rm(`${LIB}.old`, { recursive: true, force: true }, () => {});

  async function getJson(url) {
    const r = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `WakeUp/${current}`, ...(etag ? { 'If-None-Match': etag } : {}) } });
    if (r.status === 304 && cached) return cached;
    if (r.status === 404) return null; // no release yet
    if (!r.ok) throw new Error(r.status === 403 ? 'GitHub is limiting update checks; trying again later' : `GitHub said ${r.status}`);
    etag = r.headers.get('etag'); cached = await r.json();
    return cached;
  }

  async function check({ quiet = false } = {}) {
    if (st.phase === 'unsupported' || ['downloading', 'installing', 'ready'].includes(st.phase)) return st;
    if (!quiet) set({ phase: 'checking', error: null });
    try {
      const rel = U.pick(await getJson(U.LATEST), kind);
      const checkedAt = Date.now();
      if (rel && U.isNewer(rel.version, current)) { release = rel; set({ phase: 'available', latest: rel.version, notes: rel.notes, page: rel.page, checkedAt, error: null }); }
      else { release = null; set({ phase: 'current', latest: rel?.version || current, checkedAt, error: null }); }
    } catch (e) {
      log('update check failed', e.message);
      set(quiet ? { phase: st.phase === 'checking' ? 'idle' : st.phase } : { phase: 'error', error: friendly(e) });
    }
    return st;
  }

  // stream a release file to disk, hashing as it goes
  async function download(url, dest, size) {
    const r = await net.fetch(url, { signal: abort.signal });
    if (!r.ok || !r.body) throw new Error(`Download failed (${r.status})`);
    const total = Number(r.headers.get('content-length')) || size || 0;
    const hash = crypto.createHash('sha256'); const out = fs.createWriteStream(dest);
    let got = 0; let last = 0;
    try {
      for await (const chunk of r.body) {
        hash.update(chunk); got += chunk.length;
        if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
        if (total && Date.now() - last > 250) { last = Date.now(); set({ progress: got / total }); }
      }
    } finally { await new Promise((res) => out.end(res)); }
    return hash.digest('hex');
  }
  const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, (e, _o, se) => (e ? rej(new Error(String(se || e.message).trim().slice(0, 200))) : res())));

  async function install() {
    if (!release || busy) return busy;
    abort = new AbortController();
    busy = (async () => {
      const rel = release;
      try {
        set({ phase: 'downloading', progress: 0, error: null });
        await fsp.rm(temp, { recursive: true, force: true }); await fsp.mkdir(temp, { recursive: true });
        const sumsRes = await net.fetch(rel.sumsUrl, { signal: abort.signal });
        if (!sumsRes.ok) throw new Error(`Couldn't get the checksums (${sumsRes.status})`);
        const want = U.parseSums(await sumsRes.text())[rel.name];
        if (!want) throw new Error('The release has no checksum for this file');
        const file = path.join(temp, rel.name);
        const got = await download(rel.url, file, rel.size);
        if (got !== want) throw new Error('The download was damaged (checksum mismatch). Nothing was changed.');
        set({ phase: 'installing', progress: 1 });
        if (mode === 'installed') await swapInstall(file); else await swapAppImage(file);
        log('update installed', current, '->', rel.version);
        set({ phase: 'ready' });
      } catch (e) {
        if (e.name === 'AbortError') { set({ phase: 'available', progress: 0 }); return; }
        log('update failed', e.message);
        set({ phase: 'error', error: friendly(e), progress: 0 });
      } finally { busy = null; abort = null; fs.rm(temp, { recursive: true, force: true }, () => {}); }
    })();
    return busy;
  }

  // ~/.local/lib/wakeup: unpack beside it, check it, then two renames (old → .old, new → in place)
  async function swapInstall(tarball) {
    const next = `${LIB}.new`; const old = `${LIB}.old`;
    await fsp.rm(next, { recursive: true, force: true }); await fsp.mkdir(next, { recursive: true });
    await run('tar', ['-xzf', tarball, '-C', next, '--strip-components=1', '--no-same-owner']);
    const bin = path.join(next, 'wakeup');
    await fsp.access(bin, fs.constants.X_OK).catch(() => { throw new Error('The update is missing the app itself'); });
    await fsp.rm(old, { recursive: true, force: true });
    await fsp.rename(LIB, old);
    try { await fsp.rename(next, LIB); } catch (e) { await fsp.rename(old, LIB).catch(() => {}); throw e; }
  }
  // AppImage: write the new one beside the old, then rename over it (the running copy keeps its open file)
  async function swapAppImage(file) {
    const tmp = `${appImage}.new`;
    await fsp.copyFile(file, tmp); await fsp.chmod(tmp, 0o755);
    await fsp.rename(tmp, appImage);
  }

  function restart() {
    if (st.phase !== 'ready') return;
    app.relaunch(mode === 'appimage' ? { execPath: appImage, args: process.argv.slice(1) } : { args: process.argv.slice(1).filter((a) => a !== '--hidden') });
    app.quit(); // a normal quit, so the layout and sign-ins are saved first
  }
  function cancel() { abort?.abort(); }

  function schedule() {
    clearTimeout(timer);
    if (st.phase === 'unsupported' || getSettings().autoUpdate === false) return;
    timer = setTimeout(async () => { await check({ quiet: true }); schedule(); }, CHECK_EVERY);
  }
  function start() {
    onState(st);
    if (st.phase === 'unsupported' || getSettings().autoUpdate === false) return;
    setTimeout(() => check({ quiet: true }).finally(schedule), 20e3); // after startup, not during it
  }

  return { start, check: () => check(), install, cancel, restart, schedule, state: () => st };
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/ENOTFOUND|ECONN|ETIMEDOUT|network|ERR_INTERNET|ERR_NAME/i.test(m)) return 'You seem to be offline. Try again when you’re connected.';
  if (/EACCES|EPERM/i.test(m)) return 'WakeUp couldn’t write to its install folder. Update with scripts/install.sh instead.';
  return m.slice(0, 200);
}

module.exports = { createUpdater };
