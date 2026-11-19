'use strict';
// Saved sign-in (v3, A5) on the desktop. Microsoft's sign-in page is replaced by a local fake (this test profile's
// Microsoft partition answers every https request itself), so the made-up test account never leaves this computer.
// Checks: the password is stored encrypted (not readable in the file), WakeUp's page only gets the email back,
// it's typed on the sign-in page, and never on another site.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./harness');

const EMAIL = 'tester@student.example.edu'; const PASS = 'not-a-real-password-42';
const FAKE = '<!doctype html><title>Sign in</title><form><input name="loginfmt" type="email"><input name="passwd" type="password"><button>Sign in</button></form>';

test('saved sign-in: encrypted at rest, typed only on the Microsoft sign-in page', async (t) => {
  const w = await launch({ width: 1280, height: 800 });
  try {
    const { page: p, app } = w;
    const list = await p.evaluate(() => hub.signIns('list'));
    if (!list.strong) { t.skip('no secure keyring on this machine: WakeUp refuses to save (checked below)'); 
      await assert.rejects(p.evaluate((a) => hub.signIns('save', a), { id: 'microsoft', email: EMAIL, password: PASS }), /keyring/);
      return; }
    // a web page can't reach it: only WakeUp's own windows can
    await p.evaluate(() => toggleSettings(true)); await p.click('#settings [data-tab="apps"]');
    await p.fill('#settings .signin-form [name="email"]', EMAIL);
    await p.fill('#settings .signin-form [name="password"]', PASS);
    await p.click('#settings .signin-form button[type="submit"]');
    await p.waitForSelector('#settings [data-act="signin-forget"]');
    const after = await p.evaluate(() => hub.signIns('list'));
    assert.deepEqual(after.accounts, [{ id: 'microsoft', email: EMAIL }], 'the page gets the email, never the password');
    const raw = fs.readFileSync(path.join(w.profile, 'signins.bin'));
    assert.ok(!raw.includes(Buffer.from(PASS)) && !raw.includes(Buffer.from(EMAIL)), 'nothing readable in the file');

    // serve the fake sign-in page for every https request in the Microsoft partition, then send Outlook's pane there
    await app.evaluate(({ session }, html) => {
      session.fromPartition('persist:m365').protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html' } }));
    }, FAKE);
    await p.click('#sidebar button[aria-label="Outlook"]');
    const val = async (url) => app.evaluate(async (_e, u) => {
      let pane; for (let i = 0; i < 50 && !(pane = global.wakeupDebug.panes.get('mail'))?.view; i++) await new Promise((r) => setTimeout(r, 100));
      const wc = pane.view.webContents;
      await wc.loadURL(u);
      // poll: on a busy machine the fill can take a moment; a page that's never filled stays empty for the full 6 s
      const read = () => wc.executeJavaScript('[document.querySelector("[name=loginfmt]").value, document.querySelector("[name=passwd]").value]');
      let v = await read(); for (let i = 0; i < 30 && !(v[0] && v[1]); i++) { await new Promise((r) => setTimeout(r, 200)); v = await read(); }
      return v;
    }, url);
    assert.deepEqual(await val('https://outlook.office.com/mail/'), ['', ''], 'not typed on another site');
    assert.deepEqual(await val('https://login.microsoftonline.com/common/oauth2/v2.0/authorize'), [EMAIL, PASS], 'typed on the sign-in page');

    await p.click('#settings [data-act="signin-forget"]').catch(async () => { await p.evaluate(() => toggleSettings(true)); await p.click('#settings [data-tab="apps"]'); await p.click('#settings [data-act="signin-forget"]'); });
    await p.waitForFunction(() => hub.signIns('list').then((r) => !r.accounts.length));
    assert.ok(!fs.existsSync(path.join(w.profile, 'signins.bin')), 'forgetting removes the file');
  } finally { await w.close(); }
});
