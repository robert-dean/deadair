// The read side: rows that already exist, turned into one answer. No plugin is
// ever invoked here — a console page view must not be able to start a fan-out —
// so the only thing the plugin registry contributes is the order the stored
// payloads are merged in.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { EnrichmentReadService } from '../../../src/modules/enrichment/enrichment.read.service.js';
import type { EnrichmentRepository, StoredProviderPayload } from '../../../src/modules/enrichment/enrichment.repository.js';
import type { EnrichmentService } from '../../../src/modules/enrichment/enrichment.service.js';

const TRACK_ID = '11111111-1111-4111-8111-111111111111';
const ARTIST_ID = '22222222-2222-4222-8222-222222222222';
const ALBUM_ID = '33333333-3333-4333-8333-333333333333';

const MUSICBRAINZ = 'deadair.musicbrainz';
const OTHER = 'deadair.other';

const fetchedAt = DateTime.fromISO('2026-08-01T10:00:00.000Z');

/**
 * A stored row, in the shape the WRITE path actually leaves behind.
 *
 * `providerRef` is on both halves deliberately: `saveArtistEnrichment` lifts it into its own column
 * AND stores the sanitized payload it came in on, which keeps it inside `data` too. Every fixture
 * here used to omit it, so nothing in this file exercised the shape the console reads — and the read
 * failed its own response validation against every real row while these tests stayed green. A miss
 * is the one exception: an empty payload has no ref to carry.
 */
function payload(provider: string, data: unknown, overrides: Partial<StoredProviderPayload> = {}): StoredProviderPayload {
    const empty = typeof data === 'object' && data !== null && Object.keys(data).length === 0;
    return {
        provider,
        data: empty ? data : { ...(data as object), providerRef: `${provider}:ref` },
        ...(empty ? {} : { providerRef: `${provider}:ref` }),
        fetchedAt,
        expiresAt: fetchedAt.plus({ days: 90 }),
        ...overrides,
    };
}

/** The repository as a canned answer. `undefined` is its "no such row" signal. */
function fakeRepository(rows: Record<string, StoredProviderPayload[] | undefined>) {
    return {
        findTrackEnrichment: vi.fn(async () => rows.track),
        findArtistEnrichment: vi.fn(async () => rows.artist),
        findAlbumEnrichment: vi.fn(async () => rows.album),
    } as unknown as EnrichmentRepository;
}

/** Only the provider-order half of the write service is reachable from the read side. */
function fakeService(order: string[]) {
    return {
        providerIds: () => order,
        artistProviderIds: () => order,
        albumProviderIds: () => order,
    } as unknown as EnrichmentService;
}

const service = (rows: Record<string, StoredProviderPayload[] | undefined>, order: string[] = [MUSICBRAINZ, OTHER]) =>
    new EnrichmentReadService(fakeRepository(rows), fakeService(order));

