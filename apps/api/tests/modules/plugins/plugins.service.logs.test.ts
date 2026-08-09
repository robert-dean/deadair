// Coverage for the three log routes `PluginsService` gained in package 08:
// `getPluginLogs`, `downloadPluginLogs`, `setPluginLogLevel`. Every one of
// them reuses the `configure` permission, deliberately not `view` (logs
// carry operational detail the view-only `operator` grant should not get),
// and `setPluginLogLevel` announces its persistence write before touching
// the in-memory gate. See `plugins.service.authorization.test.ts` for the
// harness this file's construction and stubbing style is drawn from.

import { describe, expect, it, vi } from 'vitest';
import { IsHttpError } from '@maroonedsoftware/errors';
import type { PluginManifest } from '@deadair/plugin-sdk';

import { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { AuthorizationContext, type Actor, type UserActor } from '../../../src/modules/permissions/authorization.context.js';
import type { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import { PluginConfigService, type PluginConfigReadModel } from '../../../src/modules/plugins/plugin.config.service.js';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginLifecycleManager } from '../../../src/modules/plugins/plugin.lifecycle.manager.js';
import { PluginLog } from '../../../src/modules/plugins/plugin.log.js';
import { PluginOAuthStateStore } from '../../../src/modules/plugins/plugin.oauth.state.store.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { PluginsService } from '../../../src/modules/plugins/plugins.service.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import type { PluginLogLevel } from '../../../src/modules/plugins/types/plugins.types.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const SPOTIFY_ID = 'deadair.spotify';

const userActor = (actorId: string, roles: ReadonlyArray<'admin' | 'listener'> = []): UserActor => ({
    kind: 'user',
    sessionToken: 'test-session',
    actorId,
    factors: [],
    platformRoles: new Set(roles),
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
    return { id, dir: `/plugins/${id}`, status: 'active', manifest: manifest({ id }), instance: {} as never, ...overrides };
}

/**
 * A tiny fixture-backed fake of the two `PermissionsService` methods
 * `AccessControlService` actually calls, mirroring
 * `plugins.service.authorization.test.ts`'s fixture but pared to what this
 * file needs: per-permission grants keyed by (namespace, id, permission,
 * userId).
 */
class FakePermissionsFixture {
    private readonly grants = new Set<string>();

    grant(namespace: string, id: string, permission: string, userId: string): this {
        this.grants.add(`${namespace}:${id}:${permission}:${userId}`);
        return this;
    }

    /** Grants only `view`, mirroring an `operator` tuple: `configure` is deliberately withheld. */
    grantOperator(pluginId: string, userId: string): this {
        return this.grant('plugin', pluginId, 'view', userId);
    }

    grantOwner(pluginId: string, userId: string): this {
        for (const permission of ['view', 'configure', 'enable', 'oauth']) {
            this.grant('plugin', pluginId, permission, userId);
        }
        return this;
    }

    asPermissionsService(): PermissionsService {
        return {
            checkSubject: vi.fn(async (object: { namespace: string; id: string }, permission: string, subject: { id: string }) =>
                this.grants.has(`${object.namespace}:${object.id}:${permission}:${subject.id}`),
            ),
            listObjects: vi.fn(async () => ({ ids: [], truncated: false })),
        } as unknown as PermissionsService;
    }
}

interface Harness {
    service: PluginsService;
    requireSpy: ReturnType<typeof vi.fn>;
    configService: PluginConfigService;
    pluginLog: PluginLog;
}

function makeService(actor: Actor, fixture: FakePermissionsFixture, readModel: Partial<PluginConfigReadModel> = {}): Harness {
    const registry = new PluginRegistry();
    registry.upsert(record(SPOTIFY_ID));

    const accessControl = new AccessControlService(new AuthorizationContext(actor), fixture.asPermissionsService());
    const requireSpy = vi.spyOn(accessControl, 'require');

    const configService = {
        getReadModel: vi.fn(async (pluginId: string) => ({
            pluginId,
            enabled: true,
            config: {},
            configured: {},
            oauthConnected: false,
            ...readModel,
        })),
        getConfig: vi.fn(async () => ({})),
        getSecrets: vi.fn(async () => ({})),
        saveConfig: vi.fn(async () => {}),
        setEnabled: vi.fn(async () => {}),
        setLogLevel: vi.fn(async () => {}),
    } as unknown as PluginConfigService;

    const lifecycleManager = {
        rescan: vi.fn(async () => {}),
        reinitPlugin: vi.fn(async () => {}),
    } as unknown as PluginLifecycleManager;

    const pluginLog = {
        for: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        setLevel: vi.fn(),
        levelOf: vi.fn(() => 'info'),
        tail: vi.fn(async () => []),
        readAll: vi.fn(async () => 'log body'),
    } as unknown as PluginLog;

    const service = new PluginsService(
        registry,
        configService,
        new PluginInvoker(registry, stubPluginLog().log),
        lifecycleManager,
        new PluginOAuthStateStore(),
        accessControl,
        pluginLog,
        new AfterCommit(),
    );

    return { service, requireSpy, configService, pluginLog };
}

/** Asserts the rejection is a 403 `HttpError`. */
async function expectForbidden(promise: Promise<unknown>): Promise<void> {
    await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.statusCode === 403);
}

describe('PluginsService: log routes require configure, not view', () => {
    it('getPluginLogs calls accessControl.require with configure and rejects an operator (view-only) grant', async () => {
        const fixture = new FakePermissionsFixture().grantOperator(SPOTIFY_ID, 'u-operator');
        const { service, requireSpy } = makeService(userActor('u-operator'), fixture);

        await expectForbidden(service.getPluginLogs(SPOTIFY_ID, {}));

        expect(requireSpy).toHaveBeenCalledWith({ namespace: 'plugin', id: SPOTIFY_ID }, 'configure');
        expect(requireSpy).not.toHaveBeenCalledWith({ namespace: 'plugin', id: SPOTIFY_ID }, 'view');
    });

    it('getPluginLogs succeeds for an owner grant', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service } = makeService(userActor('u-owner'), fixture);

        await expect(service.getPluginLogs(SPOTIFY_ID, {})).resolves.toBeDefined();
    });

    it('downloadPluginLogs calls accessControl.require with configure and rejects an operator (view-only) grant', async () => {
        const fixture = new FakePermissionsFixture().grantOperator(SPOTIFY_ID, 'u-operator');
        const { service, requireSpy } = makeService(userActor('u-operator'), fixture);

        await expectForbidden(service.downloadPluginLogs(SPOTIFY_ID));

        expect(requireSpy).toHaveBeenCalledWith({ namespace: 'plugin', id: SPOTIFY_ID }, 'configure');
        expect(requireSpy).not.toHaveBeenCalledWith({ namespace: 'plugin', id: SPOTIFY_ID }, 'view');
    });

    it('downloadPluginLogs succeeds for an owner grant', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service } = makeService(userActor('u-owner'), fixture);

        await expect(service.downloadPluginLogs(SPOTIFY_ID)).resolves.toBeDefined();
    });

    it('setPluginLogLevel calls accessControl.require with configure and rejects an operator (view-only) grant', async () => {
        const fixture = new FakePermissionsFixture().grantOperator(SPOTIFY_ID, 'u-operator');
        const { service, requireSpy, configService } = makeService(userActor('u-operator'), fixture);

        await expectForbidden(service.setPluginLogLevel(SPOTIFY_ID, { level: 'debug' }));

        expect(requireSpy).toHaveBeenCalledWith({ namespace: 'plugin', id: SPOTIFY_ID }, 'configure');
        expect(requireSpy).not.toHaveBeenCalledWith({ namespace: 'plugin', id: SPOTIFY_ID }, 'view');
        expect(configService.setLogLevel).not.toHaveBeenCalled();
    });

    it('setPluginLogLevel succeeds for an owner grant', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service } = makeService(userActor('u-owner'), fixture);

        await expect(service.setPluginLogLevel(SPOTIFY_ID, { level: 'debug' })).resolves.toBeDefined();
    });
});

