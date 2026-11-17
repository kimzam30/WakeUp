import { Stack } from 'expo-router';
import { useTheme } from '../../ui/theme';
import { useLayout } from '../../ui/kit';

// Onboarding has its own small stack so "Add a class" can open the class editor before the app proper exists.
export default function OnboardingLayout() {
  const { c } = useTheme();
  const { wide } = useLayout();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="class" options={wide ? { presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } } : { presentation: 'modal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
}
