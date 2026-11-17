#!/usr/bin/env node
'use strict';
// One version for both apps. package.json holds it; this copies it to the Android app.
//   node scripts/bump-version.js 2.5.0   set the version everywhere (then commit; pushing to main publishes it)
//   node scripts/bump-version.js         copy package.json's version to mobile/
//   node scripts/bump-version.js --check fail if mobile/ doesn't match package.json (used by the release workflow)
const fs = require('fs');
const path = require('path');
const { versionCode } = require('../src/shared/update-core.js');

const root = path.join(__dirname, '..');
const file = (p) => path.join(root, p);
const read = (p) => JSON.parse(fs.readFileSync(file(p), 'utf8'));
const write = (p, j) => fs.writeFileSync(file(p), `${JSON.stringify(j, null, 2)}\n`);

const arg = process.argv[2];
const pkg = read('package.json');
if (arg && arg !== '--check') {
  if (!/^\d+\.\d+\.\d+$/.test(arg)) { console.error(`Not a version: ${arg} (use x.y.z)`); process.exit(1); }
  pkg.version = arg; write('package.json', pkg);
}
const v = pkg.version;
const app = read('mobile/app.json');
const mpkg = read('mobile/package.json');
const want = { version: v, versionCode: versionCode(v) };

if (arg === '--check') {
  const bad = [];
  if (app.expo.version !== want.version) bad.push(`mobile/app.json version is ${app.expo.version}`);
  if (app.expo.android?.versionCode !== want.versionCode) bad.push(`mobile/app.json versionCode is ${app.expo.android?.versionCode}`);
  if (mpkg.version !== want.version) bad.push(`mobile/package.json version is ${mpkg.version}`);
  if (bad.length) { console.error(`package.json says ${v} (versionCode ${want.versionCode}), but:\n  ${bad.join('\n  ')}\nRun: node scripts/bump-version.js`); process.exit(1); }
  console.log(`Version ${v} (versionCode ${want.versionCode}) matches everywhere.`);
  process.exit(0);
}

app.expo.version = want.version; app.expo.android.versionCode = want.versionCode; write('mobile/app.json', app);
mpkg.version = want.version; write('mobile/package.json', mpkg);
console.log(`WakeUp ${v} (Android versionCode ${want.versionCode}).`);
