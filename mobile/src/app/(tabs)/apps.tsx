// Your web apps inside WakeUp. Recently used apps stay loaded (and signed in) while you switch between them;
// past four, the least recently used one unloads. Android's back gesture goes back inside the page first.
// Split view puts two apps on screen: stacked top and bottom in a portrait window, side by side in a landscape
// one, with a draggable divider. The toolbar and the back gesture act on the focused half (outlined).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, BackHandler, Linking, PanResponder, Pressable, ScrollView, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Button, Empty, IconButton, Sheet, Txt, useLayout } from '../../ui/kit';
import { AppGlyph, Icon } from '../../ui/Icon';
import { R, S, useTheme } from '../../ui/theme';
import { allApps, closeApp, closeSplit, focusedApp, openApp, openSplit, updateSplit, useStore } from '../../lib/store';
import type { WebApp } from '../../lib/types';

// Teams' web app only runs with a desktop browser signature; on a tablet every app gets the full desktop site.
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const GOOGLE_SIGN_IN = /^https:\/\/accounts\.google\.com\//;
const STRIP = 36; // per-pane title strip in split view

type Nav = { canGoBack: boolean; loading: boolean; url: string; title: string };
const openOutside = (url: string) => Linking.openURL(url).catch(() => {});

function Glyph({ app, size = 28 }: { app: WebApp; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, borderCurve: 'continuous', backgroundColor: app.color, alignItems: 'center', justifyContent: 'center' }}>
      {['ebwise', 'mail', 'calendar', 'teams'].includes(app.id) ? <AppGlyph id={app.id} name={app.name} size={size * 0.62} /> : <Txt style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.45 }}>{app.name[0]}</Txt>}
    </View>
  );
}