describe('PluginsService: downloadPluginLogs Content-Disposition', () => {
    it('builds the filename from the sanitized id, so a header-breaking id cannot inject a header', async () => {
        const rawId = 'deadair"; evil="x\r\nX-Injected: yes';
        const fixture = new FakePermissionsFixture().grantOwner(rawId, 'u-owner');
        const registry = new PluginRegistry();
        registry.upsert(record(rawId, { manifest: manifest({ id: rawId }) }));

        const accessControl = new AccessControlService(new AuthorizationContext(userActor('u-owner')), fixture.asPermissionsService());
        const configService = {
            getReadModel: vi.fn(async () => ({ pluginId: rawId, enabled: true, config: {}, configured: {}, oauthConnected: false })),
            setLogLevel: vi.fn(async () => {}),
        } as unknown as PluginConfigService;
        const pluginLog = {
            levelOf: vi.fn(() => 'info'),
            readAll: vi.fn(async () => 'log body'),
        } as unknown as PluginLog;

        const service = new PluginsService(
            registry,
            configService,
            new PluginInvoker(registry, stubPluginLog().log),
            { rescan: vi.fn(), reinitPlugin: vi.fn() } as unknown as PluginLifecycleManager,
            new PluginOAuthStateStore(),
            accessControl,
            pluginLog,
            new AfterCommit(),
        );

        const result = await service.downloadPluginLogs(rawId);
        const header = result.headers.contentDisposition;
        const filenameValue = header.match(/^attachment; filename="(.+)\.log"$/)?.[1];

        expect(header).toMatch(/^attachment; filename=".+\.log"$/);
        expect(filenameValue).toBeDefined();
        expect(filenameValue).not.toContain('"');
        expect(filenameValue).not.toContain('\r');
        expect(filenameValue).not.toContain('\n');
        // The raw id's newline is what could have injected a second header;
        // sanitization rewrites it, so the header body is exactly one line.
        expect(header.split('\n')).toHaveLength(1);
    });
});

