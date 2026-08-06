// The fan-out: every active enrichment plugin asked about one track, in
// priority order, with a failing plugin recorded rather than thrown. No
// database and no HTTP here — `EnrichmentService` takes a `TrackRef` and
// returns what was learned, which is the same path the job and any future
// route drive.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type PluginManifest, type TrackRef } from '@deadair/plugin-sdk';

import {
    ENRICH_ALBUM_TIMEOUT_MS,
    ENRICH_ARTIST_TIMEOUT_MS,
    ENRICH_TRACK_TIMEOUT_MS,
    ENRICHMENT_MISS_TTL_MS,
    ENRICHMENT_TTL_MS,
    EnrichmentService,
    toTrackRef,
} from '../../../src/modules/enrichment/enrichment.service.js';
import type { EnrichableTrack, PendingTrack, TrackPromotion } from '../../../src/modules/enrichment/enrichment.repository.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const MUSICBRAINZ = 'deadair.musicbrainz';
const OTHER = 'deadair.other';

const ref: TrackRef = { artist: 'Portishead', title: 'Glory Box', album: 'Dummy' };

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        kind: 'enrichment',
        capabilities: ['enrichment'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

interface InstanceOptions {
    priority?: number;
    matchKeys?: string[];
    enrichTrack?: unknown;
    /** Absent means a plugin that never wrote the optional method, which is the normal case. */
    enrichArtist?: unknown;
    enrichAlbum?: unknown;
}

function instance(options: InstanceOptions = {}) {
    const built: Record<string, unknown> = {
        priority: options.priority ?? 100,
        matchKeys: options.matchKeys ?? ['isrc', 'artist-title'],
        init: vi.fn(),
        enrichTrack: options.enrichTrack ?? vi.fn(async () => ({ artist: 'Portishead' })),
    };
    if (options.enrichArtist) built.enrichArtist = options.enrichArtist;
    if (options.enrichAlbum) built.enrichAlbum = options.enrichAlbum;
    return built;
}

function record(id: string, overrides: Partial<PluginRecord> = {}, options: InstanceOptions = {}): PluginRecord {
    return { id, dir: `/plugins/${id}`, status: 'active', manifest: manifest(id), instance: instance(options) as never, ...overrides };
}

/**
 * The repository as a recording of what was asked of it. The promote methods
 * answer "yes, that was a gap I filled" by default; a test that cares about the
 * "already set, left alone" path overrides them.
 */
function fakeRepository() {
    return {
        listTracksNeedingEnrichment: vi.fn(async () => []),
        saveTrackEnrichment: vi.fn(async () => {}),
        recordTrackEnrichmentMiss: vi.fn(async () => {}),
        recordArtistEnrichmentMiss: vi.fn(async () => {}),
        recordAlbumEnrichmentMiss: vi.fn(async () => {}),
        listArtistsNeedingEnrichment: vi.fn(async () => []),
        saveArtistEnrichment: vi.fn(async () => {}),
        listAlbumsNeedingEnrichment: vi.fn(async () => []),
        saveAlbumEnrichment: vi.fn(async () => {}),
        promoteAlbum: vi.fn(async (_id: string, promotion: Record<string, unknown>) =>
            Object.keys(promotion)
                .filter(key => promotion[key] !== undefined)
                .map(key => `album.${key}`),
        ),
        promoteArtist: vi.fn(async (_id: string, promotion: { imageUrl?: string }) => (promotion.imageUrl ? ['artist.imageUrl'] : [])),
        promoteTrack: vi.fn(async (_id: string, promotion: TrackPromotion) =>
            Object.keys(promotion).filter(key => promotion[key as keyof TrackPromotion] !== undefined),
        ),
        promoteArtistMbid: vi.fn(async (_id: string, mbid?: string) => mbid !== undefined),
        promoteAlbumArtwork: vi.fn(async (_id: string, url?: string) => url !== undefined),
    };
}

const catalogTrack: EnrichableTrack = {
    id: 'track-1',
    title: 'Glory Box',
    artistId: 'artist-1',
    artistName: 'Portishead',
    albumId: 'album-1',
    albumName: 'Dummy',
    durationMs: 301_000,
};

/** What the selection query hands back: the track, plus who it is waiting on. */
const pending = (track: EnrichableTrack, outstanding: string[] = [MUSICBRAINZ]): PendingTrack => ({ ...track, outstanding });

let registry: PluginRegistry;
let repository: ReturnType<typeof fakeRepository>;
let invoker: PluginInvoker;
let service: EnrichmentService;

const build = (records: PluginRecord[]): EnrichmentService => {
    registry = new PluginRegistry();
    registry.setAll(records);
    repository = fakeRepository();
    invoker = new PluginInvoker(registry, stubPluginLog().log);
    return new EnrichmentService(registry, invoker, repository as never, stubLogger());
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('providers', () => {
    it('lists the active enrichment plugins, lowest priority first', () => {
        service = build([record(OTHER, {}, { priority: 500 }), record(MUSICBRAINZ, {}, { priority: 100 })]);
        expect(service.providerIds()).toEqual([MUSICBRAINZ, OTHER]);
    });

    it('breaks a priority tie by id, so the order is the same on every pass', () => {
        service = build([record('b.plugin', {}, { priority: 100 }), record('a.plugin', {}, { priority: 100 })]);
        expect(service.providerIds()).toEqual(['a.plugin', 'b.plugin']);
    });

    it('ignores a plugin that is not running', () => {
        service = build([record(MUSICBRAINZ, { status: 'failed', error: 'boom' })]);
        expect(service.providerIds()).toEqual([]);
    });

    it('ignores a plugin that declares enrichment and does not implement it', () => {
        const broken = record(OTHER);
        broken.instance = { priority: 100, matchKeys: ['artist-title'], init: vi.fn() } as never;
        service = build([broken]);
        expect(service.providerIds()).toEqual([]);
    });

    it('ignores a music provider, which answers a different question', () => {
        service = build([record(OTHER, { manifest: manifest(OTHER, { kind: 'music-provider', capabilities: ['catalog'] }) })]);
        expect(service.providerIds()).toEqual([]);
    });
});

describe('enrich', () => {
    it('asks every capable plugin and reports each answer separately', async () => {
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: vi.fn(async () => ({ artist: 'Portishead', year: 1994 })) }),
            record(OTHER, {}, { priority: 500, enrichTrack: vi.fn(async () => ({ bpm: 90 })) }),
        ]);

        const result = await service.enrich(ref);

        expect(result.contributions.map(contribution => contribution.pluginId)).toEqual([MUSICBRAINZ, OTHER]);
        expect(result.enrichment).toEqual({ artist: 'Portishead', year: 1994, bpm: 90 });
        expect(result.failures).toEqual([]);
    });

    it('lets the lower priority number decide a field both plugins answered', async () => {
        service = build([
            record(OTHER, {}, { priority: 500, enrichTrack: vi.fn(async () => ({ artist: 'portishead (uk)' })) }),
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: vi.fn(async () => ({ artist: 'Portishead' })) }),
        ]);

        expect((await service.enrich(ref)).enrichment.artist).toBe('Portishead');
    });

    it('does not ask an isrc-only plugin about a track that has none', async () => {
        const enrichTrack = vi.fn(async () => ({ artist: 'Portishead' }));
        service = build([record(MUSICBRAINZ, {}, { matchKeys: ['isrc'], enrichTrack })]);

        await service.enrich(ref);
        expect(enrichTrack).not.toHaveBeenCalled();

        await service.enrich({ ...ref, isrc: 'GBAAA9400123' });
        expect(enrichTrack).toHaveBeenCalledTimes(1);
    });

    it('records a plugin failure and keeps going', async () => {
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: vi.fn(async () => Promise.reject(new PluginError('upstream is down'))) }),
            record(OTHER, {}, { priority: 500, enrichTrack: vi.fn(async () => ({ bpm: 90 })) }),
        ]);

        const result = await service.enrich(ref);

        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]!.pluginId).toBe(MUSICBRAINZ);
        expect(result.failures[0]!.message).toContain('upstream is down');
        expect(result.enrichment).toEqual({ bpm: 90 });
    });

    it('treats an empty answer as nothing to store, not as an empty contribution', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => ({})) })]);

        const result = await service.enrich(ref);

        expect(result.contributions).toEqual([]);
        expect(result.enrichment).toEqual({});
        expect(result.failures).toEqual([]);
    });

    it('sanitizes what a plugin returned before anything downstream sees it', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => ({ artist: 'Portishead', year: 'nineteen', nonsense: true })) })]);

        expect((await service.enrich(ref)).enrichment).toEqual({ artist: 'Portishead' });
    });

    it('stops between plugins when the caller aborts', async () => {
        const controller = new AbortController();
        const second = vi.fn(async () => ({ bpm: 90 }));
        service = build([
            record(
                MUSICBRAINZ,
                {},
                {
                    priority: 100,
                    enrichTrack: vi.fn(async () => {
                        controller.abort();
                        return { artist: 'Portishead' };
                    }),
                },
            ),
            record(OTHER, {}, { priority: 500, enrichTrack: second }),
        ]);

        const result = await service.enrich(ref, { signal: controller.signal });

        expect(second).not.toHaveBeenCalled();
        expect(result.enrichment).toEqual({ artist: 'Portishead' });
    });

    it('has nothing to say when no enrichment plugin is installed', async () => {
        service = build([]);
        await expect(service.enrich(ref)).resolves.toEqual({ enrichment: {}, contributions: [], failures: [], misses: [] });
    });

    it('asks only the providers it was told the track is waiting on', async () => {
        const musicbrainz = vi.fn(async () => ({ artist: 'Portishead' }));
        const other = vi.fn(async () => ({ bpm: 90 }));
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: musicbrainz }),
            record(OTHER, {}, { priority: 500, enrichTrack: other }),
        ]);

        const result = await service.enrich(ref, { only: [OTHER] });

        expect(musicbrainz).not.toHaveBeenCalled();
        expect(other).toHaveBeenCalledTimes(1);
        expect(result.contributions.map(contribution => contribution.pluginId)).toEqual([OTHER]);
    });
});

