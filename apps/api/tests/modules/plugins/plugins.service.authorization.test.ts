import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { IsHttpError } from '@maroonedsoftware/errors';
import type { PluginManifest } from '@deadair/plugin-sdk';

import { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { AuthorizationContext, type Actor, type UserActor } from '../../../src/modules/permissions/authorization.context.js';
import type { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import { PluginEchoTracker } from '../../../src/modules/plugins/plugin.echo.tracker.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginLifecycleManager } from '../../../src/modules/plugins/plugin.lifecycle.manager.js';
import { PluginOAuthStateStore } from '../../../src/modules/plugins/plugin.oauth.state.store.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { PluginsService } from '../../../src/modules/plugins/plugins.service.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';

const SPOTIFY_ID = 'deadair.spotify';
const OTHER_ID = 'deadair.other';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

const userActor = (actorId: string, roles: ReadonlyArray<'admin' | 'listener'>): UserActor => ({
    kind: 'user',
    sessionToken: 'test-session',
    actorId,
    factors: [],
    rolePermissions: new Set<string>(),
    platformRoles: new Set(roles),
});

const systemActor: Actor = { kind: 'system', sessionToken: '', source: 'test' };

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id: SPOTIFY_ID,
        name: 'Spotify',
        version: '1.0.0',
        kind: 'music-provider',
        capabilities: ['catalog', 'oauth'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: true },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

const oauthInstance = {
    getAuthorizeUrl: vi.fn(async (state: string) => `https://provider.example/authorize?state=${state}`),
    handleCallback: vi.fn(async () => {}),
};

function record(id: string, overrides: Partial<PluginRecord> = {}): PluginRecord {
    return { id, dir: `/plugins/${id}`, status: 'active', manifest: manifest({ id }), instance: oauthInstance as never, ...overrides };
}

/**
 * A tiny fixture-backed fake of the two `PermissionsService` methods
 * `AccessControlService` actually calls. Encodes only the already-resolved
 * answer for each (object, permission, subject) triple the tests need — it
 * does not re-implement the Zanzibar relation walk.
 */
class FakePermissionsFixture {
    /** `<namespace>:<id>:<permission>:<userId>` → allowed. */
    private readonly grants = new Set<string>();
    /** `<namespace>:<permission>:<userId>` → visible ids. */
    private readonly visibility = new Map<string, string[]>();

    grant(namespace: string, id: string, permission: string, userId: string): this {
        this.grants.add(`${namespace}:${id}:${permission}:${userId}`);
        return this;
    }

    setVisible(namespace: string, permission: string, userId: string, ids: string[]): this {
        this.visibility.set(`${namespace}:${permission}:${userId}`, ids);
        return this;
    }

    asPermissionsService(): PermissionsService {
        return {
            checkSubject: vi.fn(async (object: { namespace: string; id: string }, permission: string, subject: { id: string }) =>
                this.grants.has(`${object.namespace}:${object.id}:${permission}:${subject.id}`),
            ),
            listObjects: vi.fn(async (namespace: string, permission: string, subject: { id: string }) => ({
                ids: this.visibility.get(`${namespace}:${permission}:${subject.id}`) ?? [],
                truncated: false,
            })),
        } as unknown as PermissionsService;
    }
}

interface Harness {
    service: PluginsService;
    accessControl: AccessControlService;
    requireSpy: ReturnType<typeof vi.fn>;
    canAccessSpy: ReturnType<typeof vi.fn>;
    listVisibleIdsSpy: ReturnType<typeof vi.fn>;
}

/** Builds a `PluginsService` around a real `AccessControlService`/`AuthorizationContext`, with everything else a bare stub. */
function makeService(actor: Actor, fixture: FakePermissionsFixture = new FakePermissionsFixture()): Harness {
    const registry = new PluginRegistry();
    registry.upsert(record(SPOTIFY_ID));
    registry.upsert(record(OTHER_ID, { manifest: manifest({ id: OTHER_ID, capabilities: ['catalog'] }) }));

    const accessControl = new AccessControlService(new AuthorizationContext(actor), fixture.asPermissionsService());
    const requireSpy = vi.spyOn(accessControl, 'require');
    const canAccessSpy = vi.spyOn(accessControl, 'canAccess');
    const listVisibleIdsSpy = vi.spyOn(accessControl, 'listVisibleIds');

    const configService = {
        getReadModel: vi.fn(async (pluginId: string) => ({ pluginId, enabled: true, config: {}, configured: {} })),
        getConfig: vi.fn(async () => ({})),
        getSecrets: vi.fn(async () => ({})),
        saveConfig: vi.fn(async () => {}),
        setEnabled: vi.fn(async () => {}),
    } as unknown as PluginConfigService;

    const lifecycleManager = {
        rescan: vi.fn(async () => {}),
        reinitPlugin: vi.fn(async () => {}),
    } as unknown as PluginLifecycleManager;
    const echoTracker = {
        expectEcho: vi.fn(),
        retractEcho: vi.fn(),
    } as unknown as PluginEchoTracker;

    const service = new PluginsService(
        registry,
        configService,
        new PluginInvoker(registry, stubLogger()),
        lifecycleManager,
        echoTracker,
        new PluginOAuthStateStore(),
        accessControl,
        stubLogger(),
    );

    return { service, accessControl, requireSpy, canAccessSpy, listVisibleIdsSpy };
}

/** Asserts the rejection is a 403 `HttpError`. */
async function expectForbidden(promise: Promise<unknown>): Promise<void> {
    await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.statusCode === 403);
}

describe('PluginsService authorization: admin', () => {
    it('passes every per-plugin operation and lists every seeded plugin', async () => {
        const { service } = makeService(userActor('u-admin', ['admin']));

        await expect(service.getPlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expect(service.updatePluginConfig(SPOTIFY_ID, { config: {} })).resolves.toBeDefined();
        await expect(service.enablePlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expect(service.disablePlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expect(service.testPlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expect(service.startOAuthAuthorization(SPOTIFY_ID)).resolves.toBeDefined();

        const list = await service.listPlugins({});
        expect(list.map(p => p.id).sort()).toEqual([OTHER_ID, SPOTIFY_ID]);
    });
});

describe('PluginsService authorization: listener', () => {
    it('can read but is denied on every mutating operation', async () => {
        const { service } = makeService(userActor('u-listener', ['listener']));

        await expect(service.getPlugin(SPOTIFY_ID)).resolves.toBeDefined();
        const list = await service.listPlugins({});
        expect(list.map(p => p.id).sort()).toEqual([OTHER_ID, SPOTIFY_ID]);

        await expectForbidden(service.updatePluginConfig(SPOTIFY_ID, { config: {} }));
        await expectForbidden(service.enablePlugin(SPOTIFY_ID));
        await expectForbidden(service.disablePlugin(SPOTIFY_ID));
        await expectForbidden(service.testPlugin(SPOTIFY_ID));
        await expectForbidden(service.startOAuthAuthorization(SPOTIFY_ID));
    });
});

describe('PluginsService authorization: roleless user, no tuples', () => {
    it('sees no plugins and is denied on getPlugin', async () => {
        const { service } = makeService(userActor('u-nobody', []));

        await expect(service.listPlugins({})).resolves.toEqual([]);
        await expectForbidden(service.getPlugin(SPOTIFY_ID));
    });
});

describe('PluginsService authorization: roleless user with an operator grant', () => {
    // The fixture below encodes the *resolved* result of a `plugin:deadair.spotify#operator@user:u-operator`
    // tuple: `view` follows `operator` in the relation graph, so the tuple grants view but not configure.
    it('sees exactly the granted plugin, can view it, and cannot configure it', async () => {
        const fixture = new FakePermissionsFixture()
            .grant('plugin', SPOTIFY_ID, 'view', 'u-operator')
            .setVisible('plugin', 'view', 'u-operator', [SPOTIFY_ID]);
        const { service } = makeService(userActor('u-operator', []), fixture);

        const list = await service.listPlugins({});
        expect(list.map(p => p.id)).toEqual([SPOTIFY_ID]);

        await expect(service.getPlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expectForbidden(service.updatePluginConfig(SPOTIFY_ID, { config: {} }));
    });
});

describe('PluginsService authorization: completeOAuthCallback', () => {
    // Regression guard: the OAuth callback is anonymous by design (the provider redirects a
    // browser here with no session of ours), so it must never reach AccessControlService,
    // regardless of whether the state check inside it passes or fails.
    it('resolves for a system actor without ever calling AccessControlService', async () => {
        const { service, requireSpy, canAccessSpy, listVisibleIdsSpy } = makeService(systemActor);

        const result = await service.completeOAuthCallback(SPOTIFY_ID, { state: 'not-a-real-state' });

        expect(result.pluginId).toBe(SPOTIFY_ID);
        expect(result.ok).toBe(false);
        expect(requireSpy).not.toHaveBeenCalled();
        expect(canAccessSpy).not.toHaveBeenCalled();
        expect(listVisibleIdsSpy).not.toHaveBeenCalled();
    });
});
