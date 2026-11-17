// Haptics with a setting. Subtle (the default) buzzes only for moments that matter: finishing or adding a task,
// and a split snapping into place. Full also buzzes on ordinary taps (buttons, tabs, options). Off is off.
import * as Haptics from 'expo-haptics';
import { getState } from './store';

type Kind = 'tap' | 'success' | 'light';
export function haptic(kind: Kind) {
  const level = getState().settings.haptics ?? 'subtle';
  if (level === 'off' || (level === 'subtle' && kind === 'tap')) return;
  const p = kind === 'success' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : kind === 'light' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    : Haptics.selectionAsync();
  p.catch(() => {});
}
