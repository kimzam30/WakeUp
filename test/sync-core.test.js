'use strict';
// node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/shared/sync-core.js');

const base = () => ({
  semester: { name: 'T2530', start: '2026-10-01', end: null, breaks: [] },
  classes: [{ id: 'k1', code: 'CSP1123', name: 'Mini IT', sessions: [] }],
  changes: [],
  tasks: [{ id: 't1', text: 'Report', done: false }, { id: 't2', text: 'Quiz', done: false }],
});

test('diff finds edits, additions and deletions', () => {
  const a = base(); const b = base();
  b.tasks[0].done = true; b.tasks.splice(1, 1); b.classes.push({ id: 'k2', code: '', name: 'Calc', sessions: [] });
  const d = S.diff(a, b);
  assert.deepEqual(d.upserts.map((r) => S.key(r.kind, r.id)).sort(), ['class:k2', 'task:t1']);
  assert.deepEqual(d.deletes, [{ kind: 'task', id: 't2' }]);
});

test('no change, no rows', () => {
  const d = S.diff(base(), base());
  assert.equal(d.upserts.length + d.deletes.length, 0);
});

test('apply adds, updates, deletes and keeps order', () => {
  const rows = [
    { kind: 'task', id: 't1', data: { id: 't1', text: 'Report v2', done: false } },
    { kind: 'task', id: 't2', deleted: true, data: {} },
    { kind: 'task', id: 't3', data: { id: 't3', text: 'New', done: false } },
    { kind: 'semester', id: 'current', data: { name: 'T2610', start: '2027-02-01', end: null, breaks: [] } },
  ];
  const { planner, changed } = S.apply(base(), rows);
  assert.ok(changed);
  assert.deepEqual(planner.tasks.map((t) => t.text), ['Report v2', 'New']);
  assert.equal(planner.semester.name, 'T2610');
});

test('local edits waiting to upload win over the cloud', () => {
  const rows = [{ kind: 'task', id: 't1', data: { id: 't1', text: 'cloud', done: false } }];
  const { planner } = S.apply(base(), rows, new Set(['task:t1']));
  assert.equal(planner.tasks[0].text, 'Report');
});

test('outbox keeps only the latest edit per item', () => {
  let o = S.queue([], { upserts: [{ kind: 'task', id: 't1', data: { id: 't1', text: 'a' } }], deletes: [] });
  o = S.queue(o, { upserts: [], deletes: [{ kind: 'task', id: 't1' }] });
  assert.equal(o.length, 1);
  assert.equal(o[0].deleted, true);
});

test('first sign-in merge keeps local-only items and adds cloud ones', () => {
  const rows = [{ kind: 'task', id: 'c1', data: { id: 'c1', text: 'from phone', done: false } }, { kind: 'semester', id: 'current', data: { name: '', start: null, end: null, breaks: [] } }];
  const p = S.mergeFirst(base(), rows);
  assert.deepEqual(p.tasks.map((t) => t.id), ['t1', 't2', 'c1']);
  assert.equal(p.semester.start, '2026-10-01');
});

test('only portable settings sync', () => {
  assert.deepEqual(S.pickSettings({ theme: 'dark', sideWidth: 300, classLabel: 'both' }), { theme: 'dark', classLabel: 'both' });
});

test('an empty semester row is not "data"; a class or a dated semester is', () => {
  assert.equal(S.hasContent([{ kind: 'semester', id: 'current', data: { name: '', start: null } }]), false);
  assert.equal(S.hasContent([{ kind: 'task', id: 't1', deleted: true, data: {} }]), false);
  assert.equal(S.hasContent([{ kind: 'semester', id: 'current', data: { start: '2026-10-01' } }]), true);
  assert.equal(S.hasContent([{ kind: 'class', id: 'k1', data: { id: 'k1' } }]), true);
  assert.equal(S.plannerHasContent({ semester: { start: null }, classes: [], changes: [], tasks: [] }), false);
  assert.equal(S.plannerHasContent(base()), true);
});

test('deletes made while signed out stay deleted and are tombstoned on the next sign-in', () => {
  let removed = S.trackOffline([], { upserts: [], deletes: [{ kind: 'task', id: 't2' }, { kind: 'task', id: 'x' }] });
  removed = S.trackOffline(removed, { upserts: [{ kind: 'task', id: 'x' }], deletes: [] });
  assert.deepEqual(removed, ['task:t2']);
  const local = base(); local.tasks = local.tasks.filter((t) => t.id !== 't2');
  const rows = [{ kind: 'task', id: 't1', data: base().tasks[0] }, { kind: 'task', id: 't2', data: base().tasks[1] }];
  const merged = S.mergeFirst(local, rows, removed);
  assert.deepEqual(merged.tasks.map((t) => t.id), ['t1']);
  const out = S.firstOutbox(rows, merged, removed);
  assert.ok(out.some((r) => r.kind === 'task' && r.id === 't2' && r.deleted));
  assert.ok(!out.some((r) => r.kind === 'task' && r.id === 't1'));
});

test('remote settings merge field by field around unsent local edits', () => {
  const local = { theme: 'dark', nickname: 'Kim', reminders: 10 };
  const remote = { theme: 'light', nickname: 'Hakim', reminders: 10 };
  assert.deepEqual(S.remoteSettingsPatch(local, remote, ['nickname']), { theme: 'light' });
  assert.deepEqual(S.settingsKeysChanged(local, { ...local, nickname: 'K', sideWidth: 9 }), ['nickname']);
  assert.ok(!S.SYNCED_SETTINGS.includes('notify'));
});

test('stillDirty: sent keys are clean, keys edited during the upload stay dirty', () => {
  const body = { nickname: 'B', theme: 'dark' };
  // nickname sent and unchanged → clean; theme sent but now 'light' → dirty; weekStart not sent → dirty
  assert.deepEqual(S.stillDirty(['nickname', 'theme', 'weekStart'], ['nickname', 'theme'], body, { nickname: 'B', theme: 'light', weekStart: 0 }), ['theme', 'weekStart']);
  // a sent key missing locally doesn't stay dirty forever
  assert.deepEqual(S.stillDirty(['customApps'], ['customApps'], { customApps: [] }, {}), []);
});

test('applying the uploaded body keeps the value just sent', () => {
  const local = { nickname: 'B', theme: 'system' };
  const body = { nickname: 'B', theme: 'dark' }; // theme came from the cloud, nickname from this device
  assert.deepEqual(S.remoteSettingsPatch(local, body, []), { theme: 'dark' });
});
