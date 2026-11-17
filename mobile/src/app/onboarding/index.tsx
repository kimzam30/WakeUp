// First run: welcome → sign in (or not) → semester → classes → apps → notifications → done.
// Signing in to an account that already has a timetable goes welcome → sign in → "welcome back" → notifications → done.
// The place you're at is saved, so a restart continues where you left off; back retraces the steps you took.
// Finishing is a one-way door: the root layout swaps this route out, so back can't return here.
import { useEffect, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, Divider, Field, Row, Segmented, Switch, Txt, useLayout } from '../../ui/kit';
import { ClassIcon } from '../../ui/ClassBits';
import { DateField } from '../../ui/DateField';
import { Icon } from '../../ui/Icon';
import { R, S, useTheme } from '../../ui/theme';
import { Planner } from '../../lib/shared';
import { BUILTIN_APPS, kv, setOnboarded, setPlanner, setSettings, useStore } from '../../lib/store';
import { cloudSummary, signIn } from '../../lib/sync';
import { askPermission, openSystemSettings, rescheduleSoon, type Permission } from '../../lib/reminders';
import { DAYS, classLabel, classSub, fmtTime } from '../../lib/format';

type Step = 'welcome' | 'sync' | 'back' | 'semester' | 'classes' | 'apps' | 'notify' | 'done';
const NEW_PATH: Step[] = ['welcome', 'sync', 'semester', 'classes', 'apps', 'notify', 'done'];
const BACK_PATH: Step[] = ['welcome', 'sync', 'back', 'notify', 'done'];
const AI: [string, string, string][] = [['ChatGPT', 'https://chatgpt.com/', '#10a37f'], ['Claude', 'https://claude.ai/', '#d97757'], ['Copilot', 'https://copilot.microsoft.com/', '#2b63d9'], ['Perplexity', 'https://www.perplexity.ai/', '#20808d']];

