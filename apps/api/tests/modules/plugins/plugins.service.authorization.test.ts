// These are service-level unit tests standing behind an "authenticated, any
// actor" route floor (see `apps/api/data/contracts/plugins/plugins.ck`):
// every route below `rescan` and the OAuth callback requires only that the
// caller be authenticated, and everything past that is decided here. The
// 401 for an unauthenticated request is handled in
// `authorization.context.middleware.ts` and is deliberately not covered in
// this file.

import { describe, expect, it, vi } from 'vitest';
import { IsHttpError } from '@maroonedsoftware/errors';
import { PluginError, type PluginManifest } from '@deadair/plugin-sdk';
import { ErrorCodes } from '@deadair/error-codes';

import { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { AuthorizationContext, type Actor, type UserActor } from '../../../src/modules/permissions/authorization.context.js';
import type { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import { PluginConfigService, type PluginConfigReadModel } from '../../../src/modules/plugins/plugin.config.service.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginLifecycleManager } from '../../../src/modules/plugins/plugin.lifecycle.manager.js';
import { OAUTH_SECRET_FIELD, PLUGIN_OAUTH_SECRET_KEY } from '../../../src/modules/plugins/plugin.oauth.secret.js';
import { PluginOAuthStateStore } from '../../../src/modules/plugins/plugin.oauth.state.store.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { PluginsService } from '../../../src/modules/plugins/plugins.service.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const SPOTIFY_ID = 'deadair.spotify';
const OTHER_ID = 'deadair.other';

// Mirrors the `UserActor` shape `authorization.context.middleware.ts` builds
// for `claims.actorType === 'user'`: `platformRoles` is a subset of
// `{'admin', 'listener'}` that may be empty (a roleless authenticated user is
// a real, ordinary state).
const userActor = (actorId: string, roles: ReadonlyArray<'admin' | 'listener'>): UserActor => ({
    kind: 'user',
    sessionToken: 'test-session',
    actorId,
    factors: [],
    platformRoles: new Set(roles),
});

// This is the actor `authorization.context.middleware.ts` builds for an
// unauthenticated request (the non-webhook path). It is the only actor shape
// that reaches the anonymous OAuth callback, and after this run it is no
// longer trusted by `AccessControlService`.
const httpSystemActor: Actor = { kind: 'system', sessionToken: '', source: 'http' };

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id: SPOTIFY_ID,
        name: 'Spotify',
        version: '1.0.0',
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

    /**
     * Encodes the resolved result of a `plugin:<id>#owner@user:<userId>`
     * tuple: per `permission view = owner | operator; configure = owner;
     * enable = owner; oauth = owner`, an owner passes all four checks and is
     * included in the `view` visibility set.
     */
    grantOwner(pluginId: string, userId: string): this {
        for (const permission of ['view', 'configure', 'enable', 'oauth']) {
            this.grant('plugin', pluginId, permission, userId);
        }
        return this.setVisible('plugin', 'view', userId, [pluginId]);
    }

    /**
     * Encodes the resolved result of a `plugin:<id>#operator@user:<userId>`
     * tuple: `view` follows `operator` in the relation graph, but
     * `configure`/`enable`/`oauth` do not, so only `view` is granted.
     */
    grantOperator(pluginId: string, userId: string): this {
        this.grant('plugin', pluginId, 'view', userId);
        return this.setVisible('plugin', 'view', userId, [pluginId]);
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
    configService: PluginConfigService;
    lifecycleManager: PluginLifecycleManager;
    registry: PluginRegistry;
}

/**
 * Builds a `PluginsService` around a real `AccessControlService`/`AuthorizationContext`,
 * with everything else a bare stub. `readModels` lets a test override the
 * per-plugin `getReadModel` result (e.g. `oauthConnected`) without touching
 * the other tests' default.
 */
function makeService(
    actor: Actor,
    fixture: FakePermissionsFixture = new FakePermissionsFixture(),
    readModels: Record<string, Partial<PluginConfigReadModel>> = {},
): Harness {
    const registry = new PluginRegistry();
    registry.upsert(record(SPOTIFY_ID));
    registry.upsert(record(OTHER_ID, { manifest: manifest({ id: OTHER_ID, capabilities: ['catalog'] }) }));

    const accessControl = new AccessControlService(new AuthorizationContext(actor), fixture.asPermissionsService());
    const requireSpy = vi.spyOn(accessControl, 'require');
    const canAccessSpy = vi.spyOn(accessControl, 'canAccess');
    const listVisibleIdsSpy = vi.spyOn(accessControl, 'listVisibleIds');

    const configService = {
        getReadModel: vi.fn(async (pluginId: string) => ({
            pluginId,
            enabled: true,
            config: {},
            configured: {},
            oauthConnected: false,
            ...readModels[pluginId],
        })),
        getConfig: vi.fn(async () => ({})),
        getSecrets: vi.fn(async () => ({})),
        saveConfig: vi.fn(async () => {}),
        setEnabled: vi.fn(async () => {}),
    } as unknown as PluginConfigService;

    const lifecycleManager = {
        rescan: vi.fn(async () => {}),
        reinitPlugin: vi.fn(async () => {}),
    } as unknown as PluginLifecycleManager;
    const service = new PluginsService(
        registry,
        configService,
        new PluginInvoker(registry, stubPluginLog().log),
        lifecycleManager,
        new PluginOAuthStateStore(),
        accessControl,
        stubPluginLog().log,
    );

    return { service, accessControl, requireSpy, canAccessSpy, listVisibleIdsSpy, configService, lifecycleManager, registry };
}

/** Asserts the rejection is a 403 `HttpError`. */
async function expectForbidden(promise: Promise<unknown>): Promise<void> {
    await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.statusCode === 403);
}

/** Asserts the rejection is an `HttpError` with the given status code. */
async function expectHttpStatus(promise: Promise<unknown>, statusCode: number): Promise<void> {
    await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.statusCode === statusCode);
}

