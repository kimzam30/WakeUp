// What's on in one class meeting (a quiz, a test, a consultation, a presentation) or what to bring or do.
// Add it to this meeting or to the class's next one ("bring a calculator next week"). The evening before, and in
// the class reminder, WakeUp says so.
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { haptic } from '../lib/haptics';
import { Planner, Schema } from '../lib/shared';
import { setPlanner, useStore } from '../lib/store';
import { fmtDate } from '../lib/format';
import type { Change, NoteTag, Occurrence } from '../lib/types';
import { Button, Chip, IconButton, Pick, Segmented, Txt } from './kit';
import { R, S, T, useTheme } from './theme';

const TAGS = Object.entries(Planner.NOTE_TAGS) as [NoteTag, [string, '' | 'bad' | 'info' | 'warn' | 'good']][];
const HINT: Record<NoteTag, string> = {
  quiz: 'Details (optional), e.g. chapters 1–3', test: 'Details (optional), e.g. midterm, 1 hour', consultation: 'Details (optional), e.g. bring your draft',
  presentation: 'Details (optional), e.g. group 3 presents', bring: 'What to bring or do, e.g. calculator', other: 'e.g. read chapter 3 before class',
};

export function ClassNotes({ o }: { o: Occurrence }) {
  const { c } = useTheme();
  const planner = useStore((s) => s.planner);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [tag, setTag] = useState<NoteTag>('quiz');
  const [text, setText] = useState('');
  const [when, setWhen] = useState<'this' | 'next'>('this');
  const [said, setSaid] = useState('');
  // the same class's next meeting after this one
  const next = useMemo(() => {
    for (let i = 1; i <= 28; i++) { const d = Planner.addDays(o.date, i); const hit = Planner.occurrencesOn(d, planner).find((x) => x.classId === o.classId && x.live); if (hit) return hit; }
    return null;
  }, [planner, o.date, o.classId]);
  const needsText = tag === 'bring' || tag === 'other';
  const add = () => {
    const note = text.trim(); if (needsText && !note) { input.current?.focus(); return; }
    const at = when === 'next' && next ? next : o;
    setPlanner((p) => ({ changes: [...p.changes, { id: Schema.newId('x'), type: 'note', sessionId: null, classId: o.classId, ref: at.ref, date: at.date, tag, note, toDate: null, start: null, end: null, venue: '', link: '' } as Change] }));
    setText(''); input.current?.clear(); setWhen('this'); haptic('light');
    setSaid(at === o ? '' : `Added to ${fmtDate(at.date)}.`);
  };
  const remove = (id: string) => setPlanner((p) => ({ changes: p.changes.filter((x) => x.id !== id) }));
  return (
    <View style={{ gap: S(2), marginBottom: S(2) }}>
      <Txt kind="small" muted>In this class</Txt>
      {(o.notes ?? []).map((n) => (
        <View key={n.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S(2), minHeight: 40 }}>
          <Chip label={Planner.NOTE_TAGS[n.tag ?? 'other'][0]} tone={Planner.NOTE_TAGS[n.tag ?? 'other'][1] || undefined} />
          <Txt style={{ flex: 1 }}>{n.note}</Txt>
          <IconButton icon="close" label={`Remove ${Planner.noteText(n)}`} onPress={() => remove(n.id)} size={16} />
        </View>
      ))}
      <View style={{ gap: S(2), padding: S(3), borderRadius: R.card, borderWidth: 1, borderStyle: 'dashed', borderColor: c.lineStrong }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: S(2) }}>
          {TAGS.map(([k, [l]]) => <Pick key={k} label={l} on={tag === k} onPress={() => setTag(k)} />)}
        </ScrollView>
        <TextInput ref={input} defaultValue="" onChangeText={setText} onSubmitEditing={add} submitBehavior="blurAndSubmit" returnKeyType="done" maxLength={200}
          placeholder={HINT[tag]} placeholderTextColor={c.faint} accessibilityLabel="Note"
          style={[T.body, { color: c.text, minHeight: 44, paddingHorizontal: S(3), borderRadius: R.input, backgroundColor: c.sunken }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2), flexWrap: 'wrap' }}>
          {next ? <Segmented label="For" value={when} onChange={setWhen} options={[['this', 'This class'], ['next', `Next · ${fmtDate(next.date)}`]]} /> : null}
          <View style={{ flex: 1 }} />
          <Button kind="primary" small label="Add" onPress={add} />
        </View>
        {said ? <Txt kind="small" style={{ color: c.good }}>{said}</Txt> : null}
      </View>
    </View>
  );
}
