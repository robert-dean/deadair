import { definePlugin } from '@deadair/plugin-sdk';
import { appleChartsManifest } from './apple.charts.manifest.js';
import { AppleMusicChartsPlugin } from './apple.charts.plugin.js';

// What the station imports. `package.json`'s `deadair.plugin` points at the built copy of this file,
// and its default export has to be `definePlugin(manifest, factory)`. The factory runs once per
// start of the plugin, so keep it cheap: setup belongs in the plugin's `onLoad`.
export default definePlugin(appleChartsManifest, () => new AppleMusicChartsPlugin());
