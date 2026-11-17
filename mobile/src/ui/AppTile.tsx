// An app's square tile: its colour with its icon, or its first letter. Used by the sidebar, Today and Apps.
import { Text, View } from 'react-native';
import { AppGlyph } from './Icon';
import type { WebApp } from '../lib/types';

const DRAWN = ['ebwise', 'mail', 'calendar', 'teams'];
export function AppTile({ app, size = 28 }: { app: WebApp; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, borderCurve: 'continuous', backgroundColor: app.color, alignItems: 'center', justifyContent: 'center' }}>
      {DRAWN.includes(app.id) ? <AppGlyph id={app.id} name={app.name} size={size * 0.62} /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.45 }}>{app.name[0]}</Text>}
    </View>
  );
}
