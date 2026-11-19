// Settings' sections (the routes are src/app/settings/*): account and sync, notifications, timetable, apps,
// appearance, privacy, about. Same words as the desktop app. Phones get a grouped list with a sub-page per
// section; landscape tablets get sections on the left and details on the right.
import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, View } from 'react-native';
import Constants from 'expo-constants';
import { Button, Card, Divider, Field, Row, Segmented, Sheet, Switch, Txt, useLayout } from './kit';
import { Icon } from './Icon';
import { S, useTheme } from './theme';
import { TimeField } from './DateField';
import { BUILTIN_APPS, closeApp, setOnboarded, setSettings, useStore } from '../lib/store';
import { cancelUpdate, checkForUpdate, installUpdate, setAutoUpdate, useUpdate } from '../lib/updater';
import { deleteCloudData, flush, retryRefused, signIn, signOut } from '../lib/sync';
import { askPermission, openSystemSettings, permission, rescheduleSoon, type Permission } from '../lib/reminders';
import { fmtTime } from '../lib/format';
import type { WebApp } from '../lib/types';
import { Legal, Look } from '../lib/shared';
import { Avatar } from './Avatar';
import { forgetSignIn, saveSignIn, savedEmail } from '../lib/signins';
import { toast } from './Toast';

const AI: [string, string, string][] = [
  ['ChatGPT', 'https://chatgpt.com/', '#10a37f'], ['Claude', 'https://claude.ai/', '#d97757'], ['Gemini', 'https://gemini.google.com/', '#4285f4'],
  ['Copilot', 'https://copilot.microsoft.com/', '#2b63d9'], ['Perplexity', 'https://www.perplexity.ai/', '#20808d'], ['DeepSeek', 'https://chat.deepseek.com/', '#4d6bfe'],
  ['NotebookLM', 'https://notebooklm.google.com/', '#202124'],
];
const ago = (iso: string | null) => { if (!iso) return 'not yet'; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };

export type SecId = 'sync' | 'notify' | 'timetable' | 'apps' | 'you' | 'privacy' | 'about';
export const SECTIONS: [SecId, string, string][] = [['sync', 'Account and sync', 'cloud'], ['notify', 'Notifications', 'bell'], ['timetable', 'Timetable', 'cal'], ['apps', 'Apps', 'apps'], ['you', 'Appearance and you', 'palette'], ['privacy', 'Privacy & Legal', 'scale'], ['about', 'About', 'info']];

export function SectionBody({ id }: { id: SecId }) {
  if (id === 'sync') return <SyncCard />;
  if (id === 'notify') return <NotifyCard />;
  if (id === 'timetable') return <TimetableCard />;
  if (id === 'apps') return <AppsCard />;
  if (id === 'you') return <YouCard />;
  if (id === 'privacy') return <PrivacyCard />;
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
        <Row><Avatar sync={sync} size={40} /><View style={{ flex: 1 }}><Txt kind="headline">{sync.name || sync.email}</Txt><Txt kind="small" muted style={bad ? { color: c.bad } : undefined}>{sync.name ? `${sync.email} · ` : ''}{syncText}</Txt>
          {sync.rejected ? <Txt kind="small" style={{ color: c.bad, marginTop: 4 }}>{`${n(sync.rejected, 'item')} couldn’t sync and stay on this device only${sync.refused?.length ? `: ${sync.refused.join(', ')}${sync.rejected > sync.refused.length ? '…' : ''}` : ''}.`}</Txt> : null}
          {sync.rejected ? <View style={{ alignItems: 'flex-start', marginTop: S(1) }}><Button small kind="plain" label="Try again" onPress={() => { retryRefused(); }} /></View> : null}</View></Row>
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
            {a.id === 'teams' && s.apps.includes('teams') ? (
              <SetRow title="Teams offline cache" desc="Off stops Teams’ black “Web page not available” screen. On lets Teams open a little faster.">
                <Switch label="Teams offline cache" value={!!s.teamsCache} onChange={(on) => setSettings({ teamsCache: on })} />
              </SetRow>
            ) : null}
          </View>
        ))}
        {s.customApps.map((a) => (
          <View key={a.id}><Divider inset={16} />
            <SetRow title={a.name} desc={`${a.ai ? 'AI · ' : ''}${safeHost(a.url)}${a.external ? ' · opens in Chrome' : ''}`}>
              <Button small kind="danger" label="Remove" onPress={() => remove(a)} />
            </SetRow>
            <SetRow title="Open in browser" desc="For sites that won’t let you sign in inside WakeUp, like Google’s (NotebookLM).">
              <Switch label={`Open ${a.name} in the browser`} value={!!a.external} onChange={(on) => { if (on) closeApp(a.id); setSettings({ customApps: s.customApps.map((x) => (x.id === a.id ? { ...x, external: on } : x)) }); }} />
            </SetRow>
          </View>
        ))}
        <Divider />
        <View style={{ padding: S(3) }}><Button small icon="plus" label="Add an app" onPress={() => setAdding(true)} /></View>
      </Card>
      <Txt kind="small" muted>Apps you add here also appear on your other devices. Google doesn’t allow “Continue with Google” inside apps, so sign in with your email, or open the app in your browser.</Txt>
      <SignInCard />
      <AddApp open={adding} onClose={() => setAdding(false)} existing={s.customApps} onAdd={(a) => setSettings({ customApps: [...s.customApps, a] })} />
    </View>
  );
}

