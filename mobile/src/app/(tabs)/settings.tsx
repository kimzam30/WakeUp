// Settings: account and sync, notifications, timetable, apps, appearance. Same words as the desktop app.
// Phones get one grouped list; landscape tablets get sections on the left and details on the right.
import { useEffect, useState } from 'react';
import { Alert, AppState, Pressable, View } from 'react-native';
import Constants from 'expo-constants';
import { Button, Card, Divider, Field, Page, Row, Section, Segmented, Sheet, Switch, Txt, useLayout } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { R, S, useTheme } from '../../ui/theme';
import { TimeField } from '../../ui/DateField';
import { BUILTIN_APPS, closeApp, setOnboarded, setSettings, useStore } from '../../lib/store';
import { cancelUpdate, checkForUpdate, installUpdate, setAutoUpdate, useUpdate } from '../../lib/updater';
import { flush, signIn, signOut } from '../../lib/sync';
import { askPermission, openSystemSettings, permission, rescheduleSoon, type Permission } from '../../lib/reminders';
import { fmtTime } from '../../lib/format';
import type { WebApp } from '../../lib/types';

const AI: [string, string, string][] = [
  ['ChatGPT', 'https://chatgpt.com/', '#10a37f'], ['Claude', 'https://claude.ai/', '#d97757'], ['Gemini', 'https://gemini.google.com/', '#4285f4'],
  ['Copilot', 'https://copilot.microsoft.com/', '#2b63d9'], ['Perplexity', 'https://www.perplexity.ai/', '#20808d'], ['DeepSeek', 'https://chat.deepseek.com/', '#4d6bfe'],
];
const ago = (iso: string | null) => { if (!iso) return 'not yet'; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };

type SecId = 'sync' | 'notify' | 'timetable' | 'apps' | 'you' | 'about';
const SECTIONS: [SecId, string, string][] = [['sync', 'Account and sync', 'cloud'], ['notify', 'Notifications', 'bell'], ['timetable', 'Timetable', 'cal'], ['apps', 'Apps', 'apps'], ['you', 'Appearance and you', 'palette'], ['about', 'About', 'info']];

export default function Settings() {
  const { c } = useTheme();
  const { twoCol } = useLayout();
  const [tab, setTab] = useState<SecId>('sync');
  if (!twoCol) {
    return (
      <Page>
        <Txt kind="display">Settings</Txt>
        {SECTIONS.map(([id, title]) => <Section key={id} title={title}><SectionBody id={id} /></Section>)}
      </Page>
    );
  }
  // landscape tablets: sections on the left, the chosen one on the right
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.bg }}>
      <View style={{ width: 300, borderRightWidth: 1, borderColor: c.line, paddingTop: S(10), paddingHorizontal: S(4), gap: S(1) }}>
        <Txt kind="display" style={{ paddingHorizontal: S(3), marginBottom: S(4) }}>Settings</Txt>
        {SECTIONS.map(([id, title, icon]) => {
          const on = id === tab;
          return (
            <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(id)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S(3), minHeight: 48, paddingHorizontal: S(3), borderRadius: R.input, backgroundColor: on ? c.accentSoft : pressed ? c.hover : 'transparent' })}>
              <Icon name={icon} color={on ? c.accentText : c.muted} />
              <Txt style={{ fontWeight: on ? '600' : '500' }}>{title}</Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }}>
        <Page max={680}>
          <Txt kind="title">{SECTIONS.find((x) => x[0] === tab)![1]}</Txt>
          <SectionBody id={tab} />
        </Page>
      </View>
    </View>
  );
}

function SectionBody({ id }: { id: SecId }) {
  if (id === 'sync') return <SyncCard />;
  if (id === 'notify') return <NotifyCard />;
  if (id === 'timetable') return <TimetableCard />;
  if (id === 'apps') return <AppsCard />;
  if (id === 'you') return <YouCard />;
  return <AboutCard />;
}

