import { z } from 'zod';

// Well-formed fixture: exercises the happy path through the loader.
export default {
    manifest: {
        id: 'test.valid',
        name: 'Test Valid Plugin',
        version: '1.0.0',
        kind: 'music-provider',
        capabilities: ['catalog'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: z.object({}),
    },
    factory: () => ({
        async init() {},
    }),
};
