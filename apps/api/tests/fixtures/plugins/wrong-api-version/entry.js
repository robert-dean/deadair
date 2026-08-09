import { z } from 'zod';

// Otherwise well-formed, but declares an apiVersion range this host's
// PLUGIN_API_VERSION (1.0.0) does not satisfy.
export default {
    manifest: {
        id: 'test.wrong-api-version',
        name: 'Test Wrong API Version Plugin',
        version: '1.0.0',
        capabilities: ['catalog'],
        apiVersion: '^99.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: z.object({}),
    },
    factory: () => ({
        async init() {},
    }),
};
