import { Text, View } from 'react-native';
import { Icon } from './Icon';
import { S, useTheme } from './theme';
import type { ClassItem } from '../lib/types';
import { classLabel } from '../lib/format';
import { useStore } from '../lib/store';

// A class's icon in its colour, on a soft tile of the same colour.
export function ClassIcon({ cls, size = 36 }: { cls: ClassItem; size?: number }) {
  const mode = useStore((s) => s.settings.classLabel);
  const { dark } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, borderCurve: 'continuous', backgroundColor: `${cls.color}${dark ? '33' : '1f'}`, alignItems: 'center', justifyContent: 'center' }}>
      {cls.icon ? <Icon name={cls.icon} size={size * 0.5} color={cls.color} /> : (
        <Text style={{ color: cls.color, fontWeight: '700', fontSize: size * 0.42 }}>{classLabel(cls, mode).trim()[0]?.toUpperCase() || '?'}</Text>
      )}
    </View>
  );
}

export function ColorDot({ color }: { color: string }) {
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: S(1) }} />;
}
