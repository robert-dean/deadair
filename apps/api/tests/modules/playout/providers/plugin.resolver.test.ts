// Asking a provider for a record's URL, and telling the two kinds of refusal apart: one about the
// record, which is answered as "no URL", and one about the ACCOUNT, which is thrown so the caller can
// put the fetch off without counting it against the copy.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type PluginManifest } from '@deadair/plugin-sdk';

import { PluginTrackResolver, ProviderBusy } from '../../../../src/modules/playout/providers/plugin.resolver.js';
import { PluginInvoker } from '../../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../../utils/plugin.log.fixture.js';

const PROVIDER = 'deadair.provider';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(capabilities: string[]): PluginManifest {
    return {
        id: PROVIDER,
        name: PROVIDER,
        version: '1.0.0',
        capabilities,
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

const build = (resolveStreamUrl: (id: string) => Promise<{ url: string } | undefined>, capabilities = ['stream']) => {
    const record: PluginRecord = {
        id: PROVIDER,
        dir: `/plugins/${PROVIDER}`,
        origin: 'bundled',
        status: 'active',
        manifest: manifest(capabilities),
        instance: { init: vi.fn(), resolveStreamUrl: vi.fn(resolveStreamUrl) } as never,
    };
    const registry = new PluginRegistry();
    registry.setAll([record]);

    return new PluginTrackResolver(registry, new PluginInvoker(registry, stubPluginLog().log), stubLogger());
};

describe('PluginTrackResolver.resolveBinding', () => {
    it('answers with the URL the provider gave', async () => {
        const resolver = build(async id => ({ url: `https://cdn.example/${id}` }));

        expect(await resolver.resolveBinding(PROVIDER, 'TR:1')).toBe('https://cdn.example/TR:1');
    });

    it('answers nothing for a plugin that cannot stream', async () => {
        const resolver = build(async () => ({ url: 'https://cdn.example/x' }), ['catalog']);

        expect(await resolver.resolveBinding(PROVIDER, 'TR:1')).toBeUndefined();
    });

    // A refusal about THIS record is still an ordinary "no URL", which is what counts toward a bench.
    it.each(['upstream', 'not_found', 'forbidden'] as const)('answers nothing when the provider refuses the record (%s)', async code => {
        const resolver = build(async () => {
            throw new PluginError('no audio for that one').withCode(code);
        });

        expect(await resolver.resolveBinding(PROVIDER, 'TR:1')).toBeUndefined();
    });

    it.each(['unavailable', 'rate_limited'] as const)('throws ProviderBusy when the account is busy (%s)', async code => {
        const resolver = build(async () => {
            throw new PluginError('playing on another device').withCode(code).withRetry(60_000);
        });

        const refused = resolver.resolveBinding(PROVIDER, 'TR:1');

        await expect(refused).rejects.toBeInstanceOf(ProviderBusy);
        await expect(refused).rejects.toMatchObject({ pluginId: PROVIDER, retryAfterMs: 60_000 });
    });
});
