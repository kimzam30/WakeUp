// Small building blocks used by every screen. Shape lock (theme.ts): pills for actions, 14 for cards,
// 10 for inputs and rows, 6 for chips. Press feedback is a background highlight on rows and a slight scale on buttons.
import { createContext, forwardRef, useContext, useEffect, type ComponentRef, type ReactNode } from 'react';
import {
  Dimensions, Modal, Pressable, ScrollView, Switch as RNSwitch, Text, TextInput, View, useWindowDimensions,
  type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { haptic } from '../lib/haptics';
import { useDragToClose } from './motion';
import { Icon } from './Icon';
import { R, S, T, useTheme } from './theme';

export type Size = 'cover' | 'compact' | 'medium' | 'expanded';
// Size classes from Material's window guidance, by width AND height, plus the Z Flip cover screen.
//  cover:    the display itself is small and nearly square (Flip cover screen), not just a small window
//  compact:  phones; also any window under 480dp tall (a phone on its side, a short split-screen half)
//  medium:   tablet portrait, foldables, wide split-screen halves
//  expanded: tablet landscape, DeX
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const screen = Dimensions.get('screen');
  const coverScreen = Math.min(screen.width, screen.height) < 420 && Math.max(screen.width, screen.height) < 560;
  const size: Size = coverScreen ? 'cover' : width < 600 || height < 480 ? 'compact' : width < 840 ? 'medium' : 'expanded';
  const landscape = width > height;
  return {
    size, width, height, landscape,
    wide: size === 'medium' || size === 'expanded',
    // a phone on its side: the nav moves to a slim rail so the content keeps its height
    sideways: size === 'compact' && landscape && height < 480,
    // room for two columns of content (after the sidebar/rail)
    twoCol: size === 'expanded' || (size === 'medium' && landscape),
  };
}

// How much room the floating tab bar takes at the bottom of a tab's screen (0 where there is no floating bar)
export const BarSpace = createContext(0);
export const useBarSpace = () => useContext(BarSpace);

export function Txt({ style, muted, faint, kind = 'body', ...p }: { kind?: keyof typeof T; muted?: boolean; faint?: boolean; style?: StyleProp<TextStyle>; children?: ReactNode; numberOfLines?: number; selectable?: boolean; adjustsFontSizeToFit?: boolean; minimumFontScale?: number }) {
  const { c } = useTheme();
  return <Text {...p} style={[T[kind], { color: muted ? c.muted : faint ? c.faint : c.text }, style]} />;
}

// A screen's scrolling body with a readable max width. Keeps the focused field above the keyboard.
export function Page({ children, pad = true, max = 760, refresh, gap }: { children: ReactNode; pad?: boolean; max?: number; refresh?: ReactNode; gap?: number }) {
  const { c } = useTheme();
  const { size } = useLayout();
  const insets = useSafeAreaInsets();
  const bar = useBarSpace();
  const side = size === 'cover' ? S(3) : size === 'compact' ? S(5) : S(8);
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: pad ? Math.max(insets.top, S(4)) + S(2) : 0, paddingBottom: S(10) + bar, paddingHorizontal: side, alignItems: 'center' }}
      >
        {refresh}
        <View style={{ width: '100%', maxWidth: max, gap: gap ?? (size === 'cover' ? S(4) : S(6)) }}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Two columns side by side when there's room, one column otherwise
export function Columns({ left, right, split = 0.55 }: { left: ReactNode; right: ReactNode; split?: number }) {
  const { twoCol, size } = useLayout();
  const gap = size === 'cover' ? S(4) : S(6);
  if (!twoCol) return <View style={{ gap }}>{left}{right}</View>;
  return (
    <View style={{ flexDirection: 'row', gap, alignItems: 'flex-start' }}>
      <View style={{ flex: split, gap }}>{left}</View>
      <View style={{ flex: 1 - split, gap }}>{right}</View>
    </View>
  );
}

export function Card({ children, style, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; accent?: string }) {
  const { c } = useTheme();
  return (
    <View style={[{ backgroundColor: c.raised, borderRadius: R.card, borderCurve: 'continuous', borderWidth: 1, borderColor: c.line, overflow: 'hidden' }, style]}>
      {accent ? <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: accent }} /> : null}
      {children}
    </View>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: S(2) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 }}>
        <Txt kind="headline">{title}</Txt>
        {action}
      </View>
      {children}
    </View>
  );
}

