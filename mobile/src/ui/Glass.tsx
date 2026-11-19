// The glass material (docs/DESIGN.md): only for things that float over content, the tab bar, toasts and sheets.
// On Android a BlurView blurs a BlurTargetView it doesn't sit inside, so each layer that hosts glass wraps its
// content in <GlassTarget> and draws the glass beside it. Android 11 and older get the tint without the blur.
import { createContext, useContext, useRef, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurTargetView, BlurView } from 'expo-blur';
import { useTheme } from './theme';

type Target = RefObject<ComponentRef<typeof View> | null>;
const Ctx = createContext<Target | null>(null);

// Wraps what the glass above it should blur. Children read the ref through <Glass>.
export function GlassLayer({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  return (
    <Ctx.Provider value={ref}>
      <View style={{ flex: 1 }}>
        <BlurTargetView ref={ref} style={{ flex: 1 }}>{children}</BlurTargetView>
        {overlay}
      </View>
    </Ctx.Provider>
  );
}

export function Glass({ children, style, radius }: { children?: ReactNode; style?: StyleProp<ViewStyle>; radius: number }) {
  const { c, dark } = useTheme();
  const target = useContext(Ctx);
  return (
    <View style={[{ borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden', boxShadow: c.glassShadow }, style]}>
      <BlurView
        blurTarget={target ?? undefined}
        blurMethod={target ? 'dimezisBlurViewSdk31Plus' : 'none'}
        intensity={dark ? 60 : 70}
        tint={dark ? 'dark' : 'light'}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* tint and hairline on top of the blur, so the bar reads on photos, white pages and black ones alike */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.glass, borderRadius: radius, borderCurve: 'continuous', borderWidth: 1, borderColor: c.glassLine }} />
      {children}
    </View>
  );
}
