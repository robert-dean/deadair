import { definePlugin } from '@deadair/plugin-sdk';

import { castManifest } from './cast.manifest.js';
import { CastPlugin } from './cast.plugin.js';
import { ChromecastDriver } from './drivers/chromecast/chromecast.driver.js';
import type { SpeakerDriver } from './drivers/speaker.driver.js';

export { CastPlugin, castManifest };

/** One fresh set of drivers per instance, since each holds the connections of the instance that made it. */
const drivers = (): SpeakerDriver[] => [new ChromecastDriver()];

export const manifest = castManifest(drivers().map(driver => ({ value: driver.protocol, label: driver.label })));

export default definePlugin(manifest, () => new CastPlugin(drivers()));
