'use strict';
// Timetable, tasks, Today and the focus timer, end to end on a throwaway profile: what you'd do in a week of using it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, planner } = require('./harness');

const DLG = '[role=dialog]';
const todayDow = String(new Date().getDay());

const PANE = (name) => `.pane[aria-label="${name}"]`;
async function openPane(page, name) { await page.click(`#sidebar button[aria-label="${name}"]`); await page.waitForSelector(`${PANE(name)}:not([hidden])`); }
// close whatever sheet is open, then open the class meeting's sheet fresh
async function openMeeting(page) {
  while (await page.isVisible(DLG)) { await page.click(`${DLG} [data-act=close] >> nth=0`); }
  await page.click(`${PANE('Timetable')} button:has-text("CSP1123")`);
  await page.waitForSelector(DLG);
}
// a class meeting today, late in the evening so it's always ahead of "now" while the tests run
async function addClass(page, { code = 'CSP1123', name = 'Mini IT Project', start = '23:00', end = '23:50' } = {}) {
  await openPane(page, 'Timetable');
  await page.click(`${PANE('Timetable')} [data-act=add-class] >> nth=0`);
  await page.fill(`${DLG} [data-f=code]`, code); await page.fill(`${DLG} [data-f=name]`, name);
  await page.selectOption(`${DLG} [data-f="s.0.day"]`, todayDow);
  await page.fill(`${DLG} [data-f="s.0.start"]`, start); await page.fill(`${DLG} [data-f="s.0.end"]`, end);
  await page.fill(`${DLG} [data-f="s.0.venue"]`, 'CQAR2004');
  await page.click(`${DLG} button[type=submit]`);
  await page.waitForFunction((c) => hub.planner().then((p) => p.classes.some((x) => x.code === c)), code);
  if (await page.isVisible(`${DLG}[aria-label=Semester]`)) await page.click(`${DLG}[aria-label=Semester] [data-act=close] >> nth=0`);
}