export default function Apps() {
  const { c } = useTheme();
  const { size, wide } = useLayout();
  const insets = useSafeAreaInsets();
  const settings = useStore((s) => s.settings);
  const openIds = useStore((s) => s.openApps);
  const active = useStore((s) => s.activeApp);
  const split = useStore((s) => s.split);
  const focused = useStore(focusedApp);
  const apps = useMemo(() => allApps(settings), [settings]);
  const refs = useRef<Record<string, ComponentRef<typeof WebView> | null>>({});
  const navRef = useRef<Record<string, Nav>>({});
  const [, bump] = useState(0); // toolbar re-renders when the focused page's nav state changes
  const [picker, setPicker] = useState(false);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const canSplit = size !== 'cover' && apps.length > 1;
  const shown = split && canSplit ? [split.a, split.b] : active ? [active] : [];
  const vertical = area.h > area.w; // portrait window: stack the halves

  // a split saved on a tablet doesn't survive the cover screen; apps that were hidden or removed close
  useEffect(() => { if (split && !canSplit) closeSplit(); }, [split, canSplit]);
  useEffect(() => {
    const ids = new Set(apps.map((a) => a.id));
    for (const id of openIds) if (!ids.has(id)) closeApp(id);
    if (active && !ids.has(active)) openApp(null);
  }, [apps, openIds, active]);

  // Android back: go back in the focused page, then leave split, then leave the app, then the system's turn
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!focused) return false;
      if (navRef.current[focused]?.canGoBack) { refs.current[focused]?.goBack(); return true; }
      if (split) { closeSplit(split.focus === 'a' ? 'b' : 'a'); return true; }
      openApp(null); return true;
    });
    return () => sub.remove();
  }, [focused, split]));

  const onNav = useCallback((id: string, e: WebViewNavigation) => {
    const prev = navRef.current[id];
    navRef.current[id] = { canGoBack: e.canGoBack, loading: e.loading, url: e.url, title: e.title };
    if (!prev || prev.loading !== e.loading || prev.title !== e.title || prev.canGoBack !== e.canGoBack) bump((x) => x + 1);
  }, []);
  const setRef = useCallback((id: string, r: ComponentRef<typeof WebView> | null) => { refs.current[id] = r; }, []);
  const app = apps.find((a) => a.id === focused);

  const switcher = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S(2), paddingHorizontal: S(3), alignItems: 'center' }}>
      {apps.map((a) => {
        const on = shown.includes(a.id); const loaded = openIds.includes(a.id);
        return (
          <Pressable key={a.id} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={a.name} accessibilityHint={canSplit ? 'Long-press to open beside the current app' : undefined}
            onPress={() => openApp(a.id)} onLongPress={() => { if (canSplit && focused && a.id !== focused) { Haptics.selectionAsync().catch(() => {}); openSplit(a.id); } }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S(2), height: 40, paddingLeft: 6, paddingRight: size === 'compact' && !on ? 6 : S(3), borderRadius: R.pill, backgroundColor: on ? c.accentSoft : pressed ? c.hover : 'transparent', borderWidth: 1, borderColor: a.id === focused && split ? c.accent : on ? c.accent : c.line })}>
            <Glyph app={a} size={28} />
            {size !== 'compact' || on ? <Txt kind="small" style={{ fontWeight: '600', color: on ? c.text : c.muted }}>{a.name}</Txt> : null}
            {loaded && !on ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.faint }} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  if (!apps.length) {
    return <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: c.bg }}><Empty icon="apps" title="No apps yet" body="Turn on Ebwise, Outlook or Teams, or add any website, in Settings." action={<Button label="Open Settings" onPress={() => router.navigate('/settings')} />} /></View>;
  }

  const ratio = split?.ratio ?? 0.5;
  const along = vertical ? area.h : area.w;
  const first = Math.round(along * ratio);
  // where each loaded app sits: a half, the whole area, or parked off-screen (still loaded)
  const place = (id: string) => {
    if (!shown.includes(id) || !area.w) return { position: 'absolute' as const, left: 0, top: 0, width: 1, height: 1, opacity: 0 };
    if (shown.length === 1) return { position: 'absolute' as const, left: 0, top: 0, width: area.w, height: area.h };
    const isA = id === split!.a;
    const len = isA ? first - 3 : along - first - 3;
    return vertical
      ? { position: 'absolute' as const, left: 0, top: isA ? 0 : first + 3, width: area.w, height: len }
      : { position: 'absolute' as const, top: 0, left: isA ? 0 : first + 3, height: area.h, width: len };
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.side, paddingTop: insets.top }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: c.line }}>
        <View style={{ flex: 1 }}>{switcher}</View>
        {app ? <View style={{ flexDirection: 'row', paddingRight: S(1) }}>
          {size !== 'compact' ? <IconButton icon="back" label="Back" onPress={() => refs.current[app.id]?.goBack()} /> : null}
          <IconButton icon="reload" label="Reload" onPress={() => refs.current[app.id]?.reload()} />
          {canSplit ? <IconButton icon="split" label={split ? 'Close split' : 'Split with another app'} onPress={() => (split ? closeSplit() : setPicker(true))} /> : null}
          {size !== 'compact' || !split ? <IconButton icon="external" label="Open in browser" onPress={() => openOutside(navRef.current[app.id]?.url || app.url)} /> : null}
          <IconButton icon="close" label={`Close ${app.name}`} onPress={() => closeApp(app.id)} />
        </View> : null}
      </View>
      <View style={{ flex: 1, backgroundColor: c.line }} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {!shown.length ? (
          <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: S(5), gap: S(4) }}>
            <Txt kind="title">Open an app</Txt>
            <Txt muted>{`Each app keeps its own place while you switch. Sign in to Microsoft once and Outlook, Calendar, Teams and Ebwise share it.${canSplit ? ' To see two at once, open one and tap Split.' : ''}`}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(3) }}>
              {apps.map((a) => (
                <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Open ${a.name}`} onPress={() => openApp(a.id)}
                  style={({ pressed }) => ({ width: wide ? 148 : '47%', padding: S(4), gap: S(3), borderRadius: R.card, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.hover : c.raised })}>
                  <Glyph app={a} size={40} />
                  <Txt kind="headline">{a.name}</Txt>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : null}
        {openIds.map((id) => {
          const a = apps.find((x) => x.id === id); if (!a) return null;
          const inSplit = !!split && shown.length > 1 && shown.includes(id);
          return (
            <View key={id} style={place(id)} pointerEvents={shown.includes(id) ? 'auto' : 'none'}>
              {inSplit ? <PaneStrip app={a} title={navRef.current[id]?.title} focused={focused === id} onFocus={() => openApp(id)}
                onSwap={() => updateSplit({ a: split!.b, b: split!.a })} onMax={() => closeSplit(split!.a === id ? 'a' : 'b')} onClose={() => closeApp(id)} /> : null}
              <Pane app={a} desktop={a.id === 'teams' || wide} onNav={onNav} setRef={setRef} onTouch={inSplit && focused !== id ? () => openApp(id) : undefined} />
              {navRef.current[id]?.loading ? <View style={{ position: 'absolute', top: inSplit ? STRIP : 0, left: 0, right: 0, height: 2, backgroundColor: c.accent, opacity: 0.6 }} /> : null}
            </View>
          );
        })}
        {split && shown.length > 1 && area.w ? <Divider vertical={vertical} at={first} along={along} /> : null}
      </View>
      <Sheet open={picker} onClose={() => setPicker(false)} title="Split with…">
        <Txt muted>{vertical ? 'It opens below the app you have open. Drag the bar between them to resize.' : 'It opens beside the app you have open. Drag the bar between them to resize.'}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(3) }}>
          {apps.filter((a) => a.id !== focused).map((a) => (
            <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Split with ${a.name}`} onPress={() => { setPicker(false); openSplit(a.id); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S(3), minHeight: 56, paddingHorizontal: S(4), borderRadius: R.input, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.hover : c.raised, flexBasis: wide ? '30%' : '46%', flexGrow: 1 })}>
              <Glyph app={a} size={32} />
              <Txt kind="headline">{a.name}</Txt>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

// A loaded web app. Memoised: switching apps, dragging the divider or another page loading doesn't re-render it.
const Pane = memo(function Pane({ app: a, desktop, onNav, setRef, onTouch }: { app: WebApp; desktop: boolean; onNav: (id: string, e: WebViewNavigation) => void; setRef: (id: string, r: ComponentRef<typeof WebView> | null) => void; onTouch?: () => void }) {
  const { c } = useTheme();
  const [life, setLife] = useState(0); // bumped when Android kills the page's renderer: the page reloads instead of the app crashing
  const ref = useRef<ComponentRef<typeof WebView> | null>(null);
  return (
    <View style={{ flex: 1 }} onTouchStart={onTouch}>
      <WebView
        key={life}
        ref={(r) => { ref.current = r; setRef(a.id, r); }}
        source={{ uri: a.url }}
        userAgent={desktop ? DESKTOP_UA : undefined}
        onNavigationStateChange={(e) => onNav(a.id, e)}
        sharedCookiesEnabled thirdPartyCookiesEnabled domStorageEnabled javaScriptEnabled
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        allowsFullscreenVideo
        mediaCapturePermissionGrantType={a.ai ? 'grant' : 'prompt'}
        setBuiltInZoomControls={false}
        forceDarkOn={false}
        startInLoadingState
        onRenderProcessGone={() => setLife((x) => x + 1)}
        onContentProcessDidTerminate={() => setLife((x) => x + 1)}
        renderLoading={() => <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}><ActivityIndicator color={c.accent} /></View>}
        onShouldStartLoadWithRequest={(r) => {
          if (r.url.startsWith('mailto:') || r.url.startsWith('tel:') || r.url.startsWith('intent:')) { openOutside(r.url); return false; }
          if (GOOGLE_SIGN_IN.test(r.url)) { openOutside(r.url); return false; } // Google blocks sign-in inside apps
          return true;
        }}
        renderError={() => (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: S(3), padding: S(6), backgroundColor: c.bg }}>
            <Icon name="offline" size={32} color={c.faint} />
            <Txt kind="headline">{`${a.name} didn’t load`}</Txt>
            <Txt muted style={{ textAlign: 'center' }}>Check your connection, then try again.</Txt>
            <Button label="Try again" icon="reload" onPress={() => ref.current?.reload()} />
          </View>
        )}
        style={{ flex: 1, backgroundColor: c.bg }}
      />
    </View>
  );
});

