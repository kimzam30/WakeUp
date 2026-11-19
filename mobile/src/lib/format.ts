import type { ClassItem, Settings } from './types';

export const KIND: Record<string, string> = { lecture: 'Lecture', tutorial: 'Tutorial', lab: 'Lab' };
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtTime = (hm: string) => {
  const [hh, mm] = hm.split(':').map(Number);
  return `${((hh + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${hh < 12 ? 'am' : 'pm'}`;
};
export const fmtDate = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${DAYS[dt.getDay()]} ${d} ${MONTHS[m - 1]}`; };

// Settings → Timetable → "Show classes as" (same rule as desktop)
export const classLabel = (c: ClassItem, mode: Settings['classLabel']) => (mode === 'name' ? c.name || c.code : c.code || c.name);
export const classSub = (c: ClassItem, mode: Settings['classLabel']) => (mode === 'both' && c.code && c.name && c.name !== c.code ? c.name : '');

export const countdown = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60e3));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const r = m % 60;
  if (h < 24) return `${h} h${r ? ` ${r} min` : ''}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
};
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
