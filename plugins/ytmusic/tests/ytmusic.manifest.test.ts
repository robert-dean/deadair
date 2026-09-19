import { describe, expect, it } from 'vitest';

import { accountIndexOf, configSchema, ytmusicManifest } from '../src/ytmusic.manifest.js';

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

describe('the account index', () => {
    it('lets a config saved before the setting existed through', () => {
        // The resolver field's lesson: the host validates the stored row before onLoad runs.
        expect(configSchema.safeParse({ resolverBaseUrl: 'http://localhost:9322' }).success).toBe(true);
    });

    it('accepts the index as the text the form sends it as', () => {
        expect(configSchema.safeParse({ accountIndex: '1' }).success).toBe(true);
    });

    it('refuses an index no browser could hold', () => {
        expect(configSchema.safeParse({ accountIndex: -1 }).success).toBe(false);
        expect(configSchema.safeParse({ accountIndex: 10 }).success).toBe(false);
        expect(configSchema.safeParse({ accountIndex: 1.5 }).success).toBe(false);
    });

    it('reads the first account when nothing usable is stored', () => {
        expect(accountIndexOf(undefined)).toBe(0);
        expect(accountIndexOf('')).toBe(0);
        expect(accountIndexOf('two')).toBe(0);
        expect(accountIndexOf(-3)).toBe(0);
    });

    it('reads a stored index whether it is a number or text', () => {
        expect(accountIndexOf(1)).toBe(1);
        expect(accountIndexOf('1')).toBe(1);
    });
});
