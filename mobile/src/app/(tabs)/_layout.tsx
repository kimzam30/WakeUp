// One navigator, four shapes: a bottom bar on phones (icons only on the Flip's cover screen), a slim rail on a
// phone held sideways, a rail on tablet portrait, and a labelled sidebar (collapsible) on a landscape tablet.
// Tabs are peers: no slide between them, each keeps its state.
import { Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Icon } from '../../ui/Icon';
import { useLayout } from '../../ui/kit';
import { R, S, T, useTheme } from '../../ui/theme';
import { kv, useStore } from '../../lib/store';
import { useToday } from '../../lib/hooks';
import { useState } from 'react';

const TABS: [string, string, string][] = [['index', 'Today', 'home'], ['timetable', 'Timetable', 'cal'], ['tasks', 'Tasks', 'tasks'], ['apps', 'Apps', 'apps'], ['settings', 'Settings', 'settings']];

type BarProps = { state: { index: number; routes: { key: string; name: string }[] }; navigateToTab: (routeKey: string) => void };

let collapsedSaved = kv.get<boolean>('nav.collapsed', false);
function Bar({ state, navigateToTab }: BarProps) {
  const { c } = useTheme();
  const { size, sideways } = useLayout();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const due = useStore((s) => { let n = 0; for (const x of s.planner.tasks) if (!x.done && x.due && x.due <= today) n++; return n; });
  const [collapsed, setCollapsed] = useState(collapsedSaved);
  const side = size === 'medium' || size === 'expanded' || sideways;
  const labels = size === 'expanded' && !collapsed;
  // navigateToTab sends tabPress, switches tab, and pops the tab's stack when you tap the tab you're on
  const go = (i: number) => { if (state.index !== i) Haptics.selectionAsync().catch(() => {}); navigateToTab(state.routes[i].key); };
  const items = state.routes.map((r, i) => {
    const t = TABS.find((x) => x[0] === r.name); if (!t) return null;
    const on = state.index === i; const fg = on ? c.accentText : c.muted;
    const badge = r.name === 'tasks' && due ? due : 0;
    if (side) {
      return (
        <Pressable key={r.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t[1]} onPress={() => go(i)}
          style={({ pressed }) => ({ flexDirection: labels ? 'row' : 'column', alignItems: 'center', gap: labels ? S(3) : 2, minHeight: labels ? 44 : sideways ? 52 : 60, flex: sideways ? 1 : undefined, maxHeight: sideways ? 64 : undefined, paddingHorizontal: labels ? S(3) : 0, justifyContent: labels ? 'flex-start' : 'center', borderRadius: R.input, backgroundColor: on ? c.accentSoft : pressed ? c.hover : 'transparent' })}>
          <Icon name={t[2]} size={20} color={fg} />
          {sideways ? null : <Text style={[labels ? T.body : { fontSize: 11, lineHeight: 14 }, { color: on ? c.text : c.muted, fontWeight: on ? '600' : '500', flex: labels ? 1 : undefined }]}>{t[1]}</Text>}
          {badge ? <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, position: labels ? 'relative' : 'absolute', top: labels ? undefined : 6, right: labels ? undefined : 14 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{badge}</Text></View> : null}
        </Pressable>
      );
    }
    return (
      <Pressable key={r.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t[1]} onPress={() => go(i)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: size === 'cover' ? 56 : 64 }}>
        <View style={{ width: 56, height: 30, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accentSoft : 'transparent' }}>
          <Icon name={t[2]} size={20} color={fg} />
          {badge ? <View style={{ position: 'absolute', top: 0, right: 8, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{badge}</Text></View> : null}
        </View>
        {size !== 'cover' ? <Text style={{ fontSize: 12, lineHeight: 16, color: on ? c.text : c.muted, fontWeight: on ? '600' : '500' }}>{t[1]}</Text> : null}
      </Pressable>
    );
  });
  if (side) {
    return (
      <View style={{ width: labels ? 232 : sideways ? 72 : 84, backgroundColor: c.side, borderRightWidth: 1, borderColor: c.line, paddingTop: sideways ? insets.top + S(2) : insets.top + S(4), paddingBottom: insets.bottom + S(4), paddingLeft: (labels ? S(3) : S(2)) + (sideways ? insets.left : 0), paddingRight: labels ? S(3) : S(2), gap: sideways ? 0 : S(1) }}>
        {size === 'expanded' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: labels ? 'space-between' : 'center', marginBottom: S(4), minHeight: 44, paddingLeft: labels ? S(3) : 0 }}>
            {labels ? <Text style={[T.title, { color: c.text }]}>WakeUp</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} hitSlop={8}
              onPress={() => { const v = !collapsed; collapsedSaved = v; kv.set('nav.collapsed', v); setCollapsed(v); }}
              style={({ pressed }) => ({ width: 40, height: 40, borderRadius: R.input, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.hover : 'transparent' })}>
              <Icon name={collapsed ? 'chevR' : 'chevL'} size={18} color={c.muted} />
            </Pressable>
          </View>
        ) : sideways ? null : <View style={{ height: S(4) }} />}
        {items}
      </View>
    );
  }
  return <View style={{ flexDirection: 'row', backgroundColor: c.side, borderTopWidth: 1, borderColor: c.line, paddingBottom: insets.bottom, paddingHorizontal: S(1) }}>{items}</View>;
}

export default function TabsLayout() {
  const { c } = useTheme();
  const { size, sideways } = useLayout();
  const side = size === 'medium' || size === 'expanded' || sideways;
  return (
    <Tabs
      tabBar={(p) => <Bar {...(p as unknown as BarProps)} />}
      screenOptions={{ headerShown: false, tabBarPosition: side ? 'left' : 'bottom', sceneStyle: { backgroundColor: c.bg }, animation: 'none', lazy: true }}
    >
      {TABS.map(([name, title]) => <Tabs.Screen key={name} name={name} options={{ title }} />)}
    </Tabs>
  );
}