function SyncCard() {
  const { c } = useTheme();
  const sync = useStore((x) => x.sync);
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
  const syncText = sync.phase === 'syncing' ? 'Syncing…' : sync.phase === 'offline' ? `Offline. ${sync.pending ? `${n(sync.pending, 'change')} will upload` : 'Changes will sync'} when you’re back online.`
    : sync.phase === 'expired' ? `Your sign-in expired.${sync.pending ? ` ${n(sync.pending, 'change')} waiting.` : ''} Sign in again to keep syncing.`
    : sync.phase === 'error' ? `Sync stopped: ${sync.error}` : `Up to date · synced ${ago(sync.lastSync)}`;
  const bad = sync.phase === 'error' || sync.phase === 'expired';
  const out = () => Alert.alert('Sign out?',
    sync.pending ? `${n(sync.pending, 'change')} haven’t synced yet. They stay on this device but won’t reach your other devices.` : 'Your timetable and tasks stay on this device. They stop syncing until you sign in again.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: sync.pending ? 'destructive' : 'default', onPress: () => signOut() }]);
  return (
    <Card>
      {sync.signedIn ? <>
        <Row><Icon name="cloud" color={bad ? c.bad : c.accentText} /><View style={{ flex: 1 }}><Txt kind="headline">{sync.name || sync.email}</Txt><Txt kind="small" muted style={bad ? { color: c.bad } : undefined}>{sync.name ? `${sync.email} · ` : ''}{syncText}</Txt>
          {sync.rejected ? <Txt kind="small" style={{ color: c.bad, marginTop: 4 }}>{`${n(sync.rejected, 'item')} couldn’t sync and stay on this device only.`}</Txt> : null}</View></Row>
        <Divider />
        <View style={{ flexDirection: 'row', gap: S(2), padding: S(3), flexWrap: 'wrap' }}>
          {sync.phase === 'expired' ? <Button small kind="primary" label="Sign in again" onPress={() => signIn()} />
            : <Button small icon="reload" label="Sync now" onPress={() => flush()} disabled={sync.phase === 'syncing'} />}
          <Button small kind="plain" label="Sign out" onPress={out} />
        </View>
      </> : <>
        <Row><Icon name="cloud" color={c.faint} /><View style={{ flex: 1 }}><Txt kind="headline">Sync with Google</Txt><Txt kind="small" muted>The same timetable, tasks and settings on your phone, tablet and laptop. Your Microsoft and Ebwise sign-ins stay on this device.</Txt>
          {sync.error ? <Txt kind="small" style={{ color: c.bad, marginTop: 4 }}>{`Sign-in didn’t finish: ${sync.error}`}</Txt> : null}</View></Row>
        <View style={{ padding: S(3), paddingTop: 0 }}><Button kind="primary" label={sync.phase === 'signing' ? 'Waiting for Google…' : 'Sign in with Google'} onPress={() => signIn()} disabled={sync.phase === 'signing'} /></View>
      </>}
    </Card>
  );
}

// permission status, refreshed whenever the app comes back (people flip it in system settings and return)
function usePermission() {
  const [p, setP] = useState<Permission>('undetermined');
  useEffect(() => {
    const check = () => { permission().then(setP).catch(() => {}); };
    check();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') { check(); rescheduleSoon(300); } });
    return () => sub.remove();
  }, []);
  return [p, setP] as const;
}

function NotifyCard() {
  const { c } = useTheme();
  const { wide } = useLayout();
  const s = useStore((x) => x.settings);
  const [perm, setPerm] = usePermission();
  const ask = async () => { const r = await askPermission(); setPerm(r); if (r !== 'granted') openSystemSettings(); };
  return (
    <Card>
      {perm !== 'granted' ? <>
        <Row><Icon name="bell" color={c.bad} /><View style={{ flex: 1 }}><Txt kind="headline">Notifications are off for WakeUp</Txt><Txt kind="small" muted>{perm === 'denied' ? 'Turn them on in Android settings to get class and task reminders.' : 'Allow notifications to get class and task reminders.'}</Txt></View></Row>
        <View style={{ padding: S(3), paddingTop: 0 }}><Button kind="primary" label={perm === 'denied' ? 'Open settings' : 'Allow notifications'} onPress={perm === 'denied' ? openSystemSettings : ask} /></View>
        <Divider />
      </> : null}
      <SetRow title="Before each class" desc="A heads-up with the time and venue. Cancelled classes are skipped." stack={!wide}>
        <Segmented label="Class reminders" value={s.notify.timetable === false ? 0 : s.reminders} onChange={(reminders) => { setSettings(reminders ? { reminders, notify: { ...s.notify, timetable: true } } : { reminders }); if (reminders && perm !== 'granted') ask(); }} options={[[0, 'Off'], [5, '5 min'], [10, '10 min'], [15, '15 min']]} />
      </SetRow>
      <Divider />
      <SetRow title="Tasks due today" desc={s.taskReminder && s.notify.tasks !== false ? `One reminder at ${fmtTime(s.taskReminder)} on days something is due.` : 'Off'} stack={!wide}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3) }}>
          {s.taskReminder && s.notify.tasks !== false ? <View style={{ width: 128, flexDirection: 'row' }}><TimeField value={s.taskReminder} onChange={(taskReminder) => setSettings({ taskReminder })} /></View> : null}
          <Switch label="Task reminders" value={!!s.taskReminder && s.notify.tasks !== false} onChange={(on) => { setSettings({ taskReminder: on ? s.taskReminder || '08:00' : s.taskReminder, notify: { ...s.notify, tasks: on } }); if (on && perm !== 'granted') ask(); }} />
        </View>
      </SetRow>
    </Card>
  );
}