describe('PluginsService authorization: admin', () => {
    // Guard that this run did not change admin behaviour: `plugin:view` was
    // dropped from `listener`, not from `admin`, and admin still covers
    // every plugin operation via its `*:*` role pattern.
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

describe('PluginsService authorization: listener, no plugin tuples', () => {
    // Coverage for removing `plugin:view` from the `listener` role: a
    // listener with no per-plugin tuple now sees nothing and is denied
    // everywhere, the same as any other roleless user.
    it('sees no plugins and is denied on every operation', async () => {
        const { service } = makeService(userActor('u-listener', ['listener']));

        await expect(service.listPlugins({})).resolves.toEqual([]);
        await expectForbidden(service.getPlugin(SPOTIFY_ID));
        await expectForbidden(service.updatePluginConfig(SPOTIFY_ID, { config: {} }));
        await expectForbidden(service.enablePlugin(SPOTIFY_ID));
        await expectForbidden(service.disablePlugin(SPOTIFY_ID));
        await expectForbidden(service.testPlugin(SPOTIFY_ID));
        await expectForbidden(service.startOAuthAuthorization(SPOTIFY_ID));
    });
});

describe('PluginsService authorization: listener holding operator on one plugin', () => {
    // The scoped list that was unreachable over HTTP before this run: with
    // `plugin:view` gone from the role, `listVisibleIds` falls through to
    // the tuple walk exactly like a roleless user, even though this actor
    // also carries the `listener` role.
    it('sees exactly the granted plugin, can view it, and is denied on mutations', async () => {
        const fixture = new FakePermissionsFixture().grantOperator(SPOTIFY_ID, 'u-listener-op');
        const { service } = makeService(userActor('u-listener-op', ['listener']), fixture);

        const list = await service.listPlugins({});
        expect(list.map(p => p.id)).toEqual([SPOTIFY_ID]);

        await expect(service.getPlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expectForbidden(service.getPlugin(OTHER_ID));

        await expectForbidden(service.updatePluginConfig(SPOTIFY_ID, { config: {} }));
        await expectForbidden(service.enablePlugin(SPOTIFY_ID));
        await expectForbidden(service.startOAuthAuthorization(SPOTIFY_ID));
    });
});

describe('PluginsService authorization: roleless user with an owner grant', () => {
    // Proves the `owner` grant now decides rather than being inert: every
    // operation on the granted plugin resolves, and every one of them is
    // still denied on a plugin this actor holds no tuple for.
    it('sees exactly the granted plugin and passes every operation on it', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service } = makeService(userActor('u-owner', []), fixture);

        const list = await service.listPlugins({});
        expect(list.map(p => p.id)).toEqual([SPOTIFY_ID]);

        await expect(service.getPlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expect(service.updatePluginConfig(SPOTIFY_ID, { config: {} })).resolves.toBeDefined();
        await expect(service.enablePlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expect(service.disablePlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expect(service.testPlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expect(service.startOAuthAuthorization(SPOTIFY_ID)).resolves.toBeDefined();

        await expectForbidden(service.getPlugin(OTHER_ID));
        await expectForbidden(service.updatePluginConfig(OTHER_ID, { config: {} }));
        await expectForbidden(service.enablePlugin(OTHER_ID));
        await expectForbidden(service.disablePlugin(OTHER_ID));
        await expectForbidden(service.testPlugin(OTHER_ID));
        await expectForbidden(service.startOAuthAuthorization(OTHER_ID));
    });
});

describe('PluginsService authorization: roleless user with an operator grant', () => {
    // Together with the owner case above, this pins `view = owner |
    // operator` against `configure/enable/oauth = owner`: the list outcome
    // matches the owner case exactly, but every mutation is denied.
    it('sees exactly the granted plugin, can view it, and is denied on every mutation', async () => {
        const fixture = new FakePermissionsFixture().grantOperator(SPOTIFY_ID, 'u-operator');
        const { service } = makeService(userActor('u-operator', []), fixture);

        const list = await service.listPlugins({});
        expect(list.map(p => p.id)).toEqual([SPOTIFY_ID]);

        await expect(service.getPlugin(SPOTIFY_ID)).resolves.toBeDefined();
        await expectForbidden(service.updatePluginConfig(SPOTIFY_ID, { config: {} }));
        await expectForbidden(service.enablePlugin(SPOTIFY_ID));
        await expectForbidden(service.disablePlugin(SPOTIFY_ID));
        await expectForbidden(service.testPlugin(SPOTIFY_ID));
        await expectForbidden(service.startOAuthAuthorization(SPOTIFY_ID));

        await expectForbidden(service.getPlugin(OTHER_ID));
    });
});

describe('PluginsService authorization: roleless user, no tuples', () => {
    it('sees no plugins and is denied on getPlugin', async () => {
        const { service } = makeService(userActor('u-nobody', []));

        await expect(service.listPlugins({})).resolves.toEqual([]);
        await expectForbidden(service.getPlugin(SPOTIFY_ID));
    });
});

describe('PluginsService authorization: HTTP system actor', () => {
    // Regression guard: the OAuth callback is anonymous by design (the
    // provider redirects a browser here with no session of ours), so it must
    // never reach AccessControlService, regardless of whether the state
    // check inside it passes or fails.
    it('completes the OAuth callback without ever calling AccessControlService', async () => {
        const { service, requireSpy, canAccessSpy, listVisibleIdsSpy } = makeService(httpSystemActor);

        const result = await service.completeOAuthCallback(SPOTIFY_ID, { state: 'not-a-real-state' });

        expect(result.pluginId).toBe(SPOTIFY_ID);
        expect(result.ok).toBe(false);
        expect(requireSpy).not.toHaveBeenCalled();
        expect(canAccessSpy).not.toHaveBeenCalled();
        expect(listVisibleIdsSpy).not.toHaveBeenCalled();
    });

    // The new guard: an untrusted `system`/`http` actor reaching any other
    // plugin operation gets nothing, proving the untrusted-HTTP-actor rule
    // in `AccessControlService` reaches through the service.
    it('sees no plugins and is denied on getPlugin', async () => {
        const { service } = makeService(httpSystemActor);

        await expect(service.listPlugins({})).resolves.toEqual([]);
        await expectForbidden(service.getPlugin(SPOTIFY_ID));
    });
});

describe('PluginsService: oauthConnected on PluginDetail', () => {
    it('is true when the read model reports a connected vault, for a plugin that declares oauth', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service } = makeService(userActor('u-owner', []), fixture, { [SPOTIFY_ID]: { oauthConnected: true } });

        const detail = await service.getPlugin(SPOTIFY_ID);

        expect(detail.oauthConnected).toBe(true);
    });

    it('is false when the read model reports no connected vault, for a plugin that declares oauth', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service } = makeService(userActor('u-owner', []), fixture, { [SPOTIFY_ID]: { oauthConnected: false } });

        const detail = await service.getPlugin(SPOTIFY_ID);

        expect(detail.oauthConnected).toBe(false);
    });

    it('is absent for a plugin whose manifest does not declare the oauth capability', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(OTHER_ID, 'u-owner');
        const { service } = makeService(userActor('u-owner', []), fixture, { [OTHER_ID]: { oauthConnected: true } });

        const detail = await service.getPlugin(OTHER_ID);

        expect(detail).not.toHaveProperty('oauthConnected');
    });
});