describe('the budget each call gets', () => {
    // The walk knows what its own calls cost; PLUGIN_INVOKE_TIMEOUT_MS is the
    // figure for a call the host knows nothing about. Pinned because falling
    // back to the default is silent, and the symptom is an album call killed
    // part-way with the release group already fetched and thrown away.
    const timeoutOf = (op: string): number | undefined =>
        (vi.mocked(invoker.invoke).mock.calls.find(call => call[1] === op)?.[3] as { timeoutMs?: number } | undefined)?.timeoutMs;

    it('gives each kind of call a budget sized to the round trips it makes', async () => {
        service = build([
            record(
                MUSICBRAINZ,
                {},
                { enrichArtist: vi.fn(async () => ({ name: 'Portishead' })), enrichAlbum: vi.fn(async () => ({ name: 'Dummy' })) },
            ),
        ]);
        vi.spyOn(invoker, 'invoke');

        await service.enrich(ref);
        await service.enrichArtist({ name: 'Portishead' });
        await service.enrichAlbum({ name: 'Dummy', artist: 'Portishead' });

        expect(timeoutOf('enrichment.enrichTrack')).toBe(ENRICH_TRACK_TIMEOUT_MS);
        expect(timeoutOf('enrichment.enrichArtist')).toBe(ENRICH_ARTIST_TIMEOUT_MS);
        expect(timeoutOf('enrichment.enrichAlbum')).toBe(ENRICH_ALBUM_TIMEOUT_MS);
    });

    it('gives an album more than a track, because it is one more round trip', () => {
        expect(ENRICH_ALBUM_TIMEOUT_MS).toBeGreaterThan(ENRICH_TRACK_TIMEOUT_MS);
    });
});

