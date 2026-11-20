'use strict';
// The focus timer in the tray (v3, A3): the menu shows the time left with Pause/Resume and Stop, the icon gets a
// progress ring, and the menu's buttons drive the same timer as the window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { launch } = require('./harness');

const tray = (app) => app.evaluate(() => global.wakeupDebug.trayFocus());
const click = (app, label) => app.evaluate((_e, l) => global.wakeupDebug.trayClick(l), label);
const until = async (fn, ok) => { for (let i = 0; i < 40; i++) { const v = await fn(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 100)); } return fn(); };

test('tray: focus time left, Pause/Resume and Stop from the tray menu', async () => {
  const w = await launch({ width: 1280, height: 800 });
  try {
    const { app, page: p } = w;
    assert.deepEqual((await tray(app)).menu, ['Start focus'], 'idle: the tray offers to start');
    await click(app, 'Start focus');
    let t = await until(() => tray(app), (v) => v.menu[0] !== 'Start focus');
    assert.match(t.menu[0], /^Focus · 25 min left · until /);
    assert.deepEqual(t.menu.slice(-2), ['Pause', 'Stop focus']);
    assert.equal(await p.evaluate(() => Focus.state().phase), 'focus', 'the tray started the window’s timer');
    if (process.env.TRAY_ICON_OUT) fs.writeFileSync(process.env.TRAY_ICON_OUT, Buffer.from(t.icon, 'base64'));

    await click(app, 'Pause');
    t = await until(() => tray(app), (v) => v.menu.includes('Resume'));
    assert.match(t.menu[0], /paused$/);
    assert.equal(await p.evaluate(() => FocusCore.paused(Focus.state())), true);

    await click(app, 'Resume');
    t = await until(() => tray(app), (v) => v.menu.includes('Pause'));
    await click(app, 'Stop focus');
    t = await until(() => tray(app), (v) => v.menu[0] === 'Start focus');
    assert.equal(await p.evaluate(() => Focus.state().phase), 'idle');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});