/**
 * The manual replacement for the `plugin_configs` notify listener this run
 * removed: nothing watches the table any more, so an out-of-band edit is
 * applied by asking for it.
 */
describe('PluginsService: reloadPlugin', () => {
    it('reinitializes the plugin and returns its detail', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service, lifecycleManager, configService } = makeService(userActor('u-owner', []), fixture);

        const detail = await service.reloadPlugin(SPOTIFY_ID);

        expect(detail.id).toBe(SPOTIFY_ID);
        expect(lifecycleManager.reinitPlugin).toHaveBeenCalledExactlyOnceWith(SPOTIFY_ID);
        // A reload applies what is stored; it must never write anything itself.
        expect(configService.saveConfig).not.toHaveBeenCalled();
        expect(configService.setEnabled).not.toHaveBeenCalled();
    });

    it('is denied for an actor without the configure permission on the plugin', async () => {
        const fixture = new FakePermissionsFixture();
        const { service, lifecycleManager } = makeService(userActor('u-nobody', []), fixture);

        await expectForbidden(service.reloadPlugin(SPOTIFY_ID));

        expect(lifecycleManager.reinitPlugin).not.toHaveBeenCalled();
    });

    it('throws 404 for an id that is not installed', async () => {
        const fixture = new FakePermissionsFixture().grantOwner('ghost.plugin', 'u-owner');
        const { service, lifecycleManager } = makeService(userActor('u-owner', []), fixture);

        await expectHttpStatus(service.reloadPlugin('ghost.plugin'), 404);

        expect(lifecycleManager.reinitPlugin).not.toHaveBeenCalled();
    });
});

