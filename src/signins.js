'use strict';
// Saved sign-ins (v3, A5). One Microsoft account (Ebwise, Outlook, Calendar and Teams all sign in through it),
// encrypted with the operating system's keyring (Electron safeStorage) in its own file on this computer, never
// synced. The password never goes to WakeUp's own pages: they can save, list (email only) and forget it. It is
// typed into the page only when that page is Microsoft's own sign-in page, and WakeUp never presses Sign in for you.
const fs = require('fs');
const path = require('path');

const HOSTS = ['login.microsoftonline.com', 'login.microsoft.com', 'login.live.com'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

module.exports = function createSignIns({ app, safeStorage, log }) {
  const FILE = path.join(app.getPath('userData'), 'signins.bin');
  // Linux without a keyring falls back to "basic_text", which isn't real encryption: don't keep passwords there
  const strong = () => {
    try { return safeStorage.isEncryptionAvailable() && (safeStorage.getSelectedStorageBackend?.() || '') !== 'basic_text'; } catch { return false; }
  };
  const read = () => {
    try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(FILE))) || {}; } catch { return {}; }
  };
  const write = (o) => {
    if (!Object.keys(o).length) { try { fs.rmSync(FILE, { force: true }); } catch { /* already gone */ } return; }
    fs.writeFileSync(FILE, safeStorage.encryptString(JSON.stringify(o)), { mode: 0o600 });
  };

  function list() {
    const all = read();
    return { strong: strong(), accounts: Object.entries(all).map(([id, v]) => ({ id, email: v.email })) };
  }
  function save({ id, email, password } = {}) {
    if (id !== 'microsoft') throw new Error('Only a Microsoft account can be saved.');
    email = String(email ?? '').trim(); password = String(password ?? '');
    if (!EMAIL.test(email)) throw new Error('That doesn’t look like an email address.');
    if (!password || password.length > 256) throw new Error('Type the password for this account.');
    if (!strong()) throw new Error('This computer has no secure keyring, so WakeUp won’t keep a password here. On Linux, install and unlock a keyring (GNOME Keyring or KWallet).');
    write({ ...read(), [id]: { email, password, saved: Date.now() } });
    return list();
  }
  function forget(id) { const all = read(); delete all[id]; write(all); return list(); }

  // Fill the sign-in page, if this is one: the email on the first step, the password on the next (Microsoft's
  // page changes steps without loading a new page, so the script watches for up to two minutes).
  function fill(wc) {
    let u; try { u = new URL(wc.getURL()); } catch { return; }
    if (u.protocol !== 'https:' || !HOSTS.includes(u.hostname)) return;
    const acct = read().microsoft; if (!acct) return;
    const js = `(() => {
      if (!${JSON.stringify(HOSTS)}.includes(location.hostname) || window.__wakeupFilled) return; window.__wakeupFilled = true;
      const E = ${JSON.stringify(acct.email)}; const P = ${JSON.stringify(acct.password)};
      const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const shown = (el) => el && el.offsetParent !== null && !el.disabled;
      const done = { e: false, p: false }; const t0 = Date.now();
      const tick = () => {
        const e = document.querySelector('input[name="loginfmt"]'); if (!done.e && shown(e) && !e.value) { set(e, E); done.e = true; }
        const p = document.querySelector('input[name="passwd"]'); if (!done.p && shown(p) && !p.value) { set(p, P); done.p = true; }
        if ((done.e && done.p) || Date.now() - t0 > 120000) return; setTimeout(tick, 400);
      };
      tick();
    })();`;
    wc.executeJavaScript(js, true).catch((e) => log('sign-in fill failed:', e.message));
  }
  return { list, save, forget, fill, HOSTS };
};
