// An app's square tile: its colour with its icon, the site's own logo for apps you added, or its first letter.
// Used by the sidebar, Today and Apps.
import { Image, Text, View } from 'react-native';
import { AppGlyph } from './Icon';
import type { WebApp } from '../lib/types';

const DRAWN = ['ebwise', 'mail', 'calendar', 'teams'];
const raster = (icon?: string | null) => !!icon && /^data:image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|webp|gif);base64,/i.test(icon);
export function AppTile({ app, size = 28 }: { app: WebApp; size?: number }) {
  const r = size * 0.28;
  if (!DRAWN.includes(app.id) && raster(app.icon)) {
    // a logo sits on a light tile so dark and transparent logos stay visible in dark mode
    return (
      <View style={{ width: size, height: size, borderRadius: r, borderCurve: 'continuous', backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }}>
        <Image source={{ uri: app.icon! }} style={{ width: size * 0.78, height: size * 0.78 }} resizeMode="contain" accessibilityIgnoresInvertColors />
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: r, borderCurve: 'continuous', backgroundColor: app.color, alignItems: 'center', justifyContent: 'center' }}>
      {DRAWN.includes(app.id) ? <AppGlyph id={app.id} name={app.name} size={size * 0.62} /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.45 }}>{app.name[0]}</Text>}
    </View>
  );
}