function TimetableCard() {
  const { wide } = useLayout();
  const s = useStore((x) => x.settings);
  return (
    <Card>
      <SetRow title="Show classes as" desc={s.classLabel === 'name' ? 'Subject name only, e.g. “Mini IT Project”.' : s.classLabel === 'both' ? 'Code and name, e.g. “CSP1123 · Mini IT Project”.' : 'Subject code only, e.g. “CSP1123”.'} stack={!wide}>
        <Segmented label="Show classes as" value={s.classLabel} onChange={(classLabel) => setSettings({ classLabel })} options={[['code', 'Code'], ['name', 'Name'], ['both', 'Both']]} />
      </SetRow>
      <Divider />
      <SetRow title="Weeks start on" stack={!wide}>
        <Segmented label="Weeks start on" value={s.weekStart} onChange={(weekStart) => setSettings({ weekStart })} options={[[1, 'Monday'], [0, 'Sunday']]} />
      </SetRow>
    </Card>
  );
}

function AppsCard() {
  const s = useStore((x) => x.settings);
  const [adding, setAdding] = useState(false);
  // hiding or removing an app also closes it, so the Apps tab never points at something that's gone
  const hide = (a: WebApp) => Alert.alert(`Hide ${a.name}?`, 'It closes now and leaves the Apps tab. You can show it again here; your sign-in is kept.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Hide', onPress: () => { closeApp(a.id); setSettings({ apps: s.apps.filter((x) => x !== a.id) }); } }]);
  const remove = (a: WebApp) => Alert.alert(`Remove ${a.name}?`, 'It’s removed from all your devices.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { closeApp(a.id); setSettings({ customApps: s.customApps.filter((x) => x.id !== a.id) }); } }]);
  return (
    <View style={{ gap: S(2) }}>
      <Card>
        {BUILTIN_APPS.map((a, i) => (
          <View key={a.id}>{i ? <Divider inset={16} /> : null}
            <SetRow title={a.name} desc={a.id === 'calendar' ? 'Outlook’s calendar on its own' : undefined}>
              <Switch label={`Show ${a.name}`} value={s.apps.includes(a.id)} onChange={(on) => (on ? setSettings({ apps: [...s.apps, a.id] }) : hide(a))} />
            </SetRow>
          </View>
        ))}
        {s.customApps.map((a) => (
          <View key={a.id}><Divider inset={16} />
            <SetRow title={a.name} desc={`${a.ai ? 'AI · ' : ''}${safeHost(a.url)}`}>
              <Button small kind="danger" label="Remove" onPress={() => remove(a)} />
            </SetRow>
          </View>
        ))}
        <Divider />
        <View style={{ padding: S(3) }}><Button small icon="plus" label="Add an app" onPress={() => setAdding(true)} /></View>
      </Card>
      <Txt kind="small" muted>Apps you add here also appear on your other devices. Google doesn’t allow “Continue with Google” inside apps, so sign in with your email, or open the app in your browser.</Txt>
      <AddApp open={adding} onClose={() => setAdding(false)} existing={s.customApps} onAdd={(a) => setSettings({ customApps: [...s.customApps, a] })} />
    </View>
  );
}

function YouCard() {
  const { wide } = useLayout();
  const s = useStore((x) => x.settings);
  // the field follows the saved nickname (it can change on another device) unless you're typing in it
  const [nick, setNick] = useState(s.nickname);
  const [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setNick(s.nickname); }, [s.nickname, typing]);
  useEffect(() => {
    if (!typing) return;
    const t = setTimeout(() => { const v = nick.trim().slice(0, 30); if (v !== s.nickname) setSettings({ nickname: v }); }, 600);
    return () => clearTimeout(t);
  }, [nick, typing, s.nickname]);
  return (
    <Card>
      <View style={{ padding: S(4), gap: S(2) }}>
        <Field label="Your nickname" value={nick} onChangeText={(v) => { setTyping(true); setNick(v); }} onBlur={() => setTyping(false)} placeholder="e.g. Kim" maxLength={30} returnKeyType="done" />
        <Txt kind="small" muted>WakeUp greets you with it on Today.</Txt>
      </View>
      <Divider />
      <SetRow title="Theme" stack={!wide}><Segmented label="Theme" value={s.theme} onChange={(theme) => setSettings({ theme })} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} /></SetRow>
      <Divider />
      <SetRow title="Vibration" desc={s.haptics === 'off' ? 'Off.' : s.haptics === 'full' ? 'On every tap, plus finishing tasks.' : 'Only when you finish or add a task, or a split snaps into place.'} stack={!wide}>
        <Segmented label="Vibration" value={s.haptics ?? 'subtle'} onChange={(haptics) => setSettings({ haptics })} options={[['off', 'Off'], ['subtle', 'Subtle'], ['full', 'Full']]} />
      </SetRow>
    </Card>
  );
}

