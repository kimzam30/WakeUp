'use strict';
// Focus mode on the desktop (v3): the Focus panel's lengths change the next session, a finished session is logged by
// class, and the week's stats count it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('./harness');

test('focus: 50/10 starts a 50-minute session; custom steps; a finished session shows in this week', async () => {
  const w = await launch({ width: 1280, height: 800 });
  try {
    const p = w.page;
    await p.click('#sidebar button[aria-label="Tasks"]');
    await p.click('.focus-box [data-focus="panel"]');
    await p.click('.focus-panel [data-preset="50 / 10"]');
    assert.deepEqual(await p.evaluate(() => Focus.lengths()), { focus: 50, short: 10, long: 30 });
    await p.click('.focus-panel [data-focus="start"]');
    const mins = await p.evaluate(() => Math.round((Focus.state().endsAt - Date.now()) / 60e3));
    assert.equal(mins, 50, 'the session uses the chosen length');
    await p.click('.focus-panel [data-focus="stop"]');
    await p.click('.focus-panel [data-preset="Custom"]');
    await p.click('.focus-panel [data-len="focus"][data-by="5"]');
    assert.equal((await p.evaluate(() => Focus.lengths())).focus, 45, 'custom starts at 40 and steps by 5');
    // finish a session: start, then move the clock past its end
    await p.click('.focus-panel [data-focus="start"]');
    await p.evaluate(() => { const s = Focus.state(); localStorage.setItem('wakeup.focus', JSON.stringify({ ...s, endsAt: Date.now() - 1000 })); });
    await p.reload(); await p.waitForFunction(() => typeof Focus === 'object');
    const wk = await p.evaluate(() => Focus.week());
    assert.equal(wk.sessions, 1, 'the finished session is logged');
    assert.equal(wk.mins, 45);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});
