// A class's open tasks, inside its details: tick them off, or add one that's due the next time the class meets.
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { haptic } from '../lib/haptics';
import { Planner, Schema } from '../lib/shared';
import { setPlanner, useStore } from '../lib/store';
import { fmtDate } from '../lib/format';
import { useToday } from '../lib/hooks';
import type { ClassItem } from '../lib/types';
import { Icon } from './Icon';
import { Txt } from './kit';
import { R, S, T, useTheme } from './theme';

export function ClassTasks({ cls }: { cls: ClassItem }) {
  const { c } = useTheme();
  const today = useToday();
  const planner = useStore((s) => s.planner);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [draft, setDraft] = useState('');
  const open = useMemo(() => planner.tasks.filter((t) => t.classId === cls.id && !t.done).sort((a, b) => ((a.due ?? '9') < (b.due ?? '9') ? -1 : 1)), [planner.tasks, cls.id]);
  const next = useMemo(() => Planner.nextMeeting(planner, cls.id, today), [planner, cls.id, today]);
  const add = () => {
    const text = draft.trim(); if (!text) return;
    setPlanner((p) => ({ tasks: [{ id: Schema.newId('t'), text, done: false, due: next, classId: cls.id, created: Date.now(), doneAt: null }, ...p.tasks] }));
    setDraft(''); input.current?.clear(); haptic('light');
  };
  const finish = (id: string) => { haptic('success'); setPlanner((p) => ({ tasks: p.tasks.map((t) => (t.id === id ? { ...t, done: true, doneAt: Date.now() } : t)) })); };
  return (
    <View style={{ gap: S(1), marginBottom: S(2) }}>
      <View style={{ flexDirection: 'row', gap: S(2) }}>
        <Txt kind="small" muted>Tasks for this class</Txt>
        {open.length ? <Txt kind="small" style={{ color: c.accentText, fontWeight: '600' }}>{String(open.length)}</Txt> : null}
      </View>
      {open.slice(0, 6).map((t) => (
        <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S(2), minHeight: 44 }}>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: false }} accessibilityLabel={`Mark done: ${t.text}`} onPress={() => finish(t.id)} hitSlop={10}
            style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.lineStrong }} />
          <Txt numberOfLines={1} style={{ flex: 1 }}>{t.text}</Txt>
          {t.due ? <Txt kind="small" style={{ color: t.due < today ? c.bad : c.muted }}>{fmtDate(t.due)}</Txt> : null}
        </View>
      ))}
      {open.length > 6 ? <Txt kind="small" faint>{`and ${open.length - 6} more in Tasks`}</Txt> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2) }}>
        <Icon name="plus" size={16} color={c.faint} />
        <TextInput ref={input} defaultValue="" onChangeText={setDraft} onSubmitEditing={add} submitBehavior="blurAndSubmit" returnKeyType="done" maxLength={300}
          placeholder={next ? `Add a task, due next class (${fmtDate(next)})` : 'Add a task for this class'} placeholderTextColor={c.faint} accessibilityLabel="Add a task for this class"
          style={[T.body, { flex: 1, color: c.text, minHeight: 44, paddingHorizontal: S(3), borderRadius: R.input, backgroundColor: c.sunken }]} />
      </View>
    </View>
  );
}
