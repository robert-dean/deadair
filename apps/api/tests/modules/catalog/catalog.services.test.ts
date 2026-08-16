// The catalog services are thin by design: they turn a page number into an offset, hand the
// search straight through, and validate what comes back. Each of those three is a place a bug
// would be invisible in review and obvious to the operator.
//
// The offset arithmetic is worth pinning because it is off-by-one-shaped: `page` is zero-based
// here, and a service that multiplied `(page - 1)` would silently skip the first page of a
// catalog nobody has paged through yet.
//
// The validation is worth pinning for one row in particular. `tracks.album_id` is nullable, so a
// single ingested outside any release has no album; an earlier contract required `albumId`, and
// that row 500'd the whole page rather than rendering with a blank album cell.

import { describe, expect, it, vi } from 'vitest';

import { ArtistsService } from '../../../src/modules/catalog/artists.service.js';
import { AlbumsService } from '../../../src/modules/catalog/albums.service.js';
import { TracksService } from '../../../src/modules/catalog/tracks.service.js';
import type { ArtistsRepository } from '../../../src/modules/catalog/artists.repository.js';
import type { AlbumsRepository } from '../../../src/modules/catalog/albums.repository.js';
import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import type { TrackAudioRepository } from '../../../src/modules/playout/audio/track.audio.repository.js';
import type { AnalysisRepository } from '../../../src/modules/analysis/analysis.repository.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';

const ARTIST_ID = '11111111-1111-4111-8111-111111111111';
const ALBUM_ID = '22222222-2222-4222-8222-222222222222';
const TRACK_ID = '33333333-3333-4333-8333-333333333333';

const artistRow = () => ({ id: ARTIST_ID, name: 'Sigur Rós', rating: 0, albumCount: 3, trackCount: 41 });
const albumRow = () => ({ id: ALBUM_ID, name: '( )', artistId: ARTIST_ID, artistName: 'Sigur Rós', rating: 0, trackCount: 8 });
const trackRow = () => ({
    id: TRACK_ID,
    title: 'Vaka',
    artistId: ARTIST_ID,
    artistName: 'Sigur Rós',
    albumId: ALBUM_ID,
    albumName: '( )',
    artists: 'Sigur Rós',
    rating: 0,
});

/**
 * A row as the CONSOLE sees it: the repository answers with the column's `-1 / 0 / 1` and the
 * service hands on the enum, so an expectation written against a repository row has to say which.
 */
const seen = <T extends object>(row: T, rating: 'liked' | 'neutral' | 'disliked' = 'neutral') => ({ ...row, rating });

/** The query as the router hands it over, after zod has applied the contract's defaults. */
const query = (overrides: { page?: number; pageSize?: number; sort?: 'asc' | 'desc'; search?: string } = {}) => ({
    page: 0,
    pageSize: 25,
    sort: 'desc' as const,
    ...overrides,
});

