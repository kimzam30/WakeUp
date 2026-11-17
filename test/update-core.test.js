'use strict';
// node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/shared/update-core.js');

const D = U.DOWNLOAD_PREFIX;
const release = (over = {}) => ({
  tag_name: 'v2.5.0', draft: false, prerelease: false, body: '## What\'s Changed\n- One-click updates\n**Full Changelog**: x',
  html_url: 'https://github.com/kimzam30/WakeUp/releases/tag/v2.5.0',
  assets: [
    { name: 'WakeUp-2.5.0-linux-x64.tar.gz', browser_download_url: `${D}v2.5.0/WakeUp-2.5.0-linux-x64.tar.gz`, size: 100 },
    { name: 'WakeUp-2.5.0.AppImage', browser_download_url: `${D}v2.5.0/WakeUp-2.5.0.AppImage`, size: 120 },
    { name: 'WakeUp-2.5.0.apk', browser_download_url: `${D}v2.5.0/WakeUp-2.5.0.apk`, size: 90 },
    { name: 'SHA256SUMS', browser_download_url: `${D}v2.5.0/SHA256SUMS`, size: 1 },
  ],
  ...over,
});

test('compare versions numerically', () => {
  assert.equal(U.isNewer('2.10.0', '2.9.9'), true);
  assert.equal(U.isNewer('v2.5.0', '2.5.0'), false);
  assert.equal(U.isNewer('2.5', '2.4.9'), true);
  assert.equal(U.isNewer('2.4.0', '2.5.0'), false);
  assert.equal(U.compare('2.5.0-beta.1', '2.5.0'), 0);
});

test('versionCode grows with the version', () => {
  assert.equal(U.versionCode('2.5.0'), 20500);
  assert.ok(U.versionCode('2.10.0') > U.versionCode('2.9.99'));
  assert.ok(U.versionCode('2.4.0') > 2); // the old hand-set code
});

test('parseSums reads sha256sum output', () => {
  const h = 'a'.repeat(64);
  assert.deepEqual(U.parseSums(`${h}  WakeUp-2.5.0.apk\n${'B'.repeat(64)} *SHA256SUMS\nnonsense`), { 'WakeUp-2.5.0.apk': h, SHA256SUMS: 'b'.repeat(64) });
});

test('pick finds each platform file and the checksums', () => {
  assert.equal(U.pick(release(), 'tarball').name, 'WakeUp-2.5.0-linux-x64.tar.gz');
  assert.equal(U.pick(release(), 'appimage').name, 'WakeUp-2.5.0.AppImage');
  const apk = U.pick(release(), 'apk');
  assert.equal(apk.version, '2.5.0');
  assert.equal(apk.sumsUrl, `${D}v2.5.0/SHA256SUMS`);
  assert.equal(apk.notes, '- One-click updates');
});

test('pick refuses drafts, pre-releases, missing checksums and files from elsewhere', () => {
  assert.equal(U.pick(release({ prerelease: true }), 'apk'), null);
  assert.equal(U.pick(release({ draft: true }), 'apk'), null);
  assert.equal(U.pick(release({ assets: release().assets.filter((a) => a.name !== 'SHA256SUMS') }), 'apk'), null);
  const evil = release({ assets: release().assets.map((a) => (a.name.endsWith('.apk') ? { ...a, browser_download_url: 'https://evil.example/WakeUp.apk' } : a)) });
  assert.equal(U.pick(evil, 'apk'), null);
});
