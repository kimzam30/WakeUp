// Logos for your own apps: the site's own icon (apple-touch-icon first), the same way the desktop app finds it.
// Nothing goes to a third-party icon service. The icon is saved in settings, so it syncs to your other devices.
import { Look } from './shared';
import { getState, kv, onSettings, setSettings } from './store';
import type { WebApp } from './types';

const busy = new Set<string>();
const raster = (icon?: string | null) => !!icon && Look.isIcon(icon) && !/^data:image\/svg/.test(icon);
const checked = () => kv.get<Record<string, string>>('icons.checked', {});

const timeout = (ms: number) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function iconFrom(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { accept: 'image/png,image/*;q=0.8' }, signal: timeout(8000) });
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !Look.RASTER.test(type)) return null;
  const blob = await res.blob();
  if (blob.size < 40 || blob.size > 66000) return null;
  // FileReader may label the data with the blob's own type; use the server's
  const icon = (await dataUrl(blob)).replace(/^data:[^;,]*/, `data:${type}`);
  return Look.isIcon(icon) ? icon : null;
}

export async function findIcon(app: WebApp) {
  const key = `${app.id} ${app.url}`;
  if (busy.has(key) || (checked()[app.id] === app.url && raster(app.icon))) return;
  busy.add(key);
  try {
    let urls: string[] = [];
    try {
      const res = await fetch(app.url, { signal: timeout(10000) });
      if (res.ok && /html/i.test(res.headers.get('content-type') ?? '')) urls = Look.iconCandidates(await res.text(), res.url || app.url);
    } catch { /* offline or blocked: try /favicon.ico */ }
    if (!urls.length) urls = Look.iconCandidates('', app.url);
    for (const u of urls) {
      const icon = await iconFrom(u).catch(() => null);
      if (!icon) continue;
      const apps = getState().settings.customApps;
      if (apps.some((a) => a.id === app.id && a.url === app.url && a.icon !== icon)) setSettings({ customApps: apps.map((a) => (a.id === app.id ? { ...a, icon } : a)) });
      break;
    }
    kv.set('icons.checked', { ...checked(), [app.id]: app.url });
  } finally { busy.delete(key); }
}

// apps without a logo, or with one from before 2.8 (SVG, or a tiny favicon). Tried once per address, and again if
// another device's older WakeUp syncs an SVG back over it.
const needsIcon = (a: WebApp) => !raster(a.icon) || a.icon!.length < 1500;
export function findIcons() { for (const a of getState().settings.customApps) if (needsIcon(a)) findIcon(a); }

// look again whenever an app is added or its address changes (here or on another device)
let started = false;
export function startIcons() {
  if (started) return; started = true;
  findIcons();
  onSettings((prev, next) => { if (prev.customApps !== next.customApps) findIcons(); });
}
