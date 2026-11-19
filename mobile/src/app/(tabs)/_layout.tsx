// One navigator, four shapes. Phones: a floating glass bar (Today, Timetable, Tasks, Apps) with the liquid highlight
// (docs/DESIGN.md → Motion: two springs, the leading edge stiff and the trailing edge soft, so it stretches toward the
// new tab and settles). Settings opens from your avatar on Today. A phone on its side gets a slim rail; tablets get the
// desktop app's sidebar with Settings at the bottom. Tabs are peers: a quick cross-fade, no slide, each keeps its state.
import { Tabs, router, usePathname } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { haptic } from '../../lib/haptics';
import { Icon } from '../../ui/Icon';
import { AppTile } from '../../ui/AppTile';
import { Avatar } from '../../ui/Avatar';
import { Logo } from '../../ui/Logo';
import { Glass, GlassLayer } from '../../ui/Glass';
import { BarSpace, useLayout } from '../../ui/kit';
import { R, S, T, useTheme } from '../../ui/theme';
import { allApps, baseOf, focusedApp, kv, openApp, openSplit, useStore } from '../../lib/store';
import { useToday } from '../../lib/hooks';

const TABS: [string, string, string, string][] = [['index', 'Today', 'home', '/'], ['timetable', 'Timetable', 'cal', '/timetable'], ['tasks', 'Tasks', 'tasks', '/tasks'], ['apps', 'Apps', 'apps', '/apps']];
const BAR_H = 64;

type BarProps = { state: { index: number; routes: { key: string; name: string }[] }; navigateToTab: (routeKey: string) => void };

function useDue() {
  const today = useToday();
  return useStore((s) => { let n = 0; for (const x of s.planner.tasks) if (!x.done && x.due && x.due <= today) n++; return n; });
}

let collapsedSaved = kv.get<boolean>('nav.collapsed', false);
function Bar(p: BarProps) {
  const { size, sideways } = useLayout();
  if (size === 'medium' || size === 'expanded') return <SideBar {...p} />;
  return sideways ? <BottomBar {...p} rail /> : null;
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
          const on = route === 'apps' && shown.split(' ').map(baseOf).includes(a.id); // its tabs count as the app
          return item(a.id, a.name, <AppTile app={a} size={labels ? 24 : 30} />, on, () => openOne(a.id), 0, on && (focused ? baseOf(focused) : null) !== a.id, apps.length > 1 ? () => split(a.id) : undefined);
        }) : page('apps', 'Apps', 'apps')}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderColor: c.line, paddingTop: S(2) }}>
        {/* Settings is its own screen now (it opens from your avatar on phones); signed in, your picture sits beside it */}
        {item('settings', 'Settings',
          sync.signedIn && !labels ? <Avatar sync={sync} size={30} /> : <Icon name="settings" size={20} color={c.faint} />,
          false, () => { haptic('tap'); router.push('/settings'); }, 0, false, undefined, sync.signedIn && labels ? <Avatar sync={sync} size={24} /> : undefined)}
      </View>
    </View>
  );
}

// Phones: the floating glass bar. It lives beside the navigator (not inside it) so the blur can see the screens.
function FloatingBar() {
  const { c } = useTheme();
  const { size } = useLayout();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const due = useDue();
  const reduce = useReducedMotion();
  const icons = size === 'cover';
  const at = Math.max(0, TABS.findIndex((t) => t[3] !== '/' && (path === t[3] || path.startsWith(`${t[3]}/`))));
  const [w, setW] = useState(0);
  const PAD = 6;
  const slot = w ? (w - PAD * 2) / TABS.length : 0;
  // the two edges of the highlight; whichever leads the move springs stiff, the other soft
  const left = useSharedValue(0); const right = useSharedValue(0); const ready = useSharedValue(0);
  useEffect(() => {
    if (!slot) return;
    const L = PAD + at * slot; const Rt = L + slot;
    if (!ready.value || reduce) { left.set(L); right.set(Rt); ready.set(1); return; }
    const stiff = { stiffness: 520, damping: 33, mass: 1 }; const soft = { stiffness: 260, damping: 23, mass: 1 };
    const goingRight = L > left.value;
    left.set(withSpring(L, goingRight ? soft : stiff));
    right.set(withSpring(Rt, goingRight ? stiff : soft));
  }, [at, slot, reduce, left, right, ready]);
  const pill = useAnimatedStyle(() => ({ left: left.value, width: Math.max(0, right.value - left.value), opacity: withTiming(ready.value, { duration: 120 }) }));
  const go = (i: number) => {
    if (i !== at) haptic('tap');
    router.navigate(TABS[i][3] as '/');
  };
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom + S(2), paddingHorizontal: icons ? S(3) : S(4), alignItems: 'center' }}>
      <Glass radius={R.pill} style={{ width: '100%', maxWidth: 440 }}>
        <View accessibilityRole="tablist" onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height: icons ? 56 : BAR_H, flexDirection: 'row', paddingHorizontal: PAD, alignItems: 'center' }}>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: PAD, bottom: PAD, borderRadius: R.pill, borderCurve: 'continuous', backgroundColor: c.accentSoft }, pill]} />
          {TABS.map(([name, label, icon], i) => {
            const on = i === at; const fg = on ? c.accentText : c.muted;
            const badge = name === 'tasks' ? due : 0;
            return (
              <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={badge ? `${label}, ${badge} due` : label} onPress={() => go(i)}
                style={{ flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <View>
                  <Icon name={icon} size={22} color={fg} stroke={on ? 2 : 1.75} />
                  {badge ? <View style={{ position: 'absolute', top: -5, right: -10, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{badge}</Text></View> : null}
                </View>
                {!icons ? <Text numberOfLines={1} style={[T.tiny, { letterSpacing: 0, fontSize: 11, color: on ? c.accentText : c.muted, fontWeight: on ? '700' : '500' }]}>{label}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  const { size, sideways } = useLayout();
  const insets = useSafeAreaInsets();
  const side = size === 'medium' || size === 'expanded' || sideways;
  const floating = !side;
  const tabs = (
    <Tabs
      tabBar={(p) => <Bar {...(p as unknown as BarProps)} />}
      screenOptions={{ headerShown: false, tabBarPosition: side ? 'left' : 'bottom', sceneStyle: { backgroundColor: c.bg }, animation: 'fade', transitionSpec: { animation: 'timing', config: { duration: 140 } }, lazy: true }}
    >
      {TABS.map(([name, title]) => <Tabs.Screen key={name} name={name} options={{ title }} />)}
    </Tabs>
  );
  if (!floating) return tabs;
  return (
    <BarSpace.Provider value={(size === 'cover' ? 56 : BAR_H) + S(2) + insets.bottom}>
      <GlassLayer overlay={<FloatingBar />}>{tabs}</GlassLayer>
    </BarSpace.Provider>
  );
}