describe('isrcOnlyProviderIds', () => {
    it('names the plugins that cannot answer about a track with no ISRC', () => {
        service = build([record(MUSICBRAINZ, {}, { matchKeys: ['isrc', 'artist-title'] }), record(OTHER, {}, { matchKeys: ['isrc'] })]);
        expect(service.isrcOnlyProviderIds()).toEqual([OTHER]);
    });
});

describe('toTrackRef', () => {
    it('asks about the canonical artist rather than the printed credit', () => {
        expect(toTrackRef(catalogTrack)).toEqual({
            isrc: undefined,
            artist: 'Portishead',
            title: 'Glory Box',
            album: 'Dummy',
            durationMs: 301_000,
            year: undefined,
        });
    });
});

describe('enrichPending', () => {
    it('walks the batch the repository handed it and summarises the run', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => ({ artist: 'Portishead', year: 1994 })) })]);
        repository.listTracksNeedingEnrichment.mockResolvedValue([pending(catalogTrack), pending({ ...catalogTrack, id: 'track-2' })] as never);

        const summary = await service.enrichPending(25);

        expect(repository.listTracksNeedingEnrichment).toHaveBeenCalledWith([MUSICBRAINZ], [], 25);
        expect(summary).toMatchObject({ scanned: 2, enriched: 2, failed: 0 });
    });

    it('asks each track only the providers that track is waiting on', async () => {
        const musicbrainz = vi.fn(async () => ({ artist: 'Portishead' }));
        const other = vi.fn(async () => ({ bpm: 90 }));
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: musicbrainz }),
            record(OTHER, {}, { priority: 500, enrichTrack: other }),
        ]);
        repository.listTracksNeedingEnrichment.mockResolvedValue([
            pending(catalogTrack, [OTHER]),
            pending({ ...catalogTrack, id: 'track-2' }, [MUSICBRAINZ, OTHER]),
        ] as never);

        await service.enrichPending(25);

        // The first track already had a live MusicBrainz row, so a stale
        // Last.fm-shaped provider must not drag MusicBrainz along with it.
        expect(musicbrainz).toHaveBeenCalledTimes(1);
        expect(other).toHaveBeenCalledTimes(2);
    });

    it('tells the query which providers cannot match a track without an ISRC', async () => {
        service = build([record(MUSICBRAINZ, {}, { matchKeys: ['artist-title'] }), record(OTHER, {}, { matchKeys: ['isrc'] })]);

        await service.enrichPending(25);

        expect(repository.listTracksNeedingEnrichment).toHaveBeenCalledWith([MUSICBRAINZ, OTHER], [OTHER], 25);
    });

    it('does not go near the database when no enrichment plugin is installed', async () => {
        service = build([]);

        const summary = await service.enrichPending(25);

        expect(repository.listTracksNeedingEnrichment).not.toHaveBeenCalled();
        expect(summary).toEqual({ scanned: 0, enriched: 0, promoted: 0, failed: 0 });
    });

    it('counts a track nobody could identify as scanned but not enriched', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => ({})) })]);
        repository.listTracksNeedingEnrichment.mockResolvedValue([pending(catalogTrack)] as never);

        expect(await service.enrichPending(25)).toMatchObject({ scanned: 1, enriched: 0, failed: 0 });
    });

    it('skips a track that threw and keeps the batch going', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => ({ artist: 'Portishead' })) })]);
        repository.listTracksNeedingEnrichment.mockResolvedValue([pending(catalogTrack), pending({ ...catalogTrack, id: 'track-2' })] as never);
        repository.saveTrackEnrichment.mockRejectedValueOnce(new Error('write failed'));

        const summary = await service.enrichPending(25);

        expect(summary).toMatchObject({ scanned: 2, enriched: 1, failed: 1 });
    });

    it('stops between tracks when the caller aborts', async () => {
        const controller = new AbortController();
        service = build([
            record(
                MUSICBRAINZ,
                {},
                {
                    enrichTrack: vi.fn(async () => {
                        controller.abort();
                        return { artist: 'Portishead' };
                    }),
                },
            ),
        ]);
        repository.listTracksNeedingEnrichment.mockResolvedValue([pending(catalogTrack), pending({ ...catalogTrack, id: 'track-2' })] as never);

        expect(await service.enrichPending(25, controller.signal)).toMatchObject({ scanned: 1 });
    });
});

