// Root: onboarding is a one-way door (Stack.Protected), so back can never return to it once finished.
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useStore } from '../lib/store';
import { startSync } from '../lib/sync';
import { startUpdates } from '../lib/updater';
import { startIcons } from '../lib/icons';
import { listenForTaps, registerTopUp, rescheduleSoon, startNotificationActions } from '../lib/reminders';
import { useTheme } from '../ui/theme';
import { useLayout } from '../ui/kit';
import { GlassLayer } from '../ui/Glass';
import { ToastHost } from '../ui/Toast';
import { startWidgets } from '../widgets';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Root() {
  const onboarded = useStore((s) => s.onboarded);
  const { c, dark } = useTheme();
  const { wide } = useLayout();
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    // after sync has restored your sign-in, so a logo found here uploads to your other devices
    startSync().catch(() => {}).finally(() => { startIcons(); startNotificationActions(); });
    startUpdates();
    rescheduleSoon();
    registerTopUp();
    startWidgets();
    return listenForTaps();
  }, []);
  useEffect(() => { SystemUI.setBackgroundColorAsync(c.bg).catch(() => {}); }, [c.bg]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <GlassLayer overlay={<ToastHost />}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'fade_from_bottom' }}>
        <Stack.Protected guard={onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" options={wide ? { presentation: 'transparentModal', animation: 'fade' } : { presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="focus" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }} />
          <Stack.Screen name="classes/[id]" options={wide ? { presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } } : { animation: 'slide_from_right' }} />
          <Stack.Screen name="class" options={wide ? { presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } } : { presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack.Protected>
        <Stack.Protected guard={!onboarded}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
      </Stack>
      </GlassLayer>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
