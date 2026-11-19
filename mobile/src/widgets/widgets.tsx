// Home-screen widgets (docs/design/v3-widgets.html, draft 2): Next class (2×2, and a slim 4×1 when short) and
// Due today (4×2, 2×2). Sizes, padding and row counts follow the draft: radius 24 (One UI's widget radius),
// padding 16 (12 under 160 dp wide), 36 dp rows, and the class code as big as the width allows.
// These render in Android's widget host, not in the app: only FlexWidget/TextWidget, no hooks, no theme context.
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { ColorProp } from 'react-native-android-widget';
import { getState } from '../lib/store';
import { Planner } from '../lib/shared';
import { classLabel, fmtTime } from '../lib/format';

type Pal = { bg: ColorProp; tx: ColorProp; mu: ColorProp; fa: ColorProp; ln: ColorProp; sf: ColorProp; bad: ColorProp; ac: ColorProp; act: ColorProp };
const LIGHT: Pal = { bg: '#ffffff', tx: '#111318', mu: '#5f6570', fa: '#8b919b', ln: '#e6e8eb', sf: '#f3f4f6', bad: '#c4271b', ac: '#2b63d9', act: '#1f4fb8' };
const DARK: Pal = { bg: '#141518', tx: '#eceef1', mu: '#a1a6ae', fa: '#737881', ln: '#26282d', sf: '#1f2125', bad: '#f59a92', ac: '#2b63d9', act: '#7fa6f5' };
// Inter files bundled for the widgets by the plugin in app.json (the widget host can't use the app's fonts)
const F = { r: 'Inter_400Regular', m: 'Inter_500Medium', s: 'Inter_600SemiBold', b: 'Inter_700Bold' };
const ROW = 36;
const pad = (w: number) => (w < 160 ? 12 : 16);
const hex = (c: string): ColorProp => (/^#[0-9a-f]{6}$/i.test(c) ? (c as ColorProp) : '#2b63d9');

// `now` comes from the caller: a widget is a one-off picture of a moment, drawn by the handler
export type Size = { width: number; height: number; now: number };

// ---------- Next class ----------
export function NextClass({ width, height, dark, now }: Size & { dark: boolean }) {
  const p = dark ? DARK : LIGHT;
  const { planner, settings } = getState();
  const [next] = Planner.upcoming(planner, new Date(now), 7);
  const P = pad(width);
  const root = { height: 'match_parent' as const, width: 'match_parent' as const, backgroundColor: p.bg, borderRadius: 24, padding: P };
  if (!next) {
    return (
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://timetable' }} style={{ ...root, justifyContent: 'center' }}>
        <TextWidget text="NEXT" style={{ fontSize: 11, fontFamily: F.b, color: p.mu, letterSpacing: 0.06 }} />
        <TextWidget text={planner.classes.length ? 'No more classes this week' : 'Add your timetable'} style={{ fontSize: 15, fontFamily: F.s, color: p.tx, marginTop: 4 }} />
      </FlexWidget>
    );
  }
  const live = next.startsAt <= now;
  const code = classLabel(next.cls, settings.classLabel);
  const color = hex(next.cls.color);
  // the start time, not a countdown: Android redraws widgets about every 30 minutes, so minutes would go stale
  const todayYmd = Planner.ymd(new Date(now));
  const label = live ? `NOW · ENDS ${fmtTime(next.end).toUpperCase()}` : next.date === todayYmd ? `NEXT · ${fmtTime(next.start).toUpperCase()}` : `NEXT · ${dayWord(next.date, now).toUpperCase()}`;
  const where = next.mode === 'online' ? 'Online' : next.venue || '';
  const open = { clickAction: 'OPEN_URI', clickActionData: { uri: 'wakeup://timetable' } };

  // short (4×1): one line with a colour bar
  if (height < 120) {
    return (
      <FlexWidget {...open} style={{ ...root, flexDirection: 'row', alignItems: 'center', flexGap: 10 }}>
        <FlexWidget style={{ width: 4, height: 'match_parent', borderRadius: 2, backgroundColor: color }} />
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget text={label} maxLines={1} style={{ fontSize: 11, fontFamily: F.b, color: p.mu, letterSpacing: 0.06 }} />
          <TextWidget text={[code, `${fmtTime(next.start)}${width >= 300 && where ? ` · ${where}` : ''}`].join('  ')} maxLines={1} truncate="END" style={{ fontSize: 15, fontFamily: F.s, color: p.tx }} />
        </FlexWidget>
        {live && next.link ? <JoinPill p={p} link={next.link} small /> : null}
      </FlexWidget>
    );
  }

  const hero = Math.min(height >= 170 ? 34 : 28, Math.floor((width - P * 2) / (Math.max(code.length, 4) * 0.7)));
  const sub = settings.classLabel === 'name' ? next.cls.code : next.cls.name;
  const total = Math.max(1, next.endsAt - next.startsAt);
  return (
    <FlexWidget {...open} style={{ ...root, flexDirection: 'column' }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
        <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <TextWidget text={label} maxLines={1} style={{ fontSize: 11, fontFamily: F.b, color: p.mu, letterSpacing: 0.06 }} />
      </FlexWidget>
      <TextWidget text={code} maxLines={1} truncate="END" style={{ fontSize: hero, fontFamily: F.b, color: p.tx, marginTop: 8 }} />
      {sub ? <TextWidget text={sub} maxLines={1} truncate="END" style={{ fontSize: 12, fontFamily: F.r, color: p.mu }} /> : null}
      <FlexWidget style={{ flex: 1 }} />
      {live ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', flexGap: 8 }}>
          <FlexWidget style={{ width: 'match_parent', height: 4, borderRadius: 2, backgroundColor: p.sf, flexDirection: 'row' }}>
            <FlexWidget style={{ height: 4, borderRadius: 2, backgroundColor: color, width: Math.round((width - P * 2) * Math.min(1, (now - next.startsAt) / total)) }} />
          </FlexWidget>
          {next.link ? <JoinPill p={p} link={next.link} /> : <TextWidget text={where} maxLines={1} style={{ fontSize: 12, fontFamily: F.r, color: p.mu }} />}
        </FlexWidget>
      ) : (
        <FlexWidget>
          <TextWidget text={`${next.date === todayYmd ? '' : `${dayWord(next.date, now)} `}${fmtTime(next.start)} – ${fmtTime(next.end)}`} maxLines={1} style={{ fontSize: 12, fontFamily: F.r, color: p.mu }} />
          {where ? <TextWidget text={where} maxLines={1} truncate="END" style={{ fontSize: 12, fontFamily: F.r, color: p.mu }} /> : null}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

function JoinPill({ p, link, small }: { p: Pal; link: string; small?: boolean }) {
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: link }} accessibilityLabel="Join the meeting"
      style={{ height: 36, width: small ? 'wrap_content' : 'match_parent', paddingHorizontal: 16, borderRadius: 18, backgroundColor: p.ac, alignItems: 'center', justifyContent: 'center' }}>
      <TextWidget text="Join" style={{ fontSize: 13, fontFamily: F.s, color: '#ffffff' }} />
    </FlexWidget>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayWord(ymd: string, now: number) {
  const today = Planner.ymd(new Date(now));
  if (ymd === Planner.addDays(today, 1)) return 'Tomorrow';
  return DAYS[Planner.parse(ymd).getDay()];
}

// ---------- Due today ----------
export function DueToday({ width, height, dark, now }: Size & { dark: boolean }) {
  const p = dark ? DARK : LIGHT;
  const { planner, settings } = getState();
  const today = Planner.ymd(new Date(now));
  const due = planner.tasks.filter((t) => !t.done && !t.exam && t.due && t.due <= today).sort((a, b) => (a.due! < b.due! ? -1 : 1));
  const P = pad(width);
  const fit = Math.max(1, Math.floor((height - P * 2 - 28 - 4) / ROW));
  const wide = width >= 240;
  const header = (
    <FlexWidget style={{ height: 28, width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
      <TextWidget text={due.length ? `DUE TODAY · ${due.length}` : 'DUE TODAY'} style={{ fontSize: 11, fontFamily: F.b, color: p.mu, letterSpacing: 0.06 }} />
      <FlexWidget style={{ flex: 1 }} />
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://tasks?add=1' }} accessibilityLabel="Add a task"
        style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: p.sf, alignItems: 'center', justifyContent: 'center' }}>
        <TextWidget text="+" style={{ fontSize: 17, fontFamily: F.m, color: p.tx }} />
      </FlexWidget>
    </FlexWidget>
  );
  const root = { height: 'match_parent' as const, width: 'match_parent' as const, backgroundColor: p.bg, borderRadius: 24, padding: P, flexDirection: 'column' as const };
  if (!due.length) {
    const exam = planner.tasks.filter((t) => t.exam && !t.done && t.due && t.due > today).sort((a, b) => (a.due! < b.due! ? -1 : 1))[0];
    return (
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://tasks' }} style={root}>
        {header}
        <FlexWidget style={{ flex: 1, width: 'match_parent', alignItems: 'center', justifyContent: 'center' }}>
          <TextWidget text="Nothing due today" style={{ fontSize: 13, fontFamily: F.m, color: p.tx }} />
          {exam ? <TextWidget text={`Next: ${exam.text}, ${dayWord(exam.due!, now)}${exam.at ? ` ${fmtTime(exam.at)}` : ''}`} maxLines={1} truncate="END" style={{ fontSize: 12, fontFamily: F.r, color: p.mu, marginTop: 2 }} /> : null}
        </FlexWidget>
      </FlexWidget>
    );
  }
  return (
    <FlexWidget style={root}>
      {header}
      <FlexWidget style={{ width: 'match_parent', marginTop: 4, flexDirection: 'column' }}>
        {due.slice(0, fit).map((t, i) => {
          const late = t.due! < today;
          const cls = t.classId ? planner.classes.find((k) => k.id === t.classId) : undefined;
          return (
            <FlexWidget key={t.id} style={{ height: ROW, width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 10, borderTopWidth: i ? 1 : 0, borderColor: p.ln }}>
              {/* the circle finishes the task right here; the text opens Tasks */}
              <FlexWidget clickAction="DONE" clickActionData={{ id: t.id }} accessibilityLabel={`Finish ${t.text}`}
                style={{ width: 32, height: ROW, alignItems: 'center', justifyContent: 'center', marginLeft: -6 }}>
                <FlexWidget style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: late ? p.bad : p.fa }} />
              </FlexWidget>
              <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://tasks' }} style={{ flex: 1, height: ROW, flexDirection: 'row', alignItems: 'center', flexGap: 8 }}>
                <FlexWidget style={{ flex: 1 }}><TextWidget text={t.text} maxLines={1} truncate="END" style={{ fontSize: 13, fontFamily: F.m, color: p.tx }} /></FlexWidget>
                {wide ? <TextWidget text={late ? 'Late' : cls ? classLabel(cls, settings.classLabel) : ''} maxLines={1} style={{ fontSize: 12, fontFamily: late ? F.s : F.r, color: late ? p.bad : p.mu }} /> : null}
              </FlexWidget>
            </FlexWidget>
          );
        })}
      </FlexWidget>
    </FlexWidget>
  );
}

// ---------- Today (4×4): the rest of the day as blocks in time order, free gaps between, then what's due ----------
export function TodayTimeline({ width, height, dark, now }: Size & { dark: boolean }) {
  const p = dark ? DARK : LIGHT;
  const { planner, settings } = getState();
  const today = Planner.ymd(new Date(now));
  const d = new Date(now);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const all = Planner.occurrencesOn(today, planner).filter((o) => o.live).sort((a, b) => Planner.mins(a.start) - Planner.mins(b.start));
  const left = all.filter((o) => Planner.mins(o.end) > nowMin); // classes that haven't ended
  const due = planner.tasks.filter((t) => !t.done && !t.exam && t.due && t.due <= today).sort((a, b) => (a.due! < b.due! ? -1 : 1));
  const exam = planner.tasks.filter((t) => t.exam && !t.done && t.due && t.due >= today).sort((a, b) => ((a.due! + (a.at ?? '')) < (b.due! + (b.at ?? '')) ? -1 : 1))[0];
  const P = pad(width);
  const week = Planner.weekOf(today, planner.semester, settings.weekStart);
  const head = `${DAYS[d.getDay()].toUpperCase()} ${d.getDate()} ${MONTHS[d.getMonth()].toUpperCase()}${week?.week ? ` · WEEK ${week.week}` : ''}`;
  const summary = all.length && !left.length ? `Classes done, ${due.length ? `${due.length} due` : 'nothing due'}`
    : `${left.length ? `${left.length} class${left.length === 1 ? '' : 'es'} left` : 'No classes'}, ${due.length ? `${due.length} due` : 'nothing due'}`;
  const hm = (m: number) => fmtTime(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

  // blocks from now: a free gap if the next class is 30+ minutes away, then classes and the gaps between them
  type Block = { kind: 'class' | 'free'; a: number; b: number; o?: (typeof left)[number] };
  const blocks: Block[] = [];
  let at = nowMin;
  for (const o of left) {
    const a = Planner.mins(o.start); const b = Planner.mins(o.end);
    if (a - at >= 30) blocks.push({ kind: 'free', a: at, b: a });
    blocks.push({ kind: 'class', a: Math.max(a, Math.min(at, a)), b, o }); at = Math.max(at, b);
  }
  const avail = height - P * 2 - 40 - 8;
  // at most 1 dp per minute, so one class never fills the widget; at least enough for every block to show
  const span = blocks.length ? blocks[blocks.length - 1].b - blocks[0].a : 0;
  const per = span ? Math.max(Math.min(1, (avail - 40) / span), 0) : 0;
  const hOf = (k: Block) => Math.max(k.kind === 'class' ? 30 : 20, Math.round((k.b - k.a) * per) - 4);
  const used = blocks.reduce((n, k) => n + hOf(k) + 4, 0) || 24;
  // what's due fills the space that's left (36 dp rows), then one line for the next exam or class
  const rows = Math.max(0, Math.floor((avail - used - 28) / ROW));
  const nextClass = left.length ? undefined : Planner.upcoming(planner, new Date(now), 7)[0];
  const tail = exam && (!rows || due.length <= rows) ? `${exam.text}: ${exam.due === today ? `today${exam.at ? ` ${fmtTime(exam.at)}` : ''}` : `exam in ${Math.round((Date.parse(exam.due!) - Date.parse(today)) / 864e5)} days`}`
    : nextClass ? `Next class: ${classLabel(nextClass.cls, settings.classLabel)}, ${dayWord(nextClass.date, now)} ${fmtTime(nextClass.start)}` : '';

  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://' }} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: p.bg, borderRadius: 24, padding: P, flexDirection: 'column' }}>
      <FlexWidget style={{ height: 40 }}>
        <TextWidget text={head} maxLines={1} style={{ fontSize: 11, fontFamily: F.b, color: p.mu, letterSpacing: 0.06 }} />
        <TextWidget text={summary} maxLines={1} style={{ fontSize: 15, fontFamily: F.s, color: p.tx }} />
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', marginTop: 8 }}>
        {!blocks.length ? <TextWidget text={!planner.classes.length ? 'Add your timetable in WakeUp' : all.length ? 'No more classes today' : 'No classes today'} style={{ fontSize: 13, fontFamily: F.m, color: p.mu, height: 20, marginBottom: 4 }} /> : null}
        {blocks.map((k, i) => {
          const h = hOf(k);
          const live = !!k.o && Planner.mins(k.o.start) <= nowMin;
          const color = k.o ? hex(k.o.cls.color) : p.ln;
          return (
            <FlexWidget key={i} style={{ width: 'match_parent', height: h, marginBottom: 4, flexDirection: 'row', flexGap: 8 }}>
              <TextWidget text={k.kind === 'free' ? '' : hm(Planner.mins(k.o!.start))} maxLines={1} style={{ width: 44, fontSize: 11, fontFamily: F.r, color: p.fa }} />
              {k.o ? (
                <FlexWidget style={{ flex: 1, height: 'match_parent', borderRadius: 8, backgroundColor: (dark ? `${color}40` : `${color}22`) as ColorProp, borderLeftWidth: 3, borderLeftColor: color, paddingHorizontal: 8, justifyContent: 'center' }}>
                  <TextWidget text={`${classLabel(k.o.cls, settings.classLabel)}${live ? `  · now, until ${fmtTime(k.o.end)}` : ''}`} maxLines={1} truncate="END" style={{ fontSize: 12.5, fontFamily: F.s, color: p.tx }} />
                  {h >= 40 ? <TextWidget text={[k.o.kind ? k.o.kind[0].toUpperCase() + k.o.kind.slice(1) : '', k.o.mode === 'online' ? 'Online' : k.o.venue].filter(Boolean).join(' · ')} maxLines={1} truncate="END" style={{ fontSize: 11, fontFamily: F.r, color: p.mu }} /> : null}
                </FlexWidget>
              ) : (
                <FlexWidget style={{ flex: 1, height: 'match_parent', borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: p.ln, paddingHorizontal: 8, justifyContent: 'center' }}>
                  <TextWidget text={`Free until ${hm(k.b)}${due[0] ? ` · ${due[0].text} due` : ''}`} maxLines={1} truncate="END" style={{ fontSize: 11, fontFamily: F.r, color: p.mu }} />
                </FlexWidget>
              )}
            </FlexWidget>
          );
        })}
      </FlexWidget>
      {rows && due.length ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', borderTopWidth: blocks.length ? 1 : 0, borderColor: p.ln }}>
          {due.slice(0, rows).map((t, i) => (
            <FlexWidget key={t.id} style={{ height: ROW, width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 10, borderTopWidth: i ? 1 : 0, borderColor: p.ln }}>
              <FlexWidget clickAction="DONE" clickActionData={{ id: t.id }} accessibilityLabel={`Finish ${t.text}`} style={{ width: 28, height: ROW, alignItems: 'center', justifyContent: 'center', marginLeft: -4 }}>
                <FlexWidget style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: t.due! < today ? p.bad : p.fa }} />
              </FlexWidget>
              <FlexWidget style={{ flex: 1 }}><TextWidget text={t.text} maxLines={1} truncate="END" style={{ fontSize: 13, fontFamily: F.m, color: p.tx }} /></FlexWidget>
              {t.due! < today ? <TextWidget text="Late" style={{ fontSize: 12, fontFamily: F.s, color: p.bad }} /> : null}
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : null}
      <FlexWidget style={{ flex: 1 }} />
      {tail ? <TextWidget text={rows < due.length ? `${tail} · +${due.length - rows} more due` : tail} maxLines={1} truncate="END" style={{ fontSize: 12, fontFamily: F.r, color: p.mu }} /> : rows < due.length ? <TextWidget text={`+${due.length - rows} more due`} style={{ fontSize: 12, fontFamily: F.r, color: p.mu }} /> : null}
    </FlexWidget>
  );
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- Exam (2×2): the next exam, days left in big numbers, amber from 3 days ----------
export function ExamCountdown({ width, height, dark, now }: Size & { dark: boolean }) {
  const p = dark ? DARK : LIGHT;
  const { planner, settings } = getState();
  const today = Planner.ymd(new Date(now));
  const exam = planner.tasks.filter((t) => t.exam && !t.done && t.due && t.due >= today).sort((a, b) => ((a.due! + (a.at ?? '')) < (b.due! + (b.at ?? '')) ? -1 : 1))[0];
  const P = pad(width);
  const root = { height: 'match_parent' as const, width: 'match_parent' as const, backgroundColor: p.bg, borderRadius: 24, padding: P, flexDirection: 'column' as const };
  const amber: ColorProp = dark ? '#e9b860' : '#8a5300';
  if (!exam) {
    return (
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://tasks' }} style={{ ...root, justifyContent: 'center' }}>
        <TextWidget text="EXAM" style={{ fontSize: 11, fontFamily: F.b, color: p.mu, letterSpacing: 0.06 }} />
        <TextWidget text="No exams coming up" style={{ fontSize: 15, fontFamily: F.s, color: p.tx, marginTop: 4 }} />
        <TextWidget text="Add one in Tasks with the Exam chip." style={{ fontSize: 12, fontFamily: F.r, color: p.mu, marginTop: 2 }} />
      </FlexWidget>
    );
  }
  const days = Math.round((Date.parse(exam.due!) - Date.parse(today)) / 864e5);
  const warn = days <= 3;
  const cls = exam.classId ? planner.classes.find((k) => k.id === exam.classId) : undefined;
  const big = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : String(days);
  const size = days > 1 ? (height >= 170 ? 52 : 40) : Math.min(30, Math.floor((width - P * 2) / (big.length * 0.62)));
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://tasks' }} style={root}>
      <TextWidget text={days <= 1 ? 'EXAM' : 'EXAM IN'} style={{ fontSize: 11, fontFamily: F.b, color: warn ? amber : p.mu, letterSpacing: 0.06 }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', flexGap: 6, marginTop: 4 }}>
        <TextWidget text={big} maxLines={1} style={{ fontSize: size, fontFamily: F.b, color: warn ? amber : p.tx }} />
        {days > 1 ? <TextWidget text="days" style={{ fontSize: 12, fontFamily: F.r, color: p.mu, marginBottom: 6 }} /> : null}
      </FlexWidget>
      <FlexWidget style={{ flex: 1 }} />
      <TextWidget text={exam.text} maxLines={1} truncate="END" style={{ fontSize: 15, fontFamily: F.s, color: p.tx }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
        {cls ? <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: hex(cls.color) }} /> : null}
        <TextWidget text={[cls ? classLabel(cls, settings.classLabel) : '', days > 1 ? dayWord(exam.due!, now) : '', exam.at ? fmtTime(exam.at) : '', exam.venue].filter(Boolean).join(' · ')} maxLines={1} truncate="END" style={{ fontSize: 12, fontFamily: F.r, color: p.mu }} />
      </FlexWidget>
    </FlexWidget>
  );
}

// ---------- Focus (2×2): running → ring, the end time and Pause; idle → this week and Start ----------
export type FocusInfo = { phase: 'idle' | 'focus' | 'short' | 'long'; paused: boolean; left: number; total: number; endsAt: number | null; task: string | null; color: string | null; label: string; week: { sessions: number; mins: number }; lengths: { focus: number } };
export function FocusWidget({ width, height, dark, now, f }: Size & { dark: boolean; f: FocusInfo }) {
  void now;
  const p = dark ? DARK : LIGHT;
  const P = pad(width);
  const root = { height: 'match_parent' as const, width: 'match_parent' as const, backgroundColor: p.bg, borderRadius: 24, padding: P, flexDirection: 'column' as const };
  const btn = (text: string, action: string, primary: boolean) => (
    <FlexWidget clickAction={action} accessibilityLabel={text} style={{ height: 36, width: 'match_parent', borderRadius: 18, backgroundColor: primary ? p.ac : p.sf, alignItems: 'center', justifyContent: 'center' }}>
      <TextWidget text={text} style={{ fontSize: 13, fontFamily: F.s, color: primary ? '#ffffff' : p.tx }} />
    </FlexWidget>
  );
  if (f.phase === 'idle') {
    const h = Math.floor(f.week.mins / 60); const m = f.week.mins % 60;
    return (
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://focus' }} style={root}>
        <TextWidget text="FOCUS" style={{ fontSize: 11, fontFamily: F.b, color: p.mu, letterSpacing: 0.06 }} />
        <TextWidget text={`${f.week.sessions} session${f.week.sessions === 1 ? '' : 's'}`} style={{ fontSize: 15, fontFamily: F.s, color: p.tx, marginTop: 6 }} />
        <TextWidget text={f.week.mins ? `this week · ${h ? `${h} h ` : ''}${m ? `${m} min` : ''}`.trim() : 'this week'} style={{ fontSize: 12, fontFamily: F.r, color: p.mu }} />
        <FlexWidget style={{ flex: 1 }} />
        {btn(`Start ${f.lengths.focus} min`, 'FOCUS_START', true)}
      </FlexWidget>
    );
  }
  const color = f.phase === 'focus' ? hex(f.color ?? '#2b63d9') : (dark ? '#7dd3a8' : '#1d6b45');
  const r = Math.round(Math.min(width, height) * 0.16); const sw = 6; const L = 2 * Math.PI * r; const box = 2 * r + sw;
  const frac = Math.max(0, Math.min(1, f.left / Math.max(1, f.total)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}"><circle cx="${box / 2}" cy="${box / 2}" r="${r}" fill="none" stroke="${p.sf}" stroke-width="${sw}"/><circle cx="${box / 2}" cy="${box / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${L * (1 - frac)}" transform="rotate(-90 ${box / 2} ${box / 2})"/></svg>`;
  const ends = f.endsAt ? fmtTime(`${String(new Date(f.endsAt).getHours()).padStart(2, '0')}:${String(new Date(f.endsAt).getMinutes()).padStart(2, '0')}`) : '';
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://focus' }} style={root}>
      <TextWidget text={(f.task ? `${f.label} · ${f.task}` : f.label).toUpperCase()} maxLines={1} truncate="END" style={{ fontSize: 11, fontFamily: F.b, color: p.mu, letterSpacing: 0.06 }} />
      <FlexWidget style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexGap: 10 }}>
        <SvgWidget svg={svg} style={{ width: box, height: box }} />
        <FlexWidget style={{ flex: 1 }}>
          {/* the end time on its own line: it's the one thing that stays right between redraws */}
          <TextWidget text={f.paused ? `${Math.ceil(f.left / 60e3)} min left` : ends} maxLines={1} style={{ fontSize: 17, fontFamily: F.b, color: p.tx }} />
          <TextWidget text={f.paused ? 'paused' : f.phase === 'focus' ? 'focus ends' : 'break ends'} maxLines={1} style={{ fontSize: 12, fontFamily: F.r, color: p.mu }} />
        </FlexWidget>
      </FlexWidget>
      {btn(f.paused ? 'Resume' : 'Pause', f.paused ? 'FOCUS_RESUME' : 'FOCUS_PAUSE', f.paused)}
    </FlexWidget>
  );
}

// ---------- Z Flip cover screen (352 × 339): always black, the next class big, then what's due ----------
export function CoverScreen({ width, height, now }: Size & { dark: boolean }) {
  void height;
  const p = DARK; const bg: ColorProp = '#000000';
  const { planner, settings } = getState();
  const [next] = Planner.upcoming(planner, new Date(now), 7);
  const today = Planner.ymd(new Date(now));
  const due = planner.tasks.filter((t) => !t.done && !t.exam && t.due && t.due <= today).sort((a, b) => (a.due! < b.due! ? -1 : 1));
  const root = { height: 'match_parent' as const, width: 'match_parent' as const, backgroundColor: bg, padding: 20, flexDirection: 'column' as const };
  if (!next) {
    return (
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://' }} style={{ ...root, justifyContent: 'center' }}>
        <TextWidget text="NEXT" style={{ fontSize: 12, fontFamily: F.b, color: p.mu, letterSpacing: 0.06 }} />
        <TextWidget text="No more classes this week" style={{ fontSize: 20, fontFamily: F.s, color: p.tx, marginTop: 6 }} />
      </FlexWidget>
    );
  }
  const live = next.startsAt <= now;
  const code = classLabel(next.cls, settings.classLabel);
  const size = Math.min(56, Math.floor((width - 40) / (Math.max(code.length, 4) * 0.7)));
  const label = live ? `NOW · ENDS ${fmtTime(next.end).toUpperCase()}` : next.date === today ? `NEXT · ${fmtTime(next.start).toUpperCase()}` : `NEXT · ${dayWord(next.date, now).toUpperCase()}`;
  const late = due.find((t) => t.due! < today);
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'wakeup://timetable' }} style={root}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 8 }}>
        <FlexWidget style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: hex(next.cls.color) }} />
        <TextWidget text={label} style={{ fontSize: 12, fontFamily: F.b, color: p.mu, letterSpacing: 0.06 }} />
      </FlexWidget>
      <TextWidget text={code} maxLines={1} style={{ fontSize: size, fontFamily: F.b, color: p.tx, marginTop: 6 }} />
      <TextWidget text={[`${fmtTime(next.start)} – ${fmtTime(next.end)}`, next.mode === 'online' ? 'Online' : next.venue].filter(Boolean).join(' · ')} maxLines={1} truncate="END" style={{ fontSize: 15, fontFamily: F.m, color: p.mu }} />
      <FlexWidget style={{ flex: 1 }} />
      {live && next.link ? <JoinPill p={p} link={next.link} /> : (
        <FlexWidget style={{ width: 'match_parent', borderTopWidth: 1, borderColor: p.ln, paddingTop: 12 }}>
          <TextWidget text={due.length ? `${due.length} due today${late ? ` · ${late.text} late` : ''}` : 'Nothing due today'} maxLines={1} truncate="END" style={{ fontSize: 14, fontFamily: F.m, color: late ? p.bad : p.tx }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
