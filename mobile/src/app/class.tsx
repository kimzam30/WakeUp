// Add or edit a class: a modal with its own Cancel / Save. Asks before throwing away unsaved changes.
// Phones: full screen. Tablets: a centred dialog over the timetable, with the weekly sessions in two columns.
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation, usePreventRemove } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Field, IconButton, Segmented, Txt, useLayout } from '../ui/kit';
import { TimeField } from '../ui/DateField';
import { Icon } from '../ui/Icon';
import { CLASS_COLORS, R, S, useTheme } from '../ui/theme';
import { Planner, Schema } from '../lib/shared';
import { getState, setPlanner, useStore } from '../lib/store';
import { DAYS, classLabel } from '../lib/format';
import type { ClassItem, Session } from '../lib/types';

const blankSession = (): Session => ({ id: Schema.newId('s'), kind: 'lecture', section: '', day: 1, start: '09:00', end: '11:00', venue: '', mode: 'campus', link: '' });

export default function ClassEditor() {
  const { c } = useTheme();
  const { wide, twoCol, height } = useLayout();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useStore((s) => s.planner.classes.find((k) => k.id === id));
  const [d, setD] = useState<ClassItem>(() => existing ? structuredClone(existing) : {
    id: Schema.newId('k'), code: '', name: '', icon: Planner.ICON_KEYS[getState().planner.classes.length % Planner.ICON_KEYS.length],
    color: CLASS_COLORS[getState().planner.classes.length % CLASS_COLORS.length], sessions: [blankSession()],
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = !saved && JSON.stringify(d) !== JSON.stringify(existing ?? null) && (!!d.code.trim() || !!d.name.trim() || !!existing);
  usePreventRemove(dirty, ({ data }) => {
    Alert.alert('Discard changes?', 'Your changes to this class aren’t saved yet.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => nav.dispatch(data.action) },
    ]);
  });
  const mode = useStore((s) => s.settings.classLabel);
  const set = (p: Partial<ClassItem>) => { setD({ ...d, ...p }); setError(''); };
  const setS = (i: number, p: Partial<Session>) => set({ sessions: d.sessions.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  const save = () => {
    if (!d.code.trim() && !d.name.trim()) { setError('Give the class a code or a name.'); return; }
    const bad = d.sessions.find((s) => s.end <= s.start);
    if (bad) { setError('Each session has to end after it starts.'); return; }
    const course = (d.course ?? '').trim(); const notes = (d.notes ?? '').trim();
    if (course && !/^https:\/\/\S+$/i.test(course)) { setError('The Ebwise link has to start with https://'); return; }
    const { course: _c, notes: _n, ...rest } = d; // empty ones aren't kept
    const clean = { ...rest, code: d.code.trim(), name: d.name.trim() || d.code.trim(), ...(course ? { course } : null), ...(notes ? { notes } : null) };
    setPlanner((p) => ({ classes: existing ? p.classes.map((k) => (k.id === d.id ? clean : k)) : [...p.classes, clean] }));
    setSaved(true);
    setTimeout(() => router.back(), 0);
  };
  const remove = () => Alert.alert(`Delete ${classLabel(d, mode)}?`, 'Its sessions and one-off changes go too. Tasks linked to it are kept.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => {
      const sids = new Set(d.sessions.map((s) => s.id));
      setPlanner((p) => ({ classes: p.classes.filter((k) => k.id !== d.id), changes: p.changes.filter((x) => !sids.has(x.sessionId ?? '') && x.classId !== d.id), tasks: p.tasks.map((t) => (t.classId === d.id ? { ...t, classId: null } : t)) }));
      setSaved(true); setTimeout(() => router.back(), 0);
    } },
  ]);

  const body = (
    <View style={{ flex: wide ? undefined : 1, backgroundColor: c.bg, width: '100%', maxWidth: wide ? (twoCol ? 920 : 680) : undefined, maxHeight: wide ? height * 0.92 : undefined, borderRadius: wide ? R.card + 6 : 0, borderCurve: 'continuous', overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: wide ? S(3) : insets.top + S(2), paddingHorizontal: S(2), paddingBottom: S(2), borderBottomWidth: 1, borderColor: c.line, gap: S(1) }}>
        <IconButton icon="close" label="Cancel" onPress={() => router.back()} />
        <Txt kind="title" style={{ flex: 1 }}>{existing ? 'Edit class' : 'New class'}</Txt>
        <Button kind="primary" label="Save" small onPress={save} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: wide ? S(6) : S(4), paddingBottom: (wide ? 0 : insets.bottom) + S(10), alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: twoCol ? 880 : 680, gap: S(5) }}>
          {error ? <View style={{ padding: S(3), borderRadius: R.input, backgroundColor: c.badBg }}><Txt style={{ color: c.bad }}>{error}</Txt></View> : null}
          <View style={{ flexDirection: 'row', gap: S(3), flexWrap: 'wrap' }}>
            <Field label="Code" value={d.code} onChangeText={(code) => set({ code })} placeholder="e.g. CSP1123" maxLength={20} autoCapitalize="characters" autoFocus={!existing} />
            <Field label="Name" value={d.name} onChangeText={(name) => set({ name })} placeholder="e.g. Mini IT Project" maxLength={80} style={{ flexBasis: 220 }} />
          </View>
          <Field label="Ebwise course (optional)" value={d.course ?? ''} onChangeText={(course) => set({ course })} placeholder="Paste the course page's link" keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={2000} />
          <View style={{ gap: S(2) }}>
            <Txt kind="small" muted>Colour</Txt>
            <View style={{ flexDirection: 'row', gap: S(2), flexWrap: 'wrap' }}>
              {CLASS_COLORS.map((col) => (
                <Pressable key={col} accessibilityRole="radio" accessibilityState={{ checked: d.color === col }} accessibilityLabel={`Colour ${col}`} onPress={() => set({ color: col })}
                  style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: col, alignItems: 'center', justifyContent: 'center', borderWidth: d.color === col ? 3 : 0, borderColor: c.bg, outlineWidth: d.color === col ? 2 : 0, outlineColor: col }}>
                  {d.color === col ? <Icon name="check" size={18} color="#fff" stroke={2.2} /> : null}
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ gap: S(2) }}>
            <Txt kind="small" muted>Icon</Txt>
            <View style={{ flexDirection: 'row', gap: S(2), flexWrap: 'wrap' }}>
              {Planner.ICON_KEYS.map((k) => (
                <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: d.icon === k }} accessibilityLabel={`Icon ${k}`} onPress={() => set({ icon: k })}
                  style={{ width: 44, height: 44, borderRadius: R.input, alignItems: 'center', justifyContent: 'center', backgroundColor: d.icon === k ? `${d.color}26` : c.sunken, borderWidth: 1, borderColor: d.icon === k ? d.color : c.line }}>
                  <Icon name={k} size={20} color={d.icon === k ? d.color : c.muted} />
                </Pressable>
              ))}
            </View>
          </View>
          <Txt kind="headline">Every week</Txt>
          <View style={{ flexDirection: twoCol ? 'row' : 'column', flexWrap: 'wrap', gap: S(4) }}>
          {d.sessions.map((s, i) => (
            <Card key={s.id} style={{ padding: S(4), gap: S(3), flexBasis: twoCol ? '48%' : undefined, flexGrow: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2), flexWrap: 'wrap' }}>
                <Segmented label="Kind" value={s.kind} onChange={(kind) => setS(i, { kind })} options={[['lecture', 'Lecture'], ['tutorial', 'Tutorial'], ['lab', 'Lab']]} />
                <View style={{ flex: 1 }} />
                {d.sessions.length > 1 ? <IconButton icon="trash" label="Remove this session" onPress={() => set({ sessions: d.sessions.filter((_, j) => j !== i) })} /> : null}
              </View>
              {/* all seven days share the row, so none is cut off (audit M4) */}
              <View style={{ flexDirection: 'row', gap: S(1) }}>
                {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                  <Pressable key={day} accessibilityRole="radio" accessibilityState={{ checked: s.day === day }} accessibilityLabel={DAYS[day]} onPress={() => setS(i, { day })}
                    style={{ flex: 1, minWidth: 0, height: 40, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: s.day === day ? c.accent : c.sunken, borderWidth: 1, borderColor: s.day === day ? c.accent : c.line }}>
                    <Txt kind="small" numberOfLines={1} style={{ color: s.day === day ? '#fff' : c.text, fontWeight: '600' }}>{DAYS[day]}</Txt>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: S(3) }}>
                <TimeField label="Starts" value={s.start} onChange={(start) => setS(i, { start })} />
                <TimeField label="Ends" value={s.end} onChange={(end) => setS(i, { end })} />
              </View>
              <View style={{ flexDirection: 'row', gap: S(3), flexWrap: 'wrap' }}>
                <Field label="Section" value={s.section} onChangeText={(section) => setS(i, { section })} placeholder="e.g. TC1L" maxLength={20} autoCapitalize="characters" />
                <Segmented label="Where" value={s.mode} onChange={(m) => setS(i, { mode: m })} options={[['campus', 'On campus'], ['online', 'Online']]} />
              </View>
              {s.mode === 'online'
                ? <Field label="Meeting link" value={s.link} onChangeText={(link) => setS(i, { link })} placeholder="https://teams.microsoft.com/…" keyboardType="url" autoCapitalize="none" />
                : <Field label="Venue" value={s.venue} onChangeText={(venue) => setS(i, { venue })} placeholder="e.g. CQAR1001" maxLength={80} />}
            </Card>
          ))}
          </View>
          <Button icon="plus" label="Add another session" onPress={() => set({ sessions: [...d.sessions, { ...blankSession(), kind: 'tutorial' }] })} />
          <Field label="Notes (optional)" value={d.notes ?? ''} onChangeText={(notes) => set({ notes })} placeholder="Group members, lecturer, room, anything to remember" multiline maxLength={2000}
            style={{ minHeight: 104, paddingTop: S(3), paddingBottom: S(3), textAlignVertical: 'top' }} />
          {existing ? <Button kind="danger" icon="trash" label="Delete class" onPress={remove} /> : null}
        </View>
      </ScrollView>
    </View>
  );
  if (!wide) return <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>{body}</KeyboardAvoidingView>;
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <Pressable accessibilityLabel="Cancel" onPress={() => router.back()} style={{ flex: 1, backgroundColor: c.scrim, alignItems: 'center', justifyContent: 'center', padding: S(6) }}>
        <Pressable onPress={() => {}} style={{ width: '100%', alignItems: 'center' }}>{body}</Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
