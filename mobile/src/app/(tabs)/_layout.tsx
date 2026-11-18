// One navigator, four shapes: a bottom bar on phones (icons only on the Flip's cover screen), a slim rail on a
// phone held sideways, and on tablets the desktop app's sidebar: Today, Timetable and Tasks, then your apps by
// name, then Settings below a line. A landscape tablet shows it with labels (collapsible to a rail); portrait shows
// the rail. Tabs are peers: a quick cross-fade between them, no slide, and each keeps its state.
import { Tabs } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '../../lib/haptics';
import { Icon } from '../../ui/Icon';
import { AppTile } from '../../ui/AppTile';
import { Avatar } from '../../ui/Avatar';
import { Logo } from '../../ui/Logo';
import { useLayout } from '../../ui/kit';
import { R, S, T, useTheme } from '../../ui/theme';
import { allApps, focusedApp, kv, openApp, openSplit, useStore } from '../../lib/store';
import { useToday } from '../../lib/hooks';

const TABS: [string, string, string][] = [['index', 'Today', 'home'], ['timetable', 'Timetable', 'cal'], ['tasks', 'Tasks', 'tasks'], ['apps', 'Apps', 'apps'], ['settings', 'Settings', 'settings']];

type BarProps = { state: { index: number; routes: { key: string; name: string }[] }; navigateToTab: (routeKey: string) => void };

function useDue() {
  const today = useToday();
  return useStore((s) => { let n = 0; for (const x of s.planner.tasks) if (!x.done && x.due && x.due <= today) n++; return n; });
}

let collapsedSaved = kv.get<boolean>('nav.collapsed', false);
function Bar(p: BarProps) {
  const { size, sideways } = useLayout();
  if (size === 'medium' || size === 'expanded') return <SideBar {...p} />;
  return <BottomBar {...p} rail={sideways} />;
}

// Phones: a bottom bar (a slim rail when held sideways)
function BottomBar({ state, navigateToTab, rail }: BarProps & { rail: boolean }) {
  const { c } = useTheme();
  const { size } = useLayout();
  const insets = useSafeAreaInsets();
  const due = useDue();
  // navigateToTab sends tabPress, switches tab, and pops the tab's stack when you tap the tab you're on
  const go = (i: number) => { if (state.index !== i) haptic('tap'); navigateToTab(state.routes[i].key); };
  const items = state.routes.map((r, i) => {
    const t = TABS.find((x) => x[0] === r.name); if (!t) return null;
    const on = state.index === i; const fg = on ? c.accentText : c.muted;
    const badge = r.name === 'tasks' && due ? due : 0;
    return (
      <Pressable key={r.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t[1]} onPress={() => go(i)}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: rail ? 52 : size === 'cover' ? 56 : 64, maxHeight: rail ? 64 : undefined }}>
        <View style={{ width: 56, height: 30, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accentSoft : 'transparent' }}>
          <Icon name={t[2]} size={20} color={fg} />
          {badge ? <View style={{ position: 'absolute', top: 0, right: 8, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{badge}</Text></View> : null}
        </View>
        {size !== 'cover' && !rail ? <Text style={{ fontSize: 12, lineHeight: 16, color: on ? c.text : c.muted, fontWeight: on ? '600' : '500' }}>{t[1]}</Text> : null}
      </Pressable>
    );
  });
  if (rail) return <View style={{ width: 72, backgroundColor: c.side, borderRightWidth: 1, borderColor: c.line, paddingTop: insets.top + S(2), paddingBottom: insets.bottom + S(2), paddingLeft: insets.left }}>{items}</View>;
  return <View style={{ flexDirection: 'row', backgroundColor: c.side, borderTopWidth: 1, borderColor: c.line, paddingBottom: insets.bottom, paddingHorizontal: S(1) }}>{items}</View>;
}

