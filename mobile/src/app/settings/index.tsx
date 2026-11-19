// Settings home. Phones: your account at the top, then grouped rows that open each section. Landscape tablets:
// the sections on the left and the chosen one on the right.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Card, Divider, IconButton, Page, Row, Txt, useLayout } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { Avatar } from '../../ui/Avatar';
import { R, S, useTheme } from '../../ui/theme';
import { SECTIONS, SectionBody, type SecId } from '../../ui/SettingsSections';
import { useStore } from '../../lib/store';

const GROUPS: SecId[][] = [['notify', 'timetable', 'apps', 'you'], ['privacy', 'about']];
const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function SettingsHome() {
  const { c } = useTheme();
  const { twoCol } = useLayout();
  const { section } = useLocalSearchParams<{ section?: SecId }>();
  const [tab, setTab] = useState<SecId>(section && SECTIONS.some((x) => x[0] === section) ? section : 'sync');
  if (!twoCol) return <PhoneList />;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.bg }}>
      <View style={{ width: 300, borderRightWidth: 1, borderColor: c.line, paddingTop: S(8), paddingHorizontal: S(4), gap: S(1) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: S(3), marginBottom: S(4) }}>
          <Txt kind="display" style={{ flex: 1 }}>Settings</Txt>
          <IconButton icon="close" label="Close Settings" onPress={close} />
        </View>
        {SECTIONS.map(([id, title, icon]) => {
          const on = id === tab;
          return (
            <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(id)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S(3), minHeight: 48, paddingHorizontal: S(3), borderRadius: R.input, borderCurve: 'continuous', backgroundColor: on ? c.accentSoft : pressed ? c.hover : 'transparent' })}>
              <Icon name={icon} color={on ? c.accentText : c.muted} />
              <Txt style={{ fontWeight: on ? '600' : '500' }}>{title}</Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }}>
        <Page max={680}>
          <Txt kind="title">{SECTIONS.find((x) => x[0] === tab)![1]}</Txt>
          <SectionBody id={tab} />
        </Page>
      </View>
    </View>
  );
}

function PhoneList() {
  const { c } = useTheme();
  const sync = useStore((s) => s.sync);
  const open = (id: SecId) => router.push(`/settings/${id}`);
  return (
    <Page>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt kind="display" style={{ flex: 1 }}>Settings</Txt>
        <IconButton icon="close" label="Close Settings" onPress={close} color={c.text} />
      </View>
      <Card>
        <Row onPress={() => open('sync')} accessibilityRole="button" accessibilityLabel="Account and sync">
          {sync.signedIn ? <Avatar sync={sync} size={48} /> : <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.sunken, alignItems: 'center', justifyContent: 'center' }}><Icon name="user" size={24} color={c.muted} /></View>}
          <View style={{ flex: 1, gap: 2 }}>
            <Txt kind="headline" numberOfLines={1}>{sync.signedIn ? sync.name || sync.email : 'Sign in to sync'}</Txt>
            <Txt kind="small" muted numberOfLines={1}>{sync.signedIn ? (sync.phase === 'expired' ? 'Sign-in expired' : sync.phase === 'offline' ? 'Offline' : sync.phase === 'error' ? 'Sync stopped' : 'Syncing your phone, tablet and laptop') : 'Your timetable on every device'}</Txt>
          </View>
          <Icon name="chevR" size={18} color={c.faint} />
        </Row>
      </Card>
      {GROUPS.map((g, k) => (
        <Card key={k}>
          {g.map((id, i) => {
            const [, title, icon] = SECTIONS.find((x) => x[0] === id)!;
            return (
              <View key={id}>
                {i ? <Divider inset={60} /> : null}
                <Row onPress={() => open(id)} accessibilityRole="button" accessibilityLabel={title}>
                  <View style={{ width: 32, height: 32, borderRadius: 10, borderCurve: 'continuous', backgroundColor: c.sunken, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={18} color={c.text} /></View>
                  <Txt style={{ flex: 1, fontWeight: '500' }}>{title}</Txt>
                  <Icon name="chevR" size={18} color={c.faint} />
                </Row>
              </View>
            );
          })}
        </Card>
      ))}
    </Page>
  );
}
