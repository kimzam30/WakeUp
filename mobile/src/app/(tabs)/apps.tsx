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
import { Button, Empty, IconButton, Sheet, Txt, useBarSpace, useLayout } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { AppTile as Glyph } from '../../ui/AppTile';
import { R, S, useTheme } from '../../ui/theme';
import { allApps, baseOf, closeApp, closeSplit, closeTab, focusedApp, getState, newTab, openApp, openSplit, setSettings, setTabUrl, updateSplit, useStore, withTabs } from '../../lib/store';
import type { WebApp } from '../../lib/types';
import { SignIn } from '../../lib/shared';
import { signInScript } from '../../lib/signins';
import { isMeetingUrl, startScanScript, stopScanScript } from '../../lib/qr-scan';
import { dismissToast, toast } from '../../ui/Toast';

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
  const bar = useBarSpace();
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
  const [switching, setSwitching] = useState(false); // phones: the "Your apps" sheet from the app name
  const [more, setMore] = useState(false); // phones: the actions sheet from ⋯
  const [area, setArea] = useState({ w: 0, h: 0 });
  const canSplit = size !== 'cover' && apps.length > 1;
  const shown = split && canSplit ? [split.a, split.b] : active ? [active] : [];
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
  // attendance QR (v3, A6): the scanner runs inside the meeting page (lib/qr-scan.ts) and posts back what it finds
  const [qrOn, setQrOn] = useState<string | null>(null);
  const stopQr = useCallback(() => { setQrOn((id) => { if (id) refs.current[id]?.injectJavaScript(stopScanScript()); return null; }); dismissToast('qr'); }, []);
  const startQr = (id: string) => {
    haptic('tap'); setQrOn(id); refs.current[id]?.injectJavaScript(startScanScript());
    toast({ id: 'qr', icon: 'qr', text: 'Looking for an attendance QR on screen…', ms: 600000, action: { label: 'Stop', run: stopQr } });
  };
  const onPageMessage = useCallback((id: string, data: string) => {
    let m: { wakeupQr?: string; wakeupQrTimeout?: boolean }; try { m = JSON.parse(data); } catch { return; }
    if (m.wakeupQrTimeout) { setQrOn(null); toast({ icon: 'qr', text: 'No attendance QR found in 10 minutes.' }); return; }
    if (typeof m.wakeupQr !== 'string') return;
    setQrOn(null); haptic('success');
    const text = m.wakeupQr; let link: string | null = null;
    try { const u = new URL(text); if (u.protocol === 'https:' || u.protocol === 'http:') link = u.href; } catch { /* plain text */ }
    toast(link
      ? { id: 'qr', icon: 'qr', text: `Attendance QR: ${new URL(link).hostname}`, ms: 30000, action: { label: 'Open', run: () => { Linking.openURL(link).catch(() => {}); } } }
      : { id: 'qr', icon: 'qr', text: `QR code: ${text.slice(0, 80)}`, ms: 30000 });
    void id;
  }, []);
  const app = all.find((a) => a.id === focused);
  const base = app ? baseOf(app.id) : null;
  const tabList = base && tabs[base]?.length ? [base, ...tabs[base].map((t) => t.id)] : [];
  const tabLabel = (id: string, i: number) => { const t = titles[id]; return t && !/^https?:/.test(t) ? t : i ? `${app!.name} ${i + 1}` : app!.name; };

  // Phones (v3 top bar, option A): the app's name opens "Your apps", ⋯ holds the rest with words, not bare icons.
  // The tablet keeps its row of buttons: it has the room, and its apps are in the sidebar.
  const isOpen = (id: string) => openIds.some((o) => baseOf(o) === id);
  // a page with no title shows its address ("login.microsoftonline.com…"): leave those out
  const pageTitle = app && titles[app.id] && titles[app.id] !== app.name && !/^https?:|^[^\s]+\.[a-z]{2,}/i.test(titles[app.id]) ? titles[app.id] : '';
  const openCount = apps.filter((a) => isOpen(a.id)).length;
  const phoneTitle = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(2), paddingLeft: S(2), minWidth: 0 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={app ? `${app.name}. Switch app` : 'Choose an app'} accessibilityHint={openCount > 1 ? `${openCount} apps open` : undefined}
        onPress={() => { haptic('tap'); setSwitching(true); }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S(2), height: 44, paddingLeft: 6, paddingRight: S(2), borderRadius: R.pill, borderCurve: 'continuous', backgroundColor: pressed ? c.hover : c.sunken, flexShrink: 1, minWidth: 0 })}>
        {app ? <Glyph app={app} size={28} /> : <View style={{ width: 28, alignItems: 'center' }}><Icon name="apps" size={20} color={c.text} /></View>}
        <Txt kind="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{app ? app.name : 'Apps'}</Txt>
        <Icon name="chevD" size={16} color={c.muted} />
        {openCount > 1 ? <View style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: R.pill, backgroundColor: c.active, alignItems: 'center', justifyContent: 'center' }}><Txt kind="tiny" style={{ color: c.muted, letterSpacing: 0 }}>{String(openCount)}</Txt></View> : null}
      </Pressable>
      {pageTitle ? <Txt kind="small" faint numberOfLines={1} style={{ flex: 1 }}>{pageTitle}</Txt> : null}
    </View>
  );
  const act = (k: string) => {
    setMore(false); if (!app) return;
    if (k === 'qr') { if (qrOn === app.id) stopQr(); else startQr(app.id); }
    else if (k === 'back') refs.current[app.id]?.goBack();
    else if (k === 'tab') { haptic('tap'); newTab(base!); }
    else if (k === 'split') { if (split) closeSplit(); else setPicker(true); }
    else if (k === 'browser') openOutside(navRef.current[app.id]?.url || app.url);
    else if (k === 'close') closeApp(app.id);
  };
  const row = (k: string, icon: string, label: string, tint?: string) => <MenuRow icon={icon} label={label} tint={tint} onPress={() => act(k)} />;
  const sheets = (
    <>
      <Sheet open={switching} onClose={() => setSwitching(false)} title="Your apps">
        <View style={{ gap: S(1) }}>
          {apps.map((a) => {
            const on = a.id === base; const open = isOpen(a.id);
            const sub = on && pageTitle ? pageTitle : open ? 'Open' : 'Not open';
            return (
              <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: R.input, backgroundColor: on ? c.accentSoft : 'transparent' }}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${a.name}, ${sub}`} accessibilityState={{ selected: on }} accessibilityHint={canSplit ? 'Long-press to open beside the current app' : undefined}
                  onPress={() => { setSwitching(false); openApp(a.id); }}
                  onLongPress={() => { if (canSplit && focused && a.id !== base) { haptic('tap'); setSwitching(false); openSplit(a.id); } }}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: S(3), minHeight: 60, paddingLeft: S(3) }}>
                  <Glyph app={a} size={32} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt kind="headline" numberOfLines={1}>{a.name}</Txt>
                    <Txt kind="small" muted={open} faint={!open} numberOfLines={1}>{sub}</Txt>
                  </View>
                </Pressable>
                {open ? <IconButton icon="close" label={`Close ${a.name}`} onPress={() => closeApp(a.id)} color={c.muted} /> : <View style={{ width: S(3) }} />}
              </View>
            );
          })}
          <Button label="Manage apps" icon="settings" onPress={() => { setSwitching(false); router.push('/settings/apps'); }} style={{ marginTop: S(2) }} />
        </View>
      </Sheet>
      <Sheet open={more && !!app} onClose={() => setMore(false)} title={app?.name ?? ''}>
        {app ? (
          <View style={{ gap: S(1) }}>
            {isMeetingUrl(app.url) ? row('qr', 'qr', qrOn === app.id ? 'Stop looking for the attendance QR' : 'Scan for an attendance QR', qrOn === app.id ? c.accentText : undefined) : null}
            {row('back', 'back', 'Go back a page')}
            {!split ? row('tab', 'plus', `New ${app.name} tab`) : null}
            {canSplit ? row('split', 'split', split ? 'Close split screen' : 'Split with another app') : null}
            {row('browser', 'external', 'Open in browser')}
            <View style={{ height: 1, backgroundColor: c.line, marginVertical: S(1) }} />
            {row('close', 'close', `Close ${app.name}`)}
          </View>
        ) : null}
      </Sheet>
    </>
  );

  if (!apps.length) {
    return <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: bar, backgroundColor: c.bg }}><Empty icon="apps" title="No apps yet" body="Turn on Ebwise, Outlook or Teams, or add any website, in Settings." action={<Button label="Open Settings" onPress={() => router.push('/settings/apps')} />} /></View>;
  }

  const ratio = split?.ratio ?? 0.5;
  const along = vertical ? area.h : area.w;
  const first = Math.round(along * ratio);
  // where each loaded app sits: a half, the whole area, or parked off-screen (still loaded)
  const place = (id: string) => {
    // parked apps keep the full size, hidden behind: a page laid out in a 1×1 box keeps Android's zoom for that size,
    // so Outlook came back zoomed in until the app restarted
    if (!shown.includes(id)) return { position: 'absolute' as const, left: 0, top: 0, width: area.w, height: area.h, opacity: 0, zIndex: -1 };
    if (shown.length === 1) return { position: 'absolute' as const, left: 0, top: 0, width: area.w, height: area.h };
    const isA = id === split!.a;
    const len = isA ? first - 3 : along - first - 3;
    return vertical
      ? { position: 'absolute' as const, left: 0, top: isA ? 0 : first + 3, width: area.w, height: len }
      : { position: 'absolute' as const, top: 0, left: isA ? 0 : first + 3, height: area.h, width: len };
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: bar }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: c.line }}>
        {/* tablets list the apps in the sidebar, so the bar shows what's on screen instead, like a desktop pane */}
        <View style={{ flex: 1 }}>{wide ? (app ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S(3), paddingHorizontal: S(4) }}>
            <Glyph app={app} size={24} />
            <Txt kind="small" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }}>{app.name}</Txt>
            {titles[app.id] && titles[app.id] !== app.name && !/^https?:/.test(titles[app.id]) ? <Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{titles[app.id]}</Txt> : null}
          </View>
        ) : null) : phoneTitle}</View>
        {app && !wide ? <View style={{ flexDirection: 'row', paddingRight: S(1) }}>
          <IconButton icon="reload" label="Reload" onPress={() => refs.current[app.id]?.reload()} />
          <IconButton icon="more" label={`More for ${app.name}`} onPress={() => { haptic('tap'); setMore(true); }} />
        </View> : null}
        {app && wide ? <View style={{ flexDirection: 'row', paddingRight: S(1) }}>
          {size !== 'compact' ? <IconButton icon="back" label="Back" onPress={() => refs.current[app.id]?.goBack()} /> : null}
          {isMeetingUrl(app.url) ? <IconButton icon="qr" label={qrOn === app.id ? 'Stop looking for an attendance QR' : 'Scan for an attendance QR on screen'} color={qrOn === app.id ? c.accentText : undefined} onPress={() => (qrOn === app.id ? stopQr() : startQr(app.id))} /> : null}
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
            <Txt kind="display">Apps</Txt>
            <Txt muted>{`Each app keeps its own place while you switch. Sign in to Microsoft once and Outlook, Calendar, Teams and Ebwise share it.${canSplit ? ' To see two at once, open one and tap Split.' : ''}`}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(3) }}>
              {apps.map((a) => (
                <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Open ${a.name}`} onPress={() => openApp(a.id)}
                  style={({ pressed }) => ({ width: wide ? 148 : '47%', flexGrow: wide ? 0 : 1, padding: S(4), gap: S(3), borderRadius: R.card, borderCurve: 'continuous', borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.hover : c.bg, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                  <Glyph app={a} size={40} />
                  <Txt kind="headline">{a.name}</Txt>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : null}
        {/* no page loads before the area is measured, for the same reason */}
        {area.w > 0 && openIds.map((id) => {
          const a = all.find((x) => x.id === id); if (!a) return null;
          const inSplit = !!split && shown.length > 1 && shown.includes(id);
          return (
            <View key={id} style={place(id)} pointerEvents={shown.includes(id) ? 'auto' : 'none'}>
              {inSplit ? <PaneStrip app={a} focused={focused === id} onFocus={() => openApp(id)}
                onSwap={() => updateSplit({ a: split!.b, b: split!.a })} onMax={() => closeSplit(split!.a === id ? 'a' : 'b')} onClose={() => closeApp(id)} /> : null}
              <Pane app={a} desktop={baseOf(a.id) === 'teams' || wide} onNav={onNav} setRef={setRef} onMessage={onPageMessage} onTouch={inSplit && focused !== id ? () => openApp(id) : undefined} />
              {loading[id] ? <View style={{ position: 'absolute', top: inSplit ? STRIP : 0, left: 0, right: 0, height: 2, backgroundColor: c.accent, opacity: 0.6 }} /> : null}
            </View>
          );
        })}
        {split && shown.length > 1 && area.w ? <Divider vertical={vertical} at={first} along={along} /> : null}
      </View>
      {wide ? null : sheets}
      <Sheet open={picker} onClose={() => setPicker(false)} title="Split with…">
        <Txt muted>{vertical ? 'It opens below the app you have open. Drag the bar between them to resize.' : 'It opens beside the app you have open. Drag the bar between them to resize.'}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S(3) }}>
          {apps.filter((a) => a.id !== focused).map((a) => (
            <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Split with ${a.name}`} onPress={() => { setPicker(false); openSplit(a.id); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S(3), minHeight: 56, paddingHorizontal: S(4), borderRadius: R.card, borderCurve: 'continuous', borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.hover : c.bg, flexBasis: wide ? '30%' : '46%', flexGrow: 1 })}>
              <Glyph app={a} size={32} />
              <Txt kind="headline">{a.name}</Txt>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

// One line of the ⋯ sheet: an icon and words, the whole row is the button
function MenuRow({ icon, label, onPress, tint }: { icon: string; label: string; onPress: () => void; tint?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S(4), minHeight: 52, paddingHorizontal: S(3), borderRadius: R.input, backgroundColor: pressed ? c.hover : 'transparent' })}>
      <Icon name={icon} size={20} color={tint ?? c.muted} />
      <Txt style={{ flex: 1, color: tint ?? c.text }}>{label}</Txt>
    </Pressable>
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

// A site's offline cache (its service worker) can break inside Android's web view and then fail every page load
// with net::ERR_FAILED: Android's black "Web page not available" page with the upside-down droid. Teams does this
// (seen on the Z Flip, 2026-11-20). Fix it like a browser's "clear site data", but only the worker: open a plain page on
// that site outside the worker's reach (/robots.txt), unregister its workers there, then load the page again. Cookies
// and sign-ins stay. At most once per site every 10 minutes, so a site that is really down shows the normal error.
const workerResetAt: Record<string, number> = {};
const RESET_PAGE = '/robots.txt';
const PROBE = `window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({wakeupProbe:location.protocol}));true;`;
const CLEAR_WORKERS = `(function(){var done=function(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({wakeupWorkersCleared:true}));};
try{navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister();}));}).then(done,done);}catch(e){done();}})();true;`;
function brokenWorkerOrigin(url: string, description?: string) {
  if (description !== undefined && !/ERR_FAILED/.test(description)) return null;
  let u: URL; try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.pathname === RESET_PAGE) return null;
  if (Date.now() - (workerResetAt[u.origin] ?? 0) < 10 * 60e3) return null;
  workerResetAt[u.origin] = Date.now();
  return u.origin;
}

const Pane = memo(function Pane({ app: a, desktop, onNav, setRef, onMessage, onTouch }: { app: WebApp; desktop: boolean; onNav: (id: string, e: WebViewNavigation) => void; setRef: (id: string, r: ComponentRef<typeof WebView> | null) => void; onMessage: (id: string, data: string) => void; onTouch?: () => void }) {
  const { c } = useTheme();
  const [life, setLife] = useState(0); // bumped when Android kills the page's renderer: the page reloads instead of the app crashing
  const ref = useRef<ComponentRef<typeof WebView> | null>(null);
  const [src, setSrc] = useState(a.url);
  const resetting = useRef<string | null>(null); // the page to load again once the site's workers are cleared
  const [broken, setBroken] = useState(false); // Android's own error page is showing: cover it with ours
  const loadingUrl = useRef<string | null>(null);
  const probes = useRef<ReturnType<typeof setTimeout>[]>([]);
  // A load the worker fails never ends or errors on Android's side (checked on the emulator with a broken worker):
  // only "started" arrives, then Android's error page. So ask the page where it is a few seconds in.
  const started = (url: string) => {
    probes.current.forEach(clearTimeout); setBroken(false);
    if (!/^https:/.test(url)) return;
    loadingUrl.current = url;
    probes.current = [2500, 8000].map((ms) => setTimeout(() => ref.current?.injectJavaScript(PROBE), ms));
  };
  const failed = (url: string, description?: string) => {
    if (resetting.current) return;
    const origin = brokenWorkerOrigin(url, description);
    if (!origin) { if (description === undefined) setBroken(true); return; }
    resetting.current = url; setSrc(origin + RESET_PAGE);
  };
  useEffect(() => () => probes.current.forEach(clearTimeout), []);
  return (
    <View style={{ flex: 1 }} onTouchStart={onTouch}>
      <WebView
        key={life}
        ref={(r) => { ref.current = r; setRef(a.id, r); }}
        source={{ uri: src }}
        userAgent={desktop ? DESKTOP_UA : undefined}
        onNavigationStateChange={(e) => onNav(a.id, e)}
        onLoadStart={(e) => started(e.nativeEvent.url)}
        onLoadEnd={(e) => {
          const { url } = e.nativeEvent;
          if (resetting.current && url.endsWith(RESET_PAGE)) { ref.current?.injectJavaScript(CLEAR_WORKERS); return; }
          autoSignIn(a, e.nativeEvent.url, ref.current);
          // saved sign-in: typed only on Microsoft's sign-in page (lib/signins.ts)
          signInScript(e.nativeEvent.url).then((js) => { if (js) ref.current?.injectJavaScript(js); }).catch(() => {});
        }}
        onError={(e) => failed(e.nativeEvent.url, e.nativeEvent.description)}
        onMessage={(e) => {
          const d = e.nativeEvent.data;
          if (d.includes('wakeupProbe')) { if (d.includes('chrome-error:')) failed(loadingUrl.current ?? a.url); return; }
          if (resetting.current && d.includes('wakeupWorkersCleared')) { setSrc(resetting.current); resetting.current = null; return; }
          onMessage(a.id, e.nativeEvent.data);
        }}
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
      {broken ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: S(3), padding: S(6), backgroundColor: c.bg }}>
          <Icon name="offline" size={32} color={c.faint} />
          <Txt kind="headline">{`${a.name} didn’t load`}</Txt>
          <Txt muted style={{ textAlign: 'center' }}>Check your connection, then try again. If it keeps happening, open it in your browser from the top bar.</Txt>
          <Button label="Try again" icon="reload" onPress={() => { setBroken(false); ref.current?.reload(); }} />
        </View>
      ) : null}
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