// Tablets: the desktop sidebar
function SideBar({ state, navigateToTab }: BarProps) {
  const { c } = useTheme();
  const { size } = useLayout();
  const insets = useSafeAreaInsets();
  const due = useDue();
  const settings = useStore((s) => s.settings);
  const apps = useMemo(() => allApps(settings), [settings]);
  const shown = useStore((s) => (s.split ? `${s.split.a} ${s.split.b}` : s.activeApp ?? ''));
  const focused = useStore(focusedApp);
  const sync = useStore((s) => s.sync);
  const [collapsed, setCollapsed] = useState(collapsedSaved);
  const labels = size === 'expanded' && !collapsed;
  const route = state.routes[state.index]?.name;
  const tab = (name: string) => {
    const i = state.routes.findIndex((r) => r.name === name);
    if (i >= 0) { if (state.index !== i) haptic('tap'); navigateToTab(state.routes[i].key); }
  };
  // long-press: open it beside the app on screen (split view), as the Apps tab's own switcher does
  const split = (id: string) => { haptic('tap'); if (focused && focused !== id) openSplit(id); else openApp(id); tab('apps'); };
  const openOne = (id: string) => { if (route !== 'apps' || focused !== id) haptic('tap'); openApp(id); tab('apps'); };

  // one row: an icon or tile, then (with labels) its name and a count
  const item = (key: string, label: string, icon: ReactNode, on: boolean, onPress: () => void, badge = 0, soft = false, onLongPress?: () => void, end?: ReactNode) => (
    <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={badge ? `${label}, ${badge} due` : label} onPress={onPress} onLongPress={onLongPress} accessibilityHint={onLongPress ? 'Long-press to open beside the app on screen' : undefined}
      style={({ pressed }) => ({
        flexDirection: labels ? 'row' : 'column', alignItems: 'center', justifyContent: labels ? 'flex-start' : 'center', gap: labels ? S(3) : 2,
        minHeight: labels ? 44 : 52, paddingHorizontal: labels ? S(3) : 0, borderRadius: R.input,
        backgroundColor: on ? (soft ? c.hover : c.active) : pressed ? c.hover : 'transparent',
      })}>
      {icon}
      {labels ? <Text numberOfLines={1} style={[T.body, { flex: 1, color: on ? c.text : c.muted, fontWeight: on ? '600' : '500' }]}>{label}</Text> : null}
      {badge ? (labels
        ? <Text style={[T.small, { color: c.accentText, fontWeight: '700', fontVariant: ['tabular-nums'] }]}>{badge}</Text>
        : <View style={{ position: 'absolute', top: 4, right: 12, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{badge}</Text></View>) : null}
      {end}
    </Pressable>
  );
  const page = (name: string, label: string, icon: string, badge = 0) => {
    const on = route === name;
    return item(name, label, <Icon name={icon} size={20} color={on ? c.text : c.faint} />, on, () => tab(name), badge);
  };

  return (
    <View style={{ width: labels ? 248 : 76, backgroundColor: c.side, borderRightWidth: 1, borderColor: c.line, paddingTop: insets.top + S(3), paddingBottom: insets.bottom + S(3), paddingHorizontal: labels ? S(3) : S(2) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: labels ? 'space-between' : 'center', minHeight: 48, marginBottom: S(2), paddingLeft: labels ? S(2) : 0 }}>
        {labels ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2) }}><Logo size={28} /><Text style={[T.headline, { color: c.text, fontSize: 17 }]}>WakeUp</Text></View> : null}
        {size === 'expanded' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} hitSlop={8}
            onPress={() => { const v = !collapsed; collapsedSaved = v; kv.set('nav.collapsed', v); setCollapsed(v); }}
            style={({ pressed }) => ({ width: 40, height: 40, borderRadius: R.input, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.hover : 'transparent' })}>
            <Icon name="sidebar" size={18} color={c.muted} />
          </Pressable>
        ) : <Logo size={32} />}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 2, paddingBottom: S(3) }} showsVerticalScrollIndicator={false}>
        {page('index', 'Today', 'home')}
        {page('timetable', 'Timetable', 'cal')}
        {page('tasks', 'Tasks', 'tasks', due)}
        {labels ? (
          <Pressable accessibilityRole="button" accessibilityLabel="All apps" onPress={() => { openApp(null); tab('apps'); }} hitSlop={4}
            style={{ flexDirection: 'row', alignItems: 'center', paddingTop: S(4), paddingBottom: S(1), paddingHorizontal: S(3) }}>
            <Text style={[T.small, { flex: 1, color: route === 'apps' && !shown ? c.text : c.faint, fontWeight: '500' }]}>Apps</Text>
            <Icon name="apps" size={14} color={c.faint} />
          </Pressable>
        ) : <View style={{ height: 1, backgroundColor: c.line, marginVertical: S(2), marginHorizontal: S(2) }} />}
        {apps.length ? apps.map((a) => {
          const on = route === 'apps' && shown.split(' ').includes(a.id);
          return item(a.id, a.name, <AppTile app={a} size={labels ? 24 : 30} />, on, () => openOne(a.id), 0, on && focused !== a.id, apps.length > 1 ? () => split(a.id) : undefined);
        }) : page('apps', 'Apps', 'apps')}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderColor: c.line, paddingTop: S(2) }}>
        {/* signed in: your profile picture sits beside Settings (or takes the gear's place on the rail) */}
        {sync.signedIn ? (() => {
          const on = route === 'settings';
          const pic = <Avatar sync={sync} size={labels ? 24 : 30} />;
          return labels
            ? item('settings', 'Settings', <Icon name="settings" size={20} color={on ? c.text : c.faint} />, on, () => tab('settings'), 0, false, undefined, pic)
            : item('settings', `Settings, signed in as ${sync.name || sync.email}`, pic, on, () => tab('settings'));
        })() : page('settings', 'Settings', 'settings')}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  const { size, sideways } = useLayout();
  const side = size === 'medium' || size === 'expanded' || sideways;
  return (
    <Tabs
      tabBar={(p) => <Bar {...(p as unknown as BarProps)} />}
      screenOptions={{ headerShown: false, tabBarPosition: side ? 'left' : 'bottom', sceneStyle: { backgroundColor: c.bg }, animation: 'fade', transitionSpec: { animation: 'timing', config: { duration: 140 } }, lazy: true }}
    >
      {TABS.map(([name, title]) => <Tabs.Screen key={name} name={name} options={{ title }} />)}
    </Tabs>
  );
}
