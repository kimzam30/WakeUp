// Tasks: quick add at the top, grouped Late / Today / Coming up / Someday, done ones folded away.
// Tap the circle to finish a task; tap the task to edit it: a sheet on phones, a panel beside the list on a
// landscape tablet. Typing in quick add only re-renders the quick-add box, not the list.
import { memo, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { haptic } from '../../lib/haptics';
import { Button, Card, Chip, Divider, Empty, Field, IconButton, Page, Row, Sheet, Txt, useLayout } from '../../ui/kit';
import { DateField } from '../../ui/DateField';
import { Icon } from '../../ui/Icon';
import { R, S, T, useTheme } from '../../ui/theme';
import { Planner, Schema } from '../../lib/shared';
import { setPlanner, useStore } from '../../lib/store';
import { useToday } from '../../lib/hooks';
import { classLabel, fmtDate } from '../../lib/format';
import type { ClassItem, Task } from '../../lib/types';

const GROUPS: [string, string][] = [['overdue', 'Late'], ['today', 'Today'], ['upcoming', 'Coming up'], ['someday', 'Someday']];
const dueText = (due: string, today: string) => (due < today ? `Late · ${fmtDate(due)}` : due === today ? 'Today' : due === Planner.addDays(today, 1) ? 'Tomorrow' : fmtDate(due));

export default function Tasks() {
  const { c } = useTheme();
  const { twoCol } = useLayout();
  const tasks = useStore((s) => s.planner.tasks);
  const classes = useStore((s) => s.planner.classes);
  const mode = useStore((s) => s.settings.classLabel);
  const today = useToday();
  const [showDone, setShowDone] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const edit = editId ? tasks.find((t) => t.id === editId) ?? null : null;
  const byId = useMemo(() => new Map(classes.map((k) => [k.id, k])), [classes]);

  const { groups, done } = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    const g = GROUPS.map(([k, title]) => ({
      k, title,
      list: open.filter((t) => Planner.bucket(t, today) === k).sort((a, b) => ((a.due ?? '') < (b.due ?? '') ? -1 : (a.due ?? '') > (b.due ?? '') ? 1 : b.created - a.created)),
    })).filter((x) => x.list.length);
    return { groups: g, done: tasks.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)) };
  }, [tasks, today]);

  const toggle = (t: Task) => {
    if (!t.done) haptic('success');
    setPlanner((p) => ({ tasks: p.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done, doneAt: x.done ? null : Date.now() } : x)) }));
  };
  const list = (items: Task[]) => <Card>{items.map((t, i) => <TaskRow key={t.id} t={t} first={!i} cls={t.classId ? byId.get(t.classId) : undefined} mode={mode} today={today} picked={twoCol && t.id === editId} onToggle={toggle} onOpen={setEditId} />)}</Card>;

  const body = (
    <Page max={twoCol ? 720 : 760}>
      <Txt kind="display">Tasks</Txt>
      <QuickAdd today={today} />
      {!tasks.length ? <Empty icon="tasks" title="Nothing to do yet" body="Add assignments, readings and reminders. Tasks with a date show up on Today, and you get a reminder on the day they’re due." /> : null}
      {groups.map(({ k, title, list: items }) => (
        <View key={k} style={{ gap: S(2) }}>
          <Txt kind="tiny" style={{ color: k === 'overdue' ? c.bad : c.muted }}>{`${title.toUpperCase()} · ${items.length}`}</Txt>
          {list(items)}
        </View>
      ))}
      {done.length ? (
        <View style={{ gap: S(2) }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDone }} onPress={() => setShowDone(!showDone)} style={{ flexDirection: 'row', alignItems: 'center', gap: S(1), minHeight: 44 }}>
            <Txt kind="tiny" muted>{`DONE · ${done.length}`}</Txt><Icon name={showDone ? 'chevD' : 'chevR'} size={14} color={c.muted} />
          </Pressable>
          {showDone ? list(done.slice(0, 50)) : null}
        </View>
      ) : null}
    </Page>
  );

  if (twoCol && tasks.length) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.bg }}>
        <View style={{ flex: 1 }}>{body}</View>
        <View style={{ width: 380, borderLeftWidth: 1, borderColor: c.line, backgroundColor: c.raised }}>
          {edit ? <TaskEditor key={edit.id} task={edit} onClose={() => setEditId(null)} inline /> : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: S(8), gap: S(2) }}>
              <Icon name="edit" size={28} color={c.faint} />
              <Txt muted style={{ textAlign: 'center' }}>Pick a task to change its date, class or wording.</Txt>
            </View>
          )}
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {body}
      <Sheet open={!!edit} onClose={() => setEditId(null)} title="Task">{edit ? <TaskEditor key={edit.id} task={edit} onClose={() => setEditId(null)} /> : null}</Sheet>
    </View>
  );
}

const TaskRow = memo(function TaskRow({ t, first, cls, mode, today, picked, onToggle, onOpen }: { t: Task; first: boolean; cls?: ClassItem; mode: 'code' | 'name' | 'both'; today: string; picked: boolean; onToggle: (t: Task) => void; onOpen: (id: string) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ backgroundColor: picked ? c.accentSoft : 'transparent' }}>
      {first ? null : <Divider inset={56} />}
      <Row onPress={() => onOpen(t.id)} style={{ paddingLeft: S(2) }}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={t.done ? 'Mark not done' : 'Mark done'} onPress={() => onToggle(t)} hitSlop={8}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: t.done ? c.good : c.lineStrong, backgroundColor: t.done ? c.good : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {t.done ? <Icon name="check" size={14} color="#fff" stroke={2.2} /> : null}
          </View>
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt muted={t.done} style={{ textDecorationLine: t.done ? 'line-through' : 'none' }}>{t.text}</Txt>
          {cls || (t.due && !t.done) ? <View style={{ flexDirection: 'row', gap: S(2), flexWrap: 'wrap' }}>
            {cls ? <Chip label={classLabel(cls, mode)} /> : null}
            {t.due && !t.done ? <Chip label={dueText(t.due, today)} tone={t.due < today ? 'bad' : undefined} /> : null}
          </View> : null}
        </View>
      </Row>
    </View>
  );
});

