// Service-level unit tests for `PlaylistsService`: the read-only, no-database
// aggregation of every active catalog-capable plugin's playlists, and the
// on-demand fetch of one plugin's playlist tracks. Both routes sit behind
// `requirePolicy({ policy: false })` (see `playlists.router.ts`), which is an
// authentication floor only; each entry point narrows to `plugin:view` itself
// — `listPlaylists` by filtering with `listVisibleIds`, `getPlaylistTracks` by
// calling `require` per object.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { IsHttpError } from '@maroonedsoftware/errors';
import { PluginError, type PluginManifest } from '@deadair/plugin-sdk';

import { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { AuthorizationContext, type Actor, type UserActor } from '../../../src/modules/permissions/authorization.context.js';
import type { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { PlaylistsService } from '../../../src/modules/playlists/playlists.service.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const SPOTIFY_ID = 'deadair.spotify';
const OTHER_ID = 'deadair.other';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

const userActor = (actorId: string, roles: ReadonlyArray<'admin' | 'listener'> = []): UserActor => ({
    kind: 'user',
    sessionToken: 'test-session',
    actorId,
    factors: [],
    platformRoles: new Set(roles),
});

const httpSystemActor: Actor = { kind: 'system', sessionToken: '', source: 'http' };

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

const track = (id: string) => ({ id, title: `Track ${id}`, artists: ['Artist'] });

function catalogInstance(overrides: Partial<Record<'listPlaylists' | 'getPlaylistTracks', unknown>> = {}) {
    return {
        listPlaylists: vi.fn(async () => [{ id: 'p1', name: 'Playlist 1', trackCount: 3 }]),
        getPlaylistTracks: vi.fn(async () => [track('t1'), track('t2')]),
        ...overrides,
    };
}

function record(id: string, overrides: Partial<PluginRecord> = {}): PluginRecord {
    return { id, dir: `/plugins/${id}`, status: 'active', manifest: manifest({ id }), instance: catalogInstance() as never, ...overrides };
}

/**
 * A tiny fixture-backed fake of the two `PermissionsService` methods
 * `AccessControlService` actually calls, matching the plugins-module test's
 * fixture shape.
 */
class FakePermissionsFixture {
    private readonly visibility = new Map<string, string[]>();
    private readonly grants = new Set<string>();

    setVisible(namespace: string, permission: string, userId: string, ids: string[]): this {
        this.visibility.set(`${namespace}:${permission}:${userId}`, ids);
        return this;
    }

    /**
     * Encodes the resolved result of a `plugin:<id>#operator@user:<userId>`
     * tuple: the actor passes a `view` check on that plugin and it appears in
     * their `view` visibility set. Both directions have to move together, or a
     * fixture would let a plugin be listable but not readable.
     */
    grantView(pluginId: string, userId: string): this {
        this.grants.add(`plugin:${pluginId}:view:${userId}`);
        const key = `plugin:view:${userId}`;
        this.visibility.set(key, [...(this.visibility.get(key) ?? []), pluginId]);
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
    service: PlaylistsService;
    registry: PluginRegistry;
    listVisibleIdsSpy: ReturnType<typeof vi.fn>;
}

function makeService(actor: Actor, fixture: FakePermissionsFixture = new FakePermissionsFixture()): Harness {
    const registry = new PluginRegistry();
    const accessControl = new AccessControlService(new AuthorizationContext(actor), fixture.asPermissionsService());
    const listVisibleIdsSpy = vi.spyOn(accessControl, 'listVisibleIds');

    const service = new PlaylistsService(registry, new PluginInvoker(registry, stubPluginLog().log), accessControl, stubLogger());

    return { service, registry, listVisibleIdsSpy };
}

/** Asserts the rejection is an `HttpError` with the given status code. */
async function expectHttpStatus(promise: Promise<unknown>, statusCode: number): Promise<void> {
    await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.statusCode === statusCode);
}

describe('PlaylistsService.listPlaylists', () => {
    it('aggregates playlists from every active catalog-capable plugin, tagged with plugin id/name', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID));
        registry.upsert(record(OTHER_ID, { manifest: manifest({ id: OTHER_ID, name: 'Other' }) }));

        const page = await service.listPlaylists();

        expect(page.errors).toEqual([]);
        expect(page.playlists).toHaveLength(2);
        expect(page.playlists).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ pluginId: SPOTIFY_ID, pluginName: 'Spotify', id: 'p1', name: 'Playlist 1', trackCount: 3 }),
                expect.objectContaining({ pluginId: OTHER_ID, pluginName: 'Other', id: 'p1', name: 'Playlist 1', trackCount: 3 }),
            ]),
        );
    });

    it('excludes a plugin that is installed but not active', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { status: 'discovered', instance: undefined }));

        const page = await service.listPlaylists();

        expect(page.playlists).toEqual([]);
        expect(page.errors).toEqual([]);
    });

    it('excludes a plugin whose manifest does not declare the catalog capability', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { manifest: manifest({ capabilities: [] }) }));

        const page = await service.listPlaylists();

        expect(page.playlists).toEqual([]);
        expect(page.errors).toEqual([]);
    });

    it('reports a plugin that declares catalog but does not implement every catalog method', async () => {
        // Not called (that would be a TypeError mid-request) but not silent either: a
        // manifest promising something the code does not have is its author's bug, and
        // the operator needs to see which plugin to blame rather than an empty page.
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { instance: catalogInstance({ getPlaylistTracks: undefined }) as never }));

        const page = await service.listPlaylists();

        expect(page.playlists).toEqual([]);
        expect(page.errors).toEqual([{ pluginId: SPOTIFY_ID, pluginName: 'Spotify', message: expect.stringContaining('does not implement one') }]);
    });

    it('reports a quarantined catalog plugin, with the reason and the way out', async () => {
        // The case that made this exist: a plugin whose upstream was unreachable tripped
        // the invoker's breaker, and the page then showed an empty list whose only
        // explanation was advice to enable a plugin that was already enabled.
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { status: 'failed', instance: undefined, error: 'fetch to accounts.spotify.com failed' }));

        const page = await service.listPlaylists();

        expect(page.playlists).toEqual([]);
        expect(page.errors).toHaveLength(1);
        expect(page.errors[0]?.pluginName).toBe('Spotify');
        expect(page.errors[0]?.message).toContain('quarantined');
        expect(page.errors[0]?.message).toContain('fetch to accounts.spotify.com failed');
        expect(page.errors[0]?.message).toContain('Reload the plugin');
    });

    it('reports a misconfigured catalog plugin', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { status: 'misconfigured', instance: undefined, error: 'clientId is required' }));

        const page = await service.listPlaylists();

        expect(page.errors[0]?.message).toContain('configuration is not valid');
        expect(page.errors[0]?.message).toContain('clientId is required');
    });

    it('stays silent about a plugin the operator has not enabled', async () => {
        // `discovered` and `disabled` are choices, not faults. Reporting them would put a
        // permanent warning on the page for a station deliberately running one source.
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { status: 'disabled', instance: undefined }));
        registry.upsert(record(OTHER_ID, { status: 'discovered', instance: undefined, manifest: manifest({ id: OTHER_ID, name: 'Other' }) }));

        const page = await service.listPlaylists();

        expect(page.errors).toEqual([]);
    });

    it('says nothing about a failed plugin whose manifest never loaded', async () => {
        // With no manifest there is no way to know it was ever a catalog, and blaming
        // this page for an enrichment plugin's failure is worse than silence. The
        // plugins page is where a manifest-less failure belongs.
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert({ id: SPOTIFY_ID, dir: '/plugins/x', status: 'failed', error: 'manifest did not validate' });

        const page = await service.listPlaylists();

        expect(page.errors).toEqual([]);
    });

    it('does not report a plugin the actor cannot see', async () => {
        // The error list must not become a way to discover what is installed.
        const fixture = new FakePermissionsFixture();
        const { service, registry } = makeService(userActor('u-plain'), fixture);
        registry.upsert(record(SPOTIFY_ID, { status: 'failed', instance: undefined, error: 'boom' }));

        const page = await service.listPlaylists();

        expect(page.errors).toEqual([]);
    });

    it('collects one plugin failure as an error without dropping the others (Promise.allSettled)', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID));
        registry.upsert(
            record(OTHER_ID, {
                manifest: manifest({ id: OTHER_ID, name: 'Other' }),
                instance: catalogInstance({
                    listPlaylists: vi.fn(async () => {
                        throw new PluginError('provider is down').withCode('unavailable');
                    }),
                }) as never,
            }),
        );

        const page = await service.listPlaylists();

        expect(page.playlists).toHaveLength(1);
        expect(page.playlists[0]).toMatchObject({ pluginId: SPOTIFY_ID });
        expect(page.errors).toHaveLength(1);
        expect(page.errors[0]).toMatchObject({ pluginId: OTHER_ID, pluginName: 'Other' });
        expect(page.errors[0]!.message).toContain('provider is down');
    });

    it('filters to only the plugins visible to the actor when listVisibleIds does not report {all: true}', async () => {
        const fixture = new FakePermissionsFixture().setVisible('plugin', 'view', 'u-scoped', [SPOTIFY_ID]);
        const { service, registry } = makeService(userActor('u-scoped', []), fixture);
        registry.upsert(record(SPOTIFY_ID));
        registry.upsert(record(OTHER_ID, { manifest: manifest({ id: OTHER_ID, name: 'Other' }) }));

        const page = await service.listPlaylists();

        expect(page.playlists.map(p => p.pluginId)).toEqual([SPOTIFY_ID]);
    });

    it('returns nothing for an actor with no visible plugins', async () => {
        const { service, registry } = makeService(userActor('u-nobody', []));
        registry.upsert(record(SPOTIFY_ID));

        const page = await service.listPlaylists();

        expect(page.playlists).toEqual([]);
        expect(page.errors).toEqual([]);
    });

    it('never calls AccessControlService.require, matching the route floor of policy: false', async () => {
        const { service, registry, listVisibleIdsSpy } = makeService(httpSystemActor);
        registry.upsert(record(SPOTIFY_ID));

        await service.listPlaylists();

        expect(listVisibleIdsSpy).toHaveBeenCalledWith('plugin', 'view');
    });
});

