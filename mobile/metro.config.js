// Metro also bundles the planner logic shared with the desktop app (../src/shared and ../src/ui/planner-core.js),
// so there is exactly one copy of it.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const shared = path.resolve(__dirname, '..', 'src');
config.watchFolders = [...(config.watchFolders || []), shared];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
module.exports = config;
