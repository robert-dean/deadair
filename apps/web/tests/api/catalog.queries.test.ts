// Two things about these options are worth pinning, because both fail quietly.
//
// The key has to carry the page and the search term. If it did not, page 2 would read page 1 out
// of the cache and a search would overwrite the unfiltered list with a filtered slice of itself.
//
// The wire query has to send `sort: 'asc'` and drop an empty search. The shared `Pagination`
// contract defaults to `desc`, which over name ordering opens every list at Z, and the contract's
// `search` has a `min=1`, so sending `''` is a 422 rather than "no filter".

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    catalogAlbumOptions,
    catalogAlbumTracksOptions,
    catalogArtistAlbumsOptions,
    catalogArtistOptions,
    catalogArtistsOptions,
    catalogTracksOptions,
} from '../../src/api/catalog.queries';
import { queryKeys } from '../../src/api/query.keys';
import { DEFAULT_PAGE_SIZE } from '../../src/components/catalog/catalog.page.params';

const listArtists = vi.fn();
const getArtist = vi.fn();
const listArtistAlbums = vi.fn();
const getAlbum = vi.fn();
const listAlbumTracks = vi.fn();
const listTracks = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        catalog: {
            listArtists: (...args: unknown[]) => listArtists(...args),
            getArtist: (...args: unknown[]) => getArtist(...args),
            listArtistAlbums: (...args: unknown[]) => listArtistAlbums(...args),
            getAlbum: (...args: unknown[]) => getAlbum(...args),
            listAlbumTracks: (...args: unknown[]) => listAlbumTracks(...args),
            listTracks: (...args: unknown[]) => listTracks(...args),
        },
    },
}));

const ARTIST_ID = '11111111-1111-4111-8111-111111111111';
const ALBUM_ID = '22222222-2222-4222-8222-222222222222';

const emptyPage = { meta: { total: 0, page: 0, pageSize: DEFAULT_PAGE_SIZE, sort: 'asc' }, data: [] };

afterEach(() => {
    vi.resetAllMocks();
});

describe('catalogArtistsOptions', () => {
    it('keys on the page and the search term, so neither reads the other out of the cache', () => {
        expect(catalogArtistsOptions({ page: 0 }).queryKey).toEqual(queryKeys.catalog.artists(0, undefined, '::'));
        expect(catalogArtistsOptions({ page: 1 }).queryKey).not.toEqual(catalogArtistsOptions({ page: 0 }).queryKey);
        expect(catalogArtistsOptions({ page: 0, search: 'sigur' }).queryKey).not.toEqual(catalogArtistsOptions({ page: 0 }).queryKey);
    });

    it('asks for an ascending page of the configured size', async () => {
        listArtists.mockResolvedValue(emptyPage);

        await catalogArtistsOptions({ page: 2 }).queryFn?.({} as never);

        expect(listArtists).toHaveBeenCalledWith({ page: 2, pageSize: DEFAULT_PAGE_SIZE, sort: 'asc', sortBy: undefined, search: undefined });
    });

    it('drops an empty search rather than sending one the contract rejects', async () => {
        listArtists.mockResolvedValue(emptyPage);

        await catalogArtistsOptions({ page: 0, search: '' }).queryFn?.({} as never);

        expect(listArtists).toHaveBeenCalledWith(expect.objectContaining({ search: undefined }));
    });

    it('sends a real search through untouched', async () => {
        listArtists.mockResolvedValue(emptyPage);

        await catalogArtistsOptions({ page: 0, search: 'sigur' }).queryFn?.({} as never);

        expect(listArtists).toHaveBeenCalledWith(expect.objectContaining({ search: 'sigur' }));
    });
});

describe('the single-item options', () => {
    it('key on the id and read straight through', async () => {
        expect(catalogArtistOptions(ARTIST_ID).queryKey).toEqual(queryKeys.catalog.artist(ARTIST_ID));
        expect(catalogAlbumOptions(ALBUM_ID).queryKey).toEqual(queryKeys.catalog.album(ALBUM_ID));

        getArtist.mockResolvedValue({ id: ARTIST_ID });
        getAlbum.mockResolvedValue({ id: ALBUM_ID });

        await catalogArtistOptions(ARTIST_ID).queryFn?.({} as never);
        await catalogAlbumOptions(ALBUM_ID).queryFn?.({} as never);

        expect(getArtist).toHaveBeenCalledWith(ARTIST_ID);
        expect(getAlbum).toHaveBeenCalledWith(ALBUM_ID);
    });
});

describe('the per-parent lists', () => {
    it('key on the parent as well as the page, so two artists never share a page', () => {
        const other = '44444444-4444-4444-8444-444444444444';

        expect(catalogArtistAlbumsOptions(ARTIST_ID, { page: 0 }).queryKey).toEqual(queryKeys.catalog.artistAlbums(ARTIST_ID, 0, undefined, '::'));
        expect(catalogArtistAlbumsOptions(ARTIST_ID, { page: 0 }).queryKey).not.toEqual(catalogArtistAlbumsOptions(other, { page: 0 }).queryKey);
    });

    it('pass the parent id first and the page second', async () => {
        listArtistAlbums.mockResolvedValue(emptyPage);
        listAlbumTracks.mockResolvedValue(emptyPage);

        await catalogArtistAlbumsOptions(ARTIST_ID, { page: 1 }).queryFn?.({} as never);
        await catalogAlbumTracksOptions(ALBUM_ID, { page: 0 }).queryFn?.({} as never);

        expect(listArtistAlbums).toHaveBeenCalledWith(ARTIST_ID, { page: 1, pageSize: DEFAULT_PAGE_SIZE, sort: 'asc', sortBy: undefined, search: undefined });
        expect(listAlbumTracks).toHaveBeenCalledWith(ALBUM_ID, { page: 0, pageSize: DEFAULT_PAGE_SIZE, sort: 'asc', sortBy: undefined, search: undefined });
    });
});

describe('catalogTracksOptions', () => {
    it('reads the flat track list', async () => {
        listTracks.mockResolvedValue(emptyPage);

        await catalogTracksOptions({ page: 0, search: 'vaka' }).queryFn?.({} as never);

        expect(listTracks).toHaveBeenCalledWith({ page: 0, pageSize: DEFAULT_PAGE_SIZE, sort: 'asc', sortBy: undefined, search: 'vaka' });
    });
});
