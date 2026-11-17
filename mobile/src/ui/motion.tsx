// Gestures and motion shared by the screens. Everything runs on the UI thread (Reanimated), follows the finger,
// and settles with a short ease or spring. Android's "Remove animations" setting turns the springs off.
import { useCallback, useRef, type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Icon } from './Icon';
import { S, T, useTheme } from './theme';

const SETTLE = { damping: 22, stiffness: 240 };
export const enter = FadeIn.duration(180);
export const leave = FadeOut.duration(140);
export const move = LinearTransition.duration(200).easing(Easing.out(Easing.cubic));

// Swipe sideways to page (the week grid: left for next week, right for previous). The content follows the finger,
// slides out, and the next page slides in from the other side. Vertical scrolling still works.
export function SwipePager({ onSwipe, enabled = true, children }: { onSwipe: (dir: 1 | -1) => void; enabled?: boolean; children: ReactNode }) {
  const x = useSharedValue(0);
  const pan = usePanGesture({
    enabled,
    activeOffsetX: [-24, 24],
    failOffsetY: [-16, 16],
    onUpdate: (e) => { 'worklet'; x.value = e.translationX * 0.5; },
    onDeactivate: (e) => {
      'worklet';
      const far = Math.abs(e.translationX) > 90 || Math.abs(e.velocityX) > 700;
      if (e.canceled || !far) { x.value = withSpring(0, SETTLE); return; }
      const dir: 1 | -1 = e.translationX < 0 ? 1 : -1;
      x.value = withTiming(-dir * 72, { duration: 110 }, (done) => {
        if (!done) return;
        scheduleOnRN(onSwipe, dir);
        x.value = dir * 72;
        x.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
      });
    },
  });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], opacity: 1 - Math.min(Math.abs(x.value) / 180, 0.6) }));
  return <GestureDetector gesture={pan}><Animated.View style={style}>{children}</Animated.View></GestureDetector>;
}

// A list row you can swipe: right to finish (or reopen), left to show Delete.
export function SwipeRow({ done, onDone, onDelete, children }: { done: boolean; onDone: () => void; onDelete: () => void; children: ReactNode }) {
  const { c } = useTheme();
  const ref = useRef<SwipeableMethods>(null);
  const left = (progress: SharedValue<number>) => <Action progress={progress} side="left" bg={done ? c.active : '#1d7a4c'} fg={done ? c.text : '#fff'} icon={done ? 'reload' : 'check'} label={done ? 'Not done' : 'Done'} />;
  const right = (progress: SharedValue<number>, _t: SharedValue<number>, m: SwipeableMethods) => (
    <Action progress={progress} side="right" bg="#c4271b" fg="#fff" icon="trash" label="Delete" onPress={() => { m.close(); onDelete(); }} />
  );
  return (
    <ReanimatedSwipeable ref={ref} friction={1.6} leftThreshold={72} rightThreshold={56} overshootLeft={false} overshootRight={false} renderLeftActions={left} renderRightActions={right}
      onSwipeableOpen={(dir) => { if (dir === SwipeDirection.RIGHT) { ref.current?.close(); onDone(); } }}>
      {children}
    </ReanimatedSwipeable>
  );
}

function Action({ progress, side, bg, fg, icon, label, onPress }: { progress: SharedValue<number>; side: 'left' | 'right'; bg: string; fg: string; icon: string; label: string; onPress?: () => void }) {
  const style = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.4, 1], [0, 0.7, 1]), transform: [{ scale: interpolate(progress.value, [0, 1], [0.8, 1], 'clamp') }] }));
  const box = useAnimatedStyle(() => ({ opacity: progress.value > 0.01 ? 1 : 0 })); // hidden at rest, so no colour peeks at the card's corners
  const body = (
    <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: S(2) }, style]}>
      <Icon name={icon} size={18} color={fg} stroke={2} />
      <Text style={[T.small, { color: fg, fontWeight: '700' }]}>{label}</Text>
    </Animated.View>
  );
  return (
    <Animated.View style={[{ width: 120, backgroundColor: bg, alignItems: side === 'left' ? 'flex-start' : 'flex-end', justifyContent: 'center', paddingHorizontal: S(5) }, box]}>
      {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={12} style={{ paddingVertical: S(4) }}>{body}</Pressable> : body}
    </Animated.View>
  );
}

// Drag a sheet down by its top bar to close it
export function useDragToClose(onClose: () => void, enabled: boolean) {
  const y = useSharedValue(0);
  const pan = usePanGesture({
    enabled,
    activeOffsetY: 8,
    failOffsetX: [-20, 20],
    onUpdate: (e) => { 'worklet'; y.value = Math.max(0, e.translationY); },
    onDeactivate: (e) => {
      'worklet';
      if (!e.canceled && (e.translationY > 120 || e.velocityY > 900)) { y.value = withTiming(900, { duration: 180 }, () => scheduleOnRN(onClose)); return; }
      y.value = withSpring(0, SETTLE);
    },
  });
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const reset = useCallback(() => y.set(0), [y]);
  return { pan, style, reset };
}
