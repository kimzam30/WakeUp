'use strict';
// Settings, end to end: every section opens, every switch, choice and list saves, survives a restart, and the
// Privacy & Legal page and the app form behave. Runs the real app on a throwaway profile (see harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, settings } = require('./harness');

const SWITCHES = ['startHidden', 'labels', 'compact', 'sleepWhenHidden', 'askDownload', 'openDownload', 'notifyDownload', 'screenshotCopy', 'outlookOne']; // autoUpdate shows only in installed builds
const SECTIONS = ['general', 'apps', 'timetable', 'performance', 'downloads', 'links', 'appearance', 'privacy', 'about'];

// what a switch stands for in the saved settings ("one Outlook" is the Calendar app being hidden)
const value = (s, k) => (k === 'outlookOne' ? s.hidden.includes('calendar') : !!s[k]);

async function openSection(page, tab) {
  if (!(await page.isVisible('#settings .set-nav'))) await page.click('#sidebar button[aria-label="Settings"]');
  await page.click(`#settings [data-tab="${tab}"]`);
}
async function findSwitch(page, k) { // switches live in different sections; find the one that has it
  for (const tab of SECTIONS) {
    await openSection(page, tab);
    if (await page.locator(`#settings .switch[data-k="${k}"]`).count()) return page.locator(`#settings .switch[data-k="${k}"]`);
  }
  return null;
}