describe('EnrichmentReadService', () => {
    it('gives a scalar to the higher-priority provider and accumulates the lists across both', async () => {
        const read = service({
            track: [
                payload(OTHER, { artist: 'PORTISHEAD', genres: ['downtempo'], bpm: 92.5 }),
                payload(MUSICBRAINZ, { artist: 'Portishead', genres: ['trip hop'] }),
            ],
        });

        const detail = await read.getTrackEnrichment(TRACK_ID);

        expect(detail.trackId).toBe(TRACK_ID);
        // Order is the plugin priority, not the order the rows came back in.
        expect(detail.sources.map(source => source.provider)).toEqual([MUSICBRAINZ, OTHER]);
        expect(detail.merged.artist).toBe('Portishead');
        expect(detail.merged.genres).toEqual(['trip hop', 'downtempo']);
        // The gap the canonical source never had an opinion about.
        expect(detail.merged.bpm).toBe(92.5);
    });

    it('sorts a provider that is no longer installed last, without dropping what it said', async () => {
        const read = service({ track: [payload('deadair.retired', { label: 'Go! Beat' }), payload(MUSICBRAINZ, { artist: 'Portishead' })] }, [
            MUSICBRAINZ,
        ]);

        const detail = await read.getTrackEnrichment(TRACK_ID);

        expect(detail.sources.map(source => source.provider)).toEqual([MUSICBRAINZ, 'deadair.retired']);
        expect(detail.merged.label).toBe('Go! Beat');
    });

    it('reads an empty payload as a recorded miss rather than as an answer', async () => {
        const read = service({ track: [payload(MUSICBRAINZ, {})] });

        const detail = await read.getTrackEnrichment(TRACK_ID);

        expect(detail.sources).toHaveLength(1);
        expect(detail.sources[0]?.found).toBe(false);
        expect(detail.merged).toEqual({});
    });

    it('flags a payload past its TTL as stale, and still hands it back', async () => {
        const read = service({
            track: [payload(MUSICBRAINZ, { artist: 'Portishead' }, { expiresAt: DateTime.now().minus({ days: 1 }) })],
        });

        const detail = await read.getTrackEnrichment(TRACK_ID);

        expect(detail.sources[0]?.stale).toBe(true);
        expect(detail.merged.artist).toBe('Portishead');
    });

    it('keeps a provider field the SDK has no name for on the source, and out of the merged view', async () => {
        const read = service({ track: [payload(MUSICBRAINZ, { artist: 'Portishead', listeners: 412_000 })] });

        const detail = await read.getTrackEnrichment(TRACK_ID);

        expect(detail.sources[0]?.data.extra).toEqual({ listeners: 412_000 });
        expect(detail.merged).not.toHaveProperty('extra');
    });

    it('drops a link an upstream smuggled in under a scheme the console would have rendered', async () => {
        const read = service({
            track: [
                payload(MUSICBRAINZ, {
                    links: [
                        { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Portishead_(band)' },
                        { label: 'Tap here', url: 'javascript:alert(1)' },
                    ],
                }),
            ],
        });

        const detail = await read.getTrackEnrichment(TRACK_ID);

        expect(detail.merged.links).toEqual([{ label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Portishead_(band)' }]);
    });

    it('answers a track nothing has been stored about with an empty set rather than a 404', async () => {
        const read = service({ track: [] });

        await expect(read.getTrackEnrichment(TRACK_ID)).resolves.toEqual({ trackId: TRACK_ID, merged: {}, sources: [] });
    });

    it('404s a track that is not in the catalog, and equally one that was merged away', async () => {
        const read = service({ track: undefined });

        await expect(read.getTrackEnrichment(TRACK_ID)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('reads an artist through the artist providers and their own field set', async () => {
        const read = service({
            artist: [payload(MUSICBRAINZ, { facts: ['Portishead formed in Bristol in 1991.'], imageUrl: 'https://example.test/p.jpg' })],
        });

        const detail = await read.getArtistEnrichment(ARTIST_ID);

        expect(detail.artistId).toBe(ARTIST_ID);
        expect(detail.merged.facts).toEqual(['Portishead formed in Bristol in 1991.']);
        expect(detail.merged.imageUrl).toBe('https://example.test/p.jpg');
    });

    it('reads an album, keeping the partial release date the source actually claimed', async () => {
        const read = service({ album: [payload(MUSICBRAINZ, { label: 'Go! Beat', releaseDate: '1994', year: 1994 })] });

        const detail = await read.getAlbumEnrichment(ALBUM_ID);

        expect(detail.albumId).toBe(ALBUM_ID);
        expect(detail.merged.releaseDate).toBe('1994');
        expect(detail.merged.year).toBe(1994);
    });

    // The ref is the plugin's id for the thing, not a fact about the thing. It belongs to the
    // source; `data` is a strict object with no field for it, so a payload handed over untouched
    // answered 400 and every enrichment panel in the console read "could not be loaded".
    it('carries the provider’s own ref on the source, and never inside the payload or the merged view', async () => {
        const read = service({
            track: [payload(MUSICBRAINZ, { artist: 'Portishead' })],
            artist: [payload(MUSICBRAINZ, { facts: ['Formed in Bristol in 1991.'] })],
            album: [payload(MUSICBRAINZ, { label: 'Go! Beat' })],
        });

        for (const detail of [await read.getTrackEnrichment(TRACK_ID), await read.getArtistEnrichment(ARTIST_ID), await read.getAlbumEnrichment(ALBUM_ID)]) {
            expect(detail.sources[0]?.providerRef).toBe(`${MUSICBRAINZ}:ref`);
            expect(detail.sources[0]?.data).not.toHaveProperty('providerRef');
            expect(detail.merged).not.toHaveProperty('providerRef');
            // And not swept into `extra` on the way past, which would put it back on the wire under
            // another name and into the card the console draws.
            expect(detail.sources[0]?.data.extra).toBeUndefined();
        }
    });

    it('reads a payload that is nothing but a ref as a miss, since it says nothing about the record', async () => {
        const read = service({ track: [payload(MUSICBRAINZ, {}, { providerRef: 'mb:ref', data: { providerRef: 'mb:ref' } })] });

        const detail = await read.getTrackEnrichment(TRACK_ID);

        expect(detail.sources[0]?.found).toBe(false);
        expect(detail.merged).toEqual({});
    });

    it('404s an artist and an album that are not in the catalog', async () => {
        const read = service({ artist: undefined, album: undefined });

        await expect(read.getArtistEnrichment(ARTIST_ID)).rejects.toMatchObject({ statusCode: 404 });
        await expect(read.getAlbumEnrichment(ALBUM_ID)).rejects.toMatchObject({ statusCode: 404 });
    });
});
