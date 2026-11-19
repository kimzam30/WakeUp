#!/usr/bin/env node
'use strict';
// A read-only walk through the Android app on a connected device: every tab, every Settings section, the apps,
// the class and task screens. It taps by what's on screen (Android's accessibility tree), checks each screen shows
// what it should, screenshots it, and fails on any crash or JavaScript error in the log. It never adds, edits or
// deletes anything, so it's safe on a phone that's signed in and syncing.
//
//   node scripts/android-e2e.js <device serial> [screenshot folder]
//
// Needs adb (ANDROID_HOME/platform-tools or on PATH) and WakeUp installed on the device.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const [serial, outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wakeup-android-'))] = process.argv.slice(2);
if (!serial) { console.error('usage: node scripts/android-e2e.js <device serial> [screenshot folder]'); process.exit(2); }
const ADB = [process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb'), path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'), 'adb']
  .find((p) => p === 'adb' || fs.existsSync(p));
const PKG = 'my.kimzam.wakeup';
const adb = (...a) => execFileSync(ADB, ['-s', serial, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the screen as a list of nodes: text, description, bounds
function screen() {
  // the dump tool gives up while a web page is busy animating: try again a few times
  for (let i = 0; ; i++) {
    try { adb('shell', 'uiautomator', 'dump', '/sdcard/wakeup-ui.xml'); break; } catch (e) { if (i >= 4) throw e; execFileSync('sleep', ['1']); }
  }
  const xml = adb('exec-out', 'cat', '/sdcard/wakeup-ui.xml');
  const nodes = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#10;/g, '\n')]));
    if (a.package !== PKG) continue;
    const b = a.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); if (!b) continue;
    nodes.push({ text: a.text || '', desc: a['content-desc'] || '', x: (+b[1] + +b[3]) / 2, y: (+b[2] + +b[4]) / 2, w: +b[3] - +b[1], h: +b[4] - +b[2], click: a.clickable === 'true', selected: a.selected === 'true' });
  }
  return nodes;
}
const label = (n) => `${n.desc} ${n.text}`.trim();
const textOf = (nodes) => nodes.map(label).join('\n');
function find(nodes, re, within) { return nodes.filter((n) => n.w > 0 && n.h > 0 && (re.test(n.desc) || re.test(n.text)) && (!within || (n.x >= within[0] && n.x <= within[1]))).sort((a, b) => (b.click - a.click) || (a.w * a.h - b.w * b.h))[0]; }

// phones with a cover screen (Z Flip) have two displays: screencap then needs the main one's id
let display;
function shot() {
  if (display === undefined) display = (adb('shell', 'dumpsys', 'SurfaceFlinger', '--display-id').match(/^Display (\d+)/m) || [])[1] || null;
  const png = execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p', ...(display ? ['-d', display] : [])], { maxBuffer: 64 << 20 });
  if (png.subarray(1, 4).toString() !== 'PNG' && display) { display = null; return shot(); } // single-display devices may refuse -d
  return png;
}

const results = [];
let step = 0;
async function check(name, fn) {
  step++;
  try { await fn(); results.push({ step, name, ok: true }); console.log(`ok ${step} - ${name}`); }
  catch (e) { results.push({ step, name, ok: false, error: e.message }); console.log(`not ok ${step} - ${name}\n  ${e.message}`); }
  try { fs.writeFileSync(path.join(outDir, `${String(step).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`), shot()); } catch { /* screenshot is a bonus */ }
}
// within: [x0, x1] limits the match to a column (on tablets "Timetable" is both a sidebar item and a Settings section)
async function tap(re, { scroll = true, within } = {}) {
  for (let i = 0; i < 6; i++) {
    const n = find(screen(), re, within);
    if (n) { adb('shell', 'input', 'tap', String(Math.round(n.x)), String(Math.round(n.y))); await sleep(900); return n; }
    if (!scroll) break;
    const { w, h } = size(); adb('shell', 'input', 'swipe', String(w / 2), String(h * 0.7), String(w / 2), String(h * 0.35), '250'); await sleep(500);
  }
  throw new Error(`nothing on screen matches ${re}`);
}
async function expect(re, { scroll = true, swipes = 6 } = {}) {
  for (let i = 0; i < swipes; i++) {
    if (re.test(textOf(screen()))) return;
    if (!scroll) break;
    const { w, h } = size(); adb('shell', 'input', 'swipe', String(w / 2), String(h * 0.7), String(w / 2), String(h * 0.35), '250'); await sleep(500);
  }
  throw new Error(`screen doesn't show ${re}`);
}
let dims = null;
function size() { if (!dims) { const m = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)\s*$/m); dims = { w: +m[1], h: +m[2] }; const rot = adb('shell', 'dumpsys', 'input').match(/SurfaceOrientation: (\d)/); if (rot && (+rot[1] % 2)) dims = { w: dims.h, h: dims.w }; } return dims; }
const back = async () => { adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(700); };
async function scrollTop() { const { w, h } = size(); for (let i = 0; i < 4; i++) adb('shell', 'input', 'swipe', String(w / 2), String(h * 0.3), String(w / 2), String(h * 0.85), '200'); await sleep(400); }

