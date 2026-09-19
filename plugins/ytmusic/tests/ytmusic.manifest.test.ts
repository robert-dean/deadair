import { describe, expect, it } from 'vitest';

import { configSchema, ytmusicManifest } from '../src/ytmusic.manifest.js';

/**
 * The schema is a contract with the HOST, which validates every stored config against it before the
 * plugin's own `onLoad` runs. A fake host does not, so these assertions are the only place that
 * contract is tested -- and it was broken once, in a way no plugin-level test could see.
 */
describe('configSchema', () => {
    it('accepts a config saved before the resolver field existed', () => {
        // A catalog-only station's row: a cookie in the secrets, nothing here. Refusing it marks the
        // whole plugin misconfigured, catalog included.
        expect(configSchema.safeParse({}).success).toBe(true);
    });

    it('accepts a configured resolver', () => {
        expect(configSchema.safeParse({ resolverBaseUrl: 'http://localhost:9322' }).success).toBe(true);
    });

    it('refuses an empty resolver address rather than treating it as set', () => {
        expect(configSchema.safeParse({ resolverBaseUrl: '' }).success).toBe(false);
    });
});

describe('the form', () => {
    it('still asks for the resolver, with the address the station ships it at', () => {
        const field = ytmusicManifest.configFields.find(f => f.key === 'resolverBaseUrl');
        expect(field).toMatchObject({ required: true, default: 'http://localhost:9322', type: 'url' });
    });

    it('keeps the cookie out of the schema, because it is a write-only secret', () => {
        expect(ytmusicManifest.configFields.find(f => f.key === 'cookie')?.type).toBe('secret');
        expect(Object.keys(configSchema.shape)).not.toContain('cookie');
    });
});