describe('PluginsService: disconnectOAuth', () => {
    it('clears the OAuth vault via saveConfig and reinitializes the plugin', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service, configService, lifecycleManager } = makeService(userActor('u-owner', []), fixture);

        const detail = await service.disconnectOAuth(SPOTIFY_ID);

        expect(detail).toBeDefined();
        expect(configService.saveConfig).toHaveBeenCalledWith(SPOTIFY_ID, [...manifest().configFields, OAUTH_SECRET_FIELD], {
            [PLUGIN_OAUTH_SECRET_KEY]: '',
        });
        expect(lifecycleManager.reinitPlugin).toHaveBeenCalledWith(SPOTIFY_ID);
    });

    it('is denied for an actor without the oauth permission on the plugin', async () => {
        const fixture = new FakePermissionsFixture().grantOperator(SPOTIFY_ID, 'u-operator');
        const { service, configService, lifecycleManager } = makeService(userActor('u-operator', []), fixture);

        await expectForbidden(service.disconnectOAuth(SPOTIFY_ID));

        expect(configService.saveConfig).not.toHaveBeenCalled();
        expect(lifecycleManager.reinitPlugin).not.toHaveBeenCalled();
    });

    it('throws 501 for a plugin whose manifest does not declare the oauth capability', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(OTHER_ID, 'u-owner');
        const { service, configService, lifecycleManager } = makeService(userActor('u-owner', []), fixture);

        await expectHttpStatus(service.disconnectOAuth(OTHER_ID), 501);

        expect(configService.saveConfig).not.toHaveBeenCalled();
        expect(lifecycleManager.reinitPlugin).not.toHaveBeenCalled();
    });

    // The behaviour this run added: disconnectOAuth checks the manifest
    // capability only, not requireOAuth(), so a plugin that declares oauth
    // but has no live instance (stopped or crashed) is still disconnectable
    // rather than 503ing.
    it('succeeds for a plugin that declares oauth but has no live instance (stopped)', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service, configService, lifecycleManager, registry } = makeService(userActor('u-owner', []), fixture);
        registry.upsert(record(SPOTIFY_ID, { status: 'discovered', instance: undefined }));

        const detail = await service.disconnectOAuth(SPOTIFY_ID);

        expect(detail).toBeDefined();
        expect(configService.saveConfig).toHaveBeenCalledWith(SPOTIFY_ID, [...manifest().configFields, OAUTH_SECRET_FIELD], {
            [PLUGIN_OAUTH_SECRET_KEY]: '',
        });
        expect(lifecycleManager.reinitPlugin).toHaveBeenCalledWith(SPOTIFY_ID);
    });

    it('succeeds for a plugin that declares oauth but has no live instance (crashed, with an error reason)', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service, configService, lifecycleManager, registry } = makeService(userActor('u-owner', []), fixture);
        registry.upsert(record(SPOTIFY_ID, { status: 'misconfigured', instance: undefined, error: 'boom' }));

        await expect(service.disconnectOAuth(SPOTIFY_ID)).resolves.toBeDefined();
        expect(configService.saveConfig).toHaveBeenCalledTimes(1);
    });
});

