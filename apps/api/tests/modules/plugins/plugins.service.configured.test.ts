// Coverage for the `plugin.configured` publish `updatePluginConfig` gained in package 15: it must
// fire after the settings write commits, alongside `syncCatalogAfterCommit`, and a subscriber's own
// throw must never surface as a failed save. Harness and construction style drawn from
// `plugins.service.logs.test.ts`.

import { describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '@deadair/plugin-sdk';

import { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { AuthorizationContext, type UserActor } from '../../../src/modules/permissions/authorization.context.js';
import type { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import { PluginConfigService, type PluginConfigReadModel } from '../../../src/modules/plugins/plugin.config.service.js';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { StationBus } from '../../../src/modules/shared/station.bus.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginLifecycleManager } from '../../../src/modules/plugins/plugin.lifecycle.manager.js';
import { PluginOAuthStateStore } from '../../../src/modules/plugins/plugin.oauth.state.store.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { PluginsService } from '../../../src/modules/plugins/plugins.service.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const SPOTIFY_ID = 'deadair.spotify';

const userActor = (actorId: string): UserActor => ({
    kind: 'user',
    sessionToken: 'test-session',
    actorId,
    factors: [],
    platformRoles: new Set(),
});

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id: SPOTIFY_ID,
        name: 'Spotify',
        version: '1.0.0',
        capabilities: ['catalog'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

function record(id: string, overrides: Partial<PluginRecord> = {}): PluginRecord {
    return { id, dir: `/plugins/${id}`, origin: 'bundled', status: 'active', manifest: manifest({ id }), instance: {} as never, ...overrides };
}

interface Harness {
    service: PluginsService;
    afterCommit: AfterCommit;
    bus: StationBus;
}

function makeService(): Harness {
    const registry = new PluginRegistry();
    registry.upsert(record(SPOTIFY_ID));

    const grants = new Set([`plugin:${SPOTIFY_ID}:configure:u-owner`]);
    const permissions = {
        checkSubject: vi.fn(async (object: { namespace: string; id: string }, permission: string, subject: { id: string }) =>
            grants.has(`${object.namespace}:${object.id}:${permission}:${subject.id}`),
        ),
        listObjects: vi.fn(async () => ({ ids: [], truncated: false })),
    } as unknown as PermissionsService;
    const accessControl = new AccessControlService(new AuthorizationContext(userActor('u-owner')), permissions);

    const configService = {
        getReadModel: vi.fn(async (pluginId: string) => ({
            pluginId,
            enabled: true,
            config: {},
            configured: {},
            oauthConnected: false,
        })),
        getConfig: vi.fn(async () => ({})),
        getSecrets: vi.fn(async () => ({})),
        saveConfig: vi.fn(async () => {}),
        setEnabled: vi.fn(async () => {}),
        setLogLevel: vi.fn(async () => {}),
    } as unknown as PluginConfigService;

    const lifecycleManager = { rescan: vi.fn(async () => {}), reinitPlugin: vi.fn(async () => {}) } as unknown as PluginLifecycleManager;

    const pluginLog = {
        for: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        setLevel: vi.fn(),
        levelOf: vi.fn(() => 'info'),
        tail: vi.fn(async () => []),
        readAll: vi.fn(async () => ''),
    } as unknown as ReturnType<typeof stubPluginLog>['log'];

    const afterCommit = new AfterCommit();
    const bus = new StationBus({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);

    const service = new PluginsService(
        registry,
        configService,
        new PluginInvoker(registry, stubPluginLog().log),
        lifecycleManager,
        new PluginOAuthStateStore(),
        { holds: () => false, decisionFor: () => undefined } as never,
        accessControl,
        pluginLog,
        afterCommit,
        // Only ever asked for a catalog sync after a provider's settings change.
        { send: vi.fn(async () => 'job-1') } as never,
        { actor: { kind: 'system', sessionToken: '', source: 'test' } } as never,
        { record: vi.fn(async () => undefined) } as never,
        { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        bus,
    );

    return { service, afterCommit, bus };
}

describe('PluginsService: plugin.configured', () => {
    it('publishes plugin.configured after commit', async () => {
        const { service, afterCommit, bus } = makeService();
        const heard = vi.fn();
        bus.subscribe('plugin.configured', heard);

        await service.updatePluginConfig(SPOTIFY_ID, { config: {} });
        expect(heard).not.toHaveBeenCalled();

        await afterCommit.run();

        expect(heard).toHaveBeenCalledWith({ pluginId: SPOTIFY_ID });
    });

    it('a subscriber that throws does not fail the commit hooks', async () => {
        const { service, afterCommit, bus } = makeService();
        bus.subscribe('plugin.configured', () => {
            throw new Error('boom');
        });

        await service.updatePluginConfig(SPOTIFY_ID, { config: {} });

        await expect(afterCommit.run()).resolves.toBeUndefined();
    });
});
