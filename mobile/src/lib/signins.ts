// Saved sign-in on Android (v3, A5): one Microsoft account, kept in SecureStore (Android Keystore encryption),
// never synced. It's typed into a web app only when that page is Microsoft's own sign-in page, and WakeUp never
// presses Sign in for you. The same rules as the desktop (src/signins.js).
import * as SecureStore from 'expo-secure-store';

const KEY = 'signin.microsoft';
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const SIGNIN_HOSTS = ['login.microsoftonline.com', 'login.microsoft.com', 'login.live.com'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
type Account = { email: string; password: string };

async function read(): Promise<Account | null> {
  try { const v = await SecureStore.getItemAsync(KEY, OPTS); return v ? JSON.parse(v) : null; } catch { return null; }
}
export async function savedEmail(): Promise<string | null> { return (await read())?.email ?? null; }
export async function saveSignIn(email: string, password: string) {
  email = email.trim();
  if (!EMAIL.test(email)) throw new Error('That doesn’t look like an email address.');
  if (!password || password.length > 256) throw new Error('Type the password for this account.');
  await SecureStore.setItemAsync(KEY, JSON.stringify({ email, password }), OPTS);
}
export async function forgetSignIn() { await SecureStore.deleteItemAsync(KEY, OPTS); }

// The script for a sign-in page: email on the first step, password on the next (the page changes steps without
// loading, so it watches for up to two minutes). It checks the host again inside the page.
export async function signInScript(url: string): Promise<string | null> {
  let u: URL; try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || !SIGNIN_HOSTS.includes(u.hostname)) return null;
  const a = await read(); if (!a) return null;
  return `(() => {
    if (!${JSON.stringify(SIGNIN_HOSTS)}.includes(location.hostname) || window.__wakeupFilled) return; window.__wakeupFilled = true;
    const E = ${JSON.stringify(a.email)}; const P = ${JSON.stringify(a.password)};
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const shown = (el) => el && el.offsetParent !== null && !el.disabled;
    const done = { e: false, p: false }; const t0 = Date.now();
    const tick = () => {
      const e = document.querySelector('input[name="loginfmt"]'); if (!done.e && shown(e) && !e.value) { set(e, E); done.e = true; }
      const p = document.querySelector('input[name="passwd"]'); if (!done.p && shown(p) && !p.value) { set(p, P); done.p = true; }
      if ((done.e && done.p) || Date.now() - t0 > 120000) return; setTimeout(tick, 400);
    };
    tick();
  })(); true;`;
}
