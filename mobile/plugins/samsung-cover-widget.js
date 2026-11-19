// Puts the CoverScreen widget on the Galaxy Z Flip's cover screen (FlexWindow). Samsung reads a second meta-data
// entry on the widget's receiver that points to an XML file with display="sub_screen"
// (https://developer.samsung.com/codelab/galaxy-z/widget-flex-window.html). Other phones ignore it.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const RECEIVER = '.widget.CoverScreen';
const XML = 'samsung_cover_widget';

module.exports = function withSamsungCoverWidget(config) {
  config = withDangerousMod(config, ['android', async (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${XML}.xml`), '<?xml version="1.0" encoding="utf-8"?>\n<samsung-appwidget-provider display="sub_screen" />\n');
    return c;
  }]);
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    const r = app?.receiver?.find((x) => x.$['android:name'] === RECEIVER);
    if (!r) { console.warn(`samsung-cover-widget: ${RECEIVER} not found; list this plugin just before react-native-android-widget (Expo runs manifest mods in reverse order)`); return c; }
    // the widget plugin writes meta-data as one object; Android's manifest allows a list
    const md = r['meta-data']; const list = Array.isArray(md) ? md : md ? [md] : [];
    r['meta-data'] = list.filter((m) => m.$['android:name'] !== 'com.samsung.android.appwidget.provider');
    r['meta-data'].push({ $: { 'android:name': 'com.samsung.android.appwidget.provider', 'android:resource': `@xml/${XML}` } });
    return c;
  });
};