type BtnKind = 'primary' | 'secondary' | 'plain' | 'danger';
export function Button({ label, icon, kind = 'secondary', onPress, disabled, style, small, full }: { label: string; icon?: string; kind?: BtnKind; onPress?: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean; full?: boolean }) {
  const { c } = useTheme();
  const bg = kind === 'primary' ? c.accent : kind === 'secondary' ? c.sunken : 'transparent';
  const fg = kind === 'primary' ? c.accentInk : kind === 'danger' ? c.bad : kind === 'plain' ? c.accentText : c.text;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      onPress={() => { haptic('tap'); onPress?.(); }}
      style={({ pressed }) => [{
        minHeight: small ? 36 : 48, paddingHorizontal: small ? S(3) : S(5), borderRadius: R.pill, backgroundColor: bg,
        borderWidth: kind === 'secondary' ? 1 : 0, borderColor: c.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S(2),
        opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }], alignSelf: full ? 'stretch' : 'flex-start',
      }, style]}
    >
      {icon ? <Icon name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <Text style={[small ? T.small : T.body, { color: fg, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color, size = 20 }: { icon: string; label: string; onPress: () => void; color?: string; size?: number }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.hover : 'transparent' })}>
      <Icon name={icon} size={size} color={color ?? c.muted} />
    </Pressable>
  );
}

export function Row({ children, onPress, style, ...p }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> } & Omit<PressableProps, 'style' | 'children'>) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} {...p}
      style={({ pressed }) => [{ minHeight: 56, paddingHorizontal: S(4), paddingVertical: S(3), flexDirection: 'row', alignItems: 'center', gap: S(3), backgroundColor: pressed && onPress ? c.hover : 'transparent' }, style]}>
      {children}
    </Pressable>
  );
}
export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme();
  return <View style={{ height: 1, backgroundColor: c.line, marginLeft: inset }} />;
}

export function Chip({ label, tone, icon, small }: { label: string; tone?: 'bad' | 'info' | 'warn' | 'good'; icon?: string; small?: boolean }) {
  const { c } = useTheme();
  const fg = tone ? c[tone] : c.muted; const bg = tone ? c[`${tone}Bg` as const] : c.sunken;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: small ? 5 : S(2), height: small ? 20 : 24, borderRadius: R.chip, backgroundColor: bg, alignSelf: 'flex-start' }}>
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text numberOfLines={1} style={[T.small, { color: fg, fontWeight: '600', fontSize: small ? 11 : 12, lineHeight: small ? 14 : 18, flexShrink: 1 }]}>{label}</Text>
    </View>
  );
}

export const Field = forwardRef<ComponentRef<typeof TextInput>, TextInputProps & { label?: string }>(function Field({ label, style, ...p }, ref) {
  const { c } = useTheme();
  return (
    <View style={{ gap: S(1), flexGrow: 1, flexBasis: 140 }}>
      {label ? <Txt kind="small" muted>{label}</Txt> : null}
      <TextInput ref={ref} placeholderTextColor={c.faint} {...p}
        style={[T.body, { color: c.text, minHeight: 48, paddingHorizontal: S(3), borderRadius: R.input, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.bg }, style]} />
    </View>
  );
});

export function Segmented<V extends string | number>({ value, options, onChange, label }: { value: V; options: [V, string][]; onChange: (v: V) => void; label: string }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: c.sunken, borderRadius: R.pill, padding: 3, borderWidth: 1, borderColor: c.line, alignSelf: 'flex-start' }}>
      {options.map(([v, l]) => {
        const on = v === value;
        return (
          <Pressable key={String(v)} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { haptic('tap'); onChange(v); }}
            style={{ minHeight: 36, paddingHorizontal: S(3), borderRadius: R.pill, justifyContent: 'center', backgroundColor: on ? c.raised : 'transparent', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.12)' : undefined }}>
            <Text style={[T.small, { color: on ? c.text : c.muted, fontWeight: on ? '600' : '500' }]}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Switch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const { c } = useTheme();
  return <RNSwitch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: c.accent, false: c.lineStrong }} thumbColor="#fff" />;
}

// Bottom sheet on phones (drag its top bar down to close), centred dialog on tablets.
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const { c } = useTheme();
  const { wide, height } = useLayout();
  const insets = useSafeAreaInsets();
  const drag = useDragToClose(onClose, !wide);
  const { reset } = drag;
  useEffect(() => { if (open) reset(); }, [open, reset]);
  const top = (
    <View>
      {!wide ? <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.lineStrong, marginTop: S(2) }} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: S(5), paddingRight: S(2), paddingTop: S(2) }}>
        <Txt kind="title" style={{ flex: 1 }}>{title}</Txt>
        <IconButton icon="close" label="Close" onPress={onClose} />
      </View>
    </View>
  );
  return (
    <Modal visible={open} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: c.scrim, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? S(8) : 0 }}>
          <Animated.View style={[{ width: '100%', maxWidth: wide ? 560 : undefined, maxHeight: height * (wide ? 0.86 : 0.92) }, drag.style]}>
          <Pressable onPress={() => {}} style={{
            backgroundColor: c.raised, flexShrink: 1,
            borderRadius: R.card + 6, borderBottomLeftRadius: wide ? R.card + 6 : 0, borderBottomRightRadius: wide ? R.card + 6 : 0, borderCurve: 'continuous', overflow: 'hidden',
          }}>
            {wide ? top : <GestureDetector gesture={drag.pan}>{top}</GestureDetector>}
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S(5), paddingTop: S(2), gap: S(4) }}>{children}</ScrollView>
            {footer ? <View style={{ flexDirection: 'row', gap: S(3), justifyContent: 'flex-end', padding: S(4), paddingBottom: S(4) + (wide ? 0 : insets.bottom), borderTopWidth: 1, borderColor: c.line }}>{footer}</View> : null}
          </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