describe('artist enrichment', () => {
    const artist = { id: 'artist-1', name: 'Portishead', mbid: 'a0000000-0000-4000-8000-000000000002' };
    const facts = { name: 'Portishead', facts: ['Formed in Bristol in 1991.'], imageUrl: 'https://images.test/portishead.jpg' };

    it('counts only the plugins that actually wrote the optional method', () => {
        service = build([record(MUSICBRAINZ, {}, { enrichArtist: vi.fn(async () => facts) }), record(OTHER)]);

        expect(service.providerIds()).toEqual([MUSICBRAINZ, OTHER]);
        expect(service.artistProviderIds()).toEqual([MUSICBRAINZ]);
    });

    it('never calls a plugin that only knows recordings', async () => {
        service = build([record(OTHER)]);

        const result = await service.enrichArtist({ name: 'Portishead' });

        expect(result).toEqual({ enrichment: {}, contributions: [], failures: [], misses: [] });
    });

    it('hands each plugin the id that plugin itself fetched under last time', async () => {
        const enrichArtist = vi.fn(async () => facts);
        const otherArtist = vi.fn(async () => ({ biography: 'A Bristol group.' }));
        service = build([record(MUSICBRAINZ, {}, { priority: 100, enrichArtist }), record(OTHER, {}, { priority: 500, enrichArtist: otherArtist })]);

        await service.enrichArtist({ name: 'Portishead', mbid: 'mb-1' }, { refs: { [MUSICBRAINZ]: 'mb-1', [OTHER]: 'discogs-99' } });

        expect(enrichArtist).toHaveBeenCalledWith({ name: 'Portishead', mbid: 'mb-1', providerRef: 'mb-1' });
        expect(otherArtist).toHaveBeenCalledWith({ name: 'Portishead', mbid: 'mb-1', providerRef: 'discogs-99' });
    });

    it('merges the answers under the same priority rule as a track', async () => {
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichArtist: vi.fn(async () => ({ name: 'Portishead', facts: ['a'] })) }),
            record(OTHER, {}, { priority: 500, enrichArtist: vi.fn(async () => ({ name: 'PORTISHEAD', facts: ['b'], biography: 'Bristol.' })) }),
        ]);

        const result = await service.enrichArtist({ name: 'Portishead' });

        expect(result.enrichment).toEqual({ name: 'Portishead', facts: ['a', 'b'], biography: 'Bristol.' });
    });

    it('stores one payload per provider and fills the image only if it was a gap', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichArtist: vi.fn(async () => facts) })]);

        const outcome = await service.enrichCatalogArtist(artist);

        expect(repository.saveArtistEnrichment).toHaveBeenCalledWith(
            'artist-1',
            MUSICBRAINZ,
            undefined,
            expect.objectContaining(facts),
            ENRICHMENT_TTL_MS,
        );
        expect(repository.promoteArtist).toHaveBeenCalledWith('artist-1', { imageUrl: facts.imageUrl });
        expect(outcome.promoted).toEqual(['artist.imageUrl']);
    });

    it('remembers a miss for an artist nobody could say anything about', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichArtist: vi.fn(async () => ({})) })]);

        const outcome = await service.enrichCatalogArtist(artist);

        expect(repository.saveArtistEnrichment).not.toHaveBeenCalled();
        expect(repository.promoteArtist).not.toHaveBeenCalled();
        expect(repository.recordArtistEnrichmentMiss).toHaveBeenCalledWith('artist-1', MUSICBRAINZ, ENRICHMENT_MISS_TTL_MS);
        expect(outcome).toEqual({ artistId: 'artist-1', providers: [], promoted: [], failures: [] });
    });

    it('walks the batch and passes each artist its own outstanding list and refs', async () => {
        const enrichArtist = vi.fn(async () => facts);
        service = build([record(MUSICBRAINZ, {}, { enrichArtist })]);
        repository.listArtistsNeedingEnrichment.mockResolvedValue([
            { ...artist, outstanding: [MUSICBRAINZ], refs: { [MUSICBRAINZ]: 'mb-cached' } },
        ] as never);

        const summary = await service.enrichPendingArtists(25);

        expect(repository.listArtistsNeedingEnrichment).toHaveBeenCalledWith([MUSICBRAINZ], 25);
        expect(enrichArtist).toHaveBeenCalledWith({ name: 'Portishead', mbid: artist.mbid, providerRef: 'mb-cached' });
        expect(summary).toMatchObject({ scanned: 1, enriched: 1, promoted: 1, failed: 0 });
    });

    it('does not go near the database when no plugin answers about artists', async () => {
        service = build([record(MUSICBRAINZ)]);

        const summary = await service.enrichPendingArtists(25);

        expect(repository.listArtistsNeedingEnrichment).not.toHaveBeenCalled();
        expect(summary).toEqual({ scanned: 0, enriched: 0, promoted: 0, failed: 0 });
    });

    it('records a failing plugin rather than losing the pass', async () => {
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichArtist: vi.fn(async () => Promise.reject(new PluginError('down'))) }),
            record(OTHER, {}, { priority: 500, enrichArtist: vi.fn(async () => ({ biography: 'Bristol.' })) }),
        ]);

        const outcome = await service.enrichCatalogArtist(artist);

        expect(outcome.providers).toEqual([OTHER]);
        expect(outcome.failures).toHaveLength(1);
    });
});

