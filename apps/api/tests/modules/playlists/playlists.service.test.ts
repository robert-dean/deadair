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
    findByBindings: ReturnType<typeof vi.fn>;
    logger: Logger;
}

/**
 * The catalog's answer about the copies a playlist holds.
 *
 * A row per external id the caller names, so the default harness reports every copy as one the
 * station already holds. The cases that care about the other two states — a copy nothing has
 * ingested, and a catalog that will not answer at all — override it.
 */
const catalogRows = (externalIds: readonly string[]) =>
    externalIds.map(externalId => ({
        externalId,
        trackId: `trk_${externalId}`,
        artistId: `art_${externalId}`,
        albumId: `alb_${externalId}`,
        year: 1999,
        albumName: 'A Record',
        albumImageUrl: null,
    }));

function makeService(actor: Actor, fixture: FakePermissionsFixture = new FakePermissionsFixture()): Harness {
    const registry = new PluginRegistry();
    const accessControl = new AccessControlService(new AuthorizationContext(actor), fixture.asPermissionsService());
    const listVisibleIdsSpy = vi.spyOn(accessControl, 'listVisibleIds');
    const logger = stubLogger();
    const findByBindings = vi.fn(async (_pluginId: string, externalIds: readonly string[]) => catalogRows(externalIds));

    const service = new PlaylistsService(
        registry,
        new PluginInvoker(registry, stubPluginLog().log),
        accessControl,
        { findByBindings } as never,
        logger,
    );

    return { service, registry, listVisibleIdsSpy, findByBindings, logger };
}

/** The service's own page size. A test that disagreed with it would prove nothing. */
const PAGE_SIZE = 50;

/**
 * A plugin method that serves `total` items in pages, honouring `offset`.
 *
 * `make` builds the item at an index, so the assertions can check ORDER across
 * pages rather than only the count: a walk that dropped or repeated a page
 * would still total correctly.
 */
function pagedBy<T>(total: number, make: (index: number) => T) {
    return vi.fn(async (options?: { limit?: number; offset?: number }) => {
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? total;
        return Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => make(offset + i));
    });
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

    it('pages each plugin to the end rather than taking its default page', async () => {
        const listPlaylists = pagedBy(75, index => ({ id: `p${index}`, name: `Playlist ${index}` }));
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { instance: catalogInstance({ listPlaylists }) as never }));

        const page = await service.listPlaylists();

        expect(page.playlists).toHaveLength(75);
        expect(page.playlists[74]!.id).toBe('p74');
        expect(listPlaylists.mock.calls.map(([options]) => options?.offset)).toEqual([0, PAGE_SIZE]);
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

        expect(result).toMatchObject({
            pluginId: SPOTIFY_ID,
            playlistId: 'p1',
            tracks: [
                { id: 't1', title: 'Track t1', artists: ['Artist'] },
                { id: 't2', title: 'Track t2', artists: ['Artist'] },
            ],
        });
    });

    // The PROVIDER's row, plus what the station already holds of the same copy. `id` stays the
    // provider's, because that is what an import names it by; `trackId` is the catalog's.
    it('names the catalog rows behind the copies it has ingested', async () => {
        const { service, registry, findByBindings } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID));

        const result = await service.getPlaylistTracks(SPOTIFY_ID, 'p1');

        // One query for the whole playlist, not one per row.
        expect(findByBindings).toHaveBeenCalledExactlyOnceWith(SPOTIFY_ID, ['t1', 't2']);
        expect(result.tracks[0]).toMatchObject({ id: 't1', trackId: 'trk_t1', artistId: 'art_t1', albumId: 'alb_t1' });
    });

    // A playlist lists what a PROVIDER holds, so a copy no sync has walked is the ordinary case
    // rather than an edge, and it must carry no ids at all rather than half of a link.
    it('says nothing about a copy the catalog has never seen', async () => {
        const { service, registry, findByBindings } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID));
        findByBindings.mockResolvedValue([]);

        const [first] = (await service.getPlaylistTracks(SPOTIFY_ID, 'p1')).tracks;

        expect(first).toMatchObject({ id: 't1', title: 'Track t1' });
        expect(first?.trackId).toBeUndefined();
        expect(first?.artistId).toBeUndefined();
        expect(first?.albumId).toBeUndefined();
    });

    // The ids are decoration and the listing is the job: a playlist that lists is worth more than a
    // playlist that links, so a database fault may not take the route down with it.
    it('still lists the playlist when the catalog cannot be read', async () => {
        const { service, registry, findByBindings, logger } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID));
        findByBindings.mockRejectedValue(new Error('the pool is gone'));

        const result = await service.getPlaylistTracks(SPOTIFY_ID, 'p1');

        expect(result.tracks.map(track => track.id)).toEqual(['t1', 't2']);
        expect(result.tracks[0]?.trackId).toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('passes the playlist id through to the plugin instance', async () => {
        const instance = catalogInstance();
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { instance: instance as never }));

        await service.getPlaylistTracks(SPOTIFY_ID, 'the-playlist-id');

        expect(instance.getPlaylistTracks).toHaveBeenCalledWith('the-playlist-id', { limit: PAGE_SIZE, offset: 0 });
    });

    // A provider asked for no `limit` answers with its own default page — 20 items
    // on Spotify's playlist reads — so a single call is the top of a playlist and
    // not the playlist. The director sources a running order through here, where
    // that reads as a short playlist rather than as a truncated one.
    it('pages to the end of the playlist rather than taking the provider default page', async () => {
        const pager = pagedBy(120, index => track(`t${index}`));
        const instance = catalogInstance({
            getPlaylistTracks: vi.fn(async (_id: string, options?: { limit?: number; offset?: number }) => pager(options)),
        });
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { instance: instance as never }));

        const result = await service.getPlaylistTracks(SPOTIFY_ID, 'p1');

        expect(result.tracks).toHaveLength(120);
        expect(result.tracks[0]!.id).toBe('t0');
        expect(result.tracks[119]!.id).toBe('t119');
        expect(pager.mock.calls.map(([options]) => options?.offset)).toEqual([0, PAGE_SIZE, PAGE_SIZE * 2]);
    });

    it('stops at the first short page, so a playlist smaller than one page costs one call', async () => {
        const instance = catalogInstance();
        const { service, registry } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { instance: instance as never }));

        await service.getPlaylistTracks(SPOTIFY_ID, 'p1');

        expect(instance.getPlaylistTracks).toHaveBeenCalledTimes(1);
    });

    // A provider that ignores `offset` serves a full page forever. The walk has to
    // end anyway, and it has to say so: a silently truncated playlist looks exactly
    // like a complete one.
    it('gives up at the page cap and warns, when the provider ignores offset', async () => {
        const instance = catalogInstance({
            getPlaylistTracks: vi.fn(async () => Array.from({ length: PAGE_SIZE }, (_, i) => track(`t${i}`))),
        });
        const { service, registry, logger } = makeService(userActor('u-admin', ['admin']));
        registry.upsert(record(SPOTIFY_ID, { instance: instance as never }));

        const result = await service.getPlaylistTracks(SPOTIFY_ID, 'p1');

        expect(instance.getPlaylistTracks).toHaveBeenCalledTimes(200);
        expect(result.tracks).toHaveLength(200 * PAGE_SIZE);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('page cap'), expect.objectContaining({ plugin: SPOTIFY_ID, cap: 200 }));
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
