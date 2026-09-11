import { PluginError, definePlugin } from '@deadair/plugin-sdk';
import { z } from 'zod';

// An installed plugin's first two lines: the SDK and zod by bare specifier, which is exactly what a
// plugin under PLUGINS_DIR cannot resolve unless the station links its own copies beside it.
// `PluginError` is re-exported so a test can check the plugin was handed the host's instance.
export { PluginError };

export default definePlugin(
    {
        id: 'test.peer-importing',
        name: 'Test Peer-importing Plugin',
        version: '1.0.0',
        capabilities: ['charts'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: z.object({}),
    },
    () => ({
        async init() {},
    }),
);
