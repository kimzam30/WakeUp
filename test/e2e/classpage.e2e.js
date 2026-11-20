'use strict';
// The class page on the desktop (v3, I5, option A): the class editor keeps an Ebwise course link and notes, the date's
// panel opens the class page, and the page shows the next meeting, the notes, the weekly sessions and its tasks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, planner } = require('./harness');

const DLG = '[role=dialog]';
const PANE = '.pane[aria-label="Timetable"]';
const todayDow = String(new Date().getDay());

test('class page: course link and notes saved, opened from a class meeting', async () => {
  const w = await launch({ width: 1280, height: 800 });
  try {
    const p = w.page;
    await p.click('#sidebar button[aria-label="Timetable"]');
    await p.waitForSelector(`${PANE}:not([hidden])`);
    await p.click(`${PANE} [data-act=add-class] >> nth=0`);
    await p.fill(`${DLG} [data-f=code]`, 'CSP1123'); await p.fill(`${DLG} [data-f=name]`, 'Mini IT Project');
    await p.fill(`${DLG} [data-f=course]`, 'http://ebwise.mmu.edu.my/course/view.php?id=1');
    await p.selectOption(`${DLG} [data-f="s.0.day"]`, todayDow);
    await p.fill(`${DLG} [data-f="s.0.start"]`, '23:00'); await p.fill(`${DLG} [data-f="s.0.end"]`, '23:50');
    await p.fill(`${DLG} [data-f=notes]`, 'Group: Aina, Wei Jie\nDemo in week 12');
    await p.click(`${DLG} button[type=submit]`);
    assert.match(await p.textContent(`${DLG} .form-error`), /https/, 'an http link is refused');
    await p.fill(`${DLG} [data-f=course]`, 'https://ebwise.mmu.edu.my/course/view.php?id=1');
    await p.click(`${DLG} button[type=submit]`);
    await p.waitForFunction(() => hub.planner().then((x) => x.classes.some((c) => c.code === 'CSP1123')));
    const c = (await planner(p)).classes[0];
    assert.equal(c.course, 'https://ebwise.mmu.edu.my/course/view.php?id=1');
    assert.equal(c.notes, 'Group: Aina, Wei Jie\nDemo in week 12', 'notes keep their line break');
    while (await p.isVisible(DLG)) await p.click(`${DLG} [data-act=close] >> nth=0`); // the first class asks for semester dates

    await p.click(`${PANE} button:has-text("CSP1123")`);
    await p.click(`${DLG} [data-act=class-page]`);
    await p.waitForSelector(`${DLG}.hub`);
    const text = await p.textContent(`${DLG}.hub`);
    assert.match(text, /Next · Today/);
    assert.match(text, /11pm – 11:50pm/);
    assert.match(text, /Open in Ebwise/);
    assert.match(text, /Demo in week 12/);
    assert.match(text, /Every week/);
    await p.fill(`${DLG} .ot-add`, 'Lab report 3');
    await p.press(`${DLG} .ot-add`, 'Enter');
    await p.waitForFunction(() => hub.planner().then((x) => x.tasks.some((t) => t.text === 'Lab report 3' && t.classId)));
    assert.match(await p.textContent(`${DLG}.hub`), /Lab report 3/, 'the new task shows on the class page');
    await p.click(`${DLG} [data-act=focus-class]`);
    assert.equal(await p.evaluate(() => Focus.state().classId), c.id, 'focus is on this class');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});