/**
 * The plugin has already passed every host-side gate by the time its own code
 * runs, so anything that goes wrong from here is the plugin's failure, not the
 * request's. Before `PluginError` these all rendered as a 500 with a sentence,
 * which told the console nothing it could act on.
 */
describe('PluginsService: startOAuthAuthorization translates a plugin failure', () => {
    const failing = (error: unknown): PluginRecord =>
        record(SPOTIFY_ID, {
            instance: {
                getAuthorizeUrl: vi.fn(async () => {
                    throw error;
                }),
                handleCallback: vi.fn(async () => {}),
            } as never,
        });

    const startFor = (error: unknown): Promise<unknown> => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service, registry } = makeService(userActor('u-owner', []), fixture);
        registry.upsert(failing(error));
        return service.startOAuthAuthorization(SPOTIFY_ID);
    };

    it('answers 422 with the misconfigured code when the plugin has no client id', async () => {
        const promise = startFor(new PluginError('Spotify client ID is not configured').withCode('config'));

        await expectHttpStatus(promise, 422);
        await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.details?.code === ErrorCodes.PLUGIN_MISCONFIGURED);
    });

    it('answers 502 with the auth code when the plugin cannot authenticate', async () => {
        const promise = startFor(new PluginError('token expired').withCode('auth'));

        await expectHttpStatus(promise, 502);
        await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.details?.code === ErrorCodes.PLUGIN_AUTH_REQUIRED);
    });

    it('answers 429 with Retry-After when the provider is throttling', async () => {
        const promise = startFor(new PluginError('slow down').withCode('rate_limited').withRetry(30_000));

        await expectHttpStatus(promise, 429);
        await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.headers?.['Retry-After'] === '30');
    });

    it('still answers 500 for a plugin that throws a bare Error, so adopting PluginError is per-plugin', async () => {
        await expectHttpStatus(startFor(new Error('boom')), 500);
    });

    it('reports the plugin id in details, so a console showing several plugins knows which one failed', async () => {
        const promise = startFor(new PluginError('provider is down').withCode('unavailable'));

        await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.details?.plugin === SPOTIFY_ID);
    });
});
