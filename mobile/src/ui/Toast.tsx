// Toasts (docs/DESIGN.md → Toast): a glass pill that drops from the top with an icon, one line and an optional
// action (Undo, Open). It stays 4 s, or until you swipe it up. Progress (an update download) shows in the same pill.
// One at a time: a new toast replaces the one on screen.
import { useEffect, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { R, S, T, useTheme } from './theme';
import { haptic } from '../lib/haptics';

export type ToastSpec = { id?: string; icon?: string; text: string; action?: { label: string; run: () => void }; ms?: number; progress?: number; tone?: 'bad' };
type Shown = ToastSpec & { id: string; at: number };

let current: Shown | null = null;
let last: Shown | null = null; // still drawn while it slides away
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let timer: ReturnType<typeof setTimeout> | null = null;

export function toast(spec: ToastSpec): string {
  const id = spec.id ?? Math.random().toString(36).slice(2);
  const same = current?.id === id;
  current = { ...spec, id, at: same && current ? current.at : Date.now() };
  last = current;
  if (timer) clearTimeout(timer);
  // progress stays until it's replaced or dismissed
  if (spec.progress == null) timer = setTimeout(() => dismissToast(id), spec.ms ?? 4000);
  if (!same) AccessibilityInfo.announceForAccessibility(spec.text);
  emit();
  return id;
}
export function dismissToast(id?: string) {
  if (!current || (id && current.id !== id)) return;
  current = null; if (timer) clearTimeout(timer); timer = null; emit();
}
// "Task deleted · Undo": the change is already made; Undo puts it back
export function undoToast(text: string, undo: () => void, icon = 'check') {
  return toast({ icon, text, action: { label: 'Undo', run: () => { haptic('light'); undo(); } } });
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => current;

export function ToastHost() {
  const live = useSyncExternalStore(subscribe, snapshot, snapshot);
  const t = live ?? last;
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const reduce = useReducedMotion();
  const y = useSharedValue(-140);
  const o = useSharedValue(0);
  const shown = !!live;
  useEffect(() => {
    if (shown) {
      if (reduce) { y.set(0); o.set(withTiming(1, { duration: 150 })); }
      else { y.set(withSpring(0, { duration: 300, dampingRatio: 0.8 })); o.set(withTiming(1, { duration: 120 })); }
    } else {
      // exits are faster than entrances
      y.set(withTiming(reduce ? 0 : -140, { duration: 180 })); o.set(withTiming(0, { duration: 160 }));
    }
  }, [shown, reduce, y, o]);
  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    onUpdate: (e) => { 'worklet'; y.set(e.translationY < 0 ? e.translationY : e.translationY * 0.2); },
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY < -24 || e.velocityY < -500) { scheduleOnRN(dismissToast); return; }
      y.set(withSpring(0, { duration: 400, dampingRatio: 1 }));
    },
  });
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  return (
    <Animated.View pointerEvents={shown ? 'box-none' : 'none'} style={[{ position: 'absolute', top: insets.top + S(2), left: S(4), right: S(4), alignItems: 'center' }, style]}>
      {t ? (
        <GestureDetector gesture={pan}>
          <Glass radius={R.pill} style={{ maxWidth: 520, minWidth: 220 }}>
            <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: S(3), minHeight: 52, paddingLeft: S(4), paddingRight: t.action ? S(1) : S(5) }}>
              {t.icon ? <Icon name={t.icon} size={18} color={t.tone === 'bad' ? c.bad : c.text} /> : null}
              <View style={{ flexShrink: 1, gap: 4, paddingVertical: S(3) }}>
                <Text numberOfLines={2} style={[T.small, { color: c.text, fontWeight: '600' }]}>{t.text}</Text>
                {t.progress != null ? (
                  <View style={{ height: 3, width: 180, borderRadius: 2, backgroundColor: c.lineStrong, overflow: 'hidden' }}>
                    <View style={{ height: 3, width: `${Math.round(Math.max(0, Math.min(1, t.progress)) * 100)}%`, backgroundColor: c.accent }} />
                  </View>
                ) : null}
              </View>
              {t.action && shown ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t.action.label} hitSlop={6}
                  onPress={() => { const run = t.action!.run; dismissToast(t.id); run(); }}
                  style={({ pressed }) => ({ height: 40, paddingHorizontal: S(4), borderRadius: R.pill, justifyContent: 'center', backgroundColor: pressed ? c.hover : 'transparent' })}>
                  <Text style={[T.small, { color: c.accentText, fontWeight: '700' }]}>{t.action.label}</Text>
                </Pressable>
              ) : null}
            </View>
          </Glass>
        </GestureDetector>
      ) : null}
    </Animated.View>
  );
}