// The quick-add box keeps its own state, so typing doesn't redraw the whole list
function QuickAdd({ today }: { today: string }) {
  const { c } = useTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [draft, setDraft] = useState('');
  const [due, setDue] = useState<string | null>(today);
  const [picking, setPicking] = useState(false);
  const tomorrow = Planner.addDays(today, 1);
  const add = () => {
    const text = draft.trim(); if (!text) return;
    setPlanner((p) => ({ tasks: [{ id: Schema.newId('t'), text, done: false, due, classId: null, created: Date.now(), doneAt: null }, ...p.tasks] }));
    setDraft(''); input.current?.clear(); haptic('light');
  };
  const chip = (v: string | null, l: string, onPress = () => setDue(v)) => {
    const on = due === v;
    return (
      <Pressable key={l} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress}
        style={{ height: 36, paddingHorizontal: S(3), borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: S(1), backgroundColor: on ? c.accentSoft : 'transparent', borderWidth: 1, borderColor: on ? c.accent : c.line }}>
        <Txt kind="small" style={{ color: on ? c.accentText : c.muted, fontWeight: '600' }}>{l}</Txt>
      </Pressable>
    );
  };
  const custom = due && due !== today && due !== tomorrow;
  return (
    <Card style={{ padding: S(3), gap: S(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2) }}>
        <TextInput ref={input} defaultValue="" onChangeText={setDraft} onSubmitEditing={add} submitBehavior="submit" returnKeyType="done" placeholder="Add a task" placeholderTextColor={c.faint} maxLength={300}
          style={[T.body, { flex: 1, color: c.text, minHeight: 48, paddingHorizontal: S(3), borderRadius: R.input, backgroundColor: c.sunken }]} accessibilityLabel="New task" />
        <Button kind="primary" label="Add" small onPress={add} disabled={!draft.trim()} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: S(2) }}>
        {chip(today, 'Today')}
        {chip(tomorrow, 'Tomorrow')}
        {custom ? chip(due, fmtDate(due!), () => setPicking(true)) : chip('__pick', 'Pick date…', () => setPicking(true))}
        {chip(null, 'No date')}
      </ScrollView>
      {picking ? <DateTimePicker value={due ? Planner.parse(due) : new Date()} mode="date" minimumDate={new Date()} onChange={(e, d) => { setPicking(false); if (e.type === 'set' && d) setDue(Planner.ymd(d)); }} /> : null}
    </Card>
  );
}

function TaskEditor({ task, onClose, inline }: { task: Task; onClose: () => void; inline?: boolean }) {
  const { c } = useTheme();
  const classes = useStore((s) => s.planner.classes);
  const mode = useStore((s) => s.settings.classLabel);
  const [d, setD] = useState<Task>(task);
  const empty = !d.text.trim();
  const save = () => { if (empty) return; setPlanner((p) => ({ tasks: p.tasks.map((x) => (x.id === d.id ? { ...d, text: d.text.trim() } : x)) })); onClose(); };
  const del = () => Alert.alert('Delete this task?', d.text, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { setPlanner((p) => ({ tasks: p.tasks.filter((x) => x.id !== d.id) })); onClose(); } }]);
  const content = (
    <>
      <Field label="What" value={d.text} onChangeText={(text) => setD({ ...d, text })} multiline maxLength={300} style={{ minHeight: 72, textAlignVertical: 'top', paddingTop: S(3) }} />
      {empty ? <Txt kind="small" style={{ color: c.bad }}>A task needs some words.</Txt> : null}
      <DateField label="Due" value={d.due} onChange={(due) => setD({ ...d, due })} clearable placeholder="No date" />
      <View style={{ gap: S(2) }}>
        <Txt kind="small" muted>Class</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(2) }}>
          {[null, ...classes].map((k) => {
            const on = (k?.id ?? null) === d.classId;
            return (
              <Pressable key={k?.id ?? 'none'} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setD({ ...d, classId: k?.id ?? null })}
                style={{ height: 36, paddingHorizontal: S(3), borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: S(1), backgroundColor: on ? c.accentSoft : 'transparent', borderWidth: 1, borderColor: on ? c.accent : c.line }}>
                {k ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k.color }} /> : null}
                <Txt kind="small" style={{ color: on ? c.accentText : c.text, fontWeight: '500' }}>{k ? classLabel(k, mode) : 'None'}</Txt>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: S(3), paddingTop: S(2) }}>
        <Button kind="danger" icon="trash" label="Delete" onPress={del} />
        <View style={{ flex: 1 }} />
        <Button kind="primary" label="Save" onPress={save} disabled={empty} />
      </View>
    </>
  );
  if (!inline) return content;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S(5), paddingTop: S(8), gap: S(4) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt kind="title" style={{ flex: 1 }}>Task</Txt>
        <IconButton icon="close" label="Close" onPress={onClose} />
      </View>
      {content}
    </ScrollView>
  );
}
