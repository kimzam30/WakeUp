// The WakeUp app icon, small, for the tablet sidebar and next to the greeting on phones.
import { Image } from 'react-native';

const SRC = require('../../assets/logo.png');
export function Logo({ size = 28 }: { size?: number }) {
  return <Image source={SRC} style={{ width: size, height: size }} accessibilityIgnoresInvertColors accessible={false} />;
}
