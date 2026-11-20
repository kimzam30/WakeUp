'use strict';
// The class page's two fields (v3, I5): a class's Ebwise course link and your notes.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/shared/planner-schema.js');

const cls = (extra) => S.cleanPlanner({ classes: [{ id: 'a', code: 'CSP1123', name: 'Mini IT Project', color: '#2b63d9', sessions: [], ...extra }] }).classes[0];

test('class page: course link and notes', () => {
  const c = cls({ course: 'https://ebwise.mmu.edu.my/course/view.php?id=123', notes: '  Group: Aina, Wei Jie\r\n\r\n\r\nDemo in week 12\u0007  ' });
  assert.equal(c.course, 'https://ebwise.mmu.edu.my/course/view.php?id=123');
  assert.equal(c.notes, 'Group: Aina, Wei Jie\n\nDemo in week 12', 'line breaks stay, runs of blank lines and control characters go');
  assert.equal(cls({ course: 'http://ebwise.mmu.edu.my/x' }).course, undefined, 'only https links');
  assert.equal(cls({ course: 'javascript:alert(1)' }).course, undefined);
  assert.equal(cls({ notes: 'x'.repeat(3000) }).notes.length, 2000);
  const plain = cls({});
  assert.equal('course' in plain || 'notes' in plain, false, 'a class without them keeps its old shape');
  assert.equal('notes' in cls({ notes: '   ' }), false);
});