function PaneStrip({ app, title, focused, onFocus, onSwap, onMax, onClose }: { app: WebApp; title?: string; focused: boolean; onFocus: () => void; onSwap: () => void; onMax: () => void; onClose: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${app.name}${focused ? ', focused' : ''}`} onPress={onFocus}
      style={{ height: STRIP, flexDirection: 'row', alignItems: 'center', gap: S(2), paddingLeft: S(3), backgroundColor: focused ? c.accentSoft : c.side, borderTopWidth: 2, borderColor: focused ? c.accent : 'transparent' }}>
      <Glyph app={app} size={18} />
      <Txt kind="small" numberOfLines={1} style={{ flex: 1, fontWeight: '600', color: focused ? c.text : c.muted }}>{title || app.name}</Txt>
      <SmallBtn icon="split" label="Swap halves" onPress={onSwap} />
      <SmallBtn icon="external" label={`Show only ${app.name}`} onPress={onMax} />
      <SmallBtn icon="close" label={`Close ${app.name}`} onPress={onClose} />
    </Pressable>
  );
}
function SmallBtn({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
      style={({ pressed }) => ({ width: 40, height: STRIP, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.hover : 'transparent' })}>
      <Icon name={icon} size={15} color={c.muted} />
    </Pressable>
  );
}

// The bar between the halves: drag to resize (25–75%), snaps to a third, half or two thirds when released nearby
function Divider({ vertical, at, along }: { vertical: boolean; at: number; along: number }) {
  const { c } = useTheme();
  // the responder is made once; it reads the latest geometry from a ref (re-creating it mid-drag drops the gesture)
  const geo = useRef({ vertical, at, along }); geo.current = { vertical, at, along };
  const start = useRef(0);
  const [drag, setDrag] = useState(false);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = geo.current.at; setDrag(true); Haptics.selectionAsync().catch(() => {}); },
    onPanResponderMove: (_e, g) => {
      const { vertical: v, along: len } = geo.current;
      updateSplit({ ratio: Math.min(0.75, Math.max(0.25, (start.current + (v ? g.dy : g.dx)) / len)) });
    },
    onPanResponderRelease: (_e, g) => {
      setDrag(false);
      const { vertical: v, along: len } = geo.current;
      const r = (start.current + (v ? g.dy : g.dx)) / len;
      const snap = [1 / 3, 0.5, 2 / 3].find((x) => Math.abs(x - r) < 0.04);
      updateSplit({ ratio: Math.min(0.75, Math.max(0.25, snap ?? r)) });
      if (snap) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    onPanResponderTerminate: () => setDrag(false),
  }), []);
  const hit = 32; // touch target wider than the line
  return (
    <View {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Resize split"
      style={vertical
        ? { position: 'absolute', left: 0, right: 0, top: at - hit / 2, height: hit, alignItems: 'center', justifyContent: 'center' }
        : { position: 'absolute', top: 0, bottom: 0, left: at - hit / 2, width: hit, alignItems: 'center', justifyContent: 'center' }}>
      <View style={vertical ? { position: 'absolute', left: 0, right: 0, height: 6, backgroundColor: c.side } : { position: 'absolute', top: 0, bottom: 0, width: 6, backgroundColor: c.side }} />
      <View style={{ width: vertical ? 56 : 6, height: vertical ? 6 : 56, borderRadius: 3, backgroundColor: drag ? c.accent : c.muted }} />
    </View>
  );
}