// A selectable pill (date choices, a class, a session to copy). `dot` shows a class colour.
export function Pick({ label, on, onPress, dot, icon }: { label: string; on?: boolean; onPress: () => void; dot?: string; icon?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: !!on }} accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ height: 36, paddingHorizontal: S(3), borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: S(1) + 2, backgroundColor: on ? c.accentSoft : pressed ? c.hover : 'transparent', borderWidth: 1, borderColor: on ? c.accent : c.line })}>
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      {icon ? <Icon name={icon} size={14} color={on ? c.accentText : c.muted} /> : null}
      <Text numberOfLines={1} style={[T.small, { color: on ? c.accentText : c.text, fontWeight: on ? '600' : '500' }]}>{label}</Text>
    </Pressable>
  );
}

// Empty states say what goes here and how to fill it.
export function Empty({ icon, title, body, action }: { icon: string; title: string; body: string; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: S(3), paddingVertical: S(8), paddingHorizontal: S(4) }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.sunken, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={26} color={c.faint} /></View>
      <Txt kind="headline" style={{ textAlign: 'center' }}>{title}</Txt>
      <Txt muted style={{ textAlign: 'center', maxWidth: 360 }}>{body}</Txt>
      {action}
    </View>
  );
}

// Paper (docs/DESIGN.md): pages are flat lists with hairlines. A section's small caps label…
export function Caption({ children }: { children: string }) {
  const { c } = useTheme();
  return <Txt kind="tiny" style={{ color: c.muted, textTransform: 'uppercase' }}>{children}</Txt>;
}
// …a section title with an optional count and a link on the right…
export function Head({ title, count, link, onLink, tone }: { title: string; count?: number; link?: string; onLink?: () => void; tone?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 }}>
      <Txt kind="title" style={{ fontSize: 20, lineHeight: 26, color: tone ?? c.text }}>{title}{count != null ? <Txt kind="title" style={{ fontSize: 20, lineHeight: 26, color: c.faint, fontWeight: '500' }}>{`  ${count}`}</Txt> : null}</Txt>
      {link ? <Pressable accessibilityRole="link" hitSlop={8} onPress={onLink}><Txt kind="small" style={{ color: c.accentText, fontWeight: '600' }}>{link}</Txt></Pressable> : null}
    </View>
  );
}
// …and a flat row with a hairline above it (none above the first)
export function Line({ children, first, onPress }: { children: ReactNode; first?: boolean; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress}
      style={({ pressed }) => ({ minHeight: 52, paddingVertical: S(3), flexDirection: 'row', alignItems: 'center', gap: S(3), borderTopWidth: first ? 0 : 1, borderColor: c.line, backgroundColor: pressed && onPress ? c.hover : 'transparent', marginHorizontal: -S(2), paddingHorizontal: S(2), borderRadius: pressed && onPress ? R.input : 0 })}>
      {children}
    </Pressable>
  );
}
// a class as its colour dot and name, in place of a chip
export function ClassTag({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 110 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Txt kind="small" muted numberOfLines={1} style={[T.small, { flexShrink: 1 }]}>{label}</Txt>
    </View>
  );
}