(async () => {
  console.log(`WakeUp on ${serial} (${adb('shell', 'getprop', 'ro.product.model').trim()}), screenshots in ${outDir}`);
  adb('logcat', '-c');
  adb('shell', 'am', 'force-stop', PKG);
  adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
  await sleep(4000);
  const wide = size().w >= 1200;

  await check('opens on Today', () => expect(/Today|Good (morning|afternoon|evening)|Coming up/i, { scroll: false }));
  await check('Timetable', async () => { await tap(/^Timetable$/); await expect(/Semester|Add class|week|Mon|Tue/i); });
  await check('Tasks', async () => { await tap(/^Tasks$/); await expect(/Add a task|Focus|No tasks|Today|Tomorrow/i); });
  await check('Apps', async () => { await tap(/^Apps$/); await expect(/Ebwise|Outlook|Teams/i); });
  await check('Settings', async () => { await tap(/^Settings$/); await expect(/Account and sync|Notifications/i); });
  for (const [section, shows] of [
    ['Account and sync', /Sync with Google|Signed in|Sync now|Up to date/i],
    ['Notifications', /reminder|Notifications/i],
    ['Timetable', /Weeks start on|Show classes as/i],
    ['Apps', /AI assistants|Add|Ebwise/i],
    ['Appearance and you', /Accent|Theme|nickname|Today page/i],
    ['Privacy & Legal', /Privacy policy|All rights reserved|Sign out everywhere|Not signed in/i],
    ['About', /WakeUp \d+\.\d+|Check for updates/i],
  ]) {
    await check(`Settings: ${section}`, async () => {
      if (wide) await tap(new RegExp(`^${section.replace(/[&]/g, '.')}$`), { scroll: false, within: [size().w * 0.2, size().w * 0.62] }); else await scrollTop();
      await expect(shows, { swipes: wide ? 6 : 20 }); // phones: one long page, About is at the very end
    });
  }
  await check('back to Today', async () => { await tap(/^Today$/); await expect(/Today|Coming up|Good/i); });
  await check('open Ebwise (it loads, the toolbar shows)', async () => {
    await tap(/^Apps$/); await tap(/^Ebwise$/); await sleep(5000);
    await expect(/Ebwise/i, { scroll: false });
  });
  if (wide) {
    await check('split view: two apps side by side', async () => {
      await tap(/^Split with another app$/, { scroll: false });
      await tap(/^Split with Outlook$/, { scroll: false }); // in the picker, not Outlook in the sidebar
      await sleep(3000);
      // both apps are on screen: each pane has its own strip with the app's name
      const top = screen().filter((n) => n.x > size().w * 0.2);
      const names = new Set(top.filter((n) => /^(Ebwise|Outlook)$/.test(label(n))).map(label));
      if (names.size < 2) throw new Error(`only ${[...names].join(', ') || 'no app'} on screen`);
      await tap(/^Close split$/, { scroll: false });
    });
  }
  await check('Android back leaves the app and returns home', async () => { await back(); await back(); await expect(/Today|Apps|Ebwise/i, { scroll: false }); });

  // the log: any crash or JavaScript error while we walked around
  await check('no crash or JavaScript error in the log', () => {
    // only WakeUp's own crashes (uiautomator, the tool reading the screen, crashes now and then by itself)
    const log = adb('logcat', '-d', '-v', 'brief', 'AndroidRuntime:E', 'ReactNativeJS:E', 'ReactNative:E', '*:S');
    const bad = log.split('\n').filter((l) => /Process: my\.kimzam\.wakeup|ReactNativeJS.*(Error|TypeError|undefined is not)/.test(l));
    if (bad.length) throw new Error(bad.slice(0, 6).join('\n  '));
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`# ${results.length - failed.length}/${results.length} passed. Screenshots: ${outDir}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