describe('album enrichment', () => {
    const album = { id: 'album-1', name: 'Dummy', artistName: 'Portishead' };
    const record_group = 'b0000000-0000-4000-8000-000000000003';
    const answer = {
        name: 'Dummy',
        year: 1994,
        label: 'Go! Beat',
        artworkUrl: 'https://coverartarchive.test/dummy.jpg',
        externalIds: [{ source: 'musicbrainz-release-group', id: record_group }],
    };

    it('counts only the plugins that answer about records', () => {
        service = build([record(MUSICBRAINZ, {}, { enrichAlbum: vi.fn(async () => answer) }), record(OTHER)]);
        expect(service.albumProviderIds()).toEqual([MUSICBRAINZ]);
    });

    it('asks with the artist, because a title alone does not identify a record', async () => {
        const enrichAlbum = vi.fn(async () => answer);
        service = build([record(MUSICBRAINZ, {}, { enrichAlbum })]);

        await service.enrichCatalogAlbum({ ...album, mbid: record_group });

        expect(enrichAlbum).toHaveBeenCalledWith({ name: 'Dummy', artist: 'Portishead', mbid: record_group, providerRef: undefined });
    });

    it('promotes the release group, the year and the cover onto the album row', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichAlbum: vi.fn(async () => answer) })]);

        const outcome = await service.enrichCatalogAlbum(album);

        expect(repository.saveAlbumEnrichment).toHaveBeenCalledWith('album-1', MUSICBRAINZ, record_group, expect.any(Object), ENRICHMENT_TTL_MS);
        expect(repository.promoteAlbum).toHaveBeenCalledWith('album-1', {
            mbid: record_group,
            year: 1994,
            imageUrl: answer.artworkUrl,
        });
        expect(outcome.providers).toEqual([MUSICBRAINZ]);
    });

    it('writes nothing for a record nobody knew', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichAlbum: vi.fn(async () => ({})) })]);

        const outcome = await service.enrichCatalogAlbum(album);

        expect(repository.saveAlbumEnrichment).not.toHaveBeenCalled();
        expect(repository.promoteAlbum).not.toHaveBeenCalled();
        expect(repository.recordAlbumEnrichmentMiss).toHaveBeenCalledWith('album-1', MUSICBRAINZ, ENRICHMENT_MISS_TTL_MS);
        expect(outcome.promoted).toEqual([]);
    });

    it('walks the batch with each album its own outstanding list and refs', async () => {
        const enrichAlbum = vi.fn(async () => answer);
        service = build([record(MUSICBRAINZ, {}, { enrichAlbum })]);
        repository.listAlbumsNeedingEnrichment.mockResolvedValue([
            { ...album, outstanding: [MUSICBRAINZ], refs: { [MUSICBRAINZ]: 'rg-cached' } },
        ] as never);

        const summary = await service.enrichPendingAlbums(25);

        expect(enrichAlbum).toHaveBeenCalledWith({ name: 'Dummy', artist: 'Portishead', mbid: undefined, providerRef: 'rg-cached' });
        expect(summary).toMatchObject({ scanned: 1, enriched: 1 });
    });

    it('does not go near the database when no plugin answers about records', async () => {
        service = build([record(MUSICBRAINZ)]);

        await service.enrichPendingAlbums(25);

        expect(repository.listAlbumsNeedingEnrichment).not.toHaveBeenCalled();
    });
});

