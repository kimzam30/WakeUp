'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/ui/focus-core.js');
const P = require('../src/ui/planner-core.js');

test('focus runs, pauses and resumes', () => {
  let s = F.start(F.idle(), 0, {}, 't1');
  assert.equal(s.phase, 'focus'); assert.equal(s.taskId, 't1');
  assert.equal(F.remaining(s, 60e3), 24 * 60e3);
  s = F.pause(s, 60e3);
  assert.ok(F.paused(s)); assert.equal(F.remaining(s, 10 * 60e3), 24 * 60e3);
  s = F.resume(s, 10 * 60e3);
  assert.equal(s.endsAt, 34 * 60e3);
  assert.equal(F.tick(s, 30 * 60e3).ended, null);
});

test('a finished focus becomes a break, every fourth a long one', () => {
  let s = F.start(F.idle(), 0);
  for (let i = 1; i <= 4; i++) {
    const r = F.tick(s, s.endsAt + 1);
    assert.equal(r.ended, 'focus');
    assert.equal(r.state.phase, i === 4 ? 'long' : 'short');
    assert.equal(r.state.done, i);
    const b = F.tick(r.state, r.state.endsAt);
    assert.equal(b.ended, r.state.phase);
    s = b.state;
    assert.equal(s.phase, 'focus');
  }
});

test('skipping a focus does not count it', () => {
  const s = F.skip(F.start(F.idle(), 0), 1000);
  assert.equal(s.phase, 'short'); assert.equal(s.done, 0);
});

test('custom lengths and cleaning bad saved state', () => {
  const s = F.start(F.idle(), 0, { focus: 50 });
  assert.equal(s.endsAt, 50 * 60e3);
  assert.deepEqual(F.clean({ phase: 'nap' }), F.idle());
  assert.equal(F.clean({ phase: 'focus', endsAt: 5, done: -2 }).done, 0);
  assert.equal(F.clock(61e3), '1:01');
});

// planner helpers for autofill and task links
const plan = () => ({
  semester: { name: '', start: null, end: null, breaks: [] },
  classes: [
    { id: 'a', code: 'A1', name: 'Alpha', icon: '', color: '#000', sessions: [{ id: 's1', kind: 'lecture', section: '', day: 1, start: '08:00', end: '10:00', venue: 'CQAR3006', mode: 'campus', link: '' }] },
    { id: 'b', code: 'B1', name: 'Beta', icon: '', color: '#000', sessions: [{ id: 's2', kind: 'lab', section: '', day: 1, start: '09:00', end: '11:00', venue: 'CNMX1002', mode: 'campus', link: '' }, { id: 's3', kind: 'lecture', section: '', day: 3, start: '14:00', end: '16:00', venue: 'CQAR3006', mode: 'campus', link: '' }] },
  ],
  changes: [{ id: 'x1', type: 'cancelled', sessionId: 's1', classId: null, date: '2026-11-16', toDate: null, start: null, end: null, venue: '', link: '', note: '' }],
  tasks: [],
});

test('nextMeeting skips cancelled dates', () => {
  assert.equal(P.nextMeeting(plan(), 'a', '2026-11-16'), '2026-11-23'); // 16 Nov is a Monday, cancelled
  assert.equal(P.nextMeeting(plan(), 'b', '2026-11-17'), '2026-11-18');
  assert.equal(P.nextMeeting(plan(), 'zzz', '2026-11-17'), null);
});

test('venues are ranked by use and clashes find overlaps', () => {
  assert.deepEqual(P.venues(plan()), ['CQAR3006', 'CNMX1002']);
  assert.deepEqual(P.clashes(plan(), '2026-11-23', '09:30', '10:30').map((o) => o.classId).sort(), ['a', 'b']);
  assert.deepEqual(P.clashes(plan(), '2026-11-16', '08:00', '09:00').map((o) => o.classId), []); // A is cancelled that day
  assert.deepEqual(P.clashes(plan(), '2026-11-23', '11:00', '12:00'), []);
});
