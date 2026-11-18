'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Look = require('../src/ui/look-core.js');
const S = require('../src/shared/sync-core.js');

test('accent presets: every one has light and dark colours; unknown ids fall back to blue', () => {
  for (const [id] of Look.ACCENTS) for (const dark of [false, true]) {
    const a = Look.accent(id, dark);
    for (const v of Object.values(a)) assert.match(v, /^#[0-9a-f]{6}$/);
  }
  assert.deepStrictEqual(Look.accent('nope', false), Look.accent('blue', false));
});

test('Today layout: cleaned, moved, hidden, and filtered to what an app has', () => {
  assert.deepStrictEqual(Look.cleanToday(null), Look.todayDefault());
  const t = Look.cleanToday({ order: ['apps', 'apps', 'bogus', 'next'], hidden: ['recent', 'x'] });
  assert.deepStrictEqual(t.hidden, ['recent']);
  assert.strictEqual(new Set(t.order).size, Look.TODAY_IDS.length);
  assert.deepStrictEqual(t.order.slice(0, 1), ['apps']);
  const m = Look.moveToday(Look.todayDefault(), 'tasks', -1);
  assert.deepStrictEqual(m.order.slice(0, 3), ['next', 'tasks', 'classes']);
  assert.deepStrictEqual(Look.moveToday(m, 'next', -1), m); // already first
  const h = Look.showToday(m, 'apps', false);
  assert.deepStrictEqual(Look.todaySections(h, ['next', 'classes', 'tasks', 'apps', 'recent']), ['next', 'tasks', 'classes', 'recent']);
  assert.deepStrictEqual(Look.showToday(h, 'apps', true).hidden, []);
});

test('icon candidates: apple-touch-icon first, then the biggest PNG, then /favicon.ico; no SVG or http', () => {
  const html = `<head><link rel="icon" href="/a.svg" type="image/svg+xml"><link rel="shortcut icon" href="/f16.ico">
    <link rel="icon" sizes="32x32" href="/f32.png"><link rel='icon' sizes="192x192" href="https://cdn.example.com/f192.png">
    <link rel="apple-touch-icon" href="touch.png?v=2&amp;x=1"><link rel="icon" href="http://insecure.example.com/i.png"></head>`;
  assert.deepStrictEqual(Look.iconCandidates(html, 'https://www.notion.so/app/page'), [
    'https://www.notion.so/app/touch.png?v=2&x=1', 'https://cdn.example.com/f192.png', 'https://www.notion.so/f32.png',
    'https://www.notion.so/f16.ico', 'https://www.notion.so/favicon.ico',
  ]);
  assert.deepStrictEqual(Look.iconCandidates('', 'https://x.example.com/'), ['https://x.example.com/favicon.ico']);
  assert.deepStrictEqual(Look.iconCandidates('', 'not a url'), []);
  assert.ok(Look.isIcon('data:image/png;base64,AAAA'));
  assert.ok(!Look.isIcon('data:text/html;base64,AAAA'));
});

test('accent and the Today layout sync between devices', () => {
  assert.ok(S.SYNCED_SETTINGS.includes('accent') && S.SYNCED_SETTINGS.includes('today'));
  const patch = S.remoteSettingsPatch({ accent: 'blue' }, { accent: 'green', today: { order: ['apps'], hidden: [] } }, []);
  assert.deepStrictEqual(Object.keys(patch).sort(), ['accent', 'today']);
});
