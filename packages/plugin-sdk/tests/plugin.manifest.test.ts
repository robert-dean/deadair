import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { pluginManifestSchema, type PluginManifest } from '../src/plugin.manifest.js';
import type { ConfigField } from '../src/plugin.config.fields.js';

const validManifest = (): PluginManifest => ({
    id: 'deadair.spotify',
    name: 'Spotify',
    version: '1.0.0',
    kind: 'music-provider',
    capabilities: ['catalog', 'stream', 'steer'],
    apiVersion: '^1.0.0',
    permissions: {
        network: ['api.spotify.com'],
        storage: true,
        oauth: true,
    },
    configFields: [],
    configSchema: z.object({}),
});

describe('pluginManifestSchema', () => {
    it('parses a fully valid manifest', () => {
        const manifest = validManifest();

        const result = pluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(true);
    });

    it.each([
        ['missing id', { ...validManifest(), id: undefined }],
        ['non-reverse-DNS id (single segment)', { ...validManifest(), id: 'spotify' }],
        ['non-reverse-DNS id (uppercase)', { ...validManifest(), id: 'Deadair.Spotify' }],
        ['missing apiVersion', { ...validManifest(), apiVersion: undefined }],
        ['unknown config-field type', { ...validManifest(), configFields: [{ key: 'k', label: 'K', type: 'wat' }] }],
        ['malformed permissions (network not an array)', { ...validManifest(), permissions: { network: 'api.spotify.com', storage: true, oauth: true } }],
        ['malformed permissions (missing storage)', { ...validManifest(), permissions: { network: [], oauth: true } }],
        ['configSchema not a zod schema', { ...validManifest(), configSchema: {} }],
    ])('rejects: %s', (_label, manifest) => {
        const result = pluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(false);
    });

    it('accepts a select field without options (options is optional on the schema)', () => {
        const manifest = { ...validManifest(), configFields: [{ key: 'k', label: 'K', type: 'select' }] };

        const result = pluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(true);
    });

    it('round-trips configFields, preserving keys and order', () => {
        const configFields: ConfigField[] = [
            { key: 'clientId', label: 'Client ID', type: 'string', required: true },
            { key: 'clientSecret', label: 'Client Secret', type: 'secret' },
            { key: 'region', label: 'Region', type: 'select', options: [{ value: 'us', label: 'US' }] },
        ];
        const manifest = { ...validManifest(), configFields };

        const result = pluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.configFields.map((field) => field.key)).toEqual(['clientId', 'clientSecret', 'region']);
            expect(result.data.configFields).toEqual(configFields);
        }
    });

    it('accepts a secret field descriptor', () => {
        const manifest = {
            ...validManifest(),
            configFields: [{ key: 'apiKey', label: 'API Key', type: 'secret', required: true }],
        };

        const result = pluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(true);
    });
});
