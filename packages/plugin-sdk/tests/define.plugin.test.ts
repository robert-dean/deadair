import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { definePlugin } from '../src/define.plugin.js';
import type { PluginManifest } from '../src/plugin.manifest.js';
import type { PluginHost } from '../src/plugin.host.js';

const manifest: PluginManifest = {
    id: 'deadair.example',
    name: 'Example',
    version: '1.0.0',
    capabilities: ['enrichment'],
    apiVersion: '^1.0.0',
    permissions: { network: [], storage: false, oauth: false },
    configFields: [],
    configSchema: z.object({}),
};

describe('definePlugin', () => {
    it('returns an object pairing the manifest and factory unchanged', () => {
        const instance = { init: vi.fn().mockResolvedValue(undefined) };
        const factory = vi.fn(() => instance);

        const plugin = definePlugin(manifest, factory);

        expect(plugin.manifest).toBe(manifest);
        expect(plugin.factory).toBe(factory);
    });

    it('does not invoke the factory itself', () => {
        const factory = vi.fn(() => ({ init: vi.fn().mockResolvedValue(undefined) }));

        definePlugin(manifest, factory);

        expect(factory).not.toHaveBeenCalled();
    });

    it('passes the constructed instance through untouched when the factory is later called', async () => {
        // Compile-time: a factory returning an object with `init` satisfies PluginFactory.
        const testConnection = vi.fn().mockResolvedValue({ ok: true });
        const factory = () => ({
            init: async (_host: PluginHost) => undefined,
            testConnection,
        });

        const plugin = definePlugin(manifest, factory);
        const instance = plugin.factory();

        await expect(instance.testConnection()).resolves.toEqual({ ok: true });
    });
});
