// A field that opens Android's own date or time picker.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Icon } from './Icon';
import { Txt } from './kit';
import { R, S, useTheme } from './theme';
import { Planner } from '../lib/shared';
import { fmtDate, fmtTime } from '../lib/format';

export function DateField({ label, value, onChange, clearable, placeholder = 'Pick a date' }: { label?: string; value: string | null; onChange: (v: string | null) => void; clearable?: boolean; placeholder?: string }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: S(1), flexGrow: 1, flexBasis: 140 }}>
      {label ? <Txt kind="small" muted>{label}</Txt> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${label ?? 'Date'}: ${value ? fmtDate(value) : 'not set'}`} onPress={() => setOpen(true)}
        style={({ pressed }) => ({ minHeight: 48, borderRadius: R.input, borderWidth: 1, borderColor: c.lineStrong, paddingHorizontal: S(3), flexDirection: 'row', alignItems: 'center', gap: S(2), backgroundColor: pressed ? c.hover : c.bg })}>
        <Icon name="cal" size={16} color={c.muted} />
        <Txt style={{ flex: 1 }} faint={!value}>{value ? fmtDate(value) : placeholder}</Txt>
        {clearable && value ? <Pressable accessibilityLabel="Clear date" hitSlop={8} onPress={() => onChange(null)}><Icon name="close" size={14} color={c.faint} /></Pressable> : null}
      </Pressable>
      {open ? <DateTimePicker value={value ? Planner.parse(value) : new Date()} mode="date" onChange={(e, d) => { setOpen(false); if (e.type === 'set' && d) onChange(Planner.ymd(d)); }} /> : null}
    </View>
  );
}

export function TimeField({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [h, m] = value.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return (
    <View style={{ gap: S(1), flexGrow: 1, flexBasis: 100 }}>
      {label ? <Txt kind="small" muted>{label}</Txt> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${label ?? 'Time'}: ${fmtTime(value)}`} onPress={() => setOpen(true)}
        style={({ pressed }) => ({ minHeight: 48, borderRadius: R.input, borderWidth: 1, borderColor: c.lineStrong, paddingHorizontal: S(3), flexDirection: 'row', alignItems: 'center', gap: S(2), backgroundColor: pressed ? c.hover : c.bg })}>
        <Icon name="clock" size={16} color={c.muted} />
        <Txt style={{ fontVariant: ['tabular-nums'] }}>{fmtTime(value)}</Txt>
      </Pressable>
      {open ? <DateTimePicker value={d} mode="time" minuteInterval={5} onChange={(e, t) => { setOpen(false); if (e.type === 'set' && t) onChange(`${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`); }} /> : null}
    </View>
  );
}