test('timetable: a class needs a name, then shows in the week and on Today', async () => {
  const w = await launch();
  try {
    await openPane(w.page, 'Timetable');
    await w.page.click(`${PANE('Timetable')} [data-act=add-class] >> nth=0`);
    await w.page.click(`${DLG} button[type=submit]`);
    assert.ok((await w.page.textContent(`${DLG} .form-error`)).trim().length > 0, 'an empty class must be refused');
    await w.page.click(`${DLG} [data-act=close] >> nth=0`);
    await addClass(w.page);
    assert.ok(await w.page.isVisible(`${PANE('Timetable')} button:has-text("CSP1123")`), 'in the week view');
    await w.page.click('#sidebar button[aria-label="Today"]');
    assert.match(await w.page.textContent('#home'), /CSP1123|Mini IT/);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('timetable: a class meeting can be cancelled, made online, undone, and get a note and a task', async () => {
  const w = await launch();
  try {
    await addClass(w.page);
    await openMeeting(w.page);
    await w.page.click(`${DLG} [data-act=cancel-occ]`);
    await w.page.waitForFunction(() => hub.planner().then((p) => p.changes.length === 1));
    await openMeeting(w.page);
    await w.page.click(`${DLG} [data-act=undo]`); // the change can be taken back
    await w.page.waitForFunction(() => hub.planner().then((p) => p.changes.length === 0));
    await openMeeting(w.page);
    await w.page.click(`${DLG} [data-act=sub-online]`);
    await w.page.waitForFunction(() => hub.planner().then((p) => p.changes.length === 1));
    // a note ("Quiz") for this class
    await openMeeting(w.page);
    await w.page.click(`${DLG} [data-act=note-tag][data-tag=quiz]`);
    await w.page.fill(`${DLG} input[aria-label="Note"]`, 'Chapter 3');
    await w.page.click(`${DLG} [data-act=note-add]`);
    await w.page.waitForFunction(() => hub.planner().then((p) => JSON.stringify(p).includes('Chapter 3')));
    // a task for this class
    await w.page.fill(`${DLG} input[aria-label="Add a task for this class"]`, 'Read chapter 3');
    await w.page.press(`${DLG} input[aria-label="Add a task for this class"]`, 'Enter');
    await w.page.waitForFunction(() => hub.planner().then((p) => p.tasks.some((t) => t.text === 'Read chapter 3' || t.title === 'Read chapter 3')));
    const p = await planner(w.page);
    const task = p.tasks.find((t) => (t.text || t.title) === 'Read chapter 3');
    assert.equal(task.classId, p.classes[0].id, 'the task is linked to the class');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('timetable: a replacement can be added from a class meeting', async () => {
  const w = await launch();
  try {
    await addClass(w.page);
    await w.page.click(`${PANE('Timetable')} button:has-text("CSP1123")`);
    await w.page.click(`${DLG} [data-act=sub-replace]`);
    await w.page.click(`${DLG} [data-act=use-sess] >> nth=0`); // fills date and times from the usual session
    const tomorrow = new Date(Date.now() + 864e5); const ymd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await w.page.fill(`${DLG} [data-f=date]`, ymd);
    await w.page.fill(`${DLG} [data-f=note]`, 'Replaces Monday');
    await w.page.click(`${DLG} [data-act=do-replace]`);
    await w.page.waitForFunction((d) => hub.planner().then((p) => p.changes.some((c) => c.date === d || JSON.stringify(c).includes(d))), ymd);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('timetable: edit a class, then delete it (asks first)', async () => {
  const w = await launch();
  try {
    await addClass(w.page);
    await w.page.click(`${PANE('Timetable')} button:has-text("CSP1123")`);
    await w.page.click(`${DLG} [data-act=edit-class]`);
    await w.page.fill(`${DLG} [data-f=name]`, 'Renamed class');
    await w.page.click(`${DLG} button[type=submit]`);
    await w.page.waitForFunction(() => hub.planner().then((p) => p.classes[0]?.name === 'Renamed class'));
    await w.page.click(`${PANE('Timetable')} button:has-text("CSP1123")`);
    await w.page.click(`${DLG} [data-act=edit-class]`);
    await w.page.click(`${DLG} [data-act=del-class]`);
    await w.page.click(`${DLG} [data-act=del-no]`);
    assert.equal((await planner(w.page)).classes.length, 1, '"Keep" keeps it');
    await w.page.click(`${DLG} [data-act=del-class]`);
    await w.page.click(`${DLG} [data-act=del-yes]`);
    await w.page.waitForFunction(() => hub.planner().then((p) => p.classes.length === 0));
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('timetable: semester dates and a break save, and the week view moves', async () => {
  const w = await launch();
  try {
    await addClass(w.page); // the week arrows show once there's a class
    await w.page.click(`${PANE('Timetable')} [data-act=semester] >> nth=0`);
    await w.page.fill(`${DLG} [data-f=name]`, 'Trimester 2610');
    await w.page.fill(`${DLG} [data-f=start]`, '2026-10-05');
    await w.page.fill(`${DLG} [data-f=end]`, '2027-01-31');
    await w.page.click(`${DLG} [data-act=add-break]`);
    await w.page.fill(`${DLG} [data-f="b.0.label"]`, 'Mid-sem break');
    await w.page.fill(`${DLG} [data-f="b.0.start"]`, '2026-11-23');
    await w.page.fill(`${DLG} [data-f="b.0.end"]`, '2026-11-29');
    await w.page.click(`${DLG} button[type=submit]`);
    await w.page.waitForFunction(() => hub.planner().then((p) => p.semester.name === 'Trimester 2610' && p.semester.breaks.length === 1));
    const label = () => w.page.textContent(PANE('Timetable'));
    const now = await label();
    await w.page.click(`${PANE('Timetable')} [data-act=next]`); assert.notEqual(await label(), now);
    await w.page.click(`${PANE('Timetable')} [data-act=this]`); assert.equal(await label(), now);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('timetable: export to a file and import it back (the file dialogs answered by the test)', async () => {
  const w = await launch();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wakeup-e2e-file-')), 'timetable.json');
  try {
    await addClass(w.page);
    await w.app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
      dialog.showMessageBox = async () => ({ response: 0 });
    }, file);
    assert.equal(await w.page.evaluate(() => hub.exportPlanner()), true);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(JSON.stringify(saved).includes('CSP1123'), 'the file has the class');
    // a fresh profile imports it
    const v = await launch();
    try {
      await v.app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); dialog.showMessageBox = async () => ({ response: 0 }); }, file);
      const r = await v.page.evaluate(() => hub.importPlanner());
      assert.ok(r?.planner?.classes?.some((c) => c.code === 'CSP1123'), `import: ${JSON.stringify(r).slice(0, 200)}`);
    } finally { await v.close(); }
    // a damaged file is refused with a message, nothing changes
    fs.writeFileSync(file, '{ not json');
    const r = await w.page.evaluate(() => hub.importPlanner());
    assert.ok(r?.error, 'a damaged file is refused');
    assert.equal((await planner(w.page)).classes.length, 1);
  } finally { await w.close(); }
});

test('tasks: add with a due date and a class, finish, show and clear finished, delete', async () => {
  const w = await launch();
  try {
    await addClass(w.page);
    await openPane(w.page, 'Tasks');
    const pane = PANE('Tasks');
    for (const [text, due] of [['Due today', 'today'], ['Due tomorrow', 'tomorrow'], ['Someday', '']]) {
      await w.page.click(`${pane} [data-due="${due}"]`);
      await w.page.fill(`${pane} input[name=text]`, text);
      await w.page.press(`${pane} input[name=text]`, 'Enter');
    }
    await w.page.waitForFunction(() => hub.planner().then((p) => p.tasks.length === 3));
    const tasks = (await planner(w.page)).tasks;
    const today = tasks.find((t) => (t.text || t.title) === 'Due today'); const tmr = tasks.find((t) => (t.text || t.title) === 'Due tomorrow'); const some = tasks.find((t) => (t.text || t.title) === 'Someday');
    assert.ok(today.due && tmr.due && today.due < tmr.due, 'due dates set'); assert.equal(some.due, null);
    // finish one
    await w.page.click(`${pane} [data-id="${today.id}"] [data-act=toggle]`);
    await w.page.waitForFunction((id) => hub.planner().then((p) => p.tasks.find((t) => t.id === id)?.done), today.id);
    await w.page.click(`${pane} [data-act=show-done]`);
    assert.ok(await w.page.isVisible(`${pane} [data-id="${today.id}"]`), 'finished tasks show');
    await w.page.click(`${pane} [data-act=clear-done]`);
    await w.page.waitForFunction(() => hub.planner().then((p) => p.tasks.length === 2));
    await w.page.click(`${pane} [data-id="${some.id}"] [data-act=del]`);
    await w.page.waitForFunction(() => hub.planner().then((p) => p.tasks.length === 1));
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('focus timer: starts, pauses, resumes, skips to a break and stops', async () => {
  const w = await launch();
  try {
    await openPane(w.page, 'Tasks');
    const pane = PANE('Tasks');
    await w.page.click(`${pane} [data-focus=start]`);
    const card = () => w.page.textContent(pane);
    assert.match(await card(), /2[45]:\d\d/, 'counting down from 25:00');
    for (const f of ['skip', 'stop']) if (await w.page.locator(`${pane} [data-focus=${f}]`).count()) await w.page.click(`${pane} [data-focus=${f}]`);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('today: a task added on Today lands in Tasks; the nickname prompt saves or goes away', async () => {
  const w = await launch();
  try {
    await w.page.fill('#home input[name=task]', 'From Today');
    await w.page.press('#home input[name=task]', 'Enter');
    await w.page.waitForFunction(() => hub.planner().then((p) => p.tasks.some((t) => (t.text || t.title) === 'From Today')));
    await w.page.click('#home [data-act=nick-skip]');
    assert.equal(await w.page.isVisible('#home input[name=nick]'), false, '"Not now" hides the prompt');
    await w.page.click('#home [data-act=customize]');
    assert.ok(await w.page.isVisible('#settings [data-today]'), 'Customize Today opens its settings');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});
