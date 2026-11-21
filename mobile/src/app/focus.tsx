// Focus mode (docs/DESIGN.md → Focus): a full screen with a ring that empties as the time runs, the task or class
// you're on, Pause / Skip / Stop, the lengths (25/5, 50/10 or your own) and this week's sessions by class.
// It ticks only while it's on screen; the scheduled notification ends the phase when the app is closed.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import Animated, { useAnimatedProps, useReducedMotion, withTiming } from 'react-native-reanimated';
import { haptic } from '../lib/haptics';
import { dndAccess, dndAvailable, focus, getDnd, getLengths, openDndAccess, PRESETS, refreshDnd, setDnd, setLengths, useFocus, useFocusVersion, weekStats } from '../lib/focus';
import { Focus } from '../lib/shared';
import { useStore } from '../lib/store';
import { useActive } from '../lib/hooks';
import { classLabel } from '../lib/format';
import { Button, ClassTag, Head, IconButton, Line, Pick, Switch, Txt, useLayout } from '../ui/kit';
import { R, S, useTheme } from '../ui/theme';

const ACircle = Animated.createAnimatedComponent(Circle);
const close = () => (router.canGoBack() ? router.back() : router.replace('/tasks'));

export default function FocusScreen() {
  const { c } = useTheme();
  const { width, height } = useLayout();
  const insets = useSafeAreaInsets();
  const s = useFocus();
  useFocusVersion();
  const reduce = useReducedMotion();
  const task = useStore((st) => (s.taskId ? st.planner.tasks.find((t) => t.id === s.taskId && !t.done) : undefined));
  const clsId = task?.classId ?? s.classId; // a task's class, or the class focused on from its page
  const cls = useStore((st) => (clsId ? st.planner.classes.find((k) => k.id === clsId) : undefined));
  const mode = useStore((st) => st.settings.classLabel);
  const classes = useStore((st) => st.planner.classes);
  const [now, setNow] = useState(() => Date.now());
  const act = (fn: () => void) => { haptic('tap'); fn(); setNow(Date.now()); };
  const running = s.phase !== 'idle' && !Focus.paused(s);
  const isFocused = useIsFocused(); const appActive = useActive();
  const shown = isFocused && appActive;
  useEffect(() => {
    if (!running || !shown) return;
    const step = () => { if (focus.tick()) haptic('success'); setNow(Date.now()); };
    const first = setTimeout(step, 0);
    const t = setInterval(step, 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [running, shown]);

  const L = getLengths();
  const total = s.phase === 'idle' ? L.focus * 60e3 : focus.total(s.phase);
  const left = s.phase === 'idle' ? total : Math.min(total, Focus.remaining(s, now));
  const frac = Math.max(0, Math.min(1, left / total));
  const brk = s.phase === 'short' || s.phase === 'long';
  const tone = brk ? c.good : cls?.color ?? c.accent;
  const size = Math.min(width - S(16), height * 0.42, 340);
  const stroke = 10; const r = (size - stroke) / 2; const len = 2 * Math.PI * r;
  const ring = useAnimatedProps(() => ({ strokeDashoffset: reduce ? len * (1 - frac) : withTiming(len * (1 - frac), { duration: 900 }) }), [frac, len, reduce]);
  const stats = weekStats();
  const preset = PRESETS.find(([, p]) => p.focus === L.focus && p.short === L.short)?.[0] ?? 'Custom';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + S(2), paddingBottom: insets.bottom + S(8), paddingHorizontal: S(5), gap: S(6), alignItems: 'center' }}>
        <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' }}>
          <Txt kind="title" style={{ flex: 1 }}>{s.phase === 'idle' ? 'Focus' : Focus.label[s.phase]}</Txt>
          <IconButton icon="close" label="Close focus" onPress={close} color={c.text} />
        </View>

        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.sunken} strokeWidth={stroke} fill="none" />
            <ACircle cx={size / 2} cy={size / 2} r={r} stroke={tone} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${len} ${len}`} animatedProps={ring} />
          </Svg>
          <Txt kind="display" style={{ fontSize: Math.round(size * 0.2), lineHeight: Math.round(size * 0.24), fontVariant: ['tabular-nums'], color: Focus.paused(s) ? c.muted : c.text }}>{Focus.clock(left)}</Txt>
          <Txt kind="small" muted>{s.phase === 'idle' ? `then a ${L.short}-minute break` : Focus.paused(s) ? 'Paused' : brk ? 'Stretch, drink some water' : `${s.done} done today`}</Txt>
        </View>

        <View style={{ alignItems: 'center', gap: S(1), minHeight: 48 }}>
          {task ? <Txt kind="headline" numberOfLines={2} style={{ textAlign: 'center' }}>{task.text}</Txt> : <Txt muted>{s.phase === 'idle' ? 'Pick a task in Tasks to focus on it, or just start.' : brk ? 'On a break' : 'Focusing'}</Txt>}
          {cls ? <ClassTag color={cls.color} label={classLabel(cls, mode)} /> : null}
        </View>

        {s.phase === 'idle' ? (
          <Button kind="primary" icon="play" label="Start focus" onPress={() => act(() => focus.start(s.taskId))} />
        ) : (
          <View style={{ flexDirection: 'row', gap: S(3) }}>
            <Button kind={Focus.paused(s) ? 'primary' : 'secondary'} icon={Focus.paused(s) ? 'play' : 'hold'} label={Focus.paused(s) ? 'Resume' : 'Pause'} onPress={() => act(Focus.paused(s) ? focus.resume : focus.pause)} />
            <Button icon="forward" label={s.phase === 'focus' ? 'Break' : 'Focus'} onPress={() => act(focus.skip)} />
            <Button kind="plain" label="Stop" onPress={() => act(focus.stop)} />
          </View>
        )}

        <View style={{ alignSelf: 'stretch', maxWidth: 560, width: '100%', gap: S(3) }}>
          <Head title="Lengths" />
          <View style={{ flexDirection: 'row', gap: S(2), flexWrap: 'wrap' }}>
            {PRESETS.map(([name, p]) => <Pick key={name} label={name} on={preset === name} onPress={() => setLengths(p)} />)}
            <Pick label="Custom" on={preset === 'Custom'} onPress={() => setLengths({ ...L, focus: L.focus === 25 || L.focus === 50 ? 40 : L.focus })} />
          </View>
          {preset === 'Custom' ? <>
            <Stepper label="Focus" value={L.focus} step={5} min={5} max={180} onChange={(focus) => setLengths({ ...L, focus })} />
            <Stepper label="Break" value={L.short} step={1} min={1} max={60} onChange={(short) => setLengths({ ...L, short, long: short * 3 })} />
          </> : null}
          <Txt kind="small" muted>Changes start with the next focus. Every fourth break is a long one.</Txt>
        </View>

        {dndAvailable() ? <Quiet appActive={appActive} /> : null}

        <View style={{ alignSelf: 'stretch', maxWidth: 560, width: '100%', gap: S(1) }}>
          <Head title="This week" count={stats.sessions} />
          {stats.sessions ? stats.byClass.map(([id, v], i) => {
            const k = classes.find((x) => x.id === id);
            return (
              <Line key={id ?? 'none'} first={!i}>
                {k ? <ClassTag color={k.color} label={classLabel(k, mode)} /> : <Txt muted>No class</Txt>}
                <View style={{ flex: 1 }} />
                <Txt kind="small" muted style={{ fontVariant: ['tabular-nums'] }}>{`${v.sessions} · ${hours(v.mins)}`}</Txt>
              </Line>
            );
          }) : <Txt muted>No focus sessions yet this week. Finished sessions show here by class.</Txt>}
          {stats.sessions ? <Txt kind="small" muted style={{ marginTop: S(2) }}>{`${hours(stats.mins)} of focus since Monday.`}</Txt> : null}
        </View>
      </ScrollView>
    </View>
  );
}

// Do Not Disturb while focusing: Android needs WakeUp allowed in "Do Not Disturb access" first
function Quiet({ appActive }: { appActive: boolean }) {
  const on = getDnd();
  const access = appActive && dndAccess(); // read again on every return from Android's settings
  // back from Android's settings: apply it to a focus that's already running
  useEffect(() => { if (appActive) refreshDnd(); }, [appActive]);
  return (
    <View style={{ alignSelf: 'stretch', maxWidth: 560, width: '100%', gap: S(2) }}>
      <Head title="Quiet" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3), minHeight: 44 }}>
        <Txt style={{ flex: 1, fontWeight: '500' }}>Do Not Disturb while focusing</Txt>
        <Switch label="Do Not Disturb while focusing" value={on} onChange={(v) => { setDnd(v); if (v && !dndAccess()) openDndAccess(); }} />
      </View>
      {on && !access ? (
        <View style={{ gap: S(2) }}>
          <Txt kind="small" muted>Android needs you to allow WakeUp in “Do Not Disturb access” first.</Txt>
          <Button small icon="settings" label="Allow in Android settings" onPress={() => openDndAccess()} />
        </View>
      ) : (
        <Txt kind="small" muted>Calls and alarms you allow in Do Not Disturb still come through. It turns off for breaks, pauses and when you stop, even if WakeUp is closed.</Txt>
      )}
    </View>
  );
}

const hours = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

function Stepper({ label, value, step, min, max, onChange }: { label: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void }) {
  const { c } = useTheme();
  const btn = (d: 1 | -1) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${d > 0 ? 'More' : 'Less'} ${label.toLowerCase()} time`} disabled={d > 0 ? value >= max : value <= min} onPress={() => { haptic('tap'); onChange(Math.min(max, Math.max(min, value + d * step))); }}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.hover : c.sunken, opacity: (d > 0 ? value >= max : value <= min) ? 0.4 : 1 })}>
      <Txt kind="headline">{d > 0 ? '+' : '−'}</Txt>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3), paddingVertical: S(1), borderRadius: R.input }}>
      <Txt style={{ flex: 1, fontWeight: '500' }}>{label}</Txt>
      {btn(-1)}
      <Txt kind="headline" style={{ width: 72, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{`${value} min`}</Txt>
      {btn(1)}
    </View>
  );
}
