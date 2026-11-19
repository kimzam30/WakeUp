'use strict';
// Attendance QR (v3, A6): the worker reads a QR code from a raw BGRA screenshot, the format Electron's
// NativeImage.toBitmap gives, including one that's small on a big busy screen, and says null when there's none.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const QRCode = require('qrcode');

// draw a QR (black on white, 6 px modules, 4-module quiet zone) at (ox, oy) on a grey "slide" of w × h, as BGRA
function screen(text, w = 1280, h = 720, ox = 900, oy = 380) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' }); const n = qr.modules.size; const px = 6; const q = 4;
  const buf = Buffer.alloc(w * h * 4, 0);
  for (let i = 0; i < w * h; i++) { buf[i * 4] = 0x40; buf[i * 4 + 1] = 0x38; buf[i * 4 + 2] = 0x30; buf[i * 4 + 3] = 255; } // dark slide
  const box = (n + 2 * q) * px;
  for (let y = 0; y < box; y++) for (let x = 0; x < box; x++) {
    const mx = Math.floor(x / px) - q; const my = Math.floor(y / px) - q;
    const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(my, mx);
    const o = ((oy + y) * w + (ox + x)) * 4; const v = dark ? 0 : 255;
    buf[o] = v; buf[o + 1] = v; buf[o + 2] = v; buf[o + 3] = 255;
  }
  return { bitmap: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), width: w, height: h };
}
function decode(img) {
  const w = new Worker(path.join(__dirname, '../src/qr-worker.js'));
  return new Promise((resolve, reject) => {
    w.once('message', (m) => { w.terminate(); resolve(m.text); });
    w.once('error', reject);
    w.postMessage({ id: 1, ...img });
  });
}

test('qr worker: finds an attendance link on a shared slide', async () => {
  const url = 'https://forms.office.com/r/Attend123?class=CSP1123';
  assert.equal(await decode(screen(url)), url);
});
test('qr worker: null when the screen has no QR', async () => {
  const blank = Buffer.alloc(640 * 360 * 4, 200);
  assert.equal(await decode({ bitmap: blank.buffer.slice(0), width: 640, height: 360 }), null);
});
