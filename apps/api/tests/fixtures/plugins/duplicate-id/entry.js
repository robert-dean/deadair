import { z } from 'zod';

// Same id as valid-plugin/entry.js. Directory names sort so this comes after
// "valid-plugin" alphabetically, meaning valid-plugin claims the id first and
// this one is the quarantined duplicate.
export default {
    manifest: {
        id: 'test.valid',
        name: 'Test Duplicate Id Plugin',
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
