'use strict';
// Launches the real desktop app on a throwaway profile and hands back its main window, for the end-to-end tests
// (npm run e2e). Nothing touches your own ~/.config/WakeUp: every launch gets a fresh temp profile unless one is passed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');

async function launch({ profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wakeup-e2e-')), width = 1400, height = 900 } = {}) {
  const app = await _electron.launch({
    executablePath: require('electron'), args: [ROOT],
    colorScheme: 'no-override', // let the app's own theme setting decide (Playwright pins light by default)
    env: { ...process.env, WAKEUP_PROFILE: profile, WAKEUP_E2E: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof hub === 'object' && document.querySelector('#home'));
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(w, h); win.show(); }, [width, height]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { app, page, profile, errors, close: () => app.close().catch(() => {}) };
}

// the settings main keeps, read the way the app reads them
const settings = (page) => page.evaluate(() => hub.init().then((s) => s.settings));
const planner = (page) => page.evaluate(() => hub.planner());

module.exports = { launch, settings, planner, ROOT };
