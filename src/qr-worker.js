'use strict';
// Reads a QR code from a screenshot of a meeting pane (attendance QR, v3 A6), off the main thread so the window
// never stalls. Input: a raw BGRA bitmap (Electron's NativeImage.toBitmap) with its size. Output: the code's text, or null.
const { parentPort } = require('node:worker_threads');
const jsQR = require('jsqr');

parentPort.on('message', ({ id, bitmap, width, height }) => {
  try {
    const src = new Uint8Array(bitmap); const rgba = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) { rgba[i] = src[i + 2]; rgba[i + 1] = src[i + 1]; rgba[i + 2] = src[i]; rgba[i + 3] = 255; }
    const r = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
    parentPort.postMessage({ id, text: r ? r.data : null });
  } catch (e) { parentPort.postMessage({ id, text: null, error: e.message }); }
});
