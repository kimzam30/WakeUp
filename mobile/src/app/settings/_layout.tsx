// Settings opens from your avatar (Today) or the sidebar. A list, then each section pushes in from the side;
// Android Back steps out of a section first, then closes Settings.
import { Stack } from 'expo-router';
import { useTheme } from '../../ui/theme';

export default function SettingsLayout() {
  const { c } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }} />;
}
