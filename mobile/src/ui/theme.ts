import { Look, Planner } from '../lib/shared';
// WakeUp's colours, the same tokens as the desktop app (src/ui/ui.css): neutral surfaces, thin lines,
// one blue accent. Colour beyond that comes only from app icons, class colours and status chips.
import { useColorScheme } from 'react-native';
import { useStore } from '../lib/store';

// D · Glass + Paper (docs/DESIGN.md): a white (black in dark) page, one cool-grey family, hairlines; glass only on
// what floats (the tab bar, sheets, toasts).
const light = {
  bg: '#ffffff', side: '#f6f7f9', raised: '#ffffff', sunken: '#f3f4f6', hover: '#eef0f3', active: '#e5e7eb',
  line: '#e6e8eb', lineStrong: '#d4d7dc', text: '#111318', muted: '#5f6570', faint: '#8b919b',
  accent: '#2b63d9', accentText: '#1f4fb8', accentInk: '#ffffff', accentSoft: '#eaf0fc',
  good: '#1d6b45', goodBg: '#e3f2ea', bad: '#b42318', badBg: '#fdecea', warn: '#8a5300', warnBg: '#fdf1dc', info: '#1f4fb8', infoBg: '#eaf0fc',
  scrim: 'rgba(0,0,0,0.32)',
  glass: 'rgba(255,255,255,0.62)', glassLine: 'rgba(0,0,0,0.08)', glassShadow: '0 8px 28px rgba(15,20,30,0.14)',
};
const dark: typeof light = {
  bg: '#000000', side: '#0c0d0f', raised: '#141518', sunken: '#17181b', hover: '#1f2125', active: '#26282d',
  line: '#222428', lineStrong: '#33363b', text: '#eceef1', muted: '#a1a6ae', faint: '#737881',
  accent: '#2b63d9', accentText: '#7fa6f5', accentInk: '#ffffff', accentSoft: '#16213a',
  good: '#7dd3a8', goodBg: '#1c3328', bad: '#f59a92', badBg: '#3a1e1c', warn: '#e9b860', warnBg: '#352a17', info: '#8fb3f7', infoBg: '#1b2740',
  scrim: 'rgba(0,0,0,0.6)',
  glass: 'rgba(30,31,35,0.58)', glassLine: 'rgba(255,255,255,0.10)', glassShadow: '0 8px 28px rgba(0,0,0,0.5)',
};
export type Colors = typeof light;
const cache: Record<string, Colors> = {}; // one object per accent and mode, so screens don't re-render for nothing

export function useTheme() {
  const system = useColorScheme();
  const pref = useStore((s) => s.settings.theme);
  const accentId = useStore((s) => s.settings.accent);
  const isDark = pref === 'dark' || (pref === 'system' && system === 'dark');
  const base = isDark ? dark : light;
  const c = accentId && accentId !== 'blue' ? (cache[`${accentId}-${isDark}`] ??= { ...base, ...Look.accent(accentId, isDark) }) : base;
  return { c, dark: isDark };
}

// Shape lock: actions and chips are pills, cards and sheets 18, inputs 12, small chips 8. Spacing on a 4 grid.
export const R = { card: 18, input: 12, chip: 8, pill: 999 } as const;
export const S = (n: number) => n * 4;

// Type ramp (sp), Inter (bundled by the expo-font plugin in app.json). One large title per screen.
const F = 'Inter';
export const T = {
  display: { fontFamily: F, fontSize: 32, lineHeight: 38, fontWeight: '700' as const, letterSpacing: -0.6 },
  title: { fontFamily: F, fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  headline: { fontFamily: F, fontSize: 16, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.1 },
  body: { fontFamily: F, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: F, fontSize: 13, lineHeight: 18 },
  tiny: { fontFamily: F, fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.5 },
};

// Status chips and class colours come from the shared planner core, so both apps use the same words and colours.
export const STATUS: Record<string, [string, 'bad' | 'info' | 'warn' | 'good']> = Planner.STATUS;
export const CLASS_COLORS: string[] = Planner.CLASS_COLORS;