describe('PluginsService: setPluginLogLevel write ordering', () => {
    it('updates the in-memory level only after the persistence write resolves', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const calls: string[] = [];
        const { service, configService, pluginLog } = makeService(userActor('u-owner'), fixture);

        (configService.setLogLevel as ReturnType<typeof vi.fn>).mockImplementation(async () => {
            calls.push('setLogLevel');
        });
        (pluginLog.setLevel as ReturnType<typeof vi.fn>).mockImplementation(() => calls.push('pluginLog.setLevel'));

        await service.setPluginLogLevel(SPOTIFY_ID, { level: 'debug' });

        expect(calls).toEqual(['setLogLevel', 'pluginLog.setLevel']);
        expect(configService.setLogLevel).toHaveBeenCalledWith(SPOTIFY_ID, 'debug');
        expect(pluginLog.setLevel).toHaveBeenCalledWith(SPOTIFY_ID, 'debug');
    });

    it('returns a PluginDetail carrying the new logLevel', async () => {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const { service, pluginLog } = makeService(userActor('u-owner'), fixture);
        (pluginLog.levelOf as ReturnType<typeof vi.fn>).mockReturnValue('debug');

        const detail = await service.setPluginLogLevel(SPOTIFY_ID, { level: 'debug' });

        expect(detail.logLevel).toBe('debug');
    });
});

/** Minimum-severity ordering, mirroring `RotatingLogStore`'s own `LEVEL_ORDER`. */
const LEVEL_ORDER: Record<PluginLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Filters canned raw entries by `options.level` exactly the way
 * `RotatingLogStore.tail` does: an absent level returns everything
 * unfiltered. Reproducing that here is the point -- these tests exist to
 * catch `PluginsService` failing to resolve a default before calling
 * `tail`, and a fixture that filtered on its own would hide that bug.
 */
function filterRawEntries(
    rawEntries: ReadonlyArray<{ ts: string; level: string; text: string }>,
    options?: { limit?: number; level?: PluginLogLevel },
): Array<{ ts: string; level: string; text: string }> {
    const minSeverity = options?.level !== undefined ? LEVEL_ORDER[options.level] : undefined;
    const filtered =
        minSeverity === undefined
            ? [...rawEntries]
            : rawEntries.filter(entry => LEVEL_ORDER[entry.level.toLowerCase() as PluginLogLevel] >= minSeverity);
    return options?.limit !== undefined ? filtered.slice(-options.limit) : filtered;
}

