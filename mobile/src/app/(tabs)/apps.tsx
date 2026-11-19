// Your web apps inside WakeUp. Recently used apps stay loaded (and signed in) while you switch between them;
// past four, the least recently used one unloads. Android's back gesture goes back inside the page first.
// Split view puts two apps on screen: stacked top and bottom in a portrait window, side by side in a landscape
// one, with a draggable divider. The toolbar and the back gesture act on the focused half (outlined).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, PanResponder, Pressable, ScrollView, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '../../lib/haptics';
import { Button, Empty, IconButton, Sheet, Txt, useLayout } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { AppTile as Glyph } from '../../ui/AppTile';
import { R, S, useTheme } from '../../ui/theme';
import { allApps, baseOf, closeApp, closeSplit, closeTab, focusedApp, getState, newTab, openApp, openSplit, setSettings, setTabUrl, updateSplit, useStore, withTabs } from '../../lib/store';
import type { WebApp } from '../../lib/types';
import { SignIn } from '../../lib/shared';

// Teams' web app only runs with a desktop browser signature; on a tablet every app gets the full desktop site.
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const GOOGLE_SIGN_IN = /^https:\/\/accounts\.google\.com\//;
const STRIP = 36; // per-pane title strip in split view

type Nav = { canGoBack: boolean; loading: boolean; url: string; title: string };
const openOutside = (url: string) => Linking.openURL(url).catch(() => {});
// What a page inside an app may load or hand to the phone. Web pages load in place; mail and phone links go to their
// apps; an `intent:` link ("Open in the Teams app") only ever opens its https fallback or the app's Play Store page,
// never the raw intent (a page doesn't get to pick which part of another app opens). Everything else is refused.
// originWhitelist: every URL reaches allowLoad (the library's default would hand non-web links to Android first)
const ANY_ORIGIN = ['*'];
const INLINE = /^(https?:|about:blank|about:srcdoc|data:|blob:)/i;
function intentTarget(url: string): string | null {
  const fallback = url.match(/;S\.browser_fallback_url=([^;]+)/)?.[1];
  if (fallback) { try { const u = decodeURIComponent(fallback); if (/^https:\/\//i.test(u)) return u; } catch { /* bad escape */ } }
  const pkg = url.match(/;package=([A-Za-z0-9._]+)/)?.[1];
  return pkg ? `https://play.google.com/store/apps/details?id=${pkg}` : null;
}
function allowLoad(url: string): boolean {
  if (INLINE.test(url)) return true;
  if (/^(mailto|tel|sms):/i.test(url)) { openOutside(url); return false; }
  if (/^intent:/i.test(url)) { const t = intentTarget(url); if (t) openOutside(t); return false; }
  return false;
}
// Google refuses sign-in inside an app's web view. Say so, instead of jumping to Chrome (which would sign Chrome in,
// not WakeUp, and looks like the app closed).
let googleAsked = 0;
function googleBlocked(app: WebApp) {
  if (Date.now() - googleAsked < 3000) return; // one page can try several times in a row
  googleAsked = Date.now();
  const custom = getState().settings.customApps.find((a) => a.id === baseOf(app.id));
  Alert.alert('Use email to sign in', `Google doesn’t allow signing in from inside other apps. In ${app.name}, choose to continue with your email instead, or use ${app.name} in your browser.`,
    custom ? [ // your own app (NotebookLM, say): offer to always open it in Chrome from now on
      { text: 'Always open in browser', onPress: () => { const s = getState().settings; setSettings({ customApps: s.customApps.map((a) => (a.id === custom.id ? { ...a, external: true } : a)) }); closeApp(app.id); openApp(custom.id); } },
      { text: 'Open in browser', onPress: () => openOutside(app.url) }, { text: 'OK', style: 'cancel' },
    ] : [{ text: 'Open in browser', onPress: () => openOutside(app.url) }, { text: 'OK', style: 'cancel' }]);
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
  const tabs = useStore((s) => s.tabs);
  const all = useMemo(() => withTabs(apps, tabs), [apps, tabs]); // apps and their extra tabs
  const refs = useRef<Record<string, ComponentRef<typeof WebView> | null>>({});
  const navRef = useRef<Record<string, Nav>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({}); // the thin bar while a page loads
  const [titles, setTitles] = useState<Record<string, string>>({}); // page titles, for the tablet's title bar
  const [picker, setPicker] = useState(false);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const canSplit = size !== 'cover' && apps.length > 1;
  const shown = split && canSplit ? [split.a, split.b] : active ? [active] : [];
  const shownBase = shown.map(baseOf);
  const vertical = area.h > area.w; // portrait window: stack the halves

  // a split saved on a tablet doesn't survive the cover screen; apps that were hidden or removed close
  useEffect(() => { if (split && !canSplit) closeSplit(); }, [split, canSplit]);
  useEffect(() => {
    const ids = new Set(all.map((a) => a.id));
    for (const id of openIds) if (!ids.has(id)) closeApp(id);
    if (active && !ids.has(active)) openApp(null);
  }, [all, openIds, active]);

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
    if (id.includes('~') && !e.loading) setTabUrl(id, e.url);
    if (!prev || prev.title !== e.title) setTitles((t) => ({ ...t, [id]: e.title }));
    if (!prev || prev.loading !== e.loading) setLoading((l) => ({ ...l, [id]: e.loading }));
  }, []);
  const setRef = useCallback((id: string, r: ComponentRef<typeof WebView> | null) => { refs.current[id] = r; }, []);
  const app = all.find((a) => a.id === focused);
  const base = app ? baseOf(app.id) : null;
  const tabList = base && tabs[base]?.length ? [base, ...tabs[base].map((t) => t.id)] : [];
  const tabLabel = (id: string, i: number) => { const t = titles[id]; return t && !/^https?:/.test(t) ? t : i ? `${app!.name} ${i + 1}` : app!.name; };

  const switcher = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S(2), paddingHorizontal: S(3), alignItems: 'center' }}>
      {apps.map((a) => {
        const on = shownBase.includes(a.id);
        return (
          <Pressable key={a.id} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={a.name} accessibilityHint={canSplit ? 'Long-press to open beside the current app' : undefined}
            onPress={() => openApp(a.id)} onLongPress={() => { if (canSplit && focused && a.id !== focused) { haptic('tap'); openSplit(a.id); } }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S(2), height: 40, paddingLeft: 6, paddingRight: size === 'compact' && !on ? 6 : S(3), borderRadius: R.pill, backgroundColor: on ? c.accentSoft : pressed ? c.hover : 'transparent', borderWidth: 1, borderColor: a.id === base && split ? c.accent : on ? c.accent : c.line })}>
            <Glyph app={a} size={28} />
            {size !== 'compact' || on ? <Txt kind="small" style={{ fontWeight: '600', color: on ? c.text : c.muted }}>{a.name}</Txt> : null}
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
        {/* tablets list the apps in the sidebar, so the bar shows what's on screen instead, like a desktop pane */}
        <View style={{ flex: 1 }}>{wide ? (app ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3), paddingHorizontal: S(4) }}>
            <Glyph app={app} size={24} />
            <Txt kind="small" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }}>{app.name}</Txt>
            {titles[app.id] && titles[app.id] !== app.name && !/^https?:/.test(titles[app.id]) ? <Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{titles[app.id]}</Txt> : null}
          </View>
        ) : null) : switcher}</View>
        {app ? <View style={{ flexDirection: 'row', paddingRight: S(1) }}>
          {size !== 'compact' ? <IconButton icon="back" label="Back" onPress={() => refs.current[app.id]?.goBack()} /> : null}
          <IconButton icon="reload" label="Reload" onPress={() => refs.current[app.id]?.reload()} />
          {!split || size !== 'compact' ? <IconButton icon="plus" label={`New ${app.name} tab`} onPress={() => { haptic('tap'); newTab(base!); }} /> : null}
          {canSplit ? <IconButton icon="split" label={split ? 'Close split' : 'Split with another app'} onPress={() => (split ? closeSplit() : setPicker(true))} /> : null}
          {size !== 'compact' || !split ? <IconButton icon="external" label="Open in browser" onPress={() => openOutside(navRef.current[app.id]?.url || app.url)} /> : null}
          <IconButton icon="close" label={`Close ${app.name}`} onPress={() => closeApp(app.id)} />
        </View> : null}
      </View>
      {tabList.length ? (
        // the focused app's tabs, like a browser's. Its own page is the first; the others can be closed.
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, borderBottomWidth: 1, borderColor: c.line }} contentContainerStyle={{ gap: S(1), paddingHorizontal: S(2), paddingVertical: S(1), alignItems: 'center' }}>
          {tabList.map((id, i) => {
            const on = id === focused;
            return (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', height: 36, maxWidth: 220, borderRadius: R.input, backgroundColor: on ? c.bg : 'transparent', borderWidth: 1, borderColor: on ? c.lineStrong : 'transparent' }}>
                <Pressable accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => openApp(id)} style={{ paddingLeft: S(3), paddingRight: i ? S(1) : S(3), height: '100%', justifyContent: 'center', flexShrink: 1 }}>
                  <Txt kind="small" numberOfLines={1} style={{ fontWeight: on ? '600' : '500', color: on ? c.text : c.muted }}>{tabLabel(id, i)}</Txt>
                </Pressable>
                {i ? <Pressable accessibilityRole="button" accessibilityLabel={`Close tab ${tabLabel(id, i)}`} hitSlop={6} onPress={() => closeTab(id)} style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginRight: 2 }}><Icon name="close" size={14} color={c.faint} /></Pressable> : null}
              </View>
            );
          })}
          <Pressable accessibilityRole="button" accessibilityLabel={`New ${app!.name} tab`} hitSlop={6} onPress={() => newTab(base!)} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: R.input, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.hover : 'transparent' })}><Icon name="plus" size={16} color={c.muted} /></Pressable>
        </ScrollView>
      ) : null}
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
          const a = all.find((x) => x.id === id); if (!a) return null;
          const inSplit = !!split && shown.length > 1 && shown.includes(id);
          return (
            <View key={id} style={place(id)} pointerEvents={shown.includes(id) ? 'auto' : 'none'}>
              {inSplit ? <PaneStrip app={a} focused={focused === id} onFocus={() => openApp(id)}
                onSwap={() => updateSplit({ a: split!.b, b: split!.a })} onMax={() => closeSplit(split!.a === id ? 'a' : 'b')} onClose={() => closeApp(id)} /> : null}
              <Pane app={a} desktop={baseOf(a.id) === 'teams' || wide} onNav={onNav} setRef={setRef} onTouch={inSplit && focused !== id ? () => openApp(id) : undefined} />
              {loading[id] ? <View style={{ position: 'absolute', top: inSplit ? STRIP : 0, left: 0, right: 0, height: 2, backgroundColor: c.accent, opacity: 0.6 }} /> : null}
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
// Ebwise's login page has one button, "sign in with Microsoft". Press it for you (like the desktop does), at most
// once a minute and only on the bare page, so an error shown on it (?errors…) stays for you to read. Android web
// views share cookies, so if you're signed in to Outlook or Teams the Microsoft step finishes by itself.
const lastAutoSignIn: Record<string, number> = {};
function autoSignIn(app: WebApp, url: string, view: ComponentRef<typeof WebView> | null) {
  const base = baseOf(app.id); const sso = SignIn[base]; if (!sso || !view) return;
  let u: URL; try { u = new URL(url); } catch { return; }
  if (u.origin !== new URL(app.url).origin || u.pathname !== sso.page || u.search) return;
  if (Date.now() - (lastAutoSignIn[app.id] ?? 0) < 60e3) return;
  lastAutoSignIn[app.id] = Date.now();
  view.injectJavaScript(`document.querySelector(${JSON.stringify(sso.click)})?.click(); true;`);
}

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
        onLoadEnd={(e) => autoSignIn(a, e.nativeEvent.url, ref.current)}
        sharedCookiesEnabled thirdPartyCookiesEnabled domStorageEnabled javaScriptEnabled
        setSupportMultipleWindows={false}
        originWhitelist={ANY_ORIGIN}
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
          if (GOOGLE_SIGN_IN.test(r.url)) { googleBlocked(a); return false; }
          return allowLoad(r.url);
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

function PaneStrip({ app, focused, onFocus, onSwap, onMax, onClose }: { app: WebApp; focused: boolean; onFocus: () => void; onSwap: () => void; onMax: () => void; onClose: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${app.name}${focused ? ', focused' : ''}`} onPress={onFocus}
      style={{ height: STRIP, flexDirection: 'row', alignItems: 'center', gap: S(2), paddingLeft: S(3), backgroundColor: focused ? c.accentSoft : c.side, borderTopWidth: 2, borderColor: focused ? c.accent : 'transparent' }}>
      <Glyph app={app} size={18} />
      <Txt kind="small" numberOfLines={1} style={{ flex: 1, fontWeight: '600', color: focused ? c.text : c.muted }}>{app.name}</Txt>
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
  // (a plain box, not a ref: the gesture handlers below only read it while you drag, never during render)
  const [live] = useState(() => ({ vertical, at, along, start: 0 }));
  useEffect(() => { Object.assign(live, { vertical, at, along }); }, [live, vertical, at, along]);
  const [drag, setDrag] = useState(false);
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { live.start = live.at; setDrag(true); haptic('tap'); },
    onPanResponderMove: (_e, g) => {
      const { vertical: v, along: len } = live;
      updateSplit({ ratio: Math.min(0.75, Math.max(0.25, (live.start + (v ? g.dy : g.dx)) / len)) });
    },
    onPanResponderRelease: (_e, g) => {
      setDrag(false);
      const { vertical: v, along: len } = live;
      const r = (live.start + (v ? g.dy : g.dx)) / len;
      const snap = [1 / 3, 0.5, 2 / 3].find((x) => Math.abs(x - r) < 0.04);
      updateSplit({ ratio: Math.min(0.75, Math.max(0.25, snap ?? r)) });
      if (snap) haptic('light');
    },
    onPanResponderTerminate: () => setDrag(false),
  }));
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
