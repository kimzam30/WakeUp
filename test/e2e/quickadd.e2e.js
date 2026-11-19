'use strict';
// Plain-language quick add on the desktop (v3, A2): the line under the box says what it understood, and the words win
// over the chips (a date in the text, an exam word, a time and a room on exams).
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('./harness');

test('quick add: "essay in 3 days" and "quiz tmr 2pm @CQAR1009"', async () => {
  const w = await launch({ width: 1280, height: 800 });
  try {
    const p = w.page;
    await p.click('#sidebar button[aria-label="Tasks"]');
    const box = '.task-add [name="text"]';
    await p.fill(box, 'essay in 3 days');
    const hint = await p.textContent('.qa-hint');
    assert.match(hint, /^Will add: /, 'the hint shows while typing');
    await p.press(box, 'Enter');
    const t = await p.evaluate(() => PL.tasks.find((x) => x.text === 'essay'));
    assert.ok(t, 'the date words are taken out of the title');
    assert.equal(t.due, await p.evaluate(() => Planner.addDays(Planner.today(), 3)));
    assert.equal(await p.isHidden('.qa-hint'), true, 'the hint clears after adding');

    await p.fill(box, 'quiz tmr 2pm @CQAR1009');
    await p.press(box, 'Enter');
    const q = await p.evaluate(() => PL.tasks.find((x) => x.text === 'quiz'));
    assert.ok(q && q.exam, 'an exam word makes an exam');
    assert.deepEqual([q.at, q.venue, q.due], ['14:00', 'CQAR1009', await p.evaluate(() => Planner.addDays(Planner.today(), 1))]);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});
