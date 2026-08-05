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
        expect(result.data).toEqual([artistRow()]);
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

        await expect(service.getArtist(ARTIST_ID)).resolves.toEqual(artistRow());
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
});

describe('TracksService', () => {
    it('narrows to one album', async () => {
        const listTracks = vi.fn().mockResolvedValue({ total: 8, data: [trackRow()] });
        const service = new TracksService({ listTracks } as unknown as TracksRepository);

        await service.listTracksByAlbum(ALBUM_ID, query({ search: 'vaka' }));

        expect(listTracks).toHaveBeenCalledWith({ limit: 25, offset: 0, sort: 'desc', search: 'vaka' }, ALBUM_ID);
    });

    it('validates a track that belongs to no album instead of rejecting the whole page', async () => {
        const { albumId: _albumId, albumName: _albumName, ...orphan } = trackRow();
        const listTracks = vi.fn().mockResolvedValue({ total: 1, data: [orphan] });
        const service = new TracksService({ listTracks } as unknown as TracksRepository);

        const result = await service.listTracks(query());

        expect(result.data).toEqual([orphan]);
        expect(result.data[0].albumId).toBeUndefined();
    });
});
