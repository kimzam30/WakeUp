// Timetable: a list of the coming two weeks (default on phones) or a week grid (default on tablets). Swipe the
// grid sideways to change the week when the days fit on screen.
// Tap a class for its details and one-off changes (cancel this date, online today): a sheet on phones, a panel
// beside the week on a landscape tablet. Edit or add classes in a modal. The Flip cover screen shows the list only.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Chip, Divider, Empty, Field, IconButton, Page, Pick, Row, Segmented, Sheet, Txt, useLayout } from '../../ui/kit';
import { ClassIcon } from '../../ui/ClassBits';
import { SwipePager } from '../../ui/motion';
import { DateField, TimeField } from '../../ui/DateField';
import { Icon } from '../../ui/Icon';
import { R, S, STATUS, useTheme } from '../../ui/theme';
import { Planner, Schema } from '../../lib/shared';
import { setPlanner, useStore } from '../../lib/store';
import { DAYS, KIND, MONTHS, classLabel, classSub, fmtDate, fmtTime } from '../../lib/format';
import { ClassTasks } from '../../ui/ClassTasks';
import { useToday } from '../../lib/hooks';
import type { Change, Occurrence, Semester } from '../../lib/types';

const openLink = (url: string) => Linking.openURL(url).catch(() => {});

export default function Timetable() {
  const { c } = useTheme();
  const { size, wide, twoCol } = useLayout();
  const planner = useStore((s) => s.planner);
  const weekStart = useStore((s) => s.settings.weekStart);
  const mode = useStore((s) => s.settings.classLabel);
  const cover = size === 'cover';
  // the view follows the window (phone → list, tablet → week) until you pick one yourself
  const [pick, setPick] = useState<'list' | 'week' | null>(null);
  const view = cover ? 'list' : pick ?? (wide ? 'week' : 'list');
  const today = useToday();
  const [first, setFirst] = useState(() => Planner.startOfWeek(today, weekStart));
  useEffect(() => { setFirst(Planner.startOfWeek(today, weekStart)); }, [weekStart, today]);
  const [sel, setSel] = useState<Occurrence | null>(null);
  const [semOpen, setSemOpen] = useState(false);
  const panel = twoCol && view === 'week'; // details beside the grid instead of a sheet

  const days = useMemo(() => Array.from({ length: view === 'week' ? 7 : 14 }, (_, i) => Planner.addDays(view === 'week' ? first : today, i)), [view, first, today]);
  const byDay = useMemo(() => days.map((d) => ({ d, list: Planner.occurrencesOn(d, planner) })), [days, planner]);
  const end = Planner.addDays(first, 6);
  const range = `${Planner.parse(first).getDate()} ${MONTHS[Planner.parse(first).getMonth()]} – ${Planner.parse(end).getDate()} ${MONTHS[Planner.parse(end).getMonth()]}`;
  const wk = Planner.weekOf(view === 'week' ? first : today, planner.semester, weekStart);

  const header = cover ? (
    <View style={{ gap: S(1) }}>
      <Txt kind="title">Timetable</Txt>
      <Txt kind="small" muted>{[wk?.week ? `Week ${wk.week}` : '', 'Open on the main screen to edit'].filter(Boolean).join(' · ')}</Txt>
    </View>
  ) : (
    <View style={{ gap: S(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2) }}>
        <View style={{ flex: 1 }}>
          <Txt kind="display">Timetable</Txt>
          <Txt kind="small" muted>{[wk?.week ? `Week ${wk.week}` : '', view === 'week' ? range : 'Next two weeks', planner.semester.name].filter(Boolean).join(' · ')}</Txt>
        </View>
        <Button kind="primary" icon="plus" label={size === 'compact' ? 'Add' : 'Add class'} small onPress={() => router.push('/class')} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2), flexWrap: 'wrap' }}>
        <Segmented label="View" value={view} onChange={setPick} options={[['list', 'List'], ['week', 'Week']]} />
        {view === 'week' ? <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton icon="chevL" label="Previous week" onPress={() => setFirst(Planner.addDays(first, -7))} />
          <Button kind="plain" small label="This week" onPress={() => setFirst(Planner.startOfWeek(today, weekStart))} />
          <IconButton icon="chevR" label="Next week" onPress={() => setFirst(Planner.addDays(first, 7))} />
        </View> : null}
        <View style={{ flex: 1 }} />
        <Button kind="plain" small icon="edit" label="Semester" onPress={() => setSemOpen(true)} />
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {!planner.classes.length ? (
        <Page>{header}<Empty icon="cal" title="Add your classes once" body="Each class repeats every week for the semester, skipping breaks. You can cancel, move or put a single date online, or add a replacement." action={cover ? undefined : <Button kind="primary" icon="plus" label="Add class" onPress={() => router.push('/class')} />} /></Page>
      ) : view === 'list' ? (
        <Page max={cover ? 420 : 760}>
          {header}
          {byDay.filter((x) => x.list.length || x.d === today).slice(0, cover ? 2 : undefined).map(({ d, list }) => (
            <View key={d} style={{ gap: S(2) }}>
              <Txt kind="tiny" muted>{d === today ? 'TODAY' : d === Planner.addDays(today, 1) ? 'TOMORROW' : fmtDate(d).toUpperCase()}</Txt>
              <Card>
                {list.length ? list.map((o, i) => (
                  <View key={o.key}>
                    {i ? <Divider inset={64} /> : null}
                    <Row onPress={() => setSel(o)}>
                      <ClassIcon cls={o.cls} />
                      <View style={{ flex: 1, opacity: o.live ? 1 : 0.55 }}>
                        <Txt kind="headline" numberOfLines={1} style={{ textDecorationLine: o.live ? 'none' : 'line-through' }}>{classLabel(o.cls, mode)}{classSub(o.cls, mode) ? <Txt muted>{`  ${classSub(o.cls, mode)}`}</Txt> : null}</Txt>
                        <Txt kind="small" muted numberOfLines={2}>{[`${fmtTime(o.start)}–${fmtTime(o.end)}`, KIND[o.kind], o.section, o.mode === 'online' ? 'Online' : o.venue].filter(Boolean).join(' · ')}</Txt>
                      </View>
                      {STATUS[o.status] ? <Chip label={STATUS[o.status][0]} tone={STATUS[o.status][1]} /> : null}
                    </Row>
                  </View>
                )) : <Row><Txt muted>No classes today.</Txt></Row>}
              </Card>
            </View>
          ))}
        </Page>
      ) : panel ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1 }}><WeekGrid header={header} byDay={byDay} onPick={setSel} picked={sel?.key} onSwipe={(d) => setFirst((f) => Planner.addDays(f, 7 * d))} /></View>
          {sel ? <SidePanel o={sel} onClose={() => setSel(null)} /> : null}
        </View>
      ) : (
        <WeekGrid header={header} byDay={byDay} onPick={setSel} onSwipe={(d) => setFirst((f) => Planner.addDays(f, 7 * d))} />
      )}
      {panel ? null : <OccurrenceSheet o={sel} onClose={() => setSel(null)} />}
      <SemesterSheet open={semOpen} onClose={() => setSemOpen(false)} semester={planner.semester} />
    </View>
  );
}