export default function Onboarding() {
  const { c } = useTheme();
  const { size, wide } = useLayout();
  const insets = useSafeAreaInsets();
  // where you've been (back retraces it) and whether this account came with a timetable; both survive a restart
  const [trail, setTrail] = useState<Step[]>(() => kv.get<Step[]>('onboarding.trail', ['welcome']));
  const [returning, setReturning] = useState(() => kv.get<{ classes: number; tasks: number } | null>('onboarding.returning', null));
  useEffect(() => { kv.set('onboarding.trail', trail); kv.set('onboarding.returning', returning); }, [trail, returning]);
  const step = trail[trail.length - 1];
  const [busy, setBusy] = useState(false); // signing in or checking the account: no back, no double taps
  const [perm, setPerm] = useState<Permission | null>(null);
  const s = useStore((x) => x.settings);
  const planner = useStore((x) => x.planner);
  const sync = useStore((x) => x.sync);
  const cover = size === 'cover';
  const path = returning ? BACK_PATH : NEW_PATH;
  const go = (to: Step) => setTrail((t) => (t[t.length - 1] === to ? t : [...t, to]));
  const next = () => { const k = path.indexOf(step); go(path[Math.min(k + 1, path.length - 1)]); };
  const back = () => setTrail((t) => {
    const out = t.length > 1 ? t.slice(0, -1) : t;
    if (out[out.length - 1] === 'sync') setReturning(null); // back at sign-in: the choice of path is open again
    return out;
  });
  const canBack = trail.length > 1 && step !== 'done' && !busy;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy || step === 'done') return true; // nothing to go back to mid-sign-in, and Done is the end of the road
      if (trail.length <= 1) return false;
      back(); return true;
    });
    return () => sub.remove();
  }, [trail, busy, step]);

  // after sign-in: an account with a timetable skips the setup steps
  const afterSignIn = async () => {
    setBusy(true);
    try {
      const sum = await cloudSummary().catch(() => null);
      if (sum?.has) { setReturning({ classes: sum.classes, tasks: sum.tasks }); go('back'); } else { setReturning(null); go('semester'); }
    } finally { setBusy(false); }
  };
  const google = async () => {
    if (busy) return;
    setBusy(true);
    let ok = false;
    try { ok = await signIn(); } finally { setBusy(false); }
    if (ok) await afterSignIn();
  };
  const finish = () => { kv.set('onboarding.trail', ['welcome']); kv.set('onboarding.returning', null); setOnboarded(true); router.replace('/'); };
  const firstClass = Planner.upcoming(planner, new Date(), 7)[0];
  const mode = s.classLabel;

  // the semester is written once, when you continue, not on every keystroke
  const [sem, setSem] = useState(planner.semester);
  const semProblem = sem.start && sem.end && sem.end < sem.start ? 'The semester ends before it starts.' : '';
  const saveSem = () => { if (JSON.stringify(sem) !== JSON.stringify(planner.semester)) setPlanner({ semester: sem }); };

  // notifications: ask once, show what Android actually said
  const notifyOn = !!s.reminders || (!!s.taskReminder && s.notify.tasks !== false);
  const notifyNext = async () => {
    if (!notifyOn) { next(); return; }
    const r = await askPermission(); setPerm(r);
    rescheduleSoon(200);
    if (r === 'granted') next();
  };

  let title = ''; let body = ''; let content: React.ReactNode = null; let primary: [string, () => void] = ['Continue', next]; let secondary: [string, () => void] | null = null;
  switch (step) {
    case 'welcome':
      title = 'Wake up to your day.'; body = 'Your classes, tasks and uni apps in one calm place.';
      content = <Image source={require('../../../assets/icon.png')} style={{ width: cover ? 72 : 112, height: cover ? 72 : 112, alignSelf: 'center' }} accessibilityIgnoresInvertColors />;
      primary = ['Get started', next];
      break;
    case 'sync':
      title = 'Keep everything in sync'; body = 'Sign in with Google to see the same timetable and tasks on your phone, tablet and laptop.';
      content = <>
        {sync.signedIn ? <Card><Row><Icon name="check" color={c.good} /><Txt style={{ flex: 1 }}>{`Signed in as ${sync.email}`}</Txt></Row></Card> : null}
        {sync.error && !sync.signedIn ? <Txt kind="small" style={{ color: c.bad }}>{`Sign-in didn’t finish: ${sync.error}`}</Txt> : null}
        <Txt kind="small" muted>We only store your timetable, tasks and settings. Your Microsoft and Ebwise sign-ins stay on this device.</Txt>
      </>;
      primary = sync.signedIn ? [busy ? 'Checking your account…' : 'Continue', afterSignIn] : [busy ? 'Waiting for Google…' : 'Continue with Google', google];
      secondary = sync.signedIn || busy ? null : ['Use without an account', () => { setReturning(null); go('semester'); }];
      break;
    case 'back': {
      const n = returning?.tasks ?? 0;
      title = `Welcome back${sync.name ? `, ${sync.name.split(' ')[0]}` : ''}.`;
      body = 'Your timetable is here. Classes, changes and tasks keep syncing between your devices.';
      content = (
        <Card>
          <Row><Icon name="cal" color={c.accentText} /><Txt style={{ flex: 1 }}>{`${returning?.classes ?? planner.classes.length} class${(returning?.classes ?? planner.classes.length) === 1 ? '' : 'es'}${planner.semester.name ? ` · ${planner.semester.name}` : ''}`}</Txt></Row>
          <Divider inset={48} />
          <Row><Icon name="tasks" color={c.accentText} /><Txt style={{ flex: 1 }}>{n ? `${n} open task${n === 1 ? '' : 's'}` : 'No open tasks'}</Txt></Row>
        </Card>
      );
      break;
    }
    case 'semester':
      title = 'When does this trimester run?'; body = 'Week numbers and breaks come from these dates.';
      content = <>
        <Field label="Name" value={sem.name} onChangeText={(name) => setSem({ ...sem, name })} placeholder="e.g. Trimester 2530" maxLength={60} returnKeyType="done" />
        <View style={{ flexDirection: 'row', gap: S(3), flexWrap: 'wrap' }}>
          <DateField label="Starts" value={sem.start} onChange={(start) => setSem({ ...sem, start })} />
          <DateField label="Ends" value={sem.end} onChange={(end) => setSem({ ...sem, end })} />
        </View>
        {semProblem ? <Txt kind="small" style={{ color: c.bad }}>{semProblem}</Txt> : null}
        <Txt kind="small" muted>You can add breaks later in Timetable → Semester.</Txt>
      </>;
      primary = ['Continue', () => { if (semProblem) return; saveSem(); next(); }];
      secondary = ['Skip for now', next];
      break;
    case 'classes':
      title = 'Add your classes once.'; body = 'They repeat every week.';
      content = <>
        <View style={{ gap: S(2) }}>
          <Txt kind="small" muted>Show classes as</Txt>
          <Segmented label="Show classes as" value={mode} onChange={(classLabel) => setSettings({ classLabel })} options={[['code', 'Code'], ['name', 'Name'], ['both', 'Both']]} />
        </View>
        {planner.classes.length ? <Card>{planner.classes.map((k, j) => (
          <View key={k.id}>{j ? <Divider inset={64} /> : null}
            <Row onPress={() => router.push({ pathname: '/onboarding/class', params: { id: k.id } })}><ClassIcon cls={k} />
              <View style={{ flex: 1 }}><Txt kind="headline" numberOfLines={1}>{classLabel(k, mode)}{classSub(k, mode) ? <Txt muted>{`  ${classSub(k, mode)}`}</Txt> : null}</Txt>
                <Txt kind="small" muted numberOfLines={1}>{k.sessions.map((x) => `${DAYS[x.day]} ${fmtTime(x.start)}`).join(' · ')}</Txt></View>
              <Icon name="chevR" size={16} color={c.faint} /></Row>
          </View>))}</Card>
          : <Chip label={mode === 'name' ? 'e.g. Mini IT Project' : mode === 'both' ? 'e.g. CSP1123 · Mini IT Project' : 'e.g. CSP1123'} />}
        {cover ? <Txt kind="small" muted>Open your phone to add classes.</Txt> : <Button icon="plus" label="Add a class" onPress={() => router.push('/onboarding/class')} />}
        <Txt kind="small" muted>Have a timetable on your laptop? Go back and sign in, and it appears here by itself.</Txt>
      </>;
      primary = [planner.classes.length ? 'Continue' : 'Skip for now', next];
      break;
    case 'apps':
      title = 'Which apps do you use for class?'; body = 'You’ll sign in to each one the first time you open it.';
      content = <>
        <Card>{BUILTIN_APPS.map((a, k) => (
          <View key={a.id}>{k ? <Divider inset={16} /> : null}
            <Row><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: a.color }} /><Txt style={{ flex: 1 }}>{a.name}</Txt>
              <Switch label={a.name} value={s.apps.includes(a.id)} onChange={(on) => setSettings({ apps: on ? [...s.apps, a.id] : s.apps.filter((x) => x !== a.id) })} /></Row>
          </View>))}
        </Card>
        <Txt kind="small" muted>Add an AI assistant</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(2) }}>
          {AI.map(([n, u, col]) => {
            const on = s.customApps.some((x) => x.url === u);
            return <Pressable key={n} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setSettings({ customApps: on ? s.customApps.filter((x) => x.url !== u) : [...s.customApps, { id: `c-${n.toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`, name: n, url: u, color: col, custom: true, ai: true }] })}
              style={{ height: 40, paddingHorizontal: S(3), borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: S(2), borderWidth: 1, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accentSoft : 'transparent' }}>
              {on ? <Icon name="check" size={14} color={c.accentText} /> : <Icon name="plus" size={14} color={c.muted} />}<Txt kind="small" style={{ fontWeight: '600', color: on ? c.accentText : c.text }}>{n}</Txt>
            </Pressable>;
          })}
        </View>
      </>;
      break;
    case 'notify':
      title = 'Want reminders?'; body = 'A heads-up before each class, and one in the morning when tasks are due.';
      content = <>
        <View style={{ gap: S(2) }}>
          <Txt kind="small" muted>Before each class</Txt>
          <Segmented label="Class reminders" value={s.reminders} onChange={(reminders) => setSettings({ reminders, notify: { ...s.notify, timetable: !!reminders } })} options={[[5, '5 min'], [10, '10 min'], [15, '15 min'], [0, 'Off']]} />
        </View>
        <Card><Row><Icon name="tasks" color={c.muted} /><View style={{ flex: 1 }}><Txt>Tasks due today</Txt><Txt kind="small" muted>{`At ${fmtTime(s.taskReminder || '08:00')}, only on days something is due`}</Txt></View>
          <Switch label="Task reminders" value={!!s.taskReminder && s.notify.tasks !== false} onChange={(on) => setSettings({ taskReminder: on ? s.taskReminder || '08:00' : s.taskReminder, notify: { ...s.notify, tasks: on } })} /></Row></Card>
        {perm === 'denied' ? (
          <Card><Row><Icon name="bell" color={c.bad} /><View style={{ flex: 1 }}><Txt kind="headline">Notifications are off for WakeUp</Txt><Txt kind="small" muted>Turn them on in Android settings, or continue without reminders.</Txt></View></Row>
            <View style={{ padding: S(3), paddingTop: 0 }}><Button label="Open settings" onPress={openSystemSettings} /></View></Card>
        ) : null}
      </>;
      primary = perm === 'denied' ? ['Continue without reminders', next] : [notifyOn ? 'Turn on reminders' : 'Continue', notifyNext];
      break;
    case 'done':
      title = `You’re set${s.nickname ? `, ${s.nickname}` : ''}.`;
      body = firstClass ? `Next up: ${classLabel(firstClass.cls, mode)} at ${fmtTime(firstClass.start)}${firstClass.date === Planner.today() ? ' today' : ''}.` : 'No classes yet. You can add them any time from Timetable.';
      primary = ['Open Today', finish];
      break;
  }
  const k = path.indexOf(step);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: S(2) }}>
        {canBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="back" color={c.muted} /></Pressable> : <View style={{ width: 44 }} />}
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6 }} accessibilityLabel={`Step ${k + 1} of ${path.length}`}>
          {path.map((_, j) => <View key={j} style={{ width: j === k ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: j <= k ? c.accent : c.lineStrong }} />)}
        </View>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: cover ? S(3) : wide ? S(10) : S(5), alignItems: 'center', justifyContent: wide ? 'center' : 'flex-start' }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 520, gap: cover ? S(3) : S(5) }}>
          <View style={{ gap: S(2) }}>
            <Txt kind={cover ? 'title' : 'display'}>{title}</Txt>
            {body ? <Txt muted kind={cover ? 'small' : 'body'}>{body}</Txt> : null}
          </View>
          {content}
        </View>
      </ScrollView>
      <View style={{ padding: cover ? S(3) : S(5), paddingTop: S(3), gap: S(2), alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: 520, gap: S(2) }}>
          <Button kind="primary" label={primary[0]} onPress={primary[1]} full disabled={busy} />
          {secondary ? <Button kind="plain" label={secondary[0]} onPress={secondary[1]} full /> : null}
        </View>
      </View>
    </View>
  );
}