describe('enrichCatalogTrack', () => {
    const answer = {
        artist: 'Portishead',
        year: 1994,
        genres: ['trip hop', 'downtempo'],
        artworkUrl: 'https://coverartarchive.org/release/rel-1/front-500',
        externalIds: [
            { source: 'musicbrainz', id: 'a0000000-0000-4000-8000-000000000001' },
            { source: 'musicbrainz-artist', id: 'a0000000-0000-4000-8000-000000000002' },
        ],
    };

    it('stores one payload per provider, exactly as that plugin said it', async () => {
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: vi.fn(async () => answer) }),
            record(OTHER, {}, { priority: 500, enrichTrack: vi.fn(async () => ({ bpm: 90 })) }),
        ]);

        const outcome = await service.enrichCatalogTrack(catalogTrack);

        expect(repository.saveTrackEnrichment).toHaveBeenCalledTimes(2);
        expect(repository.saveTrackEnrichment).toHaveBeenNthCalledWith(
            1,
            'track-1',
            MUSICBRAINZ,
            'a0000000-0000-4000-8000-000000000001',
            expect.objectContaining({ artist: 'Portishead' }),
            ENRICHMENT_TTL_MS,
        );
        expect(repository.saveTrackEnrichment).toHaveBeenNthCalledWith(2, 'track-1', OTHER, undefined, { bpm: 90 }, ENRICHMENT_TTL_MS);
        expect(outcome.providers).toEqual([MUSICBRAINZ, OTHER]);
    });

    it('promotes identity and gaps onto the canonical rows', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => answer) })]);

        const outcome = await service.enrichCatalogTrack(catalogTrack);

        expect(repository.promoteTrack).toHaveBeenCalledWith('track-1', {
            mbid: 'a0000000-0000-4000-8000-000000000001',
            year: 1994,
            genre: 'trip hop',
        });
        expect(repository.promoteArtistMbid).toHaveBeenCalledWith('artist-1', 'a0000000-0000-4000-8000-000000000002');
        expect(repository.promoteAlbumArtwork).toHaveBeenCalledWith('album-1', answer.artworkUrl);
        expect(outcome.promoted).toContain('artist.mbid');
        expect(outcome.promoted).toContain('album.imageUrl');
    });

    it('remembers a miss for a track nothing could identify, so the walk stops asking', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => ({})) })]);

        const outcome = await service.enrichCatalogTrack(catalogTrack);

        expect(repository.saveTrackEnrichment).not.toHaveBeenCalled();
        expect(repository.promoteTrack).not.toHaveBeenCalled();
        expect(repository.recordTrackEnrichmentMiss).toHaveBeenCalledWith('track-1', MUSICBRAINZ, ENRICHMENT_MISS_TTL_MS);
        expect(outcome).toEqual({ trackId: 'track-1', providers: [], promoted: [], failures: [] });
    });

    it('remembers nothing about a provider that threw, because a bad minute is not evidence', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => Promise.reject(new PluginError('down'))) })]);

        await service.enrichCatalogTrack(catalogTrack);

        expect(repository.recordTrackEnrichmentMiss).not.toHaveBeenCalled();
    });

    it('remembers a miss only for the provider that had nothing', async () => {
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: vi.fn(async () => ({ artist: 'Portishead' })) }),
            record(OTHER, {}, { priority: 500, enrichTrack: vi.fn(async () => ({})) }),
        ]);

        await service.enrichCatalogTrack(catalogTrack);

        expect(repository.recordTrackEnrichmentMiss).toHaveBeenCalledTimes(1);
        expect(repository.recordTrackEnrichmentMiss).toHaveBeenCalledWith('track-1', OTHER, ENRICHMENT_MISS_TTL_MS);
    });

    it('does not reach for an album a track does not belong to', async () => {
        service = build([record(MUSICBRAINZ, {}, { enrichTrack: vi.fn(async () => answer) })]);

        await service.enrichCatalogTrack({ ...catalogTrack, albumId: undefined, albumName: undefined });

        expect(repository.promoteAlbumArtwork).not.toHaveBeenCalled();
    });

    it('reports a plugin failure without losing what the others stored', async () => {
        service = build([
            record(MUSICBRAINZ, {}, { priority: 100, enrichTrack: vi.fn(async () => Promise.reject(new PluginError('down'))) }),
            record(OTHER, {}, { priority: 500, enrichTrack: vi.fn(async () => ({ bpm: 90 })) }),
        ]);

        const outcome = await service.enrichCatalogTrack(catalogTrack);

        expect(outcome.providers).toEqual([OTHER]);
        expect(outcome.failures).toHaveLength(1);
        expect(repository.saveTrackEnrichment).toHaveBeenCalledTimes(1);
    });
});