// Classes that overlap share their column: each gets a lane, and every class in a cluster gets the same lane count.
function lanes(list: Occurrence[]) {
  const sorted = [...list].sort((a, b) => Planner.mins(a.start) - Planner.mins(b.start));
  const out: { o: Occurrence; lane: number; of: number }[] = [];
  let cluster: typeof out = []; let ends: number[] = []; let clusterEnd = -1;
  const close = () => { const n = Math.max(1, ends.length); for (const x of cluster) x.of = n; out.push(...cluster); cluster = []; ends = []; };
  for (const o of sorted) {
    const s0 = Planner.mins(o.start); const e0 = Planner.mins(o.end);
    if (s0 >= clusterEnd) close();
    let lane = ends.findIndex((e) => e <= s0); if (lane < 0) { lane = ends.length; ends.push(e0); } else ends[lane] = e0;
    cluster.push({ o, lane, of: 1 }); clusterEnd = Math.max(clusterEnd, e0);
  }
  close();
  return out;
}

// Week grid: hours down the side, one column per day. On phones the columns scroll sideways.
function WeekGrid({ header, byDay, onPick, picked, onSwipe }: { header: ReactNode; byDay: { d: string; list: Occurrence[] }[]; onPick: (o: Occurrence) => void; picked?: string; onSwipe: (dir: 1 | -1) => void }) {
  const { c } = useTheme();
  const { size } = useLayout();
  const mode = useStore((s) => s.settings.classLabel);
  const today = useToday();
  const [cardW, setCardW] = useState(0);
  const shown = byDay.filter((x, i) => i < 5 || x.list.length); // weekends only when something's on
  const all = shown.flatMap((x) => x.list);
  const from = Math.min(8, ...all.map((o) => Math.floor(Planner.mins(o.start) / 60)));
  const to = Math.max(18, ...all.map((o) => Math.ceil(Planner.mins(o.end) / 60)));
  const HOUR = 64; const gutter = 44;
  // columns fill the card's measured width; on narrow windows they keep a readable minimum and scroll sideways
  const col = Math.max(size === 'compact' ? 128 : 112, // wide enough for a whole status chip (“Replacement”)
     cardW ? (cardW - 2 - gutter) / shown.length : 0);
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  // when the days don't fit they scroll sideways; when they do, swiping sideways changes the week
  const overflow = !cardW || gutter + col * shown.length + 2 > cardW + 1;
  return (
    <Page max={1400}>
      {header}
      <SwipePager onSwipe={onSwipe} enabled={!overflow}>
      <Card>
        <View onLayout={(e) => setCardW(e.nativeEvent.layout.width)} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={overflow}>
          <View>
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: c.line }}>
              <View style={{ width: gutter }} />
              {shown.map(({ d }) => {
                const dt = Planner.parse(d); const on = d === today;
                return (
                  <View key={d} style={{ width: col, paddingVertical: S(2), paddingHorizontal: S(2), borderLeftWidth: 1, borderColor: c.line }}>
                    <Txt kind="small" muted>{DAYS[dt.getDay()]}</Txt>
                    <View style={{ alignSelf: 'flex-start', paddingHorizontal: on ? 6 : 0, borderRadius: R.chip, backgroundColor: on ? c.accent : 'transparent' }}>
                      <Txt kind="headline" style={{ color: on ? '#fff' : c.text, fontVariant: ['tabular-nums'] }}>{dt.getDate()}</Txt>
                    </View>
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', height: (to - from) * HOUR }}>
              <View style={{ width: gutter }}>
                {Array.from({ length: to - from }, (_, i) => <Txt key={i} kind="small" faint style={{ position: 'absolute', top: i * HOUR + 2, right: 6, fontSize: 11 }}>{fmtTime(`${String(from + i).padStart(2, '0')}:00`)}</Txt>)}
              </View>
              {shown.map(({ d, list }) => (
                <View key={d} style={{ width: col, borderLeftWidth: 1, borderColor: c.line }}>
                  {Array.from({ length: to - from }, (_, i) => <View key={i} style={{ position: 'absolute', top: i * HOUR, left: 0, right: 0, height: 1, backgroundColor: c.line }} />)}
                  {lanes(list).map(({ o, lane, of }) => {
                    const top = ((Planner.mins(o.start) - from * 60) / 60) * HOUR; const h = ((Planner.mins(o.end) - Planner.mins(o.start)) / 60) * HOUR;
                    const w = (col - 6) / of;
                    const sub = classSub(o.cls, mode);
                    const chip = STATUS[o.status]; const extra = chip && h >= 44 ? 26 : 0; // the status chip sits at the bottom of the block, like desktop
                    const dashed = o.status !== 'normal' && o.status !== 'online';
                    return (
                      <Pressable key={o.key} accessibilityRole="button" accessibilityLabel={`${classLabel(o.cls, mode)} ${fmtTime(o.start)}${chip ? `, ${chip[0]}` : ''}`} onPress={() => onPick(o)}
                        style={({ pressed }) => ({ position: 'absolute', top: top + 2, left: 3 + lane * w, width: w - (of > 1 ? 2 : 0), height: h - 4, borderRadius: 8, borderCurve: 'continuous', padding: S(2), gap: 1, overflow: 'hidden',
                          backgroundColor: `${o.cls.color}${pressed || picked === o.key ? '33' : '1f'}`, borderLeftWidth: 3, borderLeftColor: o.cls.color, opacity: o.live ? 1 : 0.5,
                          ...(dashed ? { borderWidth: 1, borderLeftWidth: 3, borderStyle: 'dashed' as const, borderColor: o.live ? o.cls.color : c.line } : null),
                          outlineWidth: picked === o.key ? 2 : 0, outlineColor: o.cls.color })}>
                        <Txt kind="small" numberOfLines={1} style={{ fontWeight: '700', textDecorationLine: o.live ? 'none' : 'line-through' }}>{classLabel(o.cls, mode)}</Txt>
                        {sub && h > 60 + extra ? <Txt kind="small" numberOfLines={1} style={{ fontWeight: '500', fontSize: 12 }}>{sub}</Txt> : null}
                        {h > 44 + extra ? <Txt kind="small" muted numberOfLines={1} style={{ fontSize: 12 }}>{[KIND[o.kind], o.section].filter(Boolean).join(' · ')}</Txt> : null}
                        {h > 76 + extra ? <Txt kind="small" muted numberOfLines={1} style={{ fontSize: 12 }}>{o.mode === 'online' ? 'Online' : o.venue}</Txt> : null}
                        {chip && h >= 44 ? <View style={{ marginTop: 'auto', maxWidth: '100%' }}><Chip label={chip[0]} tone={chip[1]} small={col < 132} /></View> : null}
                      </Pressable>
                    );
                  })}
                  {d === today && nowMins > from * 60 && nowMins < to * 60 ? <View style={{ position: 'absolute', left: 0, right: 0, top: ((nowMins - from * 60) / 60) * HOUR, height: 2, backgroundColor: c.bad }} /> : null}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </Card>
      </SwipePager>
    </Page>
  );
}

function OccurrenceSheet({ o, onClose }: { o: Occurrence | null; onClose: () => void }) {
  const mode = useStore((s) => s.settings.classLabel);
  if (!o) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  return (
    <Sheet open onClose={onClose} title={classLabel(o.cls, mode)} footer={<Button kind="secondary" icon="edit" label="Edit class" onPress={() => { onClose(); router.push({ pathname: '/class', params: { id: o.classId } }); }} />}>
      <OccurrenceBody key={o.key} o={o} onDone={onClose} />
    </Sheet>
  );
}

// Landscape tablets: the same details in a panel beside the week, so the grid stays in view
function SidePanel({ o, onClose }: { o: Occurrence; onClose: () => void }) {
  const { c } = useTheme();
  const mode = useStore((s) => s.settings.classLabel);
  return (
    <View style={{ width: 360, borderLeftWidth: 1, borderColor: c.line, backgroundColor: c.raised }}>
      <ScrollView contentContainerStyle={{ padding: S(5), paddingTop: S(8), gap: S(4) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2) }}>
          <Txt kind="title" style={{ flex: 1 }} numberOfLines={2}>{classLabel(o.cls, mode)}</Txt>
          <IconButton icon="close" label="Close details" onPress={onClose} />
        </View>
        <OccurrenceBody key={o.key} o={o} onDone={onClose} />
        <Button kind="secondary" icon="edit" label="Edit class" onPress={() => router.push({ pathname: '/class', params: { id: o.classId } })} />
      </ScrollView>
    </View>
  );
}

const isLink = (v: string) => /^https:\/\/\S+$/i.test(v.trim());
const NO_CHANGE = { sessionId: null, classId: null, toDate: null, start: null, end: null, venue: '', link: '', note: '' };
type Form = { date: string | null; start: string; end: string; venue: string; link: string; note: string };

// The same choices as the desktop app: cancel, online, move or replace one date, and undo any of them.
function OccurrenceBody({ o, onDone }: { o: Occurrence; onDone: () => void }) {
  const { c } = useTheme();
  const mode = useStore((s) => s.settings.classLabel);
  const [sub, setSub] = useState<null | 'online' | 'move' | 'replace'>(null);
  const [f, setF] = useState<Form>({ date: o.date, start: o.start, end: o.end, venue: '', link: '', note: '' });
  const [err, setErr] = useState('');
  const set = (patch: Partial<Form>) => { setF((x) => ({ ...x, ...patch })); setErr(''); };
  // one change per class session per date; replacements are separate entries
  const setChange = (change: Partial<Change> | null) => {
    setPlanner((p) => {
      const rest = p.changes.filter((x) => x.id !== o.change?.id && !(x.sessionId && x.sessionId === o.sessionId && x.date === o.date && x.type !== 'replacement'));
      return { changes: change ? [...rest, { id: Schema.newId('x'), ...NO_CHANGE, date: o.date, ...change } as Change] : rest };
    });
    onDone();
  };
  const open = (kind: 'online' | 'move' | 'replace') => {
    setSub(kind); setErr('');
    setF(kind === 'move' ? { date: Planner.addDays(o.date, 7), start: o.start, end: o.end, venue: '', link: '', note: '' }
      : kind === 'replace' ? { date: Planner.addDays(o.date, 1), start: o.start, end: o.end, venue: o.venue, link: '', note: '' }
        : { date: o.date, start: o.start, end: o.end, venue: '', link: o.link || '', note: '' });
  };
  const submit = () => {
    if (sub === 'online') {
      if (f.link && !isLink(f.link)) { setErr('Use a full https:// meeting link.'); return; }
      setChange({ type: 'online', sessionId: o.sessionId, link: f.link.trim() }); return;
    }
    const e = !f.date ? 'Pick a date.' : !f.start || !f.end || f.end <= f.start ? 'The end time has to be after the start.' : f.link && !isLink(f.link) ? 'Use a full https:// meeting link.' : '';
    if (e) { setErr(e); return; }
    const when = { start: f.start, end: f.end, venue: f.venue.trim(), link: f.link.trim() };
    if (sub === 'move') setChange({ type: 'moved', sessionId: o.sessionId, toDate: f.date, ...when });
    else {
      setPlanner((p) => ({ changes: [...p.changes, { id: Schema.newId('x'), ...NO_CHANGE, type: 'replacement', classId: o.classId, date: f.date!, ...when, note: f.note.trim() } as Change] }));
      onDone();
    }
  };
  // copy a regular session's time, venue and link, on that weekday (from the date already in the form)
  const copySession = (x: Occurrence['cls']['sessions'][number]) => {
    const d = f.date || o.date;
    set({ start: x.start, end: x.end, venue: x.venue || '', link: x.link || '', date: Planner.addDays(d, (x.day - Planner.weekday(d) + 7) % 7) });
  };
  const planner = useStore((s) => s.planner);
  const places = useMemo(() => Planner.venues(planner).slice(0, 8), [planner]);
  const clash = useMemo(() => {
    if (!sub || sub === 'online' || !f.date || !f.start || !f.end) return '';
    const hit = Planner.clashes(planner, f.date, f.start, f.end, sub === 'move' ? o.key : null).filter((x) => !(sub === 'replace' && x.key === o.key && f.date === o.date));
    return hit.length ? `Clashes with ${hit.map((x) => `${classLabel(x.cls, mode)} ${fmtTime(x.start)}–${fmtTime(x.end)}`).join(', ')}` : '';
  }, [sub, f.date, f.start, f.end, planner, o.key, o.date, mode]);
  const note = o.status === 'cancelled' ? 'This class is cancelled on this date.'
    : o.status === 'moved' ? `Moved to ${o.toDate ? fmtDate(o.toDate) : 'another day'}${o.change?.start ? `, ${fmtTime(o.change.start)}` : ''}.`
      : o.status === 'moved-in' ? `Moved here from ${o.fromDate ? fmtDate(o.fromDate) : 'another day'}.`
        : o.status === 'replacement' ? `Replacement class${o.note ? `: ${o.note}` : '.'}` : o.status === 'online' ? 'Online for this date only.' : '';
  const changeable = !!o.sessionId && (o.status === 'normal' || o.status === 'online');
  return (
    <>
      <View style={{ flexDirection: 'row', gap: S(3), alignItems: 'center' }}>
        <ClassIcon cls={o.cls} size={44} />
        <View style={{ flex: 1 }}>
          {o.cls.name && o.cls.name !== classLabel(o.cls, mode) ? <Txt kind="headline">{o.cls.name}</Txt> : null}
          <Txt muted>{[KIND[o.kind], o.section].filter(Boolean).join(' · ')}</Txt>
        </View>
        {STATUS[o.status] ? <Chip label={STATUS[o.status][0]} tone={STATUS[o.status][1]} /> : null}
      </View>
      <Card>
        <Row><Icon name="cal" color={c.muted} size={18} /><Txt>{fmtDate(o.date)}</Txt></Row><Divider inset={48} />
        <Row><Icon name="clock" color={c.muted} size={18} /><Txt style={{ fontVariant: ['tabular-nums'] }}>{`${fmtTime(o.start)} – ${fmtTime(o.end)}`}</Txt></Row><Divider inset={48} />
        <Row><Icon name={o.mode === 'online' ? 'video' : 'pin'} color={c.muted} size={18} /><Txt selectable style={{ flex: 1 }}>{o.mode === 'online' ? 'Online' : o.venue || 'Venue not set'}</Txt></Row>
      </Card>
      {note ? <Txt muted>{note}</Txt> : null}
      {o.link && o.live ? <Button kind="primary" icon="video" label="Join meeting" onPress={() => openLink(o.link)} /> : null}
      {sub ? (
        <View style={{ gap: S(3) }}>
          <Txt kind="headline">{sub === 'online' ? 'Online this time' : sub === 'move' ? 'Postpone or move' : 'Add a replacement class'}</Txt>
          {sub !== 'online' ? <>
            {o.cls.sessions.length ? (
              <View style={{ gap: S(1) }}>
                <Txt kind="small" muted>Same time as</Txt>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: S(2) }}>
                  {o.cls.sessions.map((x) => <Pick key={x.id} label={`${DAYS[x.day]} ${fmtTime(x.start)}–${fmtTime(x.end)} · ${KIND[x.kind]}`} on={f.start === x.start && f.end === x.end && !!f.date && Planner.weekday(f.date) === x.day} onPress={() => copySession(x)} />)}
                </ScrollView>
              </View>
            ) : null}
            <DateField label={sub === 'move' ? 'New date' : 'Date'} value={f.date} onChange={(date) => set({ date })} />
            <View style={{ flexDirection: 'row', gap: S(3) }}>
              <View style={{ flex: 1 }}><TimeField label="Starts" value={f.start} onChange={(start) => set({ start })} /></View>
              <View style={{ flex: 1 }}><TimeField label="Ends" value={f.end} onChange={(end) => set({ end })} /></View>
            </View>
            {clash ? <View style={{ flexDirection: 'row', gap: S(2), alignItems: 'center' }}><Icon name="info" size={16} color={c.warn} /><Txt kind="small" style={{ color: c.warn, flex: 1 }}>{clash}</Txt></View> : null}
            <Field label="Venue" value={f.venue} onChangeText={(venue) => set({ venue })} placeholder="Same as usual" maxLength={80} />
            {places.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: S(2) }}>
                {places.map((v) => <Pick key={v} icon="pin" label={v} on={f.venue === v} onPress={() => set({ venue: v })} />)}
              </ScrollView>
            ) : null}
          </> : null}
          <Field label={sub === 'online' ? 'Meeting link (optional)' : 'Meeting link (if online)'} value={f.link} onChangeText={(link) => set({ link })} placeholder="https://…" keyboardType="url" autoCapitalize="none" autoCorrect={false} />
          {sub === 'replace' ? <Field label="Note" value={f.note} onChangeText={(n) => set({ note: n })} placeholder="e.g. replaces the cancelled lecture on Tuesday" maxLength={200} /> : null}
          {err ? <Txt kind="small" style={{ color: c.bad }}>{err}</Txt> : null}
          <View style={{ flexDirection: 'row', gap: S(2), flexWrap: 'wrap' }}>
            <Button kind="primary" small label={sub === 'online' ? 'Make it online' : sub === 'move' ? 'Move class' : 'Add replacement'} onPress={submit} />
            <Button kind="plain" small label="Cancel" onPress={() => { setSub(null); setErr(''); }} />
          </View>
        </View>
      ) : (
        <View style={{ gap: S(2) }}>
          <ClassTasks cls={o.cls} />
          {changeable ? <Txt kind="small" muted>Just this date</Txt> : null}
          <View style={{ flexDirection: 'row', gap: S(2), flexWrap: 'wrap' }}>
            {o.change && o.status !== 'replacement' && o.status !== 'moved-in' ? <Button small icon="reload" label="Undo this change" onPress={() => setChange(null)} /> : null}
            {o.status === 'replacement' ? <Button small kind="danger" icon="trash" label="Remove replacement" onPress={() => setChange(null)} /> : null}
            {o.status === 'moved-in' ? <Button small icon="reload" label="Undo move" onPress={() => setChange(null)} /> : null}
            {changeable ? <>
              {o.status === 'normal' ? <Button small icon="ban" label="Cancelled" onPress={() => setChange({ type: 'cancelled', sessionId: o.sessionId })} /> : null}
              {o.status === 'normal' ? <Button small icon="video" label="Online" onPress={() => open('online')} /> : null}
              <Button small icon="cal" label="Postpone / move…" onPress={() => open('move')} />
            </> : null}
            <Button small icon="plus" label="Add replacement…" onPress={() => open('replace')} />
          </View>
        </View>
      )}
    </>
  );
}

