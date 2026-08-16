// The read side: rows that already exist, turned into one answer. No plugin is
// ever invoked here — a console page view must not be able to start a fan-out —
// so the only thing the plugin registry contributes is the order the stored
// payloads are merged in.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { EnrichmentReadService, MAX_FACT_CHARS } from '../../../src/modules/enrichment/enrichment.read.service.js';
import type { EnrichmentRepository, StoredProviderPayload, TrackFactPayloads } from '../../../src/modules/enrichment/enrichment.repository.js';
import type { EnrichmentService } from '../../../src/modules/enrichment/enrichment.service.js';
import type { ClaimForTrack, FactRepository, StoredFact } from '../../../src/modules/enrichment/fact.repository.js';

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
        // The write path only leaves this above zero on a row nobody could ask for, so the default
        // here is what every ordinary row carries. A test about a failure overrides it.
        attempts: 0,
        ...overrides,
    };
}

/** The repository as a canned answer. `undefined` is its "no such row" signal. */
function fakeRepository(rows: Record<string, StoredProviderPayload[] | undefined>, facts: TrackFactPayloads[] = []) {
    return {
        findTrackEnrichment: vi.fn(async () => rows.track),
        findArtistEnrichment: vi.fn(async () => rows.artist),
        findAlbumEnrichment: vi.fn(async () => rows.album),
        findFactPayloadsForTracks: vi.fn(async () => facts),
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

/**
 * The claim store as a canned answer.
 *
 * Its own fixture rather than a field on {@link fakeRepository}, because the two are separate
 * stores: one holds what a plugin said and the other what this host concluded from it.
 */
const fakeFacts = (claims: StoredFact[] = [], believed: Map<string, ClaimForTrack[]> = new Map()) =>
    ({
        findFacts: vi.fn(async () => claims),
        findFactsForTracks: vi.fn(async () => believed),
        markUsed: vi.fn(async () => undefined),
    }) as unknown as FactRepository;

const service = (rows: Record<string, StoredProviderPayload[] | undefined>, order: string[] = [MUSICBRAINZ, OTHER], claims: StoredFact[] = []) =>
    new EnrichmentReadService(fakeRepository(rows), fakeService(order), fakeFacts(claims));

/** One track's stored payloads, in the shape {@link EnrichmentRepository.findFactPayloadsForTracks} answers. */
function factRows(levels: Partial<Record<'track' | 'album' | 'artist', unknown[]>>, trackId = TRACK_ID): TrackFactPayloads[] {
    const at = (level: 'track' | 'album' | 'artist') => (levels[level] ?? []).map(data => ({ provider: MUSICBRAINZ, data }));
    return [{ trackId, track: at('track'), album: at('album'), artist: at('artist') }];
}

const factReader = (facts: TrackFactPayloads[], order: string[] = [MUSICBRAINZ, OTHER], believed: Map<string, ClaimForTrack[]> = new Map()) =>
    new EnrichmentReadService(fakeRepository({}, facts), fakeService(order), fakeFacts([], believed));

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

        await expect(read.getTrackEnrichment(TRACK_ID)).resolves.toEqual({ trackId: TRACK_ID, merged: {}, sources: [], claims: [] });
    });

    it('carries the claims the host extracted, beside the payloads the plugins supplied', async () => {
        // Beside rather than inside `merged`: a claim is this host's own conclusion, with the
        // citation that makes it worth anything, and no provider said it.
        const claim: StoredFact = {
            id: '44444444-4444-4444-8444-444444444444',
            subject: { type: 'track', id: TRACK_ID },
            claim: 'It was used in Ace Ventura.',
            category: 'placement',
            source: 'model',
            sourceProvider: 'deadair.wikipedia',
            sourceUrl: 'https://en.wikipedia.org/wiki/Rusty_Cage',
            sourceQuote: 'The song appeared in the 1994 film Ace Ventura: Pet Detective.',
        };
        const read = service({ track: [payload(MUSICBRAINZ, { artist: 'Soundgarden' })] }, [MUSICBRAINZ], [claim]);

        const detail = await read.getTrackEnrichment(TRACK_ID);

        expect(detail.claims).toHaveLength(1);
        expect(detail.claims[0]?.claim).toBe('It was used in Ace Ventura.');
        expect(detail.claims[0]?.sourceUrl).toBe('https://en.wikipedia.org/wiki/Rusty_Cage');
        expect(detail.merged).not.toHaveProperty('claims');
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

        for (const detail of [
            await read.getTrackEnrichment(TRACK_ID),
            await read.getArtistEnrichment(ARTIST_ID),
            await read.getAlbumEnrichment(ALBUM_ID),
        ]) {
            expect(detail.sources[0]?.providerRef).toBe(`${MUSICBRAINZ}:ref`);
            expect(detail.sources[0]?.data).not.toHaveProperty('providerRef');
            expect(detail.merged).not.toHaveProperty('providerRef');
            // And not swept into `extra` on the way past, which would put it back on the wire under
            // another name and into the card the console draws.
            expect(detail.sources[0]?.data.extra).toBeUndefined();
        }
    });

    it('keeps source documents off the wire, since nothing here draws an article', async () => {
        const article = {
            url: 'https://en.wikipedia.org/wiki/Glory_Box',
            title: 'Glory Box',
            text: 'Glory Box is a song by the English band Portishead.',
            retrievedAt: '2026-08-15T09:00:00.000Z',
        };
        const read = service({ track: [payload(MUSICBRAINZ, { artist: 'Portishead', documents: [article] })] });

        const detail = await read.getTrackEnrichment(TRACK_ID);

        expect(detail.sources[0]?.data).not.toHaveProperty('documents');
        expect(detail.merged).not.toHaveProperty('documents');
        // And not swept into `extra` on the way past, which would put the whole article back on the
        // wire under another name.
        expect(detail.sources[0]?.data.extra).toBeUndefined();
    });

    it('still calls a source that answered with prose ALONE a hit, not a recorded miss', async () => {
        // The wire drops its only field, so judging `found` on what travels would have the console
        // reporting "asked and had nothing" about the one source that had the most.
        const read = service({
            track: [
                payload(MUSICBRAINZ, {
                    documents: [
                        {
                            url: 'https://en.wikipedia.org/wiki/Glory_Box',
                            title: 'Glory Box',
                            text: 'Glory Box is a song by the English band Portishead.',
                            retrievedAt: '2026-08-15T09:00:00.000Z',
                        },
                    ],
                }),
            ],
        });

        expect((await read.getTrackEnrichment(TRACK_ID)).sources[0]?.found).toBe(true);
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

    // What a talk break is shown. Everything the console read carries is dropped: a writer wants
    // sentences and has no use for provenance, staleness or the fields nothing has a name for.
    describe('facts for a break', () => {
        it('takes the recording’s own facts ahead of its record’s, and its record’s ahead of its artist’s', async () => {
            const read = factReader(
                factRows({
                    track: [{ facts: ['Recorded in one take.'] }],
                    album: [{ facts: ['The record was cut at Abbey Road.'] }],
                    artist: [{ facts: ['Portishead formed in Bristol in 1991.'] }],
                }),
            );

            await expect(read.factsForTracks([TRACK_ID])).resolves.toEqual(
                new Map([[TRACK_ID, ['Recorded in one take.', 'The record was cut at Abbey Road.']]]),
            );
        });

        it('says the same thing once, however many levels and providers claimed it', async () => {
            const read = factReader([
                {
                    trackId: TRACK_ID,
                    track: [{ provider: MUSICBRAINZ, data: { facts: ['Formed in Bristol in 1991.'] } }],
                    album: [],
                    artist: [
                        { provider: MUSICBRAINZ, data: { facts: ['formed in bristol in 1991.'] } },
                        { provider: OTHER, data: { facts: ['Formed in Bristol in 1991.', 'Their second record went gold.'] } },
                    ],
                },
            ]);

            await expect(read.factsForTracks([TRACK_ID])).resolves.toEqual(
                new Map([[TRACK_ID, ['Formed in Bristol in 1991.', 'Their second record went gold.']]]),
            );
        });

        it('drops a fact too long to say rather than cutting it in half', async () => {
            const read = factReader(factRows({ artist: [{ facts: ['x'.repeat(MAX_FACT_CHARS + 1), 'Formed in Bristol in 1991.'] }] }));

            await expect(read.factsForTracks([TRACK_ID])).resolves.toEqual(new Map([[TRACK_ID, ['Formed in Bristol in 1991.']]]));
        });

        it('starts at a different fact for a different rotation, so a record played twice does not say the same thing', async () => {
            const facts = factRows({ artist: [{ facts: ['One.', 'Two.', 'Three.'] }] });

            await expect(factReader(facts).factsForTracks([TRACK_ID], 0)).resolves.toEqual(new Map([[TRACK_ID, ['One.', 'Two.']]]));
            await expect(factReader(facts).factsForTracks([TRACK_ID], 2)).resolves.toEqual(new Map([[TRACK_ID, ['Three.', 'One.']]]));
            // A rotation past the end wraps rather than emptying the answer.
            await expect(factReader(facts).factsForTracks([TRACK_ID], 7)).resolves.toEqual(new Map([[TRACK_ID, ['Two.', 'Three.']]]));
        });

        it('leaves out a track with nothing to say, rather than answering with an empty list', async () => {
            const read = factReader(factRows({ track: [{ genres: ['trip hop'] }] }));

            await expect(read.factsForTracks([TRACK_ID])).resolves.toEqual(new Map());
        });

        it('asks nothing of the database when there are no tracks to ask about', async () => {
            const repository = fakeRepository({}, []);
            const read = new EnrichmentReadService(repository, fakeService([MUSICBRAINZ]), fakeFacts());

            await expect(read.factsForTracks([])).resolves.toEqual(new Map());
            expect(repository.findFactPayloadsForTracks).not.toHaveBeenCalled();
        });

        // A claim carries the span of an article that says so, and a provider's `facts` line carries
        // a source name. Only one of those can be checked when something sounds wrong on air.
        describe('against what the station believes', () => {
            const believed = (...claims: string[]) =>
                new Map([[TRACK_ID, claims.map((claim, at) => ({ id: `fact-${at}`, claim }))]]) as Map<string, ClaimForTrack[]>;

            it('says what it can source before what a provider composed', async () => {
                const read = factReader(factRows({ track: [{ facts: ['Recorded in one take.'] }] }), undefined, believed('It was used in a film.'));

                await expect(read.factsForTracks([TRACK_ID])).resolves.toEqual(
                    new Map([[TRACK_ID, ['It was used in a film.', 'Recorded in one take.']]]),
                );
            });

            it('tops up rather than mixing, so a template line never displaces a sourced one', async () => {
                const read = factReader(
                    factRows({ track: [{ facts: ['Recorded in one take.'] }] }),
                    undefined,
                    believed('It was used in a film.', 'Johnny Cash covered it.'),
                );

                // Both slots are claims, so the provider's line is not asked for at all.
                await expect(read.factsForTracks([TRACK_ID])).resolves.toEqual(
                    new Map([[TRACK_ID, ['It was used in a film.', 'Johnny Cash covered it.']]]),
                );
            });

            it('falls back to the providers when every claim about a record is resting', async () => {
                // The cooldown filters in the query, so a store with nothing to offer looks exactly
                // like a store with nothing in it. Either way the station still has something to say.
                const read = factReader(factRows({ track: [{ facts: ['Recorded in one take.'] }] }), undefined, new Map());

                await expect(read.factsForTracks([TRACK_ID])).resolves.toEqual(new Map([[TRACK_ID, ['Recorded in one take.']]]));
            });

            it('says the same thing once when a provider composed a line the store already holds', async () => {
                const read = factReader(factRows({ track: [{ facts: ['It was used in a film.'] }] }), undefined, believed('It was used in a film.'));

                await expect(read.factsForTracks([TRACK_ID])).resolves.toEqual(new Map([[TRACK_ID, ['It was used in a film.']]]));
            });

            it('stamps every claim it hands over, so the cooldown has something to work from', async () => {
                const facts = fakeFacts([], believed('It was used in a film.'));
                const read = new EnrichmentReadService(fakeRepository({}, factRows({})), fakeService([MUSICBRAINZ]), facts);

                await read.factsForTracks([TRACK_ID]);

                expect(facts.markUsed).toHaveBeenCalledWith(['fact-0']);
            });

            it('still answers when the stamp fails, because nothing may cost a break its notes', async () => {
                const facts = fakeFacts([], believed('It was used in a film.'));
                vi.mocked(facts.markUsed).mockRejectedValue(new Error('the database went away'));
                const read = new EnrichmentReadService(fakeRepository({}, factRows({})), fakeService([MUSICBRAINZ]), facts);

                await expect(read.factsForTracks([TRACK_ID])).resolves.toEqual(new Map([[TRACK_ID, ['It was used in a film.']]]));
            });
        });
    });
});
