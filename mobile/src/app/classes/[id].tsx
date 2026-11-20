// The class page (v3, I5, option A): one place per class. The next meeting with Join, one-tap actions (Join, its Ebwise
// course, Focus, Add task), what's due for it (exams first by date), your notes, the weekly sessions and this week's
// focus time. Opened from Timetable, Today, a task's class and a class reminder. Phones: a full page; tablets: a panel
// on the right, so the timetable stays in view. One-off changes to a date stay in the timetable's sheet.
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '../../lib/haptics';
import { focus, weekStats } from '../../lib/focus';
import { Planner, QuickAddCore, Schema } from '../../lib/shared';
import { allApps, getState, newTab, openApp, setPlanner, useStore } from '../../lib/store';
import { DAYS, KIND, classLabel, countdown, fmtDate, fmtTime } from '../../lib/format';
import { toggleTask } from '../../ui/actions';
import { Button, Card, Empty, Head, IconButton, Line, Txt, useLayout } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { R, S, useTheme } from '../../ui/theme';
import type { Task } from '../../lib/types';

const close = () => (router.canGoBack() ? router.back() : router.replace('/timetable'));
const openLink = (url: string) => Linking.openURL(url).catch(() => {});
const hours = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

// The course opens in WakeUp's own Ebwise when it's an Ebwise page and you have Ebwise (a tab of it, reused if open);
// anything else opens in your browser.
function openCourse(url: string) {
  const s = getState();
  const ebwise = allApps(s.settings).find((a) => a.id === 'ebwise');
  let same = false; try { same = !!ebwise && new URL(url).host === new URL(ebwise.url).host; } catch { /* bad link */ }
  if (!same) { openLink(url); return; }
  const tabs = s.tabs.ebwise ?? [];
  const tab = tabs.find((t) => t.url === url);
  if (tab) openApp(tab.id);
  else if (tabs.length < 4) newTab('ebwise', url); // a fifth page of Ebwise is the limit (lib/store.ts)
  else { openLink(url); return; }
  router.navigate('/apps');
}

