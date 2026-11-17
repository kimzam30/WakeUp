import { Planner } from '../lib/shared';
// WakeUp's colours, the same tokens as the desktop app (src/ui/ui.css): neutral surfaces, thin lines,
// one blue accent. Colour beyond that comes only from app icons, class colours and status chips.
import { useColorScheme } from 'react-native';
import { useStore } from '../lib/store';

const light = {
  bg: '#ffffff', side: '#f7f7f5', raised: '#ffffff', sunken: '#f7f7f5', hover: '#efefed', active: '#e8e8e5',
  line: '#e8e8e6', lineStrong: '#d9d9d6', text: '#1f1f1e', muted: '#6b6a67', faint: '#8f8e8a',
  accent: '#2b63d9', accentText: '#1f4fb8', accentInk: '#ffffff', accentSoft: '#eaf0fc',
  good: '#1d6b45', goodBg: '#e3f2ea', bad: '#b42318', badBg: '#fdecea', warn: '#8a5300', warnBg: '#fdf1dc', info: '#1f4fb8', infoBg: '#eaf0fc',
  scrim: 'rgba(0,0,0,0.32)',
};
const dark: typeof light = {
  bg: '#191919', side: '#1f1f1f', raised: '#232323', sunken: '#202020', hover: '#2a2a2a', active: '#313131',
  line: '#2c2c2c', lineStrong: '#3a3a3a', text: '#e8e8e6', muted: '#a3a3a0', faint: '#7a7a77',
  accent: '#2b63d9', accentText: '#7fa6f5', accentInk: '#ffffff', accentSoft: '#1b2740',
  good: '#7dd3a8', goodBg: '#1c3328', bad: '#f59a92', badBg: '#3a1e1c', warn: '#e9b860', warnBg: '#352a17', info: '#8fb3f7', infoBg: '#1b2740',
  scrim: 'rgba(0,0,0,0.55)',
};
export type Colors = typeof light;

export function useTheme() {
  const system = useColorScheme();
  const pref = useStore((s) => s.settings.theme);
  const isDark = pref === 'dark' || (pref === 'system' && system === 'dark');
  return { c: isDark ? dark : light, dark: isDark };
}

// Shape lock: actions are pills, cards 14, inputs and rows 10, chips 6. Spacing on a 4 grid.
export const R = { card: 14, input: 10, chip: 6, pill: 999 } as const;
export const S = (n: number) => n * 4;

// Type ramp (sp): one display size per screen.
export const T = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.4 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  headline: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  tiny: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.4 },
};

// Status chips and class colours come from the shared planner core, so both apps use the same words and colours.
export const STATUS: Record<string, [string, 'bad' | 'info' | 'warn' | 'good']> = Planner.STATUS;
export const CLASS_COLORS: string[] = Planner.CLASS_COLORS;
