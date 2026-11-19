// Task actions with Undo (docs/DESIGN.md → Toast; audit M3). The change happens at once; the toast's Undo puts it back.
import { haptic } from '../lib/haptics';
import { setPlanner } from '../lib/store';
import type { Task } from '../lib/types';
import { undoToast } from './Toast';

// finish a task (or reopen it)
export function toggleTask(t: Task) {
  const was = { done: t.done, doneAt: t.doneAt ?? null };
  if (!t.done) haptic('success');
  setPlanner((p) => ({ tasks: p.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done, doneAt: x.done ? null : Date.now() } : x)) }));
  if (!t.done) undoToast(`Done: ${t.text}`, () => setPlanner((p) => ({ tasks: p.tasks.map((x) => (x.id === t.id ? { ...x, ...was } : x)) })), 'done');
}

// delete a task; Undo puts it back where it was
export function deleteTask(t: Task) {
  let at = -1;
  setPlanner((p) => { at = p.tasks.findIndex((x) => x.id === t.id); return { tasks: p.tasks.filter((x) => x.id !== t.id) }; });
  undoToast(`Deleted: ${t.text}`, () => setPlanner((p) => {
    if (p.tasks.some((x) => x.id === t.id)) return {};
    const tasks = [...p.tasks]; tasks.splice(at < 0 ? 0 : Math.min(at, tasks.length), 0, t); return { tasks };
  }), 'trash');
}
