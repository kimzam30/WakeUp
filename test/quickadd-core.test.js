'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../src/ui/quickadd-core.js');

// Friday 20 Nov 2026, weeks start on Monday
const o = { today: '2026-11-20', weekStart: 1, classes: [{ id: 'c1', code: 'CSP1123' }, { id: 'c2', code: 'CCS6314' }], nextMeeting: (id) => (id === 'c1' ? '2026-11-23' : null) };
const p = (t) => Q.parse(t, o);

test('dates', () => {
  assert.equal(p('read ch 3 tmr').due, '2026-11-21');
  assert.equal(p('read ch 3 tmr').text, 'read ch 3');
  assert.equal(p('x today').due, '2026-11-20');
  assert.equal(p('x fri').due, '2026-11-20'); // today is Friday
  assert.equal(p('x mon').due, '2026-11-23');
  assert.equal(p('x next mon').due, '2026-11-30');
  assert.equal(p('x in 3 days').due, '2026-11-23');
  assert.equal(p('x in 2 weeks').due, '2026-12-04');
  assert.equal(p('x next week').due, '2026-11-23');
  assert.equal(p('essay due 25/11').due, '2026-11-25');
  assert.equal(p('essay due 25/11').text, 'essay');
  assert.equal(p('x 1 dec').due, '2026-12-01');
  assert.equal(p('x nov 30th').due, '2026-11-30');
  assert.equal(p('x 5/1').due, '2027-01-05'); // already past this year
  assert.equal(p('x 2026-12-15').due, '2026-12-15');
  assert.equal(p('x 31/2').due, undefined); // not a real date: left in the title
  assert.equal(p('buy milk').due, undefined);
});

test('weeks that start on Sunday', () => {
  assert.equal(Q.parse('x next week', { ...o, weekStart: 0 }).due, '2026-11-22');
});

test('classes', () => {
  const r = p('lab report fri CSP1123');
  assert.deepEqual([r.text, r.due, r.classId], ['lab report', '2026-11-20', 'c1']);
  assert.equal(p('notes csp1123').classId, 'c1');
  const room = p('CQAR1009 CSP1123 notes'); // a room code isn't a class
  assert.deepEqual([room.classId, room.text], ['c1', 'CQAR1009 notes']);
  assert.equal(p('notes XYZ9999').classId, undefined);
  const nx = p('quiz by next CSP1123');
  assert.deepEqual([nx.classId, nx.due, nx.text], ['c1', '2026-11-23', 'quiz']);
  assert.equal(p('slides CSP1123 next class').due, '2026-11-23');
});

test('exams: time and venue', () => {
  const r = p('CCS6314 midterm next tue 2pm @CQAR1009');
  assert.deepEqual([r.exam, r.classId, r.due, r.at, r.venue, r.text], [true, 'c2', '2026-12-01', '14:00', 'CQAR1009', 'midterm']);
  assert.equal(p('final exam 2026-12-15 9:30am').at, '09:30');
  assert.equal(p('test fri 17:00').at, '17:00');
  assert.equal(p('test fri 12am').at, '00:00');
  // a time on a plain task stays in the title (tasks have no time)
  const t = p('call mum fri 5pm');
  assert.deepEqual([t.exam, t.at, t.text], [false, null, 'call mum 5pm']);
});

test('never loses the title', () => {
  assert.equal(p('today').text, 'today');
  assert.equal(p('   ').text, '');
  assert.ok(p('lab report fri CSP1123').found.some((f) => f.kind === 'class' && f.label === 'CSP1123'));
});