export default function ClassPage() {
  const { c } = useTheme();
  const { wide } = useLayout();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const planner = useStore((s) => s.planner);
  const mode = useStore((s) => s.settings.classLabel);
  const weekStart = useStore((s) => s.settings.weekStart);
  const cls = planner.classes.find((k) => k.id === id);
  const [now] = useState(() => Date.now());
  const next = useMemo(() => (cls ? Planner.upcoming(planner, new Date(now), 28).find((o) => o.classId === cls.id) : undefined), [planner, cls, now]);
  const due = useMemo(() => planner.tasks.filter((t) => t.classId === id && !t.done)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || Number(!!b.exam) - Number(!!a.exam)), [planner.tasks, id]);
  const week = weekStats().byClass.find(([k]) => k === id)?.[1];
  const [draft, setDraft] = useState('');
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const today = Planner.ymd(new Date(now));

  const shell = (body: React.ReactNode) => (wide ? (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <Pressable accessibilityLabel="Close the class page" onPress={close} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} />
      <View style={{ width: 440, backgroundColor: c.bg, borderLeftWidth: 1, borderColor: c.line, paddingTop: insets.top }}>{body}</View>
    </View>
  ) : <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>{body}</View>);

  if (!cls) {
    return shell(<>
      <View style={{ flexDirection: 'row', padding: S(1) }}><IconButton icon="back" label="Back" onPress={close} /></View>
      <Empty icon="cal" title="This class is gone" body="It was deleted, maybe on another device." />
    </>);
  }

  const joinLink = next?.mode === 'online' && next.link ? next.link : cls.sessions.find((x) => x.mode === 'online' && x.link)?.link;
  const sessions = [...cls.sessions].sort((a, b) => ((a.day - weekStart + 7) % 7) - ((b.day - weekStart + 7) % 7) || a.start.localeCompare(b.start));
  const when = next ? (next.date === today ? 'Today' : next.date === Planner.addDays(today, 1) ? 'Tomorrow' : fmtDate(next.date)) : '';
  const add = () => {
    const text = draft.trim(); if (!text) return;
    const q = QuickAddCore.parse(text, { today, weekStart, classes: planner.classes, nextMeeting: (k, t) => Planner.nextMeeting(planner, k, t) });
    const t: Task = { id: Schema.newId('t'), text: q.text || text, done: false, due: q.due ?? null, classId: cls.id, created: Date.now(), doneAt: null, ...(q.exam ? { exam: true, at: q.at, venue: q.venue } : null) };
    setPlanner((p) => ({ tasks: [t, ...p.tasks] }));
    setDraft(''); input.current?.clear(); haptic('light');
  };

  return shell(<>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: S(1), minHeight: 52 }}>
      <IconButton icon={wide ? 'close' : 'back'} label={wide ? 'Close' : 'Back'} onPress={close} />
      <View style={{ flex: 1 }} />
      <IconButton icon="edit" label="Edit class" onPress={() => router.push({ pathname: '/class', params: { id: cls.id } })} />
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S(4), paddingTop: S(1), paddingBottom: insets.bottom + S(10), gap: S(6) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3) }}>
        <View style={{ width: 6, alignSelf: 'stretch', minHeight: 44, borderRadius: 3, backgroundColor: cls.color }} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt kind="title" selectable>{cls.code || cls.name}</Txt>
          {cls.code && cls.name !== cls.code ? <Txt muted selectable>{cls.name}</Txt> : null}
        </View>
      </View>

      <Card style={{ gap: S(2), padding: S(4) }}>
        {next ? <>
          <Txt kind="tiny" muted style={{ fontWeight: '600', letterSpacing: 0.6 }}>{`NEXT · ${when.toUpperCase()}`}</Txt>
          <Txt kind="headline" style={{ fontSize: 20 }}>{`${fmtTime(next.start)} – ${fmtTime(next.end)}`}</Txt>
          <Txt muted>{[KIND[next.kind], next.section, next.mode === 'online' ? 'Online' : next.venue || 'Venue not set'].filter(Boolean).join(' · ')}</Txt>
          <Txt kind="small" muted>{[Planner.notesLine(next.notes), next.startsAt > now ? `in ${countdown(next.startsAt - now)}` : 'on now'].filter(Boolean).join(' · ')}</Txt>
        </> : <Txt muted>No meetings in the next four weeks.</Txt>}
      </Card>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Action icon="video" label="Join" onPress={joinLink ? () => openLink(joinLink) : null} />
        <Action icon="book" label="Ebwise" onPress={cls.course ? () => openCourse(cls.course!) : () => router.push({ pathname: '/class', params: { id: cls.id } })} />
        <Action icon="target" label="Focus" onPress={() => { focus.start(null, cls.id); router.push('/focus'); }} />
        <Action icon="plus" label="Add task" onPress={() => input.current?.focus()} />
      </View>

      <View>
        <Head title="Due" count={due.length} />
        {due.map((t, i) => (
          <Line key={t.id} first={!i}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: false }} accessibilityLabel={`Mark ${t.text} done`} onPress={() => toggleTask(t)} hitSlop={10}
              style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.lineStrong }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt style={{ fontWeight: '500' }}>{t.text}</Txt>
              <View style={{ flexDirection: 'row', gap: S(2), alignItems: 'center' }}>
                {t.exam ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="exam" size={14} color={c.accentText} /><Txt kind="small" style={{ color: c.accentText, fontWeight: '600' }}>Exam</Txt></View> : null}
                <Txt kind="small" muted>{[t.due ? fmtDate(t.due) : 'No date', t.at ? fmtTime(t.at) : '', t.venue].filter(Boolean).join(' · ')}</Txt>
              </View>
            </View>
          </Line>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2), marginTop: S(2), minHeight: 48, paddingHorizontal: S(3), borderRadius: R.input, backgroundColor: c.sunken }}>
          <Icon name="plus" size={18} color={c.faint} />
          <TextInput ref={input} value={draft} onChangeText={setDraft} onSubmitEditing={add} returnKeyType="done" blurOnSubmit={false}
            placeholder={`Add a task for ${classLabel(cls, mode)}`} placeholderTextColor={c.faint} accessibilityLabel={`Add a task for ${classLabel(cls, mode)}`}
            style={{ flex: 1, color: c.text, fontSize: 16, minHeight: 48 }} />
          {draft.trim() ? <Button small kind="primary" label="Add" onPress={add} /> : null}
        </View>
      </View>

      <View style={{ gap: S(2) }}>
        <Head title="Notes" />
        {cls.notes ? <Card style={{ padding: S(4) }}><Txt selectable style={{ lineHeight: 22 }}>{cls.notes}</Txt></Card>
          : <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/class', params: { id: cls.id } })}><Txt muted>Group members, lecturer, room… Add notes in Edit class.</Txt></Pressable>}
      </View>

      <View>
        <Head title="Every week" />
        {sessions.map((x, i) => (
          <Line key={x.id} first={!i}>
            <Txt kind="small" muted style={{ width: 40, fontWeight: '600' }}>{DAYS[x.day].toUpperCase()}</Txt>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt style={{ fontWeight: '500' }}>{`${KIND[x.kind]} · ${fmtTime(x.start)} – ${fmtTime(x.end)}`}</Txt>
              <Txt kind="small" muted>{[x.section, x.mode === 'online' ? 'Online' : x.venue || 'Venue not set'].filter(Boolean).join(' · ')}</Txt>
            </View>
            {x.mode === 'online' && x.link ? <Button small label="Join" onPress={() => openLink(x.link)} /> : null}
          </Line>
        ))}
      </View>

      <View style={{ gap: S(2) }}>
        <Head title="Focus this week" />
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: S(3), padding: S(4) }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt kind="headline" style={{ fontSize: 20 }}>{week ? hours(week.mins) : 'None yet'}</Txt>
            <Txt kind="small" muted>{week ? `${week.sessions} session${week.sessions === 1 ? '' : 's'} on ${classLabel(cls, mode)}` : `Focus on ${classLabel(cls, mode)} and it counts here`}</Txt>
          </View>
          <Button small kind="primary" icon="target" label="Focus" onPress={() => { focus.start(null, cls.id); router.push('/focus'); }} />
        </Card>
      </View>

      <View>
        <Head title="Ebwise course" />
        {cls.course
          ? <Line first onPress={() => openCourse(cls.course!)}><Txt style={{ flex: 1, fontWeight: '500' }} numberOfLines={1}>{`${classLabel(cls, mode)} on Ebwise`}</Txt><Icon name="chevR" size={18} color={c.muted} /></Line>
          : <Line first onPress={() => router.push({ pathname: '/class', params: { id: cls.id } })}><Txt muted style={{ flex: 1 }}>Paste its course link in Edit class</Txt><Icon name="chevR" size={18} color={c.muted} /></Line>}
      </View>
    </ScrollView>
  </>);
}

// one of the four round buttons under the next meeting
function Action({ icon, label, onPress }: { icon: string; label: string; onPress: (() => void) | null }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !onPress }} disabled={!onPress} onPress={() => { haptic('tap'); onPress?.(); }}
      style={({ pressed }) => ({ width: 76, alignItems: 'center', gap: S(1), opacity: onPress ? 1 : 0.4, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
      <View style={{ width: 52, height: 52, borderRadius: 18, borderCurve: 'continuous', backgroundColor: c.sunken, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={22} color={c.accentText} /></View>
      <Txt kind="small" style={{ fontWeight: '500' }}>{label}</Txt>
    </Pressable>
  );
}