describe('ArtistsService', () => {
    it('turns a zero-based page into an offset and echoes the page back as meta', async () => {
        const listArtists = vi.fn().mockResolvedValue({ total: 97, data: [artistRow()] });
        const service = new ArtistsService({ listArtists } as unknown as ArtistsRepository);

        const result = await service.listArtists(query({ page: 3, pageSize: 10, sort: 'asc' }));

        expect(listArtists).toHaveBeenCalledWith({ limit: 10, offset: 30, sort: 'asc', search: undefined });
        expect(result.meta).toEqual({ total: 97, page: 3, pageSize: 10, sort: 'asc' });
        expect(result.data).toEqual([seen(artistRow())]);
    });

    it('passes the search term through rather than filtering the page it got back', async () => {
        const listArtists = vi.fn().mockResolvedValue({ total: 1, data: [artistRow()] });
        const service = new ArtistsService({ listArtists } as unknown as ArtistsRepository);

        await service.listArtists(query({ search: 'sigur' }));

        expect(listArtists).toHaveBeenCalledWith({ limit: 25, offset: 0, sort: 'desc', search: 'sigur' });
    });

    it('404s on an id the repository will not return, merged or absent alike', async () => {
        const findArtist = vi.fn().mockResolvedValue(undefined);
        const service = new ArtistsService({ findArtist } as unknown as ArtistsRepository);

        await expect(service.getArtist(ARTIST_ID)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns the artist when there is one', async () => {
        const findArtist = vi.fn().mockResolvedValue(artistRow());
        const service = new ArtistsService({ findArtist } as unknown as ArtistsRepository);

        await expect(service.getArtist(ARTIST_ID)).resolves.toEqual(seen(artistRow()));
    });

    it('stores the rating as the column spells it and answers with the artist re-read', async () => {
        const setRating = vi.fn().mockResolvedValue(true);
        // Deliberately the row as it stands AFTER the write: the answer is a re-read, so a service
        // that echoed the request instead would pass this only by accident.
        const findArtist = vi.fn().mockResolvedValue({ ...artistRow(), rating: -1 });
        const service = new ArtistsService({ setRating, findArtist } as unknown as ArtistsRepository);

        const result = await service.rateArtist(ARTIST_ID, { rating: 'disliked' });

        expect(setRating).toHaveBeenCalledWith(ARTIST_ID, -1);
        expect(result).toEqual(seen(artistRow(), 'disliked'));
    });

    it('clears an opinion back to neutral rather than treating it as a middling one', async () => {
        const setRating = vi.fn().mockResolvedValue(true);
        const findArtist = vi.fn().mockResolvedValue(artistRow());
        const service = new ArtistsService({ setRating, findArtist } as unknown as ArtistsRepository);

        await expect(service.rateArtist(ARTIST_ID, { rating: 'neutral' })).resolves.toEqual(seen(artistRow()));
        expect(setRating).toHaveBeenCalledWith(ARTIST_ID, 0);
    });

    it('404s on rating an artist that is absent or merged away, without re-reading it', async () => {
        const setRating = vi.fn().mockResolvedValue(false);
        const findArtist = vi.fn();
        const service = new ArtistsService({ setRating, findArtist } as unknown as ArtistsRepository);

        await expect(service.rateArtist(ARTIST_ID, { rating: 'liked' })).rejects.toMatchObject({ statusCode: 404 });
        expect(findArtist).not.toHaveBeenCalled();
    });
});

describe('AlbumsService', () => {
    it('narrows to one artist without changing the shape of the page', async () => {
        const listAlbums = vi.fn().mockResolvedValue({ total: 3, data: [albumRow()] });
        const service = new AlbumsService({ listAlbums } as unknown as AlbumsRepository);

        const result = await service.listAlbumsByArtist(ARTIST_ID, query({ page: 1, pageSize: 5 }));

        expect(listAlbums).toHaveBeenCalledWith({ limit: 5, offset: 5, sort: 'desc', search: undefined }, ARTIST_ID);
        expect(result.meta).toEqual({ total: 3, page: 1, pageSize: 5, sort: 'desc' });
    });

    it('leaves the artist filter off the unscoped list', async () => {
        const listAlbums = vi.fn().mockResolvedValue({ total: 0, data: [] });
        const service = new AlbumsService({ listAlbums } as unknown as AlbumsRepository);

        await service.listAlbums(query());

        expect(listAlbums).toHaveBeenCalledWith({ limit: 25, offset: 0, sort: 'desc', search: undefined }, undefined);
    });

    it('answers an artist with no albums with an empty page, not a 404', async () => {
        const listAlbums = vi.fn().mockResolvedValue({ total: 0, data: [] });
        const service = new AlbumsService({ listAlbums } as unknown as AlbumsRepository);

        await expect(service.listAlbumsByArtist(ARTIST_ID, query())).resolves.toEqual({
            meta: { total: 0, page: 0, pageSize: 25, sort: 'desc' },
            data: [],
        });
    });

    it('404s on an album the repository will not return', async () => {
        const findAlbum = vi.fn().mockResolvedValue(undefined);
        const service = new AlbumsService({ findAlbum } as unknown as AlbumsRepository);

        await expect(service.getAlbum(ALBUM_ID)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rates a record and answers with it re-read', async () => {
        const setRating = vi.fn().mockResolvedValue(true);
        const findAlbum = vi.fn().mockResolvedValue({ ...albumRow(), rating: 1 });
        const service = new AlbumsService({ setRating, findAlbum } as unknown as AlbumsRepository);

        await expect(service.rateAlbum(ALBUM_ID, { rating: 'liked' })).resolves.toEqual(seen(albumRow(), 'liked'));
        expect(setRating).toHaveBeenCalledWith(ALBUM_ID, 1);
    });

    it('404s on rating an album that is absent or merged away', async () => {
        const setRating = vi.fn().mockResolvedValue(false);
        const service = new AlbumsService({ setRating } as unknown as AlbumsRepository);

        await expect(service.rateAlbum(ALBUM_ID, { rating: 'liked' })).rejects.toMatchObject({ statusCode: 404 });
    });
});

/**
 * A tracks service over a partial repository and three empty readers.
 *
 * The three exist for `getTrack`, which composes four independent reads; every other method here
 * touches only the catalog repository, so they default to answering with nothing rather than each
 * test having to say so.
 */
const tracksService = (
    repository: Partial<TracksRepository>,
    extras: { bindings?: unknown[]; analysis?: unknown; plays?: unknown[]; playCount?: number } = {},
) =>
    new TracksService(
        repository as TracksRepository,
        { bindingsForTrack: vi.fn().mockResolvedValue(extras.bindings ?? []) } as unknown as TrackAudioRepository,
        { stateFor: vi.fn().mockResolvedValue(extras.analysis) } as unknown as AnalysisRepository,
        { forTrack: vi.fn().mockResolvedValue({ plays: extras.plays ?? [], total: extras.playCount ?? 0 }) } as unknown as PlayHistoryRepository,
    );

describe('TracksService', () => {
    it('narrows to one album', async () => {
        const listTracks = vi.fn().mockResolvedValue({ total: 8, data: [trackRow()] });
        const service = tracksService({ listTracks });

        await service.listTracksByAlbum(ALBUM_ID, query({ search: 'vaka' }));

        expect(listTracks).toHaveBeenCalledWith({ limit: 25, offset: 0, sort: 'desc', search: 'vaka' }, ALBUM_ID);
    });

    it('validates a track that belongs to no album instead of rejecting the whole page', async () => {
        const { albumId: _albumId, albumName: _albumName, ...orphan } = trackRow();
        const listTracks = vi.fn().mockResolvedValue({ total: 1, data: [orphan] });
        const service = tracksService({ listTracks });

        const result = await service.listTracks(query());

        expect(result.data).toEqual([seen(orphan)]);
        expect(result.data[0]!.albumId).toBeUndefined();
    });

    it('rates a song and answers with it re-read', async () => {
        const setRating = vi.fn().mockResolvedValue(true);
        const findTrack = vi.fn().mockResolvedValue({ ...trackRow(), rating: 1 });
        const service = tracksService({ setRating, findTrack });

        await expect(service.rateTrack(TRACK_ID, { rating: 'liked' })).resolves.toEqual(seen(trackRow(), 'liked'));
        expect(setRating).toHaveBeenCalledWith(TRACK_ID, 1);
    });

    it('404s on rating a track that is absent or merged away', async () => {
        const setRating = vi.fn().mockResolvedValue(false);
        const findTrack = vi.fn();
        const service = tracksService({ setRating, findTrack });

        await expect(service.rateTrack(TRACK_ID, { rating: 'disliked' })).rejects.toMatchObject({ statusCode: 404 });
        expect(findTrack).not.toHaveBeenCalled();
    });
});

// The read behind "why will this record not air". What is worth pinning is that it puts four
// independent facts together without any of them being able to hide another: a record with no
// copies, a record whose copies are all benched, and a measurement that failed all have to arrive
// as themselves rather than as an empty page.
describe('TracksService.getTrack', () => {
    const bindingRow = (overrides: Record<string, unknown> = {}) => ({
        sourceId: '44444444-4444-4444-8444-444444444444',
        pluginId: 'deadair.spotify',
        externalId: 'track-42',
        playable: true,
        origin: 'sync',
        attempts: 0,
        ...overrides,
    });

    it('puts the record together with its copies, its measurement and what it has aired', async () => {
        const findTrack = vi.fn().mockResolvedValue(trackRow());
        const service = tracksService(
            { findTrack },
            {
                bindings: [bindingRow({ byteSize: 8_000_000, fetchedAt: '2026-08-14T10:00:00.000Z' })],
                analysis: { schemaVersion: 3, complete: true, analyzedAt: '2026-08-14T11:00:00.000Z', analyzer: 'sidecar 0.4' },
                plays: [{ airedAt: '2026-08-15T21:00:00.000Z', source: 'director' }],
                playCount: 12,
            },
        );

        const detail = await service.getTrack(TRACK_ID);

        expect(detail).toMatchObject({ id: TRACK_ID, title: 'Vaka', rating: 'neutral', playCount: 12 });
        expect(detail.bindings).toHaveLength(1);
        expect(detail.bindings[0]).toMatchObject({ pluginId: 'deadair.spotify', byteSize: 8_000_000 });
        expect(detail.analysis).toMatchObject({ complete: true, schemaVersion: 3 });
        expect(detail.plays).toHaveLength(1);
    });

    // The three states an operator is actually trying to tell apart, and none of them is an error:
    // nothing has ever fetched this copy, every copy is benched, and the measurement failed.
    it('reports a failure rather than hiding it', async () => {
        const findTrack = vi.fn().mockResolvedValue(trackRow());
        const service = tracksService(
            { findTrack },
            {
                bindings: [
                    bindingRow({
                        missingAt: '2026-08-15T09:00:00.000Z',
                        attempts: 4,
                        lastError: 'upstream answered 404',
                        nextAttemptAt: '2026-08-16T09:00:00.000Z',
                    }),
                ],
                analysis: { schemaVersion: 3, complete: false, failedAt: '2026-08-15T03:12:00.000Z', failureReason: 'decode ended early' },
            },
        );

        const detail = await service.getTrack(TRACK_ID);

        expect(detail.bindings[0]).toMatchObject({ attempts: 4, lastError: 'upstream answered 404' });
        expect(detail.bindings[0]!.missingAt).toBeDefined();
        expect(detail.analysis).toMatchObject({ complete: false, failureReason: 'decode ended early' });
    });

    // A record with no copies at all is a real state — an import that never resolved — and reads as
    // an empty list rather than as a 404 about the record itself.
    it('answers for a record nothing has a copy of', async () => {
        const findTrack = vi.fn().mockResolvedValue(trackRow());
        const service = tracksService({ findTrack });

        const detail = await service.getTrack(TRACK_ID);

        expect(detail.bindings).toEqual([]);
        expect(detail.analysis).toBeUndefined();
        expect(detail.plays).toEqual([]);
        expect(detail.playCount).toBe(0);
    });

    it('404s on a track that is absent or merged away', async () => {
        const service = tracksService({ findTrack: vi.fn().mockResolvedValue(undefined) });

        await expect(service.getTrack(TRACK_ID)).rejects.toMatchObject({ statusCode: 404 });
    });
});
