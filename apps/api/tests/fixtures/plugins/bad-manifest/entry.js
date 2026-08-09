// Manifest missing required fields (no permissions, no configSchema, no
// version): pluginManifestSchema.safeParse must reject this.
export default {
    manifest: {
        id: 'test.bad-manifest',
        name: 'Test Bad Manifest Plugin',
        capabilities: ['catalog'],
        apiVersion: '^1.0.0',
    },
    factory: () => ({
        async init() {},
    }),
};
