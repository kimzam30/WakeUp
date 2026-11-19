// Lucide icons (ISC licence), stroke 1.75, the same family as the desktop app (docs/DESIGN.md → Icons).
// Screens ask by WakeUp's short names; each file is imported on its own so the bundle only carries these.
import Svg, { Path, Circle } from 'react-native-svg';
import type { LucideIcon } from 'lucide-react-native';
import ArrowRight from 'lucide-react-native/icons/arrow-right';
import Ban from 'lucide-react-native/icons/ban';
import Bell from 'lucide-react-native/icons/bell';
import BookOpen from 'lucide-react-native/icons/book-open';
import Briefcase from 'lucide-react-native/icons/briefcase';
import CalendarDays from 'lucide-react-native/icons/calendar-days';
import ChartColumn from 'lucide-react-native/icons/chart-column';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import Clock from 'lucide-react-native/icons/clock';
import Cloud from 'lucide-react-native/icons/cloud';
import Code from 'lucide-react-native/icons/code';
import Columns2 from 'lucide-react-native/icons/columns-2';
import Cpu from 'lucide-react-native/icons/cpu';
import Database from 'lucide-react-native/icons/database';
import Download from 'lucide-react-native/icons/download';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import ExternalLink from 'lucide-react-native/icons/external-link';
import File from 'lucide-react-native/icons/file';
import FlaskConical from 'lucide-react-native/icons/flask-conical';
import Globe from 'lucide-react-native/icons/globe';
import GraduationCap from 'lucide-react-native/icons/graduation-cap';
import House from 'lucide-react-native/icons/house';
import Info from 'lucide-react-native/icons/info';
import ScanQrCode from 'lucide-react-native/icons/scan-qr-code';
import LayoutGrid from 'lucide-react-native/icons/layout-grid';
import Link from 'lucide-react-native/icons/link';
import ListChecks from 'lucide-react-native/icons/list-checks';
import MapPin from 'lucide-react-native/icons/map-pin';
import MessageSquare from 'lucide-react-native/icons/message-square';
import Mic from 'lucide-react-native/icons/mic';
import Music from 'lucide-react-native/icons/music';
import Palette from 'lucide-react-native/icons/palette';
import PanelLeft from 'lucide-react-native/icons/panel-left';
import Pause from 'lucide-react-native/icons/pause';
import PenLine from 'lucide-react-native/icons/pen-line';
import Pencil from 'lucide-react-native/icons/pencil';
import Play from 'lucide-react-native/icons/play';
import Plus from 'lucide-react-native/icons/plus';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import Scale from 'lucide-react-native/icons/scale';
import Search from 'lucide-react-native/icons/search';
import Settings from 'lucide-react-native/icons/settings';
import Sigma from 'lucide-react-native/icons/sigma';
import Sparkles from 'lucide-react-native/icons/sparkles';
import Target from 'lucide-react-native/icons/target';
import Timer from 'lucide-react-native/icons/timer';
import Trash2 from 'lucide-react-native/icons/trash-2';
import Undo2 from 'lucide-react-native/icons/undo-2';
import User from 'lucide-react-native/icons/user';
import Users from 'lucide-react-native/icons/users';
import Video from 'lucide-react-native/icons/video';
import WifiOff from 'lucide-react-native/icons/wifi-off';
import X from 'lucide-react-native/icons/x';

const P: Record<string, LucideIcon> = {
  back: ChevronLeft, forward: ChevronRight, chevR: ChevronRight, chevL: ChevronLeft, chevD: ChevronDown, reload: RotateCw,
  external: ExternalLink, sidebar: PanelLeft, split: Columns2, close: X, home: House, cal: CalendarDays,
  tasks: ListChecks, apps: LayoutGrid, settings: Settings, ai: Sparkles, users: Users, target: Target,
  play: Play, hold: Pause, plus: Plus, check: Check, more: Ellipsis, edit: Pencil,
  trash: Trash2, link: Link, pin: MapPin, clock: Clock, video: Video, bell: Bell,
  cloud: Cloud, offline: WifiOff, download: Download, info: Info, ban: Ban, file: File,
  code: Code, sigma: Sigma, flask: FlaskConical, chart: ChartColumn, book: BookOpen, cpu: Cpu,
  brief: Briefcase, pen: PenLine, globe: Globe, chat: MessageSquare, db: Database, music: Music,
  palette: Palette, scale: Scale, mic: Mic, timer: Timer, undo: Undo2, search: Search,
  done: CircleCheck, exam: GraduationCap, arrow: ArrowRight, user: User, qr: ScanQrCode,
};
export const ICON_NAMES = Object.keys(P);

export function Icon({ name, size = 20, color, stroke = 1.75 }: { name: string; size?: number; color: string; stroke?: number }) {
  const C = P[name] || Info;
  return <C size={size} color={color} strokeWidth={stroke} absoluteStrokeWidth={false} />;
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
