import { useState } from 'react';
import { Image, View } from 'react-native';
import { Txt } from './kit';
import { useTheme } from './theme';

// your Google profile picture, or the first letter of your name
export function Avatar({ sync, size = 32 }: { sync: { name: string; email: string; avatar?: string }; size?: number }) {
  const { c } = useTheme();
  const [failed, setFailed] = useState(false);
  if (sync.avatar && !failed) return <Image source={{ uri: sync.avatar }} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.sunken }} accessibilityIgnoresInvertColors />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Txt style={{ color: c.accentText, fontWeight: '700', fontSize: size * 0.42 }}>{(sync.name || sync.email || '?')[0].toUpperCase()}</Txt>
    </View>
  );
}
