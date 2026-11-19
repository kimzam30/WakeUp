// Tasks: the focus timer and quick add at the top (pick a class to make a task due its next class), grouped Late / Today / Coming up / Someday, done ones folded away.
// Tap the circle (or swipe the row right) to finish a task, swipe left to delete; tap the task to edit it: a sheet on phones, a panel beside the list on a
// landscape tablet. Typing in quick add only re-renders the quick-add box, not the list.
import { memo, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { haptic } from '../../lib/haptics';
import { Button, ClassTag, Divider, Empty, Field, Head, IconButton, Page, Pick, Row, Sheet, Switch, Txt, useLayout } from '../../ui/kit';
import { FocusCard } from '../../ui/FocusCard';
import { focus, useFocus } from '../../lib/focus';
import { DateField, TimeField } from '../../ui/DateField';
import Animated from 'react-native-reanimated';
import { SwipeRow, enter, leave, move } from '../../ui/motion';
import { Icon } from '../../ui/Icon';
import { R, S, T, useTheme } from '../../ui/theme';
import { Planner, QuickAddCore, Schema } from '../../lib/shared';
import { setPlanner, useStore } from '../../lib/store';
import { useToday } from '../../lib/hooks';
import { classLabel, fmtDate, fmtTime } from '../../lib/format';
import type { ClassItem, Task } from '../../lib/types';
import { deleteTask, toggleTask } from '../../ui/actions';

const GROUPS: [string, string][] = [['overdue', 'Late'], ['today', 'Today'], ['upcoming', 'Coming up'], ['someday', 'Someday']];
const dueText = (due: string, today: string): string => (due < today ? `Late · ${fmtDate(due)}` : due === today ? 'Today' : due === Planner.addDays(today, 1) ? 'Tomorrow' : fmtDate(due));

export default function Tasks() {
  const { c } = useTheme();
  const { twoCol } = useLayout();
  const tasks = useStore((s) => s.planner.tasks);
  const classes = useStore((s) => s.planner.classes);
  const mode = useStore((s) => s.settings.classLabel);
  const today = useToday();
  // the Due today widget's + opens Tasks with ?add=1: quick add takes the keyboard
  const { add } = useLocalSearchParams<{ add?: string }>();
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

  const toggle = toggleTask;
  const remove = (t: Task) => { if (editId === t.id) setEditId(null); deleteTask(t); };
  // opening a task's sheet lets go of the quick-add box first, so closing the sheet doesn't bring the keyboard back (audit M2)
  const open = (id: string) => { const f = TextInput.State.currentlyFocusedInput(); if (f) TextInput.State.blurTextInput(f); Keyboard.dismiss(); setEditId(id); };
  const list = (items: Task[]) => <View>{items.map((t, i) => <TaskRow key={t.id} t={t} first={!i} cls={t.classId ? byId.get(t.classId) : undefined} mode={mode} today={today} picked={twoCol && t.id === editId} onToggle={toggle} onOpen={open} onDelete={remove} />)}</View>;

  const body = (
    <Page max={twoCol ? 720 : 760} gap={S(7)}>
      <Txt kind="display">Tasks</Txt>
      <FocusCard />
      <QuickAdd today={today} focusKey={add} />
      {!tasks.length ? <Empty icon="tasks" title="Nothing to do yet" body="Add assignments, readings and reminders. Tasks with a date show up on Today, and you get a reminder on the day they’re due." /> : null}
      {groups.map(({ k, title, list: items }) => (
        <View key={k} style={{ gap: S(1) }}>
          <Head title={title} count={items.length} tone={k === 'overdue' ? c.bad : undefined} />
          {list(items)}
        </View>
      ))}
      {done.length ? (
        <View style={{ gap: S(2) }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDone }} onPress={() => setShowDone(!showDone)} style={{ flexDirection: 'row', alignItems: 'center', gap: S(1), minHeight: 44 }}>
            <Txt kind="title" style={{ fontSize: 20, lineHeight: 26, color: c.muted }}>{`Done  ${done.length}`}</Txt><Icon name={showDone ? 'chevD' : 'chevR'} size={18} color={c.muted} />
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

const TaskRow = memo(function TaskRow({ t, first, cls, mode, today, picked, onToggle, onOpen, onDelete }: { t: Task; first: boolean; cls?: ClassItem; mode: 'code' | 'name' | 'both'; today: string; picked: boolean; onToggle: (t: Task) => void; onOpen: (id: string) => void; onDelete: (t: Task) => void }) {
  const { c } = useTheme();
  return (
    <Animated.View entering={enter} exiting={leave} layout={move}>
    <SwipeRow done={t.done} onDone={() => onToggle(t)} onDelete={() => onDelete(t)}>
    <View style={{ backgroundColor: picked ? c.accentSoft : c.bg }}>
      {first ? null : <Divider inset={48} />}
      <Row onPress={() => onOpen(t.id)} style={{ paddingLeft: 0, paddingRight: S(1) }}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={t.done ? 'Mark not done' : 'Mark done'} onPress={() => onToggle(t)} hitSlop={8}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: t.done ? c.good : t.due && t.due < today ? c.bad : c.lineStrong, backgroundColor: t.done ? c.good : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {t.done ? <Icon name="check" size={14} color="#fff" stroke={2.2} /> : null}
          </View>
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt muted={t.done} style={{ textDecorationLine: t.done ? 'line-through' : 'none' }}>{t.text}</Txt>
          {cls || (t.due && !t.done) ? <View style={{ flexDirection: 'row', gap: S(3), flexWrap: 'wrap', alignItems: 'center' }}>
            {t.exam ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="exam" size={14} color={c.accentText} /><Txt kind="small" style={{ color: c.accentText, fontWeight: '600' }}>{['Exam', t.at ? fmtTime(t.at) : '', t.venue].filter(Boolean).join(' · ')}</Txt></View> : null}
            {t.due && !t.done ? <Txt kind="small" style={{ color: t.due < today ? c.bad : c.muted, fontWeight: t.due < today ? '600' : '400', fontVariant: ['tabular-nums'] }}>{dueText(t.due, today)}</Txt> : null}
            {cls ? <ClassTag color={cls.color} label={classLabel(cls, mode)} /> : null}
          </View> : null}
        </View>
      </Row>
    </View>
    </SwipeRow>
    </Animated.View>
  );
});

// The quick-add box keeps its own state, so typing doesn't redraw the whole list
function QuickAdd({ today, focusKey }: { today: string; focusKey?: string }) {
  const { c } = useTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [draft, setDraft] = useState('');
  const [due, setDue] = useState<string | null>(today);
  const [picking, setPicking] = useState(false);
  const [classId, setClassId] = useState<string | null>(null);
  const [exam, setExam] = useState(false);
  useEffect(() => { if (!focusKey) return; const t = setTimeout(() => input.current?.focus(), 350); return () => clearTimeout(t); }, [focusKey]);
  const planner = useStore((s) => s.planner);
  const mode = useStore((s) => s.settings.classLabel);
  const weekStart = useStore((s) => s.settings.weekStart);
  // what the words say ("lab report fri CSP1123"); they win over the chips below
  const q = useMemo(() => (draft.trim() ? QuickAddCore.parse(draft, { today, weekStart, classes: planner.classes, nextMeeting: (id, t) => Planner.nextMeeting(planner, id, t) }) : null), [draft, today, weekStart, planner]);
  const hint = q ? q.found.map((f) => (f.kind === 'due' ? (q.due ? fmtDate(q.due) : '') : f.kind === 'venue' ? `@${f.label}` : f.label)).filter(Boolean).join(' · ') : '';
  const cls = classId ? planner.classes.find((k) => k.id === classId) : undefined;
  const nextDate = useMemo(() => (cls ? Planner.nextMeeting(planner, cls.id, today) : null), [cls, planner, today]);
  const tomorrow = Planner.addDays(today, 1);
  const add = () => {
    if (!q) return;
    const k = q.classId !== undefined ? q.classId : cls ? cls.id : null;
    const isExam = q.exam || exam;
    setPlanner((p) => ({ tasks: [{ id: Schema.newId('t'), text: q.text, done: false, due: q.due !== undefined ? q.due : due, classId: k, created: Date.now(), doneAt: null, ...(isExam ? { exam: true, at: q.at, venue: q.venue } : null) }, ...p.tasks] }));
    setDraft(''); input.current?.clear(); haptic('light');
    // the next task starts fresh: no class, due today (audit M1)
    setClassId(null); setDue(today); setExam(false);
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
  const custom = due && due !== today && due !== tomorrow && due !== nextDate;
  return (
    <View style={{ gap: S(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2), paddingLeft: S(1), paddingRight: S(1) + 2, minHeight: 56, borderRadius: R.card, borderCurve: 'continuous', backgroundColor: c.sunken }}>
        <View style={{ paddingLeft: S(2) }}><Icon name="plus" size={20} color={c.faint} /></View>
        <TextInput ref={input} defaultValue="" onChangeText={setDraft} onSubmitEditing={add} submitBehavior="submit" returnKeyType="done" placeholder="Try “lab report fri CSP1123”" placeholderTextColor={c.faint} maxLength={300}
          style={[T.body, { flex: 1, color: c.text, minHeight: 48, paddingHorizontal: S(1) }]} accessibilityLabel="New task" />
        <Button kind="primary" label="Add" small onPress={add} disabled={!draft.trim()} style={{ alignSelf: 'center' }} />
      </View>
      {hint ? <Txt kind="small" style={{ color: c.accentText, marginTop: -S(1), paddingHorizontal: S(3) }}>{`Will add: ${hint}`}</Txt> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: S(2) }}>
        {chip(today, nextDate === today ? 'Today · next class' : 'Today')}
        {chip(tomorrow, nextDate === tomorrow ? 'Tomorrow · next class' : 'Tomorrow')}
        {custom ? chip(due, fmtDate(due!), () => setPicking(true)) : chip('__pick', 'Pick date…', () => setPicking(true))}
        {chip(null, 'No date')}
        {nextDate && nextDate !== today && nextDate !== tomorrow ? chip(nextDate, `Next class · ${fmtDate(nextDate)}`) : null}
      </ScrollView>
      {planner.classes.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: S(2) }}>
          <Pick label="Exam" icon="exam" on={exam} onPress={() => setExam(!exam)} />
          <View style={{ width: 1, alignSelf: 'stretch', marginVertical: 6, backgroundColor: c.line }} />
          <Pick label="No class" on={!cls} onPress={() => { if (due === nextDate) setDue(today); setClassId(null); }} />
          {planner.classes.map((k) => <Pick key={k.id} label={classLabel(k, mode)} dot={k.color} on={cls?.id === k.id} onPress={() => setClassId(k.id)} />)}
        </ScrollView>
      ) : null}
      {picking ? <DateTimePicker value={due ? Planner.parse(due) : new Date()} mode="date" minimumDate={new Date()} onChange={(e, d) => { setPicking(false); if (e.type === 'set' && d) setDue(Planner.ymd(d)); }} /> : null}
    </View>
  );
}

function TaskEditor({ task, onClose, inline }: { task: Task; onClose: () => void; inline?: boolean }) {
  const { c } = useTheme();
  const classes = useStore((s) => s.planner.classes);
  const mode = useStore((s) => s.settings.classLabel);
  const [d, setD] = useState<Task>(task);
  const fs = useFocus();
  const empty = !d.text.trim();
  const save = () => { if (empty) return; setPlanner((p) => ({ tasks: p.tasks.map((x) => (x.id === d.id ? { ...d, text: d.text.trim() } : x)) })); onClose(); };
  const del = () => { onClose(); deleteTask(task); };
  const content = (
    <>
      <Field label="What" value={d.text} onChangeText={(text) => setD({ ...d, text })} multiline maxLength={300} style={{ minHeight: 72, textAlignVertical: 'top', paddingTop: S(3) }} />
      {empty ? <Txt kind="small" style={{ color: c.bad }}>A task needs some words.</Txt> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3) }}>
        <View style={{ flex: 1 }}><Txt kind="headline" style={{ fontWeight: '500' }}>Exam or test</Txt><Txt kind="small" muted>Shows a countdown on Today.</Txt></View>
        <Switch label="Exam or test" value={!!d.exam} onChange={(on) => setD(on ? { ...d, exam: true, at: d.at ?? null, venue: d.venue ?? '' } : (({ exam: _e, at: _a, venue: _v, ...rest }) => rest)(d))} />
      </View>
      <DateField label={d.exam ? 'Date' : 'Due'} value={d.due} onChange={(due) => setD({ ...d, due })} clearable placeholder="No date" />
      {d.exam ? (
        <View style={{ flexDirection: 'row', gap: S(3), flexWrap: 'wrap' }}>
          <View style={{ width: 140, gap: S(1) }}><Txt kind="small" muted>Starts</Txt><TimeField value={d.at || '09:00'} onChange={(at) => setD({ ...d, at })} /></View>
          <Field label="Where" value={d.venue ?? ''} onChangeText={(venue) => setD({ ...d, venue })} placeholder="e.g. DTC Hall" maxLength={80} />
        </View>
      ) : null}
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
      {!d.done ? <Button icon="target" label={fs.phase !== 'idle' && fs.taskId === d.id ? 'Focusing on this task' : 'Focus on this task'} disabled={fs.phase !== 'idle' && fs.taskId === d.id} onPress={() => { focus.start(d.id); onClose(); router.push('/focus'); }} /> : null}
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
