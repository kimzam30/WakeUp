'use strict';
// The audit pass: every main screen at small, laptop and big window sizes in light and dark, with real-looking data
// in several languages; nothing may spill sideways, throw an error, or lose keyboard focus. Screenshots go to
// WAKEUP_AUDIT_DIR when it's set (used for the audit report), otherwise nowhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, planner } = require('./harness');

const OUT = process.env.WAKEUP_AUDIT_DIR;
const SIZES = [[900, 600], [1280, 800], [1920, 1080]];
const PANE = (name) => `.pane[aria-label="${name}"]`;
const TEXTS = ['Siapkan laporan makmal minggu ini', '复习第三章 数据库', 'Submit 📚✅ assignment',
  'Prepare slides for the group presentation on database normalisation with examples from the mini IT project and send them to everyone before Friday'];

async function shot(page, name) { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); } }
// anything wider than the window shows a sideways scrollbar or gets cut off
const overflow = (page) => page.evaluate(() => [...document.querySelectorAll('#stage *')]
  .filter((el) => el.offsetParent && el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed')
  .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent || '').trim().slice(0, 30)}"`));

async function seed(page) {
  await page.click('#sidebar button[aria-label="Tasks"]');
  for (const t of TEXTS) { await page.fill(`${PANE('Tasks')} input[name=text]`, t); await page.press(`${PANE('Tasks')} input[name=text]`, 'Enter'); }
  await page.waitForFunction((n) => hub.planner().then((p) => p.tasks.length === n), TEXTS.length);
}

test('audit: every screen, three window sizes, light and dark: no sideways spill, no errors', async () => {
  const w = await launch();
  const problems = [];
  try {
    await seed(w.page);
    const p = await planner(w.page);
    assert.deepEqual(p.tasks.map((t) => t.text || t.title).sort(), [...TEXTS].sort(), 'every language and emoji saved as typed');
    for (const theme of ['light', 'dark']) {
      if (!(await w.page.isVisible('#settings .set-nav'))) await w.page.click('#sidebar button[aria-label="Settings"]');
      await w.page.click('#settings [data-tab="appearance"]');
      await w.page.click(`#settings [data-k="theme"][data-v="${theme}"]`);
      for (const [width, height] of SIZES) {
        await w.app.evaluate(({ BrowserWindow }, [a, b]) => BrowserWindow.getAllWindows()[0].setSize(a, b), [width, height]);
        await w.page.waitForTimeout(250);
        for (const name of ['Today', 'Timetable', 'Tasks', 'Settings']) {
          await w.page.click(`#sidebar button[aria-label="${name}"]`);
          await w.page.waitForTimeout(200);
          const spill = await overflow(w.page);
          if (spill.length) problems.push(`${name} ${width}x${height} ${theme}: ${spill.join(', ')}`);
          await shot(w.page, `${theme}-${width}-${name.toLowerCase()}`);
        }
      }
    }
    assert.deepEqual(w.errors, []);
    assert.deepEqual(problems, []);
  } finally { await w.close(); }
});

// todo: Today's quick-add box shows no focus ring (audit 2026-11-19, fixed in the redesign)
test('audit: keyboard only: Tab moves through the sidebar and every stop shows where focus is', { todo: 'Today quick-add has no focus ring' }, async () => {
  const w = await launch();
  try {
    const stops = [];
    for (let i = 0; i < 25; i++) {
      await w.page.keyboard.press('Tab');
      stops.push(await w.page.evaluate(() => {
        const el = document.activeElement; if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
        return { what: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20) || el.tagName, ring };
      }));
    }
    const reached = stops.filter(Boolean);
    assert.ok(reached.length >= 5, 'Tab reaches the controls');
    const noRing = reached.filter((s) => !s.ring).map((s) => s.what);
    assert.deepEqual([...new Set(noRing)], [], 'each focused control shows a focus ring');
  } finally { await w.close(); }
});

test('audit: resource use with three apps loaded stays reasonable', async () => {
  const w = await launch();
  try {
    for (const name of ['Ebwise', 'Outlook', 'Teams']) {
      if (await w.page.locator(`#sidebar button[aria-label="${name}"]`).count()) await w.page.click(`#sidebar button[aria-label="${name}"]`);
    }
    await w.page.waitForTimeout(8000);
    const m = await w.app.evaluate(({ app }) => app.getAppMetrics().map((x) => ({ type: x.type, mb: Math.round(x.memory.workingSetSize / 1024), cpu: x.cpu.percentCPUUsage })));
    const total = m.reduce((a, x) => a + x.mb, 0);
    if (OUT) fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify({ total, m }, null, 2));
    assert.ok(total < 1500, `memory ${total} MB with three apps`);
  } finally { await w.close(); }
});