describe('PlaylistsService.getPlaylistTracks', () => {
    it('returns the plugin id, playlist id, and mapped tracks', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID));

        const result = await service.getPlaylistTracks(SPOTIFY_ID, 'p1');

        expect(result).toEqual({
            pluginId: SPOTIFY_ID,
            playlistId: 'p1',
            tracks: [
                { id: 't1', title: 'Track t1', artists: ['Artist'] },
                { id: 't2', title: 'Track t2', artists: ['Artist'] },
            ],
        });
    });

    it('passes the playlist id through to the plugin instance', async () => {
        const instance = catalogInstance();
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { instance: instance as never }));

        await service.getPlaylistTracks(SPOTIFY_ID, 'the-playlist-id');

        expect(instance.getPlaylistTracks).toHaveBeenCalledWith('the-playlist-id');
    });

    it('throws 404 when the plugin is not installed', async () => {
        const { service } = makeService(userActor('u-admin', ['admin']));

        await expectHttpStatus(service.getPlaylistTracks('deadair.unknown', 'p1'), 404);
    });

    it('throws 501 when the manifest does not declare the catalog capability', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { manifest: manifest({ capabilities: [] }) }));

        await expectHttpStatus(service.getPlaylistTracks(SPOTIFY_ID, 'p1'), 501);
    });

    it('throws 501 when the manifest declares catalog but the instance does not implement every method', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { instance: catalogInstance({ getPlaylistTracks: undefined }) as never }));

        await expectHttpStatus(service.getPlaylistTracks(SPOTIFY_ID, 'p1'), 501);
    });

    it('throws 503 when the plugin is installed but not active', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { status: 'discovered', instance: undefined }));

        await expectHttpStatus(service.getPlaylistTracks(SPOTIFY_ID, 'p1'), 503);
    });

    it('throws 503 when the plugin is active by status but has no live instance (defensive)', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { instance: undefined }));

        await expectHttpStatus(service.getPlaylistTracks(SPOTIFY_ID, 'p1'), 503);
    });

    it('translates a thrown PluginError into its mapped HTTP status via pluginHttpError, propagating rather than collecting', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(
            record(SPOTIFY_ID, {
                instance: catalogInstance({
                    getPlaylistTracks: vi.fn(async () => {
                        throw new PluginError('slow down').withCode('rate_limited').withRetry(30_000);
                    }),
                }) as never,
            }),
        );

        const promise = service.getPlaylistTracks(SPOTIFY_ID, 'p1');

        await expectHttpStatus(promise, 429);
        await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.headers?.['Retry-After'] === '30');
    });

    it('still answers 500 for a plugin that throws a bare Error', async () => {
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(
            record(SPOTIFY_ID, {
                instance: catalogInstance({
                    getPlaylistTracks: vi.fn(async () => {
                        throw new Error('boom');
                    }),
                }) as never,
            }),
        );

        await expectHttpStatus(service.getPlaylistTracks(SPOTIFY_ID, 'p1'), 500);
    });

    it('throws 403 for an actor with no plugin grant, even though the route floor is policy: false', async () => {
        const { service, registry } = makeService(userActor('u-nobody', []));
        registry.upsert(record(SPOTIFY_ID));

        await expectHttpStatus(service.getPlaylistTracks(SPOTIFY_ID, 'p1'), 403);
    });

    it('resolves for a roleless actor holding a view grant on that plugin', async () => {
        const fixture = new FakePermissionsFixture().grantView(SPOTIFY_ID, 'u-operator');
        const { service, registry } = makeService(userActor('u-operator', []), fixture);
        registry.upsert(record(SPOTIFY_ID));

        await expect(service.getPlaylistTracks(SPOTIFY_ID, 'p1')).resolves.toMatchObject({ pluginId: SPOTIFY_ID });
    });

    it('throws 403 on a plugin the actor holds no grant for, while resolving the one it does', async () => {
        const fixture = new FakePermissionsFixture().grantView(SPOTIFY_ID, 'u-operator');
        const { service, registry } = makeService(userActor('u-operator', []), fixture);
        registry.upsert(record(SPOTIFY_ID));
        registry.upsert(record(OTHER_ID, { manifest: manifest({ id: OTHER_ID, name: 'Other' }) }));

        await expect(service.getPlaylistTracks(SPOTIFY_ID, 'p1')).resolves.toBeDefined();
        await expectHttpStatus(service.getPlaylistTracks(OTHER_ID, 'p1'), 403);
    });

    // The permission check runs before the registry lookup, so an ungranted
    // actor cannot tell an installed plugin from an absent one by the status
    // code: both answer 403 rather than 403-vs-404.
    it('answers 403 rather than 404 for an unknown plugin id, leaking no installed set', async () => {
        const { service } = makeService(userActor('u-nobody', []));

        await expectHttpStatus(service.getPlaylistTracks('deadair.unknown', 'p1'), 403);
    });

    it('throws 403 for an http-sourced system actor, the unauthenticated fallback shape', async () => {
        const { service, registry } = makeService(httpSystemActor);
        registry.upsert(record(SPOTIFY_ID));

        await expectHttpStatus(service.getPlaylistTracks(SPOTIFY_ID, 'p1'), 403);
    });
});
