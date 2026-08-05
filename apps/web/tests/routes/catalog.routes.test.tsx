// The route modules rather than the pages: what is under test is the search-param validation and
// the loaders' contract with the router. A hand-typed page number must land on the list rather
// than an error boundary, and a failed prefetch must not abandon the navigation — the pages' own
// alerts in `components/catalog/` are only reachable because of what this file pins.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { validateCatalogPage, validateCatalogSearch } from '../../src/components/catalog/catalog.page.params';
import { queryKeys } from '../../src/api/query.keys';
import { createTestQueryClient } from '../utils/render';

const listArtists = vi.fn();
const listTracks = vi.fn();
const getArtist = vi.fn();
const listArtistAlbums = vi.fn();
const getAlbum = vi.fn();
const listAlbumTracks = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        catalog: {
            listArtists: (...args: unknown[]) => listArtists(...args),
            listTracks: (...args: unknown[]) => listTracks(...args),
            getArtist: (...args: unknown[]) => getArtist(...args),
            listArtistAlbums: (...args: unknown[]) => listArtistAlbums(...args),
            getAlbum: (...args: unknown[]) => getAlbum(...args),
            listAlbumTracks: (...args: unknown[]) => listAlbumTracks(...args),
        },
    },
}));

// Curried like the real thing — `createFileRoute(path)(options)` — but handing the options back
// so the loader can be called directly, without standing up the generated route tree.
vi.mock('@tanstack/react-router', () => ({
    createFileRoute: () => (options: unknown) => options,
    stripSearchParams: () => (search: unknown) => search,
    useNavigate: () => () => undefined,
}));

const { Route: ArtistsRoute } = await import('../../src/routes/catalog/index');
const { Route: TracksRoute } = await import('../../src/routes/catalog/tracks');
const { Route: ArtistRoute } = await import('../../src/routes/catalog/artists/$artistId');
const { Route: AlbumRoute } = await import('../../src/routes/catalog/albums/$albumId');

const ARTIST_ID = '11111111-1111-4111-8111-111111111111';
const ALBUM_ID = '22222222-2222-4222-8222-222222222222';

const emptyPage = { meta: { total: 0, page: 0, pageSize: 50, sort: 'asc' }, data: [] };

type LoaderArgs = { context: { queryClient: ReturnType<typeof createTestQueryClient> }; params?: Record<string, string>; deps: { page: number; search?: string } };

function runLoader(route: unknown, args: LoaderArgs) {
    return (route as { loader: (args: LoaderArgs) => Promise<unknown> }).loader(args);
}

afterEach(() => {
    vi.resetAllMocks();
});

describe('catalog search params', () => {
    it('reads a page and a term out of the URL', () => {
        expect(validateCatalogSearch({ page: '3', search: 'sigur' })).toEqual({ page: 3, search: 'sigur' });
    });

    it('falls back to the first unfiltered page on anything unparseable, rather than throwing', () => {
        expect(validateCatalogSearch({})).toEqual({ page: 0, search: '' });
        expect(validateCatalogSearch({ page: 'banana' })).toEqual({ page: 0, search: '' });
        expect(validateCatalogSearch({ page: '-2' })).toEqual({ page: 0, search: '' });
        expect(validateCatalogSearch({ page: '1.5' })).toEqual({ page: 0, search: '' });
        expect(validateCatalogSearch({ search: 42 })).toEqual({ page: 0, search: '' });
    });

    it('drops the term entirely on the detail routes, which have no search box', () => {
        expect(validateCatalogPage({ page: '2', search: 'sigur' })).toEqual({ page: 2 });
    });
});

describe('/catalog loader', () => {
    it('warms the cache from the same query the page reads, for the page that was asked for', async () => {
        listArtists.mockResolvedValue(emptyPage);
        const queryClient = createTestQueryClient();

        await runLoader(ArtistsRoute, { context: { queryClient }, deps: { page: 2, search: 'sig' } });

        expect(listArtists).toHaveBeenCalledWith(expect.objectContaining({ page: 2, search: 'sig' }));
        expect(queryClient.getQueryData(queryKeys.catalog.artists(2, 'sig'))).toEqual(emptyPage);
    });

    it('resolves rather than rejecting when the catalog is unreachable, so navigation still lands', async () => {
        listArtists.mockRejectedValue(new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'no' }, new Headers()));
        const queryClient = createTestQueryClient();

        await expect(runLoader(ArtistsRoute, { context: { queryClient }, deps: { page: 0, search: '' } })).resolves.toBeUndefined();
        expect(queryClient.getQueryState(queryKeys.catalog.artists(0, ''))?.status).toBe('error');
    });
});

describe('/catalog/tracks loader', () => {
    it('carries the search term through, since finding one song is what the flat list is for', async () => {
        listTracks.mockResolvedValue(emptyPage);
        const queryClient = createTestQueryClient();

        await runLoader(TracksRoute, { context: { queryClient }, deps: { page: 0, search: 'vaka' } });

        expect(listTracks).toHaveBeenCalledWith(expect.objectContaining({ search: 'vaka' }));
        expect(queryClient.getQueryData(queryKeys.catalog.tracks(0, 'vaka'))).toEqual(emptyPage);
    });
});

describe('the drill-down loaders', () => {
    it('warm both halves of the artist page in one pass', async () => {
        getArtist.mockResolvedValue({ id: ARTIST_ID, name: 'Sigur Rós', rating: 0, albumCount: 0, trackCount: 0 });
        listArtistAlbums.mockResolvedValue(emptyPage);
        const queryClient = createTestQueryClient();

        await runLoader(ArtistRoute, { context: { queryClient }, params: { artistId: ARTIST_ID }, deps: { page: 0 } });

        expect(queryClient.getQueryData(queryKeys.catalog.artist(ARTIST_ID))).toBeDefined();
        expect(queryClient.getQueryData(queryKeys.catalog.artistAlbums(ARTIST_ID, 0, undefined))).toEqual(emptyPage);
    });

    it('warm both halves of the album page in one pass', async () => {
        getAlbum.mockResolvedValue({ id: ALBUM_ID, name: '( )', artistId: ARTIST_ID, artistName: 'Sigur Rós', rating: 0, trackCount: 0 });
        listAlbumTracks.mockResolvedValue(emptyPage);
        const queryClient = createTestQueryClient();

        await runLoader(AlbumRoute, { context: { queryClient }, params: { albumId: ALBUM_ID }, deps: { page: 0 } });

        expect(queryClient.getQueryData(queryKeys.catalog.album(ALBUM_ID))).toBeDefined();
        expect(queryClient.getQueryData(queryKeys.catalog.albumTracks(ALBUM_ID, 0, undefined))).toEqual(emptyPage);
    });

    it('land the navigation on an artist that was merged away, leaving the 404 for the page to render', async () => {
        getArtist.mockRejectedValue(new SdkError(404, 'Not Found', { statusCode: 404, message: 'gone' }, new Headers()));
        listArtistAlbums.mockResolvedValue(emptyPage);
        const queryClient = createTestQueryClient();

        await expect(runLoader(ArtistRoute, { context: { queryClient }, params: { artistId: ARTIST_ID }, deps: { page: 0 } })).resolves.toBeUndefined();
        expect(queryClient.getQueryState(queryKeys.catalog.artist(ARTIST_ID))?.status).toBe('error');
    });
});
