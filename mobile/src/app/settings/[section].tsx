// One Settings section, pushed in from the side on phones. Back (the arrow, the edge swipe or Android Back) returns to the list.
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { IconButton, Page, Txt, useLayout } from '../../ui/kit';
import { useTheme } from '../../ui/theme';
import { SECTIONS, SectionBody, type SecId } from '../../ui/SettingsSections';
import { useEffect } from 'react';

export default function SettingsSection() {
  const { c } = useTheme();
  const { twoCol } = useLayout();
  const { section } = useLocalSearchParams<{ section: SecId }>();
  const found = SECTIONS.find((x) => x[0] === section);
  // a landscape tablet shows sections beside the list, so a deep link lands there
  useEffect(() => { if (twoCol && found) router.replace({ pathname: '/settings', params: { section: found[0] } }); }, [twoCol, found]);
  if (!found) return null;
  return (
    <Page>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -12, marginBottom: -8 }}>
        <IconButton icon="back" label="Back to Settings" onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} color={c.text} size={24} />
      </View>
      <Txt kind="display">{found[1]}</Txt>
      <SectionBody id={found[0]} />
    </Page>
  );
}
