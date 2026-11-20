// Today, the Cards version of draft D (docs/DESIGN.md): the date and greeting with your avatar (Settings) at the
// top right, then Now in big type with no box ("Then …" and Join), Due today, This week, Today's classes and your
// apps, in the order you chose (Settings → Appearance; it syncs). Lists are flat with hairlines; only the app
// tiles are outlined. On the Z Flip's cover screen it shrinks to Now and what's due; on a landscape tablet it
// splits into two columns.
import { useEffect, useMemo, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { haptic } from '../../lib/haptics';
import { Button, Caption, Chip, ClassTag, Columns, Head, Line, Page, Txt, useLayout } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { AppTile } from '../../ui/AppTile';
import { Avatar } from '../../ui/Avatar';
import { dismissToast, toast } from '../../ui/Toast';
import { toggleTask } from '../../ui/actions';
import { R, S, STATUS, useTheme } from '../../ui/theme';
import { Look, Planner } from '../../lib/shared';
import { allApps, openApp, useStore } from '../../lib/store';
import { cancelUpdate, installUpdate, skipUpdate, useUpdate } from '../../lib/updater';
import { DAYS_LONG, KIND, MONTHS, classLabel, classSub, countdown, fmtDate, fmtTime, greeting } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { MOBILE_TODAY } from '../../ui/SettingsSections';
import type { Task } from '../../lib/types';

const openLink = (url: string) => Linking.openURL(url).catch(() => {});
const mins = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

export default function Today() {
  const { c } = useTheme();
  const { size, twoCol } = useLayout();
  const nowMs = useNow();
  const now = new Date(nowMs);
  const planner = useStore((s) => s.planner);
  const settings = useStore((s) => s.settings);
  const sync = useStore((s) => s.sync);
  const mode = settings.classLabel;
  const today = Planner.ymd(now);
  const week = Planner.weekOf(today, planner.semester, settings.weekStart);
  // the next two classes only change when the minute does or the timetable does
  const [next, then] = useMemo(() => Planner.upcoming(planner, new Date(nowMs), 7), [planner, nowMs]);
  const isNow = !!next && next.startsAt <= nowMs;
  const classTasks = next ? planner.tasks.filter((t) => t.classId === next.classId && !t.done).length : 0;
  const todays = Planner.occurrencesOn(today, planner);
  const due = planner.tasks.filter((t) => !t.done && !t.exam && t.due && t.due <= today).sort((a, b) => (a.due! < b.due! ? -1 : 1));
  const soon = planner.tasks.filter((t) => !t.done && !t.exam && t.due && t.due > today && t.due <= Planner.addDays(today, 7)).sort((a, b) => (a.due! < b.due! ? -1 : 1));
  // exams and tests in the next 60 days, soonest first, with a countdown
  const exams = planner.tasks.filter((t) => t.exam && !t.done && t.due && t.due >= today && t.due <= Planner.addDays(today, 60)).sort((a, b) => ((a.due! + (a.at ?? '')) < (b.due! + (b.at ?? '')) ? -1 : 1));
  const cover = size === 'cover';
  const weekText = week?.week ? `Week ${week.week}${week.break ? ` · ${week.break}` : ''}` : week?.before ? `Semester starts in ${week.days} day${week.days === 1 ? '' : 's'}` : week?.after ? 'Semester finished' : '';
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Now: big type, no box. A thin bar in the class colour shows how far through it you are.
  const nowPart = next ? (
    <View style={{ gap: S(2) }}>
      <Caption>{isNow ? 'Now' : `Next · in ${countdown(next.startsAt - nowMs)}`}</Caption>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${classLabel(next.cls, mode)}`} onPress={() => router.push({ pathname: '/classes/[id]', params: { id: next.classId } })} style={{ gap: S(1) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3) }}>
          <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: next.cls.color }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt kind="display" numberOfLines={2} style={cover ? { fontSize: 24, lineHeight: 30 } : undefined}>{classLabel(next.cls, mode)}</Txt>
            {classSub(next.cls, mode) ? <Txt muted numberOfLines={1}>{classSub(next.cls, mode)}</Txt> : null}
          </View>
        </View>
      </Pressable>
      <Txt muted style={{ fontVariant: ['tabular-nums'] }}>
        {[`${next.date === today ? '' : `${fmtDate(next.date)} · `}${fmtTime(next.start)} – ${fmtTime(next.end)}`, KIND[next.kind], next.mode === 'online' ? 'Online' : next.venue || 'Venue not set'].filter(Boolean).join(' · ')}
      </Txt>
      {isNow ? (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: c.sunken, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${Math.round(Math.min(1, Math.max(0, (nowMin - mins(next.start)) / Math.max(1, mins(next.end) - mins(next.start)))) * 100)}%`, backgroundColor: next.cls.color }} />
        </View>
      ) : null}
      {next.notes?.length ? <Txt kind="small" style={{ color: c.warn, fontWeight: '600' }}>{Planner.notesLine(next.notes)}</Txt> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S(2), marginTop: S(1) }}>
        {next.link ? <Button kind="primary" icon="video" label="Join" onPress={() => openLink(next.link)} small={cover} /> : null}
        {STATUS[next.status] ? <Chip label={STATUS[next.status][0]} tone={STATUS[next.status][1]} /> : null}
        {classTasks && !cover ? <Button kind="secondary" small icon="tasks" label={`${classTasks} task${classTasks === 1 ? '' : 's'}`} onPress={() => router.navigate('/tasks')} /> : null}
      </View>
      {then && !cover ? <Txt kind="small" muted>{`Then ${classLabel(then.cls, mode)} at ${fmtTime(then.start)}${then.date === next.date ? '' : `, ${then.date === Planner.addDays(today, 1) ? 'tomorrow' : fmtDate(then.date)}`}`}</Txt> : null}
    </View>
  ) : (
    <Pressable accessibilityRole="button" onPress={() => router.navigate('/timetable')} style={{ gap: S(1) }}>
      <Caption>Next</Caption>
      <Txt kind="title">{planner.classes.length ? 'No more classes this week' : 'Add your timetable'}</Txt>
      <Txt muted>{planner.classes.length ? 'Enjoy the break.' : 'Add your classes in Timetable and the next one shows here, with Join for online ones.'}</Txt>
    </Pressable>
  );

  const late = due.some((t) => t.due! < today);
  const duePart = (
    <View style={{ gap: S(1) }}>
      <Head title={late ? 'Due today and late' : 'Due today'} link="All tasks" onLink={() => router.navigate('/tasks')} />
      {due.length ? due.slice(0, cover ? 3 : 8).map((t, i) => {
        const cls = planner.classes.find((k) => k.id === t.classId);
        return (
          <Line key={t.id} first={!i}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={`Finish ${t.text}`} hitSlop={10} onPress={() => toggleTask(t)}
              style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: t.due! < today ? c.bad : c.lineStrong }} />
            <Txt style={{ flex: 1 }} numberOfLines={2}>{t.text}</Txt>
            {cls && !cover ? <ClassTag color={cls.color} label={classLabel(cls, mode)} /> : null}
            {t.due! < today ? <Chip small label="Late" tone="bad" /> : null}
          </Line>
        );
      }) : <Line first><Icon name="done" size={20} color={c.good} /><Txt muted style={{ flex: 1 }}>Nothing due today.</Txt></Line>}
    </View>
  );

  const soonPart = soon.length || exams.length ? (
    <View style={{ gap: S(1) }}>
      <Head title="Coming up" />
      {exams.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -S(5) }} contentContainerStyle={{ gap: S(3), paddingHorizontal: S(5), paddingVertical: S(2) }}>
          {exams.slice(0, 6).map((t) => <ExamCard key={t.id} t={t} today={today} />)}
        </ScrollView>
      ) : null}
      {soon.slice(0, twoCol ? 6 : 4).map((t, i) => {
        const days = Math.round((Date.parse(t.due!) - Date.parse(today)) / 864e5);
        return (
          <Line key={t.id} first={!i} onPress={() => router.navigate('/tasks')}>
            <Txt style={{ flex: 1 }} numberOfLines={1}>{t.text}</Txt>
            <Txt kind="small" muted style={{ fontVariant: ['tabular-nums'] }}>{days === 1 ? 'Tomorrow' : `${fmtDate(t.due!)} · ${days} days`}</Txt>
          </Line>
        );
      })}
    </View>
  ) : null;

  if (cover) {
    return (
      <Page max={420}>
        {nowPart}
        <Line first onPress={() => router.navigate('/tasks')}><Icon name="tasks" color={due.length ? c.accentText : c.faint} /><Txt kind="headline" style={{ flex: 1 }}>{due.length ? `${due.length} due today` : 'Nothing due today'}</Txt><Icon name="chevR" color={c.faint} size={16} /></Line>
      </Page>
    );
  }

  const apps = allApps(settings);
  const parts: Record<string, ReactNode> = {
    next: nowPart,
    classes: todays.length ? (
      <View style={{ gap: S(1) }}>
        <Head title="Today's classes" link="Timetable" onLink={() => router.navigate('/timetable')} />
        {todays.map((o, i) => {
          const past = o.live && mins(o.end) <= nowMin;
          return (
            <Line key={o.key} first={!i} onPress={() => router.push({ pathname: '/classes/[id]', params: { id: o.classId } })}>
              <Txt kind="small" muted style={{ width: 48, fontVariant: ['tabular-nums'] }}>{fmtTime(o.start)}</Txt>
              <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: o.cls.color, opacity: o.live ? 1 : 0.4 }} />
              <View style={{ flex: 1, opacity: o.live && !past ? 1 : 0.5 }}>
                <Txt kind="headline" numberOfLines={1} style={{ textDecorationLine: o.live ? 'none' : 'line-through' }}>{classLabel(o.cls, mode)}</Txt>
                <Txt kind="small" muted numberOfLines={1}>{[KIND[o.kind], o.status === 'cancelled' ? '' : o.mode === 'online' ? 'Online' : o.venue].filter(Boolean).join(' · ')}</Txt>
                {o.notes?.length ? <Txt kind="small" numberOfLines={2} style={{ color: c.warn, fontWeight: '600' }}>{Planner.notesLine(o.notes)}</Txt> : null}
              </View>
              {STATUS[o.status] ? <Chip small label={STATUS[o.status][0]} tone={STATUS[o.status][1]} /> : null}
            </Line>
          );
        })}
      </View>
    ) : null,
    tasks: duePart,
    week: soonPart,
    apps: apps.length ? (
      <View style={{ gap: S(3) }}>
        <Head title="Your apps" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(3) }}>
          {apps.map((a) => (
            <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Open ${a.name}`} onPress={() => { haptic('tap'); openApp(a.id); router.navigate('/apps'); }}
              style={({ pressed }) => ({ width: twoCol ? 132 : '47%', flexGrow: twoCol ? 0 : 1, padding: S(3), gap: S(3), borderRadius: R.card, borderCurve: 'continuous', borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.hover : c.bg, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <AppTile app={a} size={32} />
              <Txt numberOfLines={1} style={{ fontWeight: '600' }}>{a.name}</Txt>
            </Pressable>
          ))}
        </View>
      </View>
    ) : null,
  };
  const order = Look.todaySections(settings.today, MOBILE_TODAY).filter((id) => parts[id]);
  const show = (ids: string[]) => ids.map((id) => <View key={id}>{parts[id]}</View>);
  // tablets: Now and classes on the left, tasks and apps on the right, each side in your order
  const left = order.filter((id) => id === 'next' || id === 'classes'); const right = order.filter((id) => id !== 'next' && id !== 'classes');
  return (
    <Page max={twoCol ? 1180 : 760} gap={S(8)}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S(3) }}>
        <View style={{ flex: 1, gap: S(1) }}>
          <Txt kind="small" muted>{`${DAYS_LONG[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}${weekText ? ` · ${weekText}` : ''}`}</Txt>
          <Txt kind="display">{`${greeting()}${settings.nickname ? `, ${settings.nickname}` : ''}`}</Txt>
        </View>
        {size === 'compact' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={sync.signedIn ? `Settings, signed in as ${sync.name || sync.email}` : 'Settings'} hitSlop={8} onPress={() => { haptic('tap'); router.push('/settings'); }}
            style={({ pressed }) => ({ marginTop: S(1), borderRadius: 22, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            {sync.signedIn ? <Avatar sync={sync} size={40} /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.sunken, alignItems: 'center', justifyContent: 'center' }}><Icon name="user" size={20} color={c.text} /></View>}
          </Pressable>
        ) : null}
      </View>
      <UpdateRow />
      {!order.length ? <Txt muted style={{ textAlign: 'center', paddingVertical: S(8) }}>Every section is hidden. Choose what Today shows in Settings → Appearance and you.</Txt>
        : twoCol && left.length && right.length ? <Columns left={<View style={{ gap: S(8) }}>{show(left)}</View>} right={<View style={{ gap: S(8) }}>{show(right)}</View>} /> : <View style={{ gap: S(8) }}>{show(order)}</View>}
      <View style={{ alignItems: 'center' }}>
        <Button kind="plain" small icon="settings" label="Customize Today" onPress={() => router.push('/settings/you')} />
      </View>
    </Page>
  );
}

// An exam: an outlined card with the countdown in big numbers, the class colour on the left
function ExamCard({ t, today }: { t: Task; today: string }) {
  const { c } = useTheme();
  const cls = useStore((s) => (t.classId ? s.planner.classes.find((k) => k.id === t.classId) : undefined));
  const mode = useStore((s) => s.settings.classLabel);
  const days = Math.round((Date.parse(t.due!) - Date.parse(today)) / 864e5);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${t.text}, ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`} onPress={() => router.navigate('/tasks')}
      style={({ pressed }) => ({ width: 168, padding: S(4), gap: S(2), borderRadius: R.card, borderCurve: 'continuous', borderWidth: 1, borderColor: days <= 3 ? c.warn : c.line, backgroundColor: pressed ? c.hover : c.bg, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Txt kind="display" style={{ fontVariant: ['tabular-nums'], color: days <= 3 ? c.warn : c.text }}>{days === 0 ? 'Today' : String(days)}</Txt>
        {days ? <Txt kind="small" muted>{days === 1 ? 'day' : 'days'}</Txt> : null}
      </View>
      <Txt kind="headline" numberOfLines={2}>{t.text}</Txt>
      <Txt kind="small" muted numberOfLines={1}>{[fmtDate(t.due!), t.at ? fmtTime(t.at) : '', t.venue].filter(Boolean).join(' · ')}</Txt>
      {cls ? <ClassTag color={cls.color} label={classLabel(cls, mode)} /> : null}
    </Pressable>
  );
}

// A new version: a quiet outlined row on Today; the download's progress shows in the toast pill.
function UpdateRow() {
  const { c } = useTheme();
  const u = useUpdate();
  const downloading = u.phase === 'downloading';
  useEffect(() => {
    if (downloading) toast({ id: 'update', icon: 'download', text: `Downloading WakeUp ${u.latest}… ${Math.round(u.progress * 100)}%`, progress: u.progress, action: { label: 'Cancel', run: cancelUpdate } });
    else dismissToast('update');
  }, [downloading, u.progress, u.latest]);
  const show = (u.phase === 'available' && u.latest !== u.skipped) || u.phase === 'ready';
  if (!show) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3), padding: S(3), paddingLeft: S(4), borderRadius: R.card, borderCurve: 'continuous', borderWidth: 1, borderColor: c.line }}>
      <Icon name="download" size={20} color={c.accentText} />
      <View style={{ flex: 1 }}>
        <Txt kind="headline">{u.phase === 'ready' ? `WakeUp ${u.latest} is ready` : `WakeUp ${u.latest} is out`}</Txt>
        {u.phase === 'available' && u.notes ? <Txt kind="small" muted numberOfLines={1}>{u.notes.split('\n').filter(Boolean)[0]}</Txt> : null}
      </View>
      {u.phase === 'available' ? <Button small kind="plain" label="Later" onPress={skipUpdate} /> : null}
      <Button small kind="primary" label={u.phase === 'ready' ? 'Install' : 'Update'} onPress={() => { installUpdate(); }} />
    </View>
  );
}