test('settings: every section opens without errors and has content', async () => {
  const w = await launch();
  try {
    for (const tab of SECTIONS) {
      await openSection(w.page, tab);
      const n = await w.page.locator('#settings .set-content .set-group').count();
      assert.ok(n > 0, `${tab} is empty`);
    }
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('settings: each switch flips, saves, and is still flipped after a restart', async () => {
  let w = await launch();
  const flipped = {};
  try {
    const before = await settings(w.page);
    for (const k of SWITCHES) {
      const sw = await findSwitch(w.page, k);
      assert.ok(sw, `no switch for ${k}`);
      if (await sw.isDisabled()) continue; // e.g. app names while the sidebar is icons-only
      const was = (await sw.getAttribute('aria-checked')) === 'true';
      await sw.click();
      await w.page.waitForFunction(([key, v]) => document.querySelector(`#settings .switch[data-k="${key}"]`)?.getAttribute('aria-checked') === String(v), [k, !was]);
      flipped[k] = !was;
    }
    const after = await settings(w.page);
    for (const [k, v] of Object.entries(flipped)) assert.equal(value(after, k), v, `${k} didn't save (was ${value(before, k)})`);
  } finally { await w.close(); }
  w = await launch({ profile: w.profile });
  try {
    const again = await settings(w.page);
    for (const [k, v] of Object.entries(flipped)) assert.equal(value(again, k), v, `${k} was lost on restart`);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('settings: the choices (theme, accent, zoom, links, closing) apply and save', async () => {
  const w = await launch();
  try {
    await openSection(w.page, 'appearance');
    await w.page.click('#settings [data-k="theme"][data-v="dark"]');
    await w.page.waitForFunction(() => matchMedia('(prefers-color-scheme: dark)').matches); // main sets nativeTheme
    for (const id of ['green', 'red', 'blue']) {
      await w.page.click(`#settings .swatch[data-v="${id}"]`);
      await w.page.waitForFunction((v) => document.querySelector(`#settings .swatch[data-v="${v}"]`)?.getAttribute('aria-checked') === 'true', id);
    }
    await w.page.selectOption('#settings select[data-k="zoom"]', '110');
    await openSection(w.page, 'general');
    await w.page.click('#settings [data-k="onClose"][data-v="minimize"]');
    await openSection(w.page, 'links');
    await w.page.selectOption('#settings select[data-k="docLinks"]', 'window');
    const s = await settings(w.page);
    assert.equal(s.theme, 'dark'); assert.equal(s.accent, 'blue'); assert.equal(s.zoom, 110); assert.equal(s.onClose, 'minimize'); assert.equal(s.docLinks, 'window');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('settings: the Today layout can be reordered, hidden and reset', async () => {
  const w = await launch();
  try {
    await openSection(w.page, 'appearance');
    const order = () => w.page.$$eval('#settings [data-today] .today-row', (rows) => rows.map((r) => r.dataset.id));
    const first = await order();
    await w.page.click(`#settings [data-today] .today-row[data-id="${first[1]}"] [data-act="today-up"]`);
    assert.equal((await order())[0], first[1]);
    await w.page.click(`#settings [data-today] .switch[data-k="today:${first[2]}"]`);
    assert.ok((await settings(w.page)).today.hidden.includes(first[2]));
    await w.page.click('#settings [data-act="today-reset"]');
    assert.deepEqual(await order(), first);
    assert.deepEqual((await settings(w.page)).today.hidden, []);
  } finally { await w.close(); }
});

test('settings: nickname saves and greets you on Today', async () => {
  const w = await launch();
  try {
    await openSection(w.page, 'general');
    await w.page.fill('#settings input[name="nickname"]', 'Tester');
    await w.page.click('#settings form.nick-set button[type="submit"]');
    await w.page.waitForFunction(() => hub.init().then((s) => s.settings.nickname === 'Tester'));
    await w.page.click('#settings [data-act="close"]');
    await w.page.click('#sidebar button[aria-label="Today"]');
    assert.match(await w.page.textContent('#home'), /Tester/);
  } finally { await w.close(); }
});

test('settings: your own app: bad addresses are refused, a good one is added, edited, and removed', async () => {
  const w = await launch();
  try {
    await openSection(w.page, 'apps');
    await w.page.click('#settings [data-act="add"]');
    const form = '#settings .app-form';
    await w.page.fill(`${form} [name="name"]`, 'Test site');
    await w.page.fill(`${form} [name="url"]`, 'http://insecure.example');
    await w.page.click(`${form} button[type="submit"]`);
    assert.match(await w.page.textContent(form), /https|secure/i, 'an http address must be refused');
    await w.page.fill(`${form} [name="url"]`, 'not a url at all');
    await w.page.click(`${form} button[type="submit"]`);
    assert.ok(await w.page.isVisible(form), 'a nonsense address must be refused');
    await w.page.fill(`${form} [name="url"]`, 'https://example.com');
    await w.page.click(`${form} .switch[data-k="form-ext"]`);
    await w.page.click(`${form} button[type="submit"]`);
    await w.page.waitForFunction(() => hub.init().then((s) => s.settings.customApps.some((a) => a.url.startsWith('https://example.com'))));
    const app = (await settings(w.page)).customApps.find((a) => a.url.startsWith('https://example.com'));
    assert.equal(app.external, true, '"Open in my browser" saved');
    assert.ok(await w.page.isVisible(`#sidebar button[aria-label="${app.name}"]`), 'it shows in the sidebar');
    // edit: rename
    await w.page.click(`#settings .app-row[data-id="${app.id}"] [data-act="edit"]`);
    await w.page.fill(`${form} [name="name"]`, 'Renamed site');
    await w.page.click(`${form} button[type="submit"]`);
    await w.page.waitForFunction((id) => hub.init().then((s) => s.settings.customApps.find((a) => a.id === id)?.name === 'Renamed site'), app.id);
    // remove: asks first, Cancel keeps it, Remove removes it
    await w.page.click(`#settings .app-row[data-id="${app.id}"] [data-act="remove"]`);
    await w.page.click('#settings [data-act="remove-no"]');
    assert.ok((await settings(w.page)).customApps.some((a) => a.id === app.id));
    await w.page.click(`#settings .app-row[data-id="${app.id}"] [data-act="remove"]`);
    await w.page.click('#settings [data-act="remove-yes"]');
    await w.page.waitForFunction((id) => hub.init().then((s) => !s.settings.customApps.some((a) => a.id === id)), app.id);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('settings: an AI preset adds itself, and a second one gets its own name', async () => {
  const w = await launch();
  try {
    await openSection(w.page, 'apps');
    for (let i = 0; i < 2; i++) {
      await w.page.click('#settings [data-act="add-ai"][data-name="Claude"]');
      await w.page.click('#settings .app-form button[type="submit"]');
      await w.page.waitForFunction((n) => hub.init().then((s) => s.settings.customApps.filter((a) => a.url === 'https://claude.ai/').length === n), i + 1);
    }
    const names = (await settings(w.page)).customApps.filter((a) => a.url === 'https://claude.ai/').map((a) => a.name);
    assert.equal(new Set(names).size, 2, `names must differ: ${names}`);
  } finally { await w.close(); }
});

test('settings: Privacy & Legal shows the policy and the legal links, and the cloud buttons need a sign-in', async () => {
  const w = await launch();
  try {
    await openSection(w.page, 'privacy');
    const text = await w.page.textContent('#settings .set-content');
    assert.match(text, /Privacy policy/); assert.match(text, /All rights reserved/); assert.match(text, /not affiliated/);
    assert.equal(await w.page.locator('#settings .legal-text li').count() >= 8, true);
    assert.match(await w.page.textContent('#settings [data-cloud-card]'), /not signed in/i);
    for (const a of ['legal-licence', 'legal-notices', 'legal-contact']) assert.ok(await w.page.isVisible(`#settings [data-act="${a}"]`));
  } finally { await w.close(); }
});