function YouCard() {
  const { wide } = useLayout();
  const s = useStore((x) => x.settings);
  // the field shows the saved nickname (it can change on another device) unless you're typing in it
  const [draft, setDraft] = useState<string | null>(null);
  const nick = draft ?? s.nickname;
  useEffect(() => {
    if (draft == null) return;
    const t = setTimeout(() => { const v = draft.trim().slice(0, 30); if (v !== s.nickname) setSettings({ nickname: v }); }, 600);
    return () => clearTimeout(t);
  }, [draft, s.nickname]);
  // leaving the field saves what's there at once
  const done = () => { if (draft != null) { const v = draft.trim().slice(0, 30); if (v !== s.nickname) setSettings({ nickname: v }); setDraft(null); } };
  return (
    <View style={{ gap: S(4) }}>
    <Card>
      <View style={{ padding: S(4), gap: S(2) }}>
        <Field label="Your nickname" value={nick} onChangeText={setDraft} onBlur={done} placeholder="e.g. Kim" maxLength={30} returnKeyType="done" />
        <Txt kind="small" muted>WakeUp greets you with it on Today.</Txt>
      </View>
      <Divider />
      <SetRow title="Theme" stack={!wide}><Segmented label="Theme" value={s.theme} onChange={(theme) => setSettings({ theme })} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} /></SetRow>
      <Divider />
      <SetRow title="Vibration" desc={s.haptics === 'off' ? 'Off.' : s.haptics === 'full' ? 'On every tap, plus finishing tasks.' : 'Only when you finish or add a task, or a split snaps into place.'} stack={!wide}>
        <Segmented label="Vibration" value={s.haptics ?? 'subtle'} onChange={(haptics) => setSettings({ haptics })} options={[['off', 'Off'], ['subtle', 'Subtle'], ['full', 'Full']]} />
      </SetRow>
      <Divider />
      <SetRow title="Accent colour" desc={`${Look.ACCENTS.find((a) => a[0] === (s.accent ?? 'blue'))?.[1] ?? 'Blue'}. Buttons, links and highlights; it follows you to your other devices.`} stack>
        <Swatches value={s.accent ?? 'blue'} onChange={(accent) => setSettings({ accent })} />
      </SetRow>
    </Card>
    <TodayCard />
    </View>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(3) }}>
      {Look.ACCENTS.map(([id, name, light]) => {
        const on = id === value;
        return (
          <Pressable key={id} accessibilityRole="radio" accessibilityLabel={name} accessibilityState={{ checked: on }} hitSlop={4} onPress={() => onChange(id)}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: on ? light[0] : 'transparent' }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: light[0], alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line }}>
              {on ? <Icon name="check" size={16} color="#fff" stroke={2.4} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// The Today sections a phone or tablet can show (the others are the computer's: recent files, desktop quick add)
export const MOBILE_TODAY = ['next', 'classes', 'tasks', 'week', 'apps'];

// Today's sections: order and which show. Synced; the phone, tablet and computer each lay them out to fit.
function TodayCard() {
  const { c } = useTheme();
  const today = useStore((x) => x.settings.today);
  const t = Look.cleanToday(today);
  const ids = t.order.filter((id) => MOBILE_TODAY.includes(id));
  // the desktop-only sections sit between these in the synced order, so a move steps past them
  const move = (id: string, dir: 1 | -1) => {
    const at = ids.indexOf(id); let v = t;
    for (let k = 0; k < t.order.length; k++) {
      v = Look.moveToday(v, id, dir);
      const now = v.order.filter((x) => MOBILE_TODAY.includes(x)).indexOf(id);
      if (now !== at || v.order.indexOf(id) === (dir < 0 ? 0 : v.order.length - 1)) break;
    }
    setSettings({ today: v });
  };
  return (
    <View style={{ gap: S(2) }}>
      <Txt kind="headline">Today page</Txt>
      <Txt kind="small" muted>Choose what Today shows and in what order. It syncs; your phone, tablet and computer each lay it out to fit.</Txt>
      <Card>
        {ids.map((id, i) => {
          const [, name, desc] = Look.TODAY.find((x) => x[0] === id)!; const on = !t.hidden.includes(id);
          return (
            <View key={id}>
              {i ? <Divider inset={16} /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2), paddingVertical: S(3), paddingLeft: S(4), paddingRight: S(3) }}>
                <View style={{ flex: 1, gap: 2, opacity: on ? 1 : 0.55 }}><Txt kind="headline" style={{ fontWeight: '500' }}>{name}</Txt><Txt kind="small" muted>{desc}</Txt></View>
                <MoveBtn dir={-1} name={name} disabled={i === 0} onPress={() => move(id, -1)} color={c.muted} />
                <MoveBtn dir={1} name={name} disabled={i === ids.length - 1} onPress={() => move(id, 1)} color={c.muted} />
                <Switch label={`Show ${name}`} value={on} onChange={(v) => setSettings({ today: Look.showToday(t, id, v) })} />
              </View>
            </View>
          );
        })}
        <Divider />
        <View style={{ padding: S(3) }}><Button small kind="plain" label="Reset to default" onPress={() => setSettings({ today: Look.todayDefault() })} /></View>
      </Card>
    </View>
  );
}
function MoveBtn({ dir, name, disabled, onPress, color }: { dir: 1 | -1; name: string; disabled: boolean; onPress: () => void; color: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Move ${name} ${dir < 0 ? 'up' : 'down'}`} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={4}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1, backgroundColor: pressed ? c.hover : 'transparent' })}>
      <View style={{ transform: [{ rotate: dir < 0 ? '-90deg' : '90deg' }] }}><Icon name="chevR" size={16} color={color} /></View>
    </Pressable>
  );
}


// Privacy & Legal: your cloud data, the privacy policy (src/ui/legal.js, the same text as PRIVACY.md) and the legal notes
function PrivacyCard() {
  const { c } = useTheme();
  const { wide } = useLayout();
  const sync = useStore((x) => x.sync);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const on = sync.signedIn && sync.phase !== 'expired' && !busy;
  const run = (all: boolean) => {
    setBusy(true); setMsg(null);
    (all ? signOut({ everywhere: true }) : deleteCloudData())
      .then(() => setMsg({ ok: true, text: all ? 'Signed out on every device.' : 'Your cloud data is deleted and every device is signed out.' }))
      .catch((e: Error) => setMsg({ ok: false, text: e.message }))
      .finally(() => setBusy(false));
  };
  const everywhere = () => Alert.alert('Sign out everywhere?', 'Your WakeUp sign-in ends on every computer, phone and tablet, this one included. Each keeps its own timetable and tasks.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out everywhere', onPress: () => run(true) }]);
  const wipe = () => Alert.alert('Delete your cloud data?', 'Your timetable, tasks and settings are removed from WakeUp’s database. This can’t be undone. Every device is signed out; each keeps its own copy, and signing in again uploads that device’s copy.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => run(false) }]);
  const open = (u: string) => { Linking.openURL(u).catch(() => {}); };
  return (
    <View style={{ gap: S(6) }}>
      <Card>
        {sync.signedIn ? <>
          <SetRow title="Sign out everywhere" desc="Ends your WakeUp sign-in on every device, this one included. Others notice within an hour." stack={!wide}>
            <Button small label="Sign out everywhere" onPress={everywhere} disabled={!on} />
          </SetRow>
          <Divider />
          <SetRow title="Delete my cloud data" desc="Removes everything WakeUp stored for you in its database and signs out every device. Nothing on this device is deleted." stack={!wide}>
            <Button small kind="danger" label={busy ? 'Working…' : 'Delete my cloud data'} onPress={wipe} disabled={!on} />
          </SetRow>
        </> : <SetRow title="Not signed in" desc="Nothing of yours is in WakeUp’s database from this device." />}
        {msg ? <Txt kind="small" style={{ color: msg.ok ? c.good : c.bad, paddingHorizontal: S(4), paddingBottom: S(4) }}>{msg.text}</Txt> : null}
      </Card>
      <Card>
        <SetRow title="Privacy policy" desc={`What WakeUp keeps, where, and why. Updated ${Legal.UPDATED}.`} stack={!wide}><Button small label="Read it" onPress={() => open(`${Legal.REPO}/blob/main/PRIVACY.md`)} /></SetRow>
        <Divider />
        <SetRow title={Legal.COPYRIGHT} desc={Legal.DISCLAIMER} />
        <Divider />
        <SetRow title="Licence" desc="You may use the official builds for yourself. The code may not be copied or redistributed." stack={!wide}><Button small label="Read the licence" onPress={() => open(Legal.LICENSE)} /></SetRow>
        <Divider />
        <SetRow title="Open-source software" desc="WakeUp is built with open-source software. Each piece keeps its own licence." stack={!wide}><Button small label="View notices" onPress={() => open(Legal.NOTICES)} /></SetRow>
        <Divider />
        <SetRow title="Questions or requests" desc="Ask on GitHub, for example to delete your sign-in account." stack={!wide}><Button small label="Open GitHub" onPress={() => open(Legal.CONTACT)} /></SetRow>
      </Card>
    </View>
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

// Saved sign-in (v3): one Microsoft account, typed into Microsoft's sign-in page for Ebwise, Outlook and Teams.
// Encrypted on this phone (Android Keystore) and never synced; the password field is never filled back in.
function SignInCard() {
  const { c } = useTheme();
  const [email, setEmail] = useState<string | null | undefined>(undefined); // undefined while reading
  const [draft, setDraft] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  useEffect(() => { savedEmail().then(setEmail).catch(() => setEmail(null)); }, []);
  const save = async () => {
    try { await saveSignIn(draft.email, draft.password); setEmail(draft.email.trim()); setDraft({ email: '', password: '' }); setErr(''); toast({ icon: 'check', text: 'Microsoft sign-in saved on this phone' }); }
    catch (e) { setErr((e as Error).message); }
  };
  const forget = () => Alert.alert('Forget the saved sign-in?', 'WakeUp stops typing it into Microsoft’s sign-in page. Apps you’re signed in to stay signed in.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Forget', style: 'destructive', onPress: () => { forgetSignIn().then(() => { setEmail(null); toast({ icon: 'check', text: 'Saved sign-in forgotten' }); }); } }]);
  if (email === undefined) return null;
  return (
    <View style={{ gap: S(2), marginTop: S(4) }}>
      <Txt kind="headline">Saved sign-in</Txt>
      <Txt kind="small" muted>Kept encrypted on this phone only. It never syncs, and WakeUp types it into Microsoft’s sign-in page and nowhere else. You still press Sign in.</Txt>
      <Card>
        {email ? (
          <SetRow title="Microsoft account" desc={email}><Button small kind="danger" label="Forget" onPress={forget} /></SetRow>
        ) : (
          <View style={{ padding: S(4), gap: S(3) }}>
            <Field label="Email" value={draft.email} onChangeText={(v) => setDraft({ ...draft, email: v })} placeholder="you@student.mmu.edu.my" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="off" />
            <Field label="Password" value={draft.password} onChangeText={(v) => setDraft({ ...draft, password: v })} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" />
            {err ? <Txt kind="small" style={{ color: c.bad }}>{err}</Txt> : null}
            <Button small kind="primary" label="Save" onPress={save} disabled={!draft.email.trim() || !draft.password} />
          </View>
        )}
      </Card>
    </View>
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