describe('PluginsService: getPluginLogs default level filter', () => {
    const rawEntries = [
        { ts: '2026-08-04T00:00:00.000Z', level: 'DEBUG', text: 'debug line' },
        { ts: '2026-08-04T00:00:01.000Z', level: 'INFO', text: 'info line' },
        { ts: '2026-08-04T00:00:02.000Z', level: 'WARN', text: 'warn line' },
        { ts: '2026-08-04T00:00:03.000Z', level: 'ERROR', text: 'error line' },
    ];

    /**
     * Wires the harness's stub `pluginLog` to a real filtering `tail` over
     * `rawEntries` and a mutable current level, so `levelOf`/`setLevel`
     * behave like the real `PluginLog`'s in-memory map instead of the
     * fixture's static `'info'`.
     */
    function makeFilteringHarness(initialLevel: PluginLogLevel): Harness {
        const fixture = new FakePermissionsFixture().grantOwner(SPOTIFY_ID, 'u-owner');
        const harness = makeService(userActor('u-owner'), fixture);
        let currentLevel = initialLevel;

        (harness.pluginLog.levelOf as ReturnType<typeof vi.fn>).mockImplementation(() => currentLevel);
        (harness.pluginLog.setLevel as ReturnType<typeof vi.fn>).mockImplementation((_id: string, level: PluginLogLevel | undefined) => {
            currentLevel = level ?? initialLevel;
        });
        (harness.pluginLog.tail as ReturnType<typeof vi.fn>).mockImplementation(
            async (_id: string, options?: { limit?: number; level?: PluginLogLevel }) => filterRawEntries(rawEntries, options),
        );

        return harness;
    }

    it('with no level in the query, returns only entries at or above the current level', async () => {
        const { service } = makeFilteringHarness('warn');

        const page = await service.getPluginLogs(SPOTIFY_ID, {});

        expect(page.entries.map(entry => entry.text)).toEqual(['warn line', 'error line']);
        expect(page.level).toBe('warn');
    });

    it('an explicit level stricter than the current one overrides the default', async () => {
        const { service } = makeFilteringHarness('debug');

        const page = await service.getPluginLogs(SPOTIFY_ID, { level: 'error' });

        expect(page.entries.map(entry => entry.text)).toEqual(['error line']);
        expect(page.level).toBe('error');
    });

    it('an explicit level=debug overrides a stricter current level to see everything retained', async () => {
        const { service } = makeFilteringHarness('error');

        const page = await service.getPluginLogs(SPOTIFY_ID, { level: 'debug' });

        expect(page.entries.map(entry => entry.text)).toEqual(['debug line', 'info line', 'warn line', 'error line']);
        expect(page.level).toBe('debug');
    });

    it('the returned level field always matches the filter actually applied, in both branches', async () => {
        const { service, pluginLog } = makeFilteringHarness('info');

        const withoutQuery = await service.getPluginLogs(SPOTIFY_ID, {});
        expect(withoutQuery.level).toBe('info');
        expect(pluginLog.tail).toHaveBeenLastCalledWith(SPOTIFY_ID, { limit: undefined, level: 'info' });

        const withQuery = await service.getPluginLogs(SPOTIFY_ID, { level: 'warn' });
        expect(withQuery.level).toBe('warn');
        expect(pluginLog.tail).toHaveBeenLastCalledWith(SPOTIFY_ID, { limit: undefined, level: 'warn' });
    });

    it('regression: a level lowered to debug and then raised to error no longer returns the old debug lines by default', async () => {
        const { service, pluginLog } = makeFilteringHarness('info');

        pluginLog.setLevel(SPOTIFY_ID, 'debug');
        // Debug-severity lines retained on disk from while the gate was open.
        pluginLog.setLevel(SPOTIFY_ID, 'error');

        const page = await service.getPluginLogs(SPOTIFY_ID, {});

        expect(page.level).toBe('error');
        expect(page.entries.some(entry => entry.level === 'debug')).toBe(false);
        expect(page.entries.map(entry => entry.text)).toEqual(['error line']);
    });
});
