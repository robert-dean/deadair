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

function serviceWith(
    testConnection: () => Promise<{ ok: boolean; message?: string }>,
    weather?: { homeCheck: (id: string) => Promise<string | undefined> },
) {
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
        undefined,
        weather as never,
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

// The weather plugin's own test asks about Atlanta wherever the station is, and an operator in Leeds
// read that as where the station thought it was. The station's own place is added by the host.
describe("testing a weather plugin against the station's own place", () => {
    it("adds what the service made of the station's location to the plugin's own answer", async () => {
        const homeCheck = vi.fn(async () => `For the station's location, "Leeds, UK", it found Leeds, England: 14°C.`);
        const { service } = serviceWith(async () => ({ ok: true, message: 'Open-Meteo answered a test lookup for Atlanta, Georgia: 24°C.' }), {
            homeCheck,
        });

        await expect(service.testPlugin(PLUGIN_ID)).resolves.toEqual({
            ok: true,
            message: `Open-Meteo answered a test lookup for Atlanta, Georgia: 24°C. For the station's location, "Leeds, UK", it found Leeds, England: 14°C.`,
        });
        expect(homeCheck).toHaveBeenCalledWith(PLUGIN_ID);
    });

    it('leaves ok alone when the place cannot be found, since the service itself answered', async () => {
        const { service } = serviceWith(async () => ({ ok: true, message: 'Answered.' }), { homeCheck: async () => 'It could not find it.' });

        await expect(service.testPlugin(PLUGIN_ID)).resolves.toEqual({ ok: true, message: 'Answered. It could not find it.' });
    });

    it('does not ask about the place when the service did not answer at all', async () => {
        const homeCheck = vi.fn(async () => 'never');
        const { service } = serviceWith(async () => ({ ok: false, message: 'HTTP 503.' }), { homeCheck });

        await expect(service.testPlugin(PLUGIN_ID)).resolves.toEqual({ ok: false, message: 'HTTP 503.' });
        expect(homeCheck).not.toHaveBeenCalled();
    });

    it("keeps the plugin's own answer untouched when there is nothing to add", async () => {
        const { service } = serviceWith(async () => ({ ok: true, message: 'Connected as radio.' }), { homeCheck: async () => undefined });

        await expect(service.testPlugin(PLUGIN_ID)).resolves.toEqual({ ok: true, message: 'Connected as radio.' });
    });
});
