// `CatalogSyncService` is the walk: which plugins it will talk to, how it pages
// them, and — the part with teeth — when it is and is not entitled to mark a
// plugin's bindings missing. A sweep run against a partial walk turns one failed
// HTTP page into a catalog-wide outage, so most of what follows is about the
// conditions under which the sweep must NOT happen.
//
// The resolver is faked at its own interface: its SQL is covered against a real
// database, and re-implementing resolution here would only test the fake.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { PluginManifest, ProviderPlaylist, ProviderTrack } from '@deadair/plugin-sdk';
import { PluginError } from '@deadair/plugin-sdk';

import { CatalogSyncService } from '../../../../src/modules/catalog/ingest/catalog.sync.service.js';
import type { CatalogResolverService, IngestResult } from '../../../../src/modules/catalog/ingest/catalog.resolver.service.js';
import type { JobBroker } from '@maroonedsoftware/jobbroker';
import { PluginInvoker } from '../../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../../utils/plugin.log.fixture.js';

const SPOTIFY_ID = 'deadair.spotify';
const OTHER_ID = 'deadair.other';
const PAGE_SIZE = 50;

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id: SPOTIFY_ID,
        name: 'Spotify',
        version: '1.0.0',
        kind: 'music-provider',
        capabilities: ['catalog'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

const track = (id: string, overrides: Partial<ProviderTrack> = {}): ProviderTrack => ({
    id,
    title: `Track ${id}`,
    artists: ['Artist'],
    ...overrides,
});

const playlist = (id: string, overrides: Partial<ProviderPlaylist> = {}): ProviderPlaylist => ({ id, name: `Playlist ${id}`, ...overrides });

/**
 * A provider whose two catalog methods serve fixed pages. Records every
 * (method, offset) asked for, so pagination can be asserted on the calls rather
 * than inferred from the results.
 */
function fakeProvider(config: { playlists?: ProviderPlaylist[]; tracks?: Record<string, ProviderTrack[]>; failOn?: 'playlists' | 'tracks' } = {}) {
    const playlists = config.playlists ?? [playlist('p1')];
    const tracks = config.tracks ?? { p1: [track('t1')] };
    const calls: string[] = [];

    const page = <T>(items: T[], offset = 0): T[] => items.slice(offset, offset + PAGE_SIZE);

    return {
        calls,
        instance: {
            listPlaylists: vi.fn(async (options?: { offset?: number }) => {
                calls.push(`listPlaylists:${options?.offset ?? 0}`);
                if (config.failOn === 'playlists') throw new PluginError('upstream is down').withCode('unavailable');
                return page(playlists, options?.offset);
            }),
            getPlaylistTracks: vi.fn(async (playlistId: string, options?: { offset?: number }) => {
                calls.push(`getPlaylistTracks:${playlistId}:${options?.offset ?? 0}`);
                if (config.failOn === 'tracks') throw new PluginError('upstream is down').withCode('unavailable');
                return page(tracks[playlistId] ?? [], options?.offset);
            }),
        },
    };
}

function record(id: string, overrides: Partial<PluginRecord> = {}): PluginRecord {
    return {
        id,
        dir: `/plugins/${id}`,
        status: 'active',
        manifest: manifest({ id }),
        instance: fakeProvider().instance as never,
        ...overrides,
    };
}

/** Records what ingest was asked to do, and lets a test dictate the answers. */
function fakeResolver(results: (track: ProviderTrack) => IngestResult = () => ({ status: 'ingested', trackId: 'track-1', created: true })) {
    const ingested: string[] = [];
    const swept: { pluginId: string; seen: string[] }[] = [];
    return {
        ingested,
        swept,
        resolver: {
            ingestTrack: vi.fn(async (_pluginId: string, providerTrack: ProviderTrack) => {
                ingested.push(providerTrack.id);
                return results(providerTrack);
            }),
            markMissing: vi.fn(async (pluginId: string, seen: readonly string[]) => {
                swept.push({ pluginId, seen: [...seen] });
                return seen.length;
            }),
        } as unknown as CatalogResolverService,
    };
}

/** Records what the sync asked to enqueue, and can be told to refuse. */
function fakeJobBroker(options: { failing?: boolean } = {}) {
    const sent: { name: string; payload: object }[] = [];
    return {
        sent,
        broker: {
            send: vi.fn(async (name: string, payload: object) => {
                if (options.failing) throw new Error('the queue is unreachable');
                sent.push({ name, payload });
                return 'job-1';
            }),
        } as unknown as JobBroker,
    };
}

function build(records: PluginRecord[], resolver: CatalogResolverService, broker: JobBroker = fakeJobBroker().broker) {
    const registry = new PluginRegistry();
    registry.setAll(records);
    const invoker = new PluginInvoker(registry, stubPluginLog().log);
    const logger = stubLogger();
    return { service: new CatalogSyncService(registry, invoker, resolver, broker, logger), registry, logger };
}

describe('CatalogSyncService.syncAll', () => {
    describe('which plugins it will talk to', () => {
        it('walks an active, catalog-capable plugin', async () => {
            const { resolver, ingested } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID)], resolver);

            const summaries = await service.syncAll();

            expect(summaries).toHaveLength(1);
            expect(summaries[0]).toMatchObject({ pluginId: SPOTIFY_ID, playlists: 1, items: 1, bound: 1, created: 1 });
            expect(ingested).toEqual(['t1']);
        });

        it('skips a plugin that is installed but not running', async () => {
            // Status is part of the question: a disabled or quarantined plugin
            // has no instance to call, and asking anyway is a TypeError.
            const { resolver, ingested } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { status: 'disabled', instance: undefined })], resolver);

            await expect(service.syncAll()).resolves.toEqual([]);
            expect(ingested).toEqual([]);
        });

        it('skips a plugin whose manifest does not declare the catalog capability', async () => {
            const { resolver, ingested } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { manifest: manifest({ capabilities: ['playout'] }) })], resolver);

            await expect(service.syncAll()).resolves.toEqual([]);
            expect(ingested).toEqual([]);
        });

        it('skips a plugin that declares a catalog but did not implement all of it', async () => {
            // The manifest is a promise, not evidence.
            const { resolver, ingested } = fakeResolver();
            const instance = { listPlaylists: vi.fn() } as never;
            const { service } = build([record(SPOTIFY_ID, { instance })], resolver);

            await expect(service.syncAll()).resolves.toEqual([]);
            expect(ingested).toEqual([]);
        });

        it('narrows to one plugin when the payload names one', async () => {
            const { resolver } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID), record(OTHER_ID)], resolver);

            const summaries = await service.syncAll(OTHER_ID);

            expect(summaries.map(s => s.pluginId)).toEqual([OTHER_ID]);
        });

        it('returns nothing rather than throwing when the named plugin is not installed', async () => {
            const { resolver } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID)], resolver);

            await expect(service.syncAll('deadair.nonexistent')).resolves.toEqual([]);
        });

        it('returns nothing when no plugins are active yet', async () => {
            // The routine case on an early run: the job runner starts before
            // PluginsModule.ready has initialized anything.
            const { resolver } = fakeResolver();
            const { service } = build([], resolver);

            await expect(service.syncAll()).resolves.toEqual([]);
        });
    });

    describe('paging', () => {
        it('keeps asking until a short page comes back', async () => {
            const playlists = [playlist('p1')];
            const tracks = { p1: Array.from({ length: PAGE_SIZE + 3 }, (_, i) => track(`t${i}`)) };
            const provider = fakeProvider({ playlists, tracks });
            const { resolver, ingested } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { instance: provider.instance as never })], resolver);

            const summaries = await service.syncAll();

            expect(provider.calls).toContain('getPlaylistTracks:p1:0');
            expect(provider.calls).toContain(`getPlaylistTracks:p1:${PAGE_SIZE}`);
            expect(ingested).toHaveLength(PAGE_SIZE + 3);
            expect(summaries[0]!.items).toBe(PAGE_SIZE + 3);
        });

        it('stops after one page when the first page is already short', async () => {
            const provider = fakeProvider();
            const { resolver } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { instance: provider.instance as never })], resolver);

            await service.syncAll();

            expect(provider.calls).toEqual(['listPlaylists:0', 'getPlaylistTracks:p1:0']);
        });

        it('ingests one track once even when it appears in several playlists', async () => {
            // A shared track is three provider items and one recording; ingesting
            // it three times is three transactions to reach the same row.
            const provider = fakeProvider({
                playlists: [playlist('p1'), playlist('p2')],
                tracks: { p1: [track('t1'), track('t2')], p2: [track('t1')] },
            });
            const { resolver, ingested } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { instance: provider.instance as never })], resolver);

            const summaries = await service.syncAll();

            expect(ingested).toEqual(['t1', 't2']);
            expect(summaries[0]).toMatchObject({ items: 3, bound: 2 });
        });
    });

    describe('playlists it will not read', () => {
        it('does not ask for tracks when the provider says the account may not read them', async () => {
            const provider = fakeProvider({ playlists: [playlist('p1', { permissions: ['edit'] })], tracks: { p1: [track('t1')] } });
            const { resolver, ingested } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { instance: provider.instance as never })], resolver);

            await service.syncAll();

            expect(provider.calls).toEqual(['listPlaylists:0']);
            expect(ingested).toEqual([]);
        });

        it('reads a playlist whose provider reported no permissions at all', async () => {
            // Absent means "did not say", which most providers do not. Treating
            // it as a refusal would skip every playlist on all of them.
            const provider = fakeProvider({ playlists: [playlist('p1', { permissions: undefined })], tracks: { p1: [track('t1')] } });
            const { resolver, ingested } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { instance: provider.instance as never })], resolver);

            await service.syncAll();

            expect(ingested).toEqual(['t1']);
        });

        it('skips a playlist the provider was asked about and permits nothing on', async () => {
            const provider = fakeProvider({ playlists: [playlist('p1', { permissions: [] })], tracks: { p1: [track('t1')] } });
            const { resolver, ingested } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { instance: provider.instance as never })], resolver);

            await service.syncAll();

            expect(ingested).toEqual([]);
        });
    });

    describe('the missing sweep', () => {
        it('sweeps with everything it saw after a clean walk', async () => {
            const provider = fakeProvider({ playlists: [playlist('p1')], tracks: { p1: [track('t1'), track('t2')] } });
            const { resolver, swept } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { instance: provider.instance as never })], resolver);

            const summaries = await service.syncAll();

            expect(swept).toEqual([{ pluginId: SPOTIFY_ID, seen: ['t1', 't2'] }]);
            expect(summaries[0]!.swept).toBe(2);
        });

        it('does not sweep a plugin whose walk threw', async () => {
            // The walk saw an unknown fraction of the library; sweeping would
            // mark the rest missing on the strength of one failed request.
            const provider = fakeProvider({ failOn: 'tracks' });
            const { resolver, swept } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { instance: provider.instance as never })], resolver);

            const summaries = await service.syncAll();

            expect(swept).toEqual([]);
            expect(summaries[0]!.swept).toBeUndefined();
            expect(summaries[0]!.error).toContain('upstream is down');
        });

        it('does not sweep when the walk was cancelled', async () => {
            const controller = new AbortController();
            const provider = fakeProvider({ playlists: [playlist('p1')], tracks: { p1: [track('t1')] } });
            provider.instance.listPlaylists.mockImplementation(async () => {
                controller.abort();
                return [playlist('p1')];
            });
            const { resolver, swept } = fakeResolver();
            const { service } = build([record(SPOTIFY_ID, { instance: provider.instance as never })], resolver);

            const summaries = await service.syncAll(undefined, controller.signal);

            expect(swept).toEqual([]);
            expect(summaries[0]!.error).toBe('cancelled');
        });

        it('sweeps each plugin with only its own ids', async () => {
            const spotify = fakeProvider({ playlists: [playlist('p1')], tracks: { p1: [track('spotify-1')] } });
            const other = fakeProvider({ playlists: [playlist('p9')], tracks: { p9: [track('other-1')] } });
            const { resolver, swept } = fakeResolver();
            const { service } = build(
                [record(SPOTIFY_ID, { instance: spotify.instance as never }), record(OTHER_ID, { instance: other.instance as never })],
                resolver,
            );

            await service.syncAll();

            expect(swept).toEqual([
                { pluginId: SPOTIFY_ID, seen: ['spotify-1'] },
                { pluginId: OTHER_ID, seen: ['other-1'] },
            ]);
        });
    });

    describe('failure and cancellation', () => {
        it('reports a failed plugin and keeps walking the next one', async () => {
            const broken = fakeProvider({ failOn: 'playlists' });
            const working = fakeProvider({ playlists: [playlist('p9')], tracks: { p9: [track('t9')] } });
            const { resolver, ingested } = fakeResolver();
            const { service } = build(
                [record(SPOTIFY_ID, { instance: broken.instance as never }), record(OTHER_ID, { instance: working.instance as never })],
                resolver,
            );

            const summaries = await service.syncAll();

            expect(summaries[0]).toMatchObject({ pluginId: SPOTIFY_ID, error: expect.stringContaining('upstream is down') });
            expect(summaries[1]).toMatchObject({ pluginId: OTHER_ID, bound: 1 });
            expect(ingested).toEqual(['t9']);
        });

        it('stops before the next plugin once cancelled', async () => {
            const controller = new AbortController();
            const first = fakeProvider({ playlists: [playlist('p1')], tracks: { p1: [track('t1')] } });
            const second = fakeProvider();
            first.instance.getPlaylistTracks.mockImplementation(async () => {
                controller.abort();
                return [track('t1')];
            });
            const { resolver } = fakeResolver();
            const { service } = build(
                [record(SPOTIFY_ID, { instance: first.instance as never }), record(OTHER_ID, { instance: second.instance as never })],
                resolver,
            );

            const summaries = await service.syncAll(undefined, controller.signal);

            expect(summaries.map(s => s.pluginId)).toEqual([SPOTIFY_ID]);
            expect(second.calls).toEqual([]);
        });

        it('counts an item that cannot become a catalog row without failing the walk', async () => {
            const provider = fakeProvider({ playlists: [playlist('p1')], tracks: { p1: [track('t1', { artists: [] }), track('t2')] } });
            const { resolver } = fakeResolver(providerTrack =>
                providerTrack.artists.length === 0
                    ? { status: 'skipped', reason: 'no-artist' }
                    : { status: 'ingested', trackId: 'x', created: false },
            );
            const { service } = build([record(SPOTIFY_ID, { instance: provider.instance as never })], resolver);

            const summaries = await service.syncAll();

            expect(summaries[0]).toMatchObject({ items: 2, bound: 1, created: 0, skipped: 1 });
        });
    });

    describe('handing off to the follow-up passes', () => {
        it('queues them when the run created canonical tracks', async () => {
            const { resolver } = fakeResolver(() => ({ status: 'ingested', trackId: 't', created: true }));
            const jobs = fakeJobBroker();
            const { service } = build([record(SPOTIFY_ID)], resolver, jobs.broker);

            await service.syncAll();

            // Both follow-ups have the same trigger: a track the library did not
            // have before is what gives either of them new work.
            expect(jobs.sent).toEqual([
                { name: 'catalog.resolve_placeholders', payload: {} },
                { name: 'catalog.enrich', payload: {} },
            ]);
        });

        it('does not queue it when everything was already in the library', async () => {
            // Placeholders can only start resolving when the library gains
            // something it did not have; re-reading the same rows to the same
            // conclusion is pure cost.
            const { resolver } = fakeResolver(() => ({ status: 'ingested', trackId: 't', created: false }));
            const jobs = fakeJobBroker();
            const { service } = build([record(SPOTIFY_ID)], resolver, jobs.broker);

            await service.syncAll();

            expect(jobs.sent).toEqual([]);
        });

        it('does not queue it when there were no plugins to walk', async () => {
            const { resolver } = fakeResolver();
            const jobs = fakeJobBroker();
            const { service } = build([], resolver, jobs.broker);

            await service.syncAll();

            expect(jobs.sent).toEqual([]);
        });

        it('queues them on the strength of one plugin even if another failed', async () => {
            const broken = fakeProvider({ failOn: 'playlists' });
            const working = fakeProvider({ playlists: [playlist('p9')], tracks: { p9: [track('t9')] } });
            const { resolver } = fakeResolver();
            const jobs = fakeJobBroker();
            const { service } = build(
                [record(SPOTIFY_ID, { instance: broken.instance as never }), record(OTHER_ID, { instance: working.instance as never })],
                resolver,
                jobs.broker,
            );

            await service.syncAll();

            expect(jobs.sent.map(sent => sent.name)).toEqual(['catalog.resolve_placeholders', 'catalog.enrich']);
        });

        it('reports a sync that succeeded even when the enqueue failed', async () => {
            // The sync's own work is committed and correct; failing it over a
            // hint that the next run will send again would be a worse answer.
            const { resolver } = fakeResolver();
            const jobs = fakeJobBroker({ failing: true });
            const { service, logger } = build([record(SPOTIFY_ID)], resolver, jobs.broker);

            const summaries = await service.syncAll();

            expect(summaries[0]).toMatchObject({ created: 1 });
            expect(summaries[0]!.error).toBeUndefined();
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('placeholder pass'), expect.objectContaining({ created: 1 }));
        });
    });

    it('never writes anything about the playlists it walked', async () => {
        // deadair.playlists is for playlists deadair owns; a provider's own are
        // read live and pass through. The resolver has no playlist surface at
        // all, so this asserts the only thing that could regress: that the walk
        // asks for nothing beyond track ingest and the sweep.
        const { resolver } = fakeResolver();
        const { service } = build([record(SPOTIFY_ID)], resolver);

        await service.syncAll();

        expect(Object.keys(resolver)).toEqual(['ingestTrack', 'markMissing']);
    });
});
