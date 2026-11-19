// Attendance QR on Android (v3, A6). A meeting's shared screen is a <video> (or a <canvas>) inside the Teams or Meet
// page, which Android can't screenshot from outside a web view. So the scanner runs inside the page: every 2 seconds it
// draws each visible video and canvas into a small canvas, reads it with jsQR, and posts the first code it finds back
// to WakeUp. Nothing leaves the phone. Stopping (or finding a code, or 10 minutes) removes it.
import JSQR_SOURCE from './jsqr-source';

export const MEET_HOSTS = /(^|\.)(teams\.microsoft\.com|teams\.live\.com|teams\.cloud\.microsoft|meet\.google\.com)$/;
export const isMeetingUrl = (url: string) => { try { return MEET_HOSTS.test(new URL(url).hostname); } catch { return false; } };

export function startScanScript(): string {
  return `(() => {
    if (window.__wakeupQr) return true;
    // jsQR attaches to window unless the page has an AMD loader: hide that while it loads
    if (!window.jsQR) { const d = window.define; window.define = undefined; try { ${JSQR_SOURCE}; } finally { window.define = d; } }
    if (!window.jsQR) return true;
    const c = document.createElement('canvas'); const g = c.getContext('2d', { willReadFrequently: true });
    const t0 = Date.now();
    const look = () => {
      const els = [...document.querySelectorAll('video, canvas')].filter((el) => el !== c && el.offsetWidth > 120 && el.offsetHeight > 90);
      for (const el of els) {
        try {
          const w = el.videoWidth || el.width; const h = el.videoHeight || el.height; if (!w || !h) continue;
          const s = Math.min(1, 1280 / w); c.width = Math.round(w * s); c.height = Math.round(h * s);
          g.drawImage(el, 0, 0, c.width, c.height);
          const r = window.jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
          if (r && r.data) { window.ReactNativeWebView.postMessage(JSON.stringify({ wakeupQr: r.data })); stop(); return; }
        } catch (e) { /* a protected frame: skip it */ }
      }
      if (Date.now() - t0 > 600000) { window.ReactNativeWebView.postMessage(JSON.stringify({ wakeupQrTimeout: true })); stop(); }
    };
    const timer = setInterval(look, 2000);
    const stop = () => { clearInterval(timer); window.__wakeupQr = null; };
    window.__wakeupQr = { stop };
    look();
  })(); true;`;
}
export const stopScanScript = () => 'window.__wakeupQr && window.__wakeupQr.stop(); true;';
