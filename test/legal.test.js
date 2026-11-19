'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Legal = require('../src/ui/legal.js');

const ROOT = path.join(__dirname, '..');

test('PRIVACY.md matches what the apps show', () => {
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8'), Legal.markdown(), 'run: node scripts/legal.js');
});

test('the policy names every synced setting it stores', () => {
  const text = JSON.stringify(Legal.PRIVACY).toLowerCase();
  const words = { theme: 'theme', weekStart: 'week start', nickname: 'nickname', reminders: 'reminder', classLabel: 'class label',
    customApps: 'apps you added', taskReminder: 'reminder', accent: 'accent', today: 'today layout' };
  const { SYNCED_SETTINGS } = require('../src/shared/sync-core.js');
  for (const k of SYNCED_SETTINGS) assert.ok(words[k] && text.includes(words[k]), `privacy policy doesn't mention the synced setting "${k}"`);
});

test('LICENSE carries the same owner and disclaimer', () => {
  const lic = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(lic.includes(`Copyright (c) 2026 ${Legal.OWNER}. All rights reserved.`));
  assert.ok(lic.includes('not affiliated with'));
});