function SemesterSheet({ open, onClose, semester }: { open: boolean; onClose: () => void; semester: Semester }) {
  const [d, setD] = useState(semester);
  const [seen, setSeen] = useState(open);
  if (open !== seen) { setSeen(open); if (open) setD(semester); }
  const { c } = useTheme();
  const problem = d.start && d.end && d.end < d.start ? 'The semester ends before it starts.'
    : d.breaks.some((b) => b.end < b.start) ? 'A break ends before it starts.'
    : d.start && d.end && d.breaks.some((b) => b.start > d.end! || b.end < d.start!) ? 'A break falls outside the semester.' : '';
  return (
    <Sheet open={open} onClose={onClose} title="Semester" footer={<><Button kind="plain" label="Cancel" onPress={onClose} /><Button kind="primary" label="Save" disabled={!!problem} onPress={() => { setPlanner({ semester: d }); onClose(); }} /></>}>
      <Txt muted>Classes repeat every week between these dates and skip breaks. Week numbers come from the start date.</Txt>
      {problem ? <Txt kind="small" style={{ color: c.bad }}>{problem}</Txt> : null}
      <Field label="Name" value={d.name} onChangeText={(name) => setD({ ...d, name })} placeholder="e.g. Trimester 2530" maxLength={60} />
      <View style={{ flexDirection: 'row', gap: S(3), flexWrap: 'wrap' }}>
        <DateField label="Starts" value={d.start} onChange={(start) => setD({ ...d, start })} clearable />
        <DateField label="Ends" value={d.end} onChange={(end) => setD({ ...d, end })} clearable />
      </View>
      <Txt kind="headline">Breaks</Txt>
      {d.breaks.map((b, i) => (
        <View key={i} style={{ gap: S(2), flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Name" value={b.label} onChangeText={(label) => setD({ ...d, breaks: d.breaks.map((x, j) => (j === i ? { ...x, label } : x)) })} maxLength={40} />
          <DateField label="From" value={b.start} onChange={(start) => setD({ ...d, breaks: d.breaks.map((x, j) => (j === i ? { ...x, start: start || x.start } : x)) })} />
          <DateField label="To" value={b.end} onChange={(end) => setD({ ...d, breaks: d.breaks.map((x, j) => (j === i ? { ...x, end: end || x.end } : x)) })} />
          <IconButton icon="trash" label="Remove break" onPress={() => setD({ ...d, breaks: d.breaks.filter((_, j) => j !== i) })} />
        </View>
      ))}
      <Button small icon="plus" label="Add a break" onPress={() => { const t = Planner.today(); setD({ ...d, breaks: [...d.breaks, { label: 'Mid-semester break', start: t, end: Planner.addDays(t, 6) }] }); }} />
    </Sheet>
  );
}
