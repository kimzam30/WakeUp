'use strict';
// The window itself: panes, split and tiled layouts, pop-outs, search, screenshots, downloads, the sidebar, small
// windows, a restart, and the safety rules for WakeUp's own pages. Throwaway profile; nothing opens your browser
// (shell.openExternal is replaced by a recorder) and screenshots go to a temp folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch } = require('./harness');

const PANE = (name) => `.pane[aria-label="${name}"]`;
const layout = (page) => page.evaluate(() => JSON.parse(JSON.stringify({ tile: L.tile, popped: L.popped, alive: L.alive, focused: L.focused })));
const panesIn = (t) => (!t ? [] : t.pane ? [t.pane] : (t.kids || t.children || []).flatMap(panesIn));
async function stubBrowser(app) { await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; }); }
const opened = (app) => app.evaluate(() => global.__opened);

test('panes: open, split with another app, change the layout, close', async () => {
  const w = await launch();
  try {
    await w.page.click('#sidebar button[aria-label="Timetable"]');
    await w.page.click(`${PANE('Timetable')} button[aria-label="Split with another app"]`);
    await w.page.click('[data-pick="tasks"]');
    await w.page.waitForFunction(() => document.querySelectorAll('.pane:not([hidden])').length === 2);
    assert.deepEqual(panesIn((await layout(w.page)).tile).sort(), ['tasks', 'timetable']);
    await w.page.click('#sidebar button[aria-label="Layouts"]');
    await w.page.click('button:has-text("Stacked")');
    await w.page.click('#sidebar button[aria-label="Layouts"]');
    await w.page.click('button:has-text("Single")');
    await w.page.waitForFunction(() => document.querySelectorAll('.pane:not([hidden])').length === 1);
    await w.page.click('#sidebar button[aria-label="Layouts"]');
    await w.page.click('[data-m="free"]');
    await w.page.click('#sidebar button[aria-label="Layouts"]');
    await w.page.click('[data-m="tile"]');
    const open = await w.page.$$eval('.pane:not([hidden])', (els) => els.map((e) => e.getAttribute('aria-label')));
    for (const name of open) await w.page.click(`${PANE(name)} button[aria-label="Close"]`);
    await w.page.waitForFunction(() => !document.querySelector('.pane:not([hidden])'));
    assert.ok(await w.page.isVisible('#home'), 'back on Today when everything is closed');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('panes: pop out into a window and back', async () => {
  const w = await launch();
  try {
    await w.page.click('#sidebar button[aria-label="Tasks"]');
    const before = w.app.windows().length;
    await w.page.click(`${PANE('Tasks')} button[aria-label="Pop out into its own window"]`);
    const pop = await w.app.waitForEvent('window');
    await pop.waitForLoadState();
    assert.match(pop.url(), /pop\.html/);
    assert.equal(w.app.windows().length, before + 1);
    assert.ok((await layout(w.page)).popped.includes('tasks'));
    // closing the window (as you would; Playwright's page.close() skips the window's own close) brings it back in
    await w.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('pop.html')).close());
    await w.page.waitForFunction(() => !L.popped.includes('tasks'));
    assert.deepEqual(panesIn((await layout(w.page)).tile), ['tasks'], 'Tasks is back in the main window');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('search (the switcher) finds an app and opens it; Escape closes it', async () => {
  const w = await launch();
  try {
    await w.page.click('#sidebar button[aria-label="Search"]');
    await w.page.fill('#overlay input[aria-label="Search"]', 'tasks');
    await w.page.press('#overlay input[aria-label="Search"]', 'Enter');
    await w.page.waitForSelector(`${PANE('Tasks')}:not([hidden])`);
    await w.page.click('#sidebar button[aria-label="Search"]');
    await w.page.keyboard.press('Escape');
    assert.equal(await w.page.isVisible('#overlay input[aria-label="Search"]'), false);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('screenshot of one app is saved to the chosen folder', async () => {
  const w = await launch();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wakeup-e2e-shots-'));
  try {
    await w.page.evaluate((d) => hub.setSettings({ screenshotDir: d, screenshotCopy: false }), dir);
    await w.page.click('#sidebar button[aria-label="Timetable"]');
    await w.page.click('#sidebar button[aria-label="Screenshot"]');
    await w.page.click('[data-pick="app"]');
    const deadline = Date.now() + 15000;
    while (!fs.readdirSync(dir).some((f) => f.endsWith('.png')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300));
    const png = fs.readdirSync(dir).find((f) => f.endsWith('.png'));
    assert.ok(png, 'a PNG was saved');
    assert.ok(fs.statSync(path.join(dir, png)).size > 1000);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('downloads panel, sidebar collapse and a small window all work', async () => {
  const w = await launch();
  try {
    await w.page.click('#sidebar button[aria-label="Downloads"]');
    assert.ok(await w.page.isVisible('#downloads'));
    await w.page.keyboard.press('Escape');
    await w.page.click('#sidebar button[aria-label="Collapse the sidebar"]');
    await w.page.waitForFunction(() => hub.init().then((s) => s.settings.compact === true));
    await w.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 700));
    await w.page.waitForTimeout(400);
    const overflow = await w.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, `no sideways scrolling at 640px (overflow ${overflow}px)`);
    await w.page.click('#sidebar button[aria-label="Today"]');
    assert.ok(await w.page.isVisible('#home'));
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('the layout and open apps come back after a restart', async () => {
  let w = await launch();
  try {
    await w.page.click('#sidebar button[aria-label="Timetable"]');
    await w.page.click(`${PANE('Timetable')} button[aria-label="Split with another app"]`);
    await w.page.click('[data-pick="tasks"]');
    await w.page.waitForFunction(() => document.querySelectorAll('.pane:not([hidden])').length === 2);
  } finally { await w.close(); }
  w = await launch({ profile: w.profile });
  try {
    await w.page.waitForFunction(() => document.querySelectorAll('.pane:not([hidden])').length === 2, null, { timeout: 10000 });
    assert.deepEqual(panesIn((await layout(w.page)).tile).sort(), ['tasks', 'timetable']);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('safety: WakeUp\'s own window can\'t be turned into a website, and opens no popups', async () => {
  const w = await launch();
  try {
    await stubBrowser(w.app);
    await w.page.evaluate(() => { location.href = 'https://example.com/'; });
    await w.page.waitForTimeout(1500);
    assert.match(w.page.url(), /ui\/index\.html/, 'still WakeUp');
    assert.equal(await w.page.evaluate(() => typeof hub), 'object');
    assert.equal(await w.page.evaluate(() => window.open('https://example.org/')), null, 'popup refused');
    await w.page.waitForTimeout(500);
    assert.deepEqual(await opened(w.app), ['https://example.com/', 'https://example.org/'], 'both went to the browser instead');
    assert.equal(w.app.windows().length, 1);
  } finally { await w.close(); }
});

test('safety: no stray autostart or launcher is written by a test or dev run', async () => {
  const w = await launch();
  const auto = path.join(os.homedir(), '.config', 'autostart', 'wakeup.desktop');
  const had = fs.existsSync(auto) ? fs.readFileSync(auto, 'utf8') : null;
  try {
    await w.page.evaluate(() => hub.setSettings({ autostart: true }));
    await w.page.waitForTimeout(300);
    assert.equal(fs.existsSync(auto) ? fs.readFileSync(auto, 'utf8') : null, had, 'your real autostart entry is untouched');
  } finally { await w.close(); }
});

test('tabs inside a web app: new tab, switch, close, and they come back after a restart', async () => {
  let w = await launch();
  let id;
  try {
    await w.page.evaluate(() => hub.init().then((s) => hub.setSettings({ customApps: [...s.settings.customApps, { id: 'c-example', name: 'Example', url: 'https://example.com/', color: '#5e6ad2', own: true }] })));
    await w.page.click('#sidebar button[aria-label="Example"]');
    id = 'c-example';
    await w.page.waitForSelector(`${PANE('Example')}:not([hidden])`);
    await w.page.click(`${PANE('Example')} button[aria-label="New tab"]`);
    await w.page.waitForFunction(() => document.querySelectorAll('.pane[aria-label="Example"] .tabstrip .tab').length === 2);
    await w.page.click(`${PANE('Example')} .tab-new`);
    await w.page.waitForFunction(() => document.querySelectorAll('.pane[aria-label="Example"] .tabstrip .tab').length === 3);
    await w.page.click(`${PANE('Example')} .tab-b[data-i="0"]`);
    await w.page.waitForFunction(() => document.querySelector('.pane[aria-label="Example"] .tab-b[data-i="0"]')?.getAttribute('aria-selected') === 'true');
    await w.page.click(`${PANE('Example')} .tab-x[data-x="2"]`);
    await w.page.waitForFunction(() => document.querySelectorAll('.pane[aria-label="Example"] .tabstrip .tab').length === 2);
    assert.equal((await w.page.evaluate((x) => hub.tabs().then((t) => t[x] || t), id)) !== null, true);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
  w = await launch({ profile: w.profile });
  try {
    await w.page.waitForFunction(() => document.querySelectorAll('.pane[aria-label="Example"] .tabstrip .tab').length === 2, null, { timeout: 15000 });
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});
