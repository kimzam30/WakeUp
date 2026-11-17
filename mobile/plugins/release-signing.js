// Signs release builds with WakeUp's own key when its environment variables are set (GitHub Actions sets them from
// repository secrets; locally: `. ~/.config/wakeup-signing/env` before building). Without them, release builds keep
// React Native's debug key, which is public: fine for a quick test, but Android won't install it over a real release.
//   WAKEUP_KEYSTORE (path to the .jks), WAKEUP_KEYSTORE_PASSWORD, WAKEUP_KEY_ALIAS, WAKEUP_KEY_PASSWORD
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// wakeup-release-signing';
const BLOCK = `
${MARK}
def wakeupKeystore = System.getenv('WAKEUP_KEYSTORE')
if (wakeupKeystore) {
    android.signingConfigs {
        wakeupRelease {
            storeFile file(wakeupKeystore)
            storePassword System.getenv('WAKEUP_KEYSTORE_PASSWORD')
            keyAlias System.getenv('WAKEUP_KEY_ALIAS')
            keyPassword System.getenv('WAKEUP_KEY_PASSWORD')
        }
    }
    android.buildTypes.release.signingConfig android.signingConfigs.wakeupRelease
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(MARK)) c.modResults.contents += BLOCK;
    return c;
  });
};
