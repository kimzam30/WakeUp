// The focus timer card at the top of Tasks: start a 25-minute focus (on a task, or just in general), then breaks.
// It counts down every second only while it's on screen; the notification takes over when the app is closed.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { haptic } from '../lib/haptics';
import { focus, useFocus } from '../lib/focus';
import { Focus } from '../lib/shared';
import { useStore } from '../lib/store';
import { useActive } from '../lib/hooks';
import { useIsFocused } from 'expo-router';
import { Button, Card, IconButton, Txt } from './kit';
import { R, S, useTheme } from './theme';

export function FocusCard() {
  const { c } = useTheme();
  const s = useFocus();
  const task = useStore((st) => (s.taskId ? st.planner.tasks.find((t) => t.id === s.taskId && !t.done) : undefined));
  const [now, setNow] = useState(() => Date.now());
  const act = (fn: () => void) => { fn(); setNow(Date.now()); };
  const running = s.phase !== 'idle' && !Focus.paused(s);
  // ticks only while you can see it (the end alert is a scheduled notification, so nothing depends on this)
  const focusedScreen = useIsFocused(); const appActive = useActive();
  const shown = focusedScreen && appActive;
  useEffect(() => {
    if (!running || !shown) return;
    const step = () => { if (focus.tick()) haptic('success'); setNow(Date.now()); };
    const first = setTimeout(step, 0); // catch up straight away when it comes back on screen
    const t = setInterval(step, 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [running, shown]);
  const total = s.phase === 'idle' ? 1 : Focus.LENGTHS[s.phase] * 60e3;
  const left = Math.min(total, Focus.remaining(s, now));
  const done = s.phase === 'idle' ? 0 : Math.max(0, Math.min(1, 1 - left / total));
  const bar = useAnimatedStyle(() => ({ width: withTiming(`${done * 100}%`, { duration: 900 }) }), [done]);
  const brk = s.phase === 'short' || s.phase === 'long';

  if (s.phase === 'idle') {
    return (
      <Card style={{ padding: S(3), flexDirection: 'row', alignItems: 'center', gap: S(3) }}>
        <View style={{ flex: 1 }}>
          <Txt kind="headline">Focus timer</Txt>
          <Txt kind="small" muted>{`${Focus.LENGTHS.focus} minutes of focus, then a ${Focus.LENGTHS.short}-minute break${s.done ? ` · ${s.done} done today` : ''}`}</Txt>
        </View>
        <Button kind="primary" small icon="target" label="Start" onPress={() => { haptic('tap'); act(() => focus.start(null)); }} />
      </Card>
    );
  }
  return (
    <Card style={{ padding: S(3), gap: S(2) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2) }}>
        <View style={{ flex: 1 }}>
          <Txt kind="small" style={{ color: brk ? c.good : c.accentText, fontWeight: '600' }}>{`${Focus.label[s.phase]}${Focus.paused(s) ? ' · paused' : ''}`}</Txt>
          <Txt kind="display" style={{ fontVariant: ['tabular-nums'], color: Focus.paused(s) ? c.muted : c.text }}>{Focus.clock(left)}</Txt>
          {task ? <Txt kind="small" muted numberOfLines={1}>{task.text}</Txt> : null}
        </View>
        <IconButton icon={Focus.paused(s) ? 'play' : 'hold'} label={Focus.paused(s) ? 'Resume' : 'Pause'} onPress={() => act(Focus.paused(s) ? focus.resume : focus.pause)} color={c.text} />
        <IconButton icon="forward" label={s.phase === 'focus' ? 'Skip to the break' : 'Skip to focus'} onPress={() => act(focus.skip)} />
        <IconButton icon="close" label="Stop" onPress={() => act(focus.stop)} />
      </View>
      <View style={{ height: 4, borderRadius: R.pill, backgroundColor: c.sunken, overflow: 'hidden' }}>
        <Animated.View style={[{ height: 4, borderRadius: R.pill, backgroundColor: brk ? c.good : c.accent }, bar]} />
      </View>
    </Card>
  );
}
