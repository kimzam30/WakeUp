'use strict';
// The desktop updater end to end against a fake GitHub: check → download → checksum → swap the install folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createUpdater } = require('../src/updater.js');
const U = require('../src/shared/update-core.js');

// a throwaway release-signing key; the real one never leaves CI and ~/.config/wakeup-signing
const keys = crypto.generateKeyPairSync('ed25519');
const PUBLIC = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const other = crypto.generateKeyPairSync('ed25519').privateKey;

// sig: 'good' (signed with the app's key), 'none' (no SHA256SUMS.sig) or 'wrong' (signed with another key)
function setup({ current = '2.5.0', latest = '2.6.0', corrupt = false, sig = 'good' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wakeup-upd-'));
  const lib = path.join(dir, 'lib', 'wakeup');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'wakeup'), '#!/bin/sh\necho old\n', { mode: 0o755 });
  // the release tarball: linux-unpacked/ with the new app inside
  const build = path.join(dir, 'build', 'linux-unpacked');
  fs.mkdirSync(build, { recursive: true });
  fs.writeFileSync(path.join(build, 'wakeup'), '#!/bin/sh\necho new\n', { mode: 0o755 });
  const name = `WakeUp-${latest}-linux-x64.tar.gz`;
  const tarball = path.join(dir, name);
  execFileSync('tar', ['-czf', tarball, '-C', path.join(dir, 'build'), 'linux-unpacked']);
  const bytes = fs.readFileSync(tarball);
  const sha = crypto.createHash('sha256').update(corrupt ? 'something else' : bytes).digest('hex');
  const base = `${U.DOWNLOAD_PREFIX}v${latest}/`;
  const release = {
    tag_name: `v${latest}`, draft: false, prerelease: false, body: '- Faster things', html_url: 'https://github.com/kimzam30/WakeUp/releases',
    assets: [{ name, browser_download_url: base + name, size: bytes.length }, { name: 'SHA256SUMS', browser_download_url: `${base}SHA256SUMS`, size: 100 }],
  };
  const sums = `${sha}  ${name}\n`;
  if (sig !== 'none') release.assets.push({ name: 'SHA256SUMS.sig', browser_download_url: `${base}SHA256SUMS.sig`, size: 64 });
  const signature = crypto.sign(null, Buffer.from(sums), sig === 'wrong' ? other : keys.privateKey);
  const routes = { [U.LATEST]: () => Response.json(release), [base + name]: () => new Response(bytes), [`${base}SHA256SUMS`]: () => new Response(sums), [`${base}SHA256SUMS.sig`]: () => new Response(signature) };
  const net = { fetch: async (url) => (routes[url] ? routes[url]() : new Response('nope', { status: 404 })) };
  const app = { isPackaged: true, getVersion: () => current, getPath: () => path.join(dir, 'tmp'), relaunch: () => {}, quit: () => {} };
  const states = [];
  const up = createUpdater({ app, net, log: () => {}, getSettings: () => ({ autoUpdate: true }), onState: (s) => states.push(s), lib, exePath: path.join(lib, 'wakeup'), signingKey: PUBLIC });
  return { dir, lib, up, states };
}

test('finds a newer release, installs it and keeps the old one aside', async () => {
  const { lib, up, dir } = setup();
  assert.equal(up.state().mode, 'installed');
  const st = await up.check();
  assert.equal(st.phase, 'available');
  assert.equal(st.latest, '2.6.0');
  await up.install();
  assert.equal(up.state().phase, 'ready');
  assert.match(fs.readFileSync(path.join(lib, 'wakeup'), 'utf8'), /new/);
  assert.match(fs.readFileSync(path.join(`${lib}.old`, 'wakeup'), 'utf8'), /old/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a damaged download changes nothing', async () => {
  const { lib, up, dir } = setup({ corrupt: true });
  await up.check();
  await up.install();
  assert.equal(up.state().phase, 'error');
  assert.match(up.state().error, /checksum/);
  assert.match(fs.readFileSync(path.join(lib, 'wakeup'), 'utf8'), /old/);
  assert.equal(fs.existsSync(`${lib}.new`), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

for (const sig of ['none', 'wrong']) {
  test(`an update ${sig === 'none' ? 'without a signature' : 'signed with another key'} changes nothing`, async () => {
    const { lib, up, dir } = setup({ sig });
    await up.check();
    await up.install();
    assert.equal(up.state().phase, 'error');
    assert.match(up.state().error, /isn’t signed by WakeUp/);
    assert.match(fs.readFileSync(path.join(lib, 'wakeup'), 'utf8'), /old/);
    assert.equal(fs.existsSync(`${lib}.new`), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('a second update replaces the first one\'s leftovers', async () => {
  const { lib, up, dir } = setup();
  fs.mkdirSync(path.join(`${lib}.old`, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(`${lib}.old`, 'resources', 'app.asar'), 'previous version');
  await up.check();
  await up.install();
  assert.equal(up.state().phase, 'ready', up.state().error);
  assert.match(fs.readFileSync(path.join(lib, 'wakeup'), 'utf8'), /new/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the same or an older version is not offered', async () => {
  const { up, dir } = setup({ current: '2.6.0', latest: '2.6.0' });
  assert.equal((await up.check()).phase, 'current');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a dev run never updates itself', () => {
  const app = { isPackaged: false, getVersion: () => '2.5.0', getPath: () => os.tmpdir() };
  const up = createUpdater({ app, net: {}, log: () => {}, getSettings: () => ({}), onState: () => {} });
  assert.equal(up.state().phase, 'unsupported');
  assert.equal(up.state().mode, 'dev');
});