function AboutCard() {
  const { wide } = useLayout();
  const u = useUpdate();
  const pct = Math.round(u.progress * 100);
  const desc = u.phase === 'checking' ? 'Checking for updates…'
    : u.phase === 'available' ? `WakeUp ${u.latest} is ready to install.${u.notes ? `\n${u.notes}` : ''}`
      : u.phase === 'downloading' ? `Downloading ${u.latest}… ${pct}%`
        : u.phase === 'ready' ? `WakeUp ${u.latest} is downloaded. Tap Install; Android asks once to allow installs from WakeUp.`
          : u.phase === 'error' ? `${u.error ?? 'The update didn’t work.'} Nothing was changed.`
            : u.phase === 'current' ? 'You have the latest version.' : 'WakeUp checks for a new version a few times a day.';
  return (
    <Card>
      <SetRow title={`WakeUp ${Constants.expoConfig?.version ?? ''}`} desc={desc} stack={!wide}>
        <View style={{ flexDirection: 'row', gap: S(2), flexWrap: 'wrap' }}>
          {u.phase === 'available' ? <Button small kind="primary" icon="download" label="Update now" onPress={() => { installUpdate(); }} />
            : u.phase === 'downloading' ? <Button small label="Cancel" onPress={cancelUpdate} />
              : u.phase === 'ready' ? <Button small kind="primary" label="Install" onPress={() => { installUpdate(); }} />
                : <Button small icon="reload" label="Check for updates" disabled={u.phase === 'checking'} onPress={() => { checkForUpdate(); }} />}
        </View>
      </SetRow>
      <Divider />
      <SetRow title="Check for updates automatically" desc="Looks on GitHub a few times a day. Nothing installs until you tap Update."><Switch label="Check for updates automatically" value={u.auto} onChange={setAutoUpdate} /></SetRow>
      <Divider />
      <SetRow title="Show the welcome tour again" desc="Your timetable and tasks stay as they are."><Button small label="Show" onPress={() => setOnboarded(false)} /></SetRow>
    </Card>
  );
}

const safeHost = (u: string) => { try { return new URL(u).host; } catch { return u; } };

function SetRow({ title, desc, children, stack }: { title: string; desc?: string; children?: React.ReactNode; stack?: boolean }) {
  return (
    <View style={{ padding: S(4), gap: S(3), flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'stretch' : 'center' }}>
      <View style={{ flex: stack ? undefined : 1, gap: 2 }}><Txt kind="headline" style={{ fontWeight: '500' }}>{title}</Txt>{desc ? <Txt kind="small" muted>{desc}</Txt> : null}</View>
      {children}
    </View>
  );
}

function AddApp({ open, onClose, onAdd, existing }: { open: boolean; onClose: () => void; onAdd: (a: WebApp) => void; existing: WebApp[] }) {
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [err, setErr] = useState('');
  const { c } = useTheme();
  const make = (n: string, u: string, color = '#5e6ad2', ai = false) => {
    let href: URL; try { href = new URL(/^https?:\/\//.test(u) ? u : `https://${u}`); } catch { setErr('That doesn’t look like a web address.'); return; }
    if (href.protocol !== 'https:') { setErr('Only secure (https) sites can be added.'); return; }
    const taken = new Set(existing.map((x) => x.name)); let nm = n.trim().slice(0, 32) || href.hostname; let k = 2; while (taken.has(nm)) nm = `${n} ${k++}`;
    onAdd({ id: `c-${nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'app'}-${Math.random().toString(36).slice(2, 6)}`, name: nm, url: href.href, color, custom: true, ai });
    setName(''); setUrl(''); setErr(''); onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add an app" footer={<><Button kind="plain" label="Cancel" onPress={onClose} /><Button kind="primary" label="Add" onPress={() => make(name, url)} disabled={!url.trim()} /></>}>
      <Txt kind="small" muted>AI assistants. Google blocks “Continue with Google” inside apps, so sign in with your email.</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(2) }}>
        {AI.map(([n, u, col]) => <Button key={n} small label={n} onPress={() => make(n, u, col, true)} />)}
      </View>
      <Divider />
      <Txt kind="small" muted>Any website</Txt>
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. MMU Portal" maxLength={32} />
      <Field label="Address" value={url} onChangeText={(v) => { setUrl(v); setErr(''); }} placeholder="https://…" keyboardType="url" autoCapitalize="none" autoCorrect={false} />
      {err ? <Txt kind="small" style={{ color: c.bad }}>{err}</Txt> : null}
    </Sheet>
  );
}
