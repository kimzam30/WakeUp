// The desktop app's line icons (16px grid, 1.6 stroke), so both apps speak one visual language.
import Svg, { Path, Circle } from 'react-native-svg';

const P: Record<string, string> = {
  back: 'M10 3 5 8l5 5', forward: 'M6 3l5 5-5 5', chevR: 'M6 3l5 5-5 5', chevL: 'M10 3 5 8l5 5', chevD: 'M4 6l4 4 4-4',
  reload: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3',
  external: 'M8 2.3a5.7 5.7 0 1 0 0 11.4A5.7 5.7 0 0 0 8 2.3zM2.5 8h11M8 2.3C6.5 4 5.8 5.9 5.8 8s.7 4 2.2 5.7M8 2.3c1.5 1.7 2.2 3.6 2.2 5.7s-.7 4-2.2 5.7',
  sidebar: 'M3.5 3h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3zM6 3v10',
  split: 'M3.5 3h9a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3zM8 3v10',
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  home: 'M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5z',
  cal: 'M4 3.5h8A1.5 1.5 0 0 1 13.5 5v7a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5zM2.5 6.5h11M5.5 2v3M10.5 2v3',
  tasks: 'M2.5 4l1.2 1.2L6 3M8.5 4.2h5M2.5 8l1.2 1.2L6 7M8.5 8.2h5M3 11.5h2.5v2H3zM8.5 12.5h5',
  apps: 'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z',
  settings: 'M12.68 6.55 14.25 6.6 14.25 9.4 12.68 9.45 12.33 10.29 13.4 11.43 11.43 13.4 10.29 12.33 9.45 12.68 9.4 14.25 6.6 14.25 6.55 12.68 5.71 12.33 4.57 13.4 2.6 11.43 3.67 10.29 3.32 9.45 1.75 9.4 1.75 6.6 3.32 6.55 3.67 5.71 2.6 4.57 4.57 2.6 5.71 3.67 6.55 3.32 6.6 1.75 9.4 1.75 9.45 3.32 10.29 3.67 11.43 2.6 13.4 4.57 12.33 5.71zM8 5.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z', // a cog, like the desktop app
  ai: 'M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4zM12.5 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
  users: 'M8 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3.5 13.5c0-2.5 2-4.2 4.5-4.2s4.5 1.7 4.5 4.2',
  plus: 'M8 3v10M3 8h10', check: 'M3.5 8.5l3 3 6-7', more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  edit: 'M10.5 3.5l2 2L6 12H4v-2zM9 5l2 2', trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  link: 'M6.8 9.2l2.4-2.4M7.6 4.6l1-1a2.6 2.6 0 0 1 3.8 3.8l-1 1M8.4 11.4l-1 1a2.6 2.6 0 0 1-3.8-3.8l1-1',
  pin: 'M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14zM8 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  clock: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3l2 1.5',
  video: 'M2.5 4.5h7.5v7h-7.5zM10 7l3.5-2v6L10 9',
  bell: 'M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 13.5a1.5 1.5 0 0 0 3 0',
  cloud: 'M4.5 12.5a3 3 0 0 1-.3-6A4 4 0 0 1 12 6.8a2.9 2.9 0 0 1 .3 5.7z',
  offline: 'M2 6a9 9 0 0 1 12 0M4.3 8.5a5.5 5.5 0 0 1 7.4 0M6.6 11a2 2 0 0 1 2.8 0M2.5 2.5l11 11',
  download: 'M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10',
  info: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 7.3v3.4M8 5.2v.1',
  ban: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM4.2 4.2l7.6 7.6',
  file: 'M4 1.5h5L12.5 5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5zM9 1.5V5h3.5',
  // class icons
  code: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13', sigma: 'M12 3H4l4.5 5L4 13h8',
  flask: 'M6 2.5h4M6.5 2.5v4L3 12.5a1 1 0 0 0 .9 1.5h8.2a1 1 0 0 0 .9-1.5L9.5 6.5v-4M4.8 10h6.4',
  chart: 'M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5',
  book: 'M3 3.5A1 1 0 0 1 4 2.5h8.5v9H4a1 1 0 0 0-1 1zM3 12.5a1 1 0 0 0 1 1h8.5v-2',
  cpu: 'M5 4h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM6.5 6.5h3v3h-3zM6 2v2M10 2v2M6 12v2M10 12v2M2 6h2M2 10h2M12 6h2M12 10h2',
  brief: 'M3.2 5h9.6A1.2 1.2 0 0 1 14 6.2v6.1a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 12.3V6.2A1.2 1.2 0 0 1 3.2 5zM5.5 5V3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V5M2 9h12',
  pen: 'M10.5 2.5l3 3-7.5 7.5H3v-3z',
  globe: 'M8 2.3a5.7 5.7 0 1 0 0 11.4A5.7 5.7 0 0 0 8 2.3zM2.5 8h11M8 2.3C6.5 4 5.8 5.9 5.8 8s.7 4 2.2 5.7M8 2.3c1.5 1.7 2.2 3.6 2.2 5.7s-.7 4-2.2 5.7',
  chat: 'M3.5 3h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11h-.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
  db: 'M3 4c0-1 2.2-1.8 5-1.8s5 .8 5 1.8-2.2 1.8-5 1.8S3 5 3 4zM3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8',
  music: 'M6 12V3.5l7-1.5v8.5M3 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM10 10.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z',
  palette: 'M8 2.5a5.5 5.5 0 0 0 0 11c.8 0 1.2-.5 1.2-1.1 0-.7-.5-1-.5-1.6 0-.6.5-1 1.1-1h1.4a2.3 2.3 0 0 0 2.3-2.3C13.5 4.6 11 2.5 8 2.5zM5 7.5h.01M6.5 5h.01M9.5 5h.01',
  scale: 'M8 2.5v11M5 13.5h6M3.5 5h9M3.5 5 2 9h3zM12.5 5 11 9h3z',
  // app glyphs (filled, 24 grid) are drawn by AppGlyph
};
export const ICON_NAMES = Object.keys(P);

export function Icon({ name, size = 20, color, stroke = 1.6 }: { name: string; size?: number; color: string; stroke?: number }) {
  const d = P[name] || P.info;
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d={d} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Filled 24px glyphs for the built-in apps (same as desktop)
const G: Record<string, string> = {
  ebwise: 'M12 4 2 9l10 5 8-4v6h2V9zM6 12.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.5l-6 3z',
  mail: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zm2 .8v.3l7 4.6 7-4.6v-.3zm0 2.7V17h14v-7l-7 4.6z',
  calendar: 'M7 2h2v2h6V2h2v2h2.5A1.5 1.5 0 0 1 21 5.5v14a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-14A1.5 1.5 0 0 1 4.5 4H7zM5 9v10h14V9zm2 2h3v3H7z',
  teams: 'M3 18c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5v1H3zm13.5-4.3c2.6.2 4.5 1.9 4.5 4.3v1h-4.5v-1c0-1.6-.6-3.1-1.6-4.2.5-.1 1-.1 1.6-.1z',
};
export function AppGlyph({ id, size = 18 }: { id: string; name?: string; size?: number }) {
  const d = G[id];
  if (!d) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="#fff">
      <Path d={d} />
      {id === 'teams' ? <><Circle cx="9" cy="7.5" r="3" /><Circle cx="17" cy="8.5" r="2.2" /></> : null}
    </Svg>
  );
}
