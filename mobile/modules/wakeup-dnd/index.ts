// Do Not Disturb while you focus (v3 A3, "mute, don't block"). Android only; null when the native part isn't built in.
import { requireOptionalNativeModule } from 'expo-modules-core';

type Dnd = {
  hasAccess(): boolean; // the user allowed WakeUp to change Do Not Disturb
  openAccessSettings(): void; // Android's "Do Not Disturb access" list
  quietUntil(untilMs: number): boolean; // on now, back off at `untilMs` even if WakeUp is closed (false: no access)
  restore(): void; // back to how it was, unless the user changed it meanwhile
};
export default requireOptionalNativeModule<Dnd>('WakeupDnd');
