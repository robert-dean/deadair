// "Test connection" on a quarantined plugin used to answer with the reason its breaker had stored
// (on the station, the director's third failed Spotify search in a row) without calling
// `testConnection` at all. The claim under test is that the button asks the plugin every time, and
// that the answer is what decides whether the plugin is back on the station.

import { describe, expect, it, vi } from 'vitest';
import { PluginError } from '@deadair/plugin-sdk';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginOAuthStateStore } from '../../../src/modules/plugins/plugin.oauth.state.store.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { PluginsService } from '../../../src/modules/plugins/plugins.service.js';
import type { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import type { PluginLifecycleManager } from '../../../src/modules/plugins/plugin.lifecycle.manager.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const PLUGIN_ID = 'deadair.example';

/** Everything past the test call is somebody else's test; this waves it all through. */
const permissive = () =>
    ({
        require: vi.fn(async () => {}),
        canAccess: vi.fn(async () => true),
        listVisibleIds: vi.fn(async () => ({ all: true, ids: [] })),
    }) as unknown as AccessControlService;

function serviceWith(testConnection: () => Promise<{ ok: boolean; message?: string }>) {
    const registry = new PluginRegistry();
    registry.upsert({
        id: PLUGIN_ID,
        dir: '/plugins/example',
        status: 'active',
        manifest: {
            id: PLUGIN_ID,
            name: 'Example',
            version: '1',
            capabilities: [],
            apiVersion: '^1.0.0',
            permissions: { network: [], storage: false, oauth: false },
            configFields: [],
        },
        instance: { testConnection },
    } as unknown as PluginRecord);
    const invoker = new PluginInvoker(registry, stubPluginLog().log);

    const service = new PluginsService(
        registry,
        {
            getReadModel: vi.fn(async (id: string) => ({ pluginId: id, enabled: true, config: {}, configured: {}, oauthConnected: false })),
        } as unknown as PluginConfigService,
        invoker,
        { rescan: vi.fn(), reinitPlugin: vi.fn() } as unknown as PluginLifecycleManager,
        new PluginOAuthStateStore(),
        // What the operator has allowed. Nothing in this file asks about a grant.
        { holds: () => false, decisionFor: () => undefined } as never,
        permissive(),
        stubPluginLog().log,
        new AfterCommit(),
        // Only ever asked for a catalog sync after a provider's settings change.
        { send: vi.fn(async () => 'job-1') } as never,
        { actor: { kind: 'system', sessionToken: '', source: 'test' } } as never,
        { record: vi.fn(async () => undefined) } as never,
        { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    );

    return { service, registry, invoker };
}

/** What the station did to Spotify: one non-retryable failure is enough to trip the breaker. */
async function quarantine(invoker: PluginInvoker): Promise<void> {
    await expect(
        invoker.invoke(PLUGIN_ID, 'director.lookupTrack', () => {
            throw new PluginError('Spotify API request failed: HTTP 502').withCode('auth');
        }),
    ).rejects.toThrow();
}

describe('testing a quarantined plugin', () => {
    it('asks the plugin, rather than repeating whatever tripped the breaker', async () => {
        const testConnection = vi.fn(async () => ({ ok: false, message: 'Spotify replied HTTP 502.' }));
        const { service, invoker } = serviceWith(testConnection);
        await quarantine(invoker);

        await expect(service.testPlugin(PLUGIN_ID)).resolves.toEqual({ ok: false, message: 'Spotify replied HTTP 502.' });
        expect(testConnection).toHaveBeenCalledTimes(1);
    });

    it('puts the plugin back on the station when the provider answers', async () => {
        const { service, registry, invoker } = serviceWith(async () => ({ ok: true, message: 'Connected as radio.' }));
        await quarantine(invoker);

        await expect(service.testPlugin(PLUGIN_ID)).resolves.toEqual({ ok: true, message: 'Connected as radio.' });

        expect(invoker.isBreakerOpen(PLUGIN_ID)).toBe(false);
        expect((await service.getPlugin(PLUGIN_ID)).status).toBe('active');
        expect(registry.get(PLUGIN_ID)?.error).toBeUndefined();
    });

    it("leaves it quarantined when the provider is still down, and shows the test's reason on the page", async () => {
        const { service, invoker } = serviceWith(async () => ({ ok: false, message: 'Spotify replied HTTP 502.' }));
        await quarantine(invoker);

        await service.testPlugin(PLUGIN_ID);

        const detail = await service.getPlugin(PLUGIN_ID);
        expect(detail.status).toBe('failed');
        expect(detail.lastError).toBe('testConnection: Spotify replied HTTP 502.');
    });

    it('still answers rather than rejecting when the test itself throws', async () => {
        const { service, invoker } = serviceWith(async () => {
            throw new Error('socket hang up');
        });
        await quarantine(invoker);

        await expect(service.testPlugin(PLUGIN_ID)).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/socket hang up/) });
        expect(invoker.isBreakerOpen(PLUGIN_ID)).toBe(true);
    });
});
