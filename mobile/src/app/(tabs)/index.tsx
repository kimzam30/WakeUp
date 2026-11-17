// Today: greeting, semester week, the next class with a countdown and Join button, today's classes,
// tasks due, and your apps. On the Z Flip's cover screen it shrinks to the next class and what's due; on a
// tablet it splits into two columns (classes on the left, tasks and apps on the right).
import { useMemo } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { haptic } from '../../lib/haptics';
import { Button, Card, Chip, Columns, Divider, Page, Row, Section, Txt, useLayout } from '../../ui/kit';
import { ClassIcon } from '../../ui/ClassBits';
import { AppGlyph, Icon } from '../../ui/Icon';
import { Logo } from '../../ui/Logo';
import { R, S, STATUS, T, useTheme } from '../../ui/theme';
import { Planner } from '../../lib/shared';
import { allApps, openApp, setPlanner, useStore } from '../../lib/store';
import { cancelUpdate, installUpdate, skipUpdate, useUpdate } from '../../lib/updater';
import { DAYS_LONG, KIND, MONTHS, classLabel, classSub, countdown, fmtDate, fmtTime, greeting } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import type { Task } from '../../lib/types';

const openLink = (url: string) => Linking.openURL(url).catch(() => {});

export default function Today() {
  const { c } = useTheme();
  const { size, twoCol } = useLayout();
  const phone = size === 'compact'; // tablets show the logo in the sidebar
  const nowMs = useNow();
  const now = new Date(nowMs);
  const planner = useStore((s) => s.planner);
  const settings = useStore((s) => s.settings);
  const mode = settings.classLabel;
  const today = Planner.ymd(now);
  const week = useMemo(() => Planner.weekOf(today, planner.semester, settings.weekStart), [today, planner.semester, settings.weekStart]);
  // the next class only changes when the minute does or the timetable does
  const next = useMemo(() => Planner.upcoming(planner, new Date(nowMs), 7)[0], [planner, nowMs]);
  const isNow = !!next && next.startsAt <= nowMs;
  const todays = useMemo(() => Planner.occurrencesOn(today, planner), [today, planner]);
  const due = useMemo(() => planner.tasks.filter((t) => !t.done && t.due && t.due <= today).sort((a, b) => (a.due! < b.due! ? -1 : 1)), [planner.tasks, today]);
  const soon = useMemo(() => planner.tasks.filter((t) => !t.done && t.due && t.due > today && t.due <= Planner.addDays(today, 7)).sort((a, b) => (a.due! < b.due! ? -1 : 1)), [planner.tasks, today]);
  const cover = size === 'cover';
  const weekText = week?.week ? `Week ${week.week}${week.break ? ` · ${week.break}` : ''}` : week?.before ? `Semester starts in ${week.days} days` : week?.after ? 'Semester finished' : '';

  const toggle = (t: Task) => { if (!t.done) haptic('success'); setPlanner((p) => ({ tasks: p.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done, doneAt: x.done ? null : Date.now() } : x)) })); };

  const nextCard = next ? (
    <Card accent={next.cls.color}>
      <View style={{ padding: cover ? S(3) : S(5), paddingLeft: cover ? S(4) : S(6), gap: S(3) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3) }}>
          {!cover ? <ClassIcon cls={next.cls} size={44} /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Txt kind="tiny" muted>{isNow ? 'HAPPENING NOW' : `NEXT CLASS · IN ${countdown(next.startsAt - now.getTime()).toUpperCase()}`}</Txt>
            <Txt kind={cover ? 'headline' : 'title'} numberOfLines={2}>{classLabel(next.cls, mode)}{classSub(next.cls, mode) ? <Txt kind={cover ? 'headline' : 'title'} muted style={{ fontWeight: '400' }}>{`  ${classSub(next.cls, mode)}`}</Txt> : null}</Txt>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(4) }}>
          <Fact icon="clock" text={`${next.date === today ? '' : `${fmtDate(next.date)} · `}${fmtTime(next.start)} – ${fmtTime(next.end)}`} />
          {!cover && (KIND[next.kind] || next.section) ? <Fact icon="users" text={[KIND[next.kind], next.section].filter(Boolean).join(' · ')} /> : null}
          <Fact icon={next.mode === 'online' ? 'video' : 'pin'} text={next.mode === 'online' ? 'Online' : next.venue || 'Venue not set'} />
        </View>
        {STATUS[next.status] ? <Chip label={STATUS[next.status][0]} tone={STATUS[next.status][1]} /> : null}
        {next.link ? <Button kind="primary" icon="video" label="Join meeting" onPress={() => openLink(next.link)} full={cover} /> : null}
      </View>
    </Card>
  ) : (
    <Card><Row onPress={() => router.navigate('/timetable')}><Icon name="cal" color={c.faint} /><View style={{ flex: 1 }}><Txt kind="headline">{planner.classes.length ? 'No more classes this week' : 'No classes yet'}</Txt><Txt muted kind="small">{planner.classes.length ? 'Enjoy the break.' : 'Add your classes in Timetable and they show up here.'}</Txt></View><Icon name="chevR" color={c.faint} size={16} /></Row></Card>
  );

  const tasksCard = (
    <Section title={due.length ? `Due today${due.some((t) => t.due! < today) ? ' and late' : ''}` : 'Tasks'} action={<Button kind="plain" small label="All tasks" onPress={() => router.navigate('/tasks')} />}>
      <Card>
        {due.length ? due.slice(0, cover ? 3 : 8).map((t, i) => {
          const cls = planner.classes.find((k) => k.id === t.classId);
          return (
            <View key={t.id}>
              {i ? <Divider inset={56} /> : null}
              <Row onPress={() => toggle(t)} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.lineStrong }} />
                <Txt style={{ flex: 1 }} numberOfLines={2}>{t.text}</Txt>
                {cls && !cover ? <Chip label={classLabel(cls, mode)} /> : null}
                {t.due! < today ? <Chip label="Late" tone="bad" /> : null}
              </Row>
            </View>
          );
        }) : <Row><Icon name="check" color={c.good} /><Txt muted style={{ flex: 1 }}>Nothing due today.</Txt></Row>}
      </Card>
    </Section>
  );
  // tablets have room for what's coming this week too
  const soonCard = twoCol && soon.length ? (
    <Section title="Coming up this week">
      <Card>
        {soon.slice(0, 6).map((t, i) => (
          <View key={t.id}>
            {i ? <Divider inset={16} /> : null}
            <Row onPress={() => router.navigate('/tasks')}>
              <Txt style={{ flex: 1 }} numberOfLines={1}>{t.text}</Txt>
              <Chip label={t.due === Planner.addDays(today, 1) ? 'Tomorrow' : fmtDate(t.due!)} />
            </Row>
          </View>
        ))}
      </Card>
    </Section>
  ) : null;

  if (cover) {
    return (
      <Page max={420}>
        {nextCard}
        <Card><Row onPress={() => router.navigate('/tasks')}><Icon name="tasks" color={due.length ? c.accentText : c.faint} /><Txt kind="headline" style={{ flex: 1 }}>{due.length ? `${due.length} due today` : 'Nothing due today'}</Txt><Icon name="chevR" color={c.faint} size={16} /></Row></Card>
      </Page>
    );
  }

  const apps = allApps(settings);
  return (
    <Page max={twoCol ? 1180 : 760}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3) }}>
        {phone ? <Logo size={44} /> : null}
        <View style={{ flex: 1, gap: S(1) }}>
          <Txt kind="small" muted>{`${DAYS_LONG[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}${weekText ? ` · ${weekText}` : ''}`}</Txt>
          <Txt kind="display">{`${greeting()}${settings.nickname ? `, ${settings.nickname}` : ''}`}</Txt>
        </View>
      </View>
      <UpdateBanner />
      <Columns left={<>
      {nextCard}
      {todays.length ? (
        <Section title="Today's classes">
          <Card>
            {todays.map((o, i) => (
              <View key={o.key}>
                {i ? <Divider inset={64} /> : null}
                <Row onPress={() => router.navigate('/timetable')}>
                  <ClassIcon cls={o.cls} />
                  <View style={{ flex: 1, opacity: o.live ? 1 : 0.55 }}>
                    <Txt kind="headline" numberOfLines={1} style={{ textDecorationLine: o.live ? 'none' : 'line-through' }}>{classLabel(o.cls, mode)}{classSub(o.cls, mode) ? <Txt muted>{`  ${classSub(o.cls, mode)}`}</Txt> : null}</Txt>
                    <Txt kind="small" muted numberOfLines={2}>{[`${fmtTime(o.start)}–${fmtTime(o.end)}`, KIND[o.kind], o.status === 'cancelled' ? '' : o.mode === 'online' ? 'Online' : o.venue].filter(Boolean).join(' · ')}</Txt>
                  </View>
                  {STATUS[o.status] ? <Chip label={STATUS[o.status][0]} tone={STATUS[o.status][1]} /> : null}
                </Row>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
      </>} right={<>
      {tasksCard}
      {soonCard}
      {apps.length ? (
        <Section title="Your apps">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(3) }}>
            {apps.map((a) => (
              <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Open ${a.name}`} onPress={() => { openApp(a.id); router.navigate('/apps'); }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S(2), paddingHorizontal: S(3), height: 48, borderRadius: R.input, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.hover : c.raised })}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: a.color, alignItems: 'center', justifyContent: 'center' }}>
                  <AppGlyph id={a.id} name={a.name} size={17} />{!['ebwise', 'mail', 'calendar', 'teams'].includes(a.id) ? <Txt style={{ color: '#fff', fontWeight: '700' }}>{a.name[0]}</Txt> : null}
                </View>
                <Txt style={[T.body, { fontWeight: '500' }]}>{a.name}</Txt>
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}
      </>} />
    </Page>
  );
}

function Fact({ icon, text }: { icon: string; text: string }) {
  const { c } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(1) + 2 }}><Icon name={icon} size={15} color={c.muted} /><Txt kind="small" muted>{text}</Txt></View>;
}

// A new version is out: one tap downloads it and opens Android's installer. "Later" hides it until the next version.
function UpdateBanner() {
  const { c } = useTheme();
  const u = useUpdate();
  const show = (u.phase === 'available' && u.latest !== u.skipped) || u.phase === 'downloading' || u.phase === 'ready';
  if (!show) return null;
  const title = u.phase === 'downloading' ? `Downloading WakeUp ${u.latest}… ${Math.round(u.progress * 100)}%` : u.phase === 'ready' ? `WakeUp ${u.latest} is ready to install` : `WakeUp ${u.latest} is out`;
  return (
    <Card accent={c.accent}>
      <View style={{ padding: S(4), gap: S(3) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3) }}>
          <Icon name="download" color={c.accentText} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt kind="headline">{title}</Txt>
            {u.phase === 'available' && u.notes ? <Txt kind="small" muted numberOfLines={2}>{u.notes.split('\n').filter(Boolean).slice(0, 2).join(' · ')}</Txt> : null}
          </View>
        </View>
        {u.phase === 'downloading' ? <View style={{ height: 4, borderRadius: 2, backgroundColor: c.sunken, overflow: 'hidden' }}><View style={{ width: `${Math.round(u.progress * 100)}%`, height: 4, backgroundColor: c.accent }} /></View> : null}
        <View style={{ flexDirection: 'row', gap: S(2) }}>
          {u.phase === 'downloading' ? <Button small label="Cancel" onPress={cancelUpdate} />
            : <><Button small kind="primary" label={u.phase === 'ready' ? 'Install' : 'Update now'} onPress={() => { installUpdate(); }} />{u.phase === 'available' ? <Button small kind="plain" label="Later" onPress={skipUpdate} /> : null}</>}
        </View>
      </View>
    </Card>
  );
}
