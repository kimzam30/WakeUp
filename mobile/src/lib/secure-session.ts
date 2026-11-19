// Where the Supabase sign-in lives on Android: the Keystore-encrypted SecureStore, not the plain SQLite store.
// A session (tokens plus your Google profile) can pass SecureStore's ~2 KB comfort limit, so it's stored in
// chunks: `<key>.n` holds how many, `<key>.0`… hold the pieces. A session saved by WakeUp 2.9 or older in the
// plain store moves over the first time it's read, and the plain copy is removed.
import * as SecureStore from 'expo-secure-store';
import Plain from 'expo-sqlite/kv-store';

const CHUNK = 1800;
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
// SecureStore keys may only hold letters, digits, '.', '-' and '_'
const safe = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

async function readSecure(key: string): Promise<string | null> {
  const n = Number(await SecureStore.getItemAsync(`${key}.n`, OPTS));
  if (!n) return null;
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`, OPTS)));
  return parts.some((p) => p == null) ? null : parts.join(''); // a half-written session counts as none
}
async function removeSecure(key: string) {
  const n = Number(await SecureStore.getItemAsync(`${key}.n`, OPTS)) || 0;
  await SecureStore.deleteItemAsync(`${key}.n`, OPTS); // first, so a reader never sees a count with missing pieces
  await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.deleteItemAsync(`${key}.${i}`, OPTS)));
}
async function writeSecure(key: string, value: string) {
  await removeSecure(key);
  const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) ?? [''];
  for (let i = 0; i < parts.length; i++) await SecureStore.setItemAsync(`${key}.${i}`, parts[i], OPTS);
  await SecureStore.setItemAsync(`${key}.n`, String(parts.length), OPTS); // last: the count says it's complete
}

export const secureSession = {
  async getItem(k: string): Promise<string | null> {
    const key = safe(k);
    const v = await readSecure(key);
    if (v != null) return v;
    const old = await Plain.getItem(k); // from before 2.10: move it into SecureStore
    if (old == null) return null;
    await writeSecure(key, old);
    await Plain.removeItem(k);
    return old;
  },
  async setItem(k: string, v: string) { await writeSecure(safe(k), v); },
  async removeItem(k: string) { await removeSecure(safe(k)); await Plain.removeItem(k).catch(() => {}); },
};
