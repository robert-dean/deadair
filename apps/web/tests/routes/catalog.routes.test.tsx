// The route modules rather than the pages: what is under test is the search-param validation and
// the loaders' contract with the router. A hand-typed page number must land on the list rather
// than an error boundary, and a failed prefetch must not abandon the navigation — the pages' own
// alerts in `components/catalog/` are only reachable because of what this file pins.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { DEFAULT_PAGE_SIZE, validateCatalogAlbums, validateCatalogSearch } from '../../src/components/catalog/catalog.page.params';
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

type LoaderArgs = {
    context: { queryClient: ReturnType<typeof createTestQueryClient> };
    params?: Record<string, string>;
    deps: { page: number; search?: string; sortBy?: string; sort?: 'asc' | 'desc'; pageSize?: number };
};

/**
 * How a list opens: its own first key, ascending, at the console's page size.
 *
 * Spelled once here because it appears in every expectation below, and because what these cases are
 * actually about is the page and the term rather than the ordering that rides along with them.
 */
const ORDER = { sortBy: 'name', sort: 'asc' as const, pageSize: DEFAULT_PAGE_SIZE };

/** The ordering as one key segment, matching what `catalog.queries` folds into the query key. */
const orderKey = (sortBy: string, sort = 'asc', pageSize: number = DEFAULT_PAGE_SIZE) => `${sortBy}:${sort}:${pageSize}`;

function runLoader(route: unknown, args: LoaderArgs) {
    return (route as { loader: (args: LoaderArgs) => Promise<unknown> }).loader(args);
}

afterEach(() => {
    vi.resetAllMocks();
});

describe('catalog search params', () => {
    it('reads a page and a term out of the URL', () => {
        expect(validateCatalogSearch({ page: '3', search: 'sigur' })).toEqual({ page: 3, search: 'sigur', ...ORDER });
    });

    it('falls back to the first unfiltered page on anything unparseable, rather than throwing', () => {
        expect(validateCatalogSearch({})).toEqual({ page: 0, search: '', ...ORDER });
        expect(validateCatalogSearch({ page: 'banana' })).toEqual({ page: 0, search: '', ...ORDER });
        expect(validateCatalogSearch({ page: '-2' })).toEqual({ page: 0, search: '', ...ORDER });
        expect(validateCatalogSearch({ page: '1.5' })).toEqual({ page: 0, search: '', ...ORDER });
        expect(validateCatalogSearch({ search: 42 })).toEqual({ page: 0, search: '', ...ORDER });
    });

    it('drops the term entirely on the detail routes, which have no search box', () => {
        expect(validateCatalogAlbums({ page: '2', search: 'sigur' })).toEqual({ page: 2, ...ORDER });
    });

    /**
     * The ordering is validated against the list's own vocabulary, so a key that means something on
     * another list is still not a key here. Both halves matter: the server falls back too, and this
     * is what stops a word that was never a key reaching it at all.
     */
    it('reads an ordering this list knows, and falls back on one it does not', () => {
        expect(validateCatalogSearch({ sortBy: 'tracks', sort: 'desc' })).toMatchObject({ sortBy: 'tracks', sort: 'desc' });
        expect(validateCatalogSearch({ sortBy: 'duration' })).toMatchObject({ sortBy: 'name' });
        expect(validateCatalogSearch({ sort: 'sideways' })).toMatchObject({ sort: 'asc' });
    });

    /** A hand-typed size the contract would refuse should land on the list, not on a validation error. */
    it('only accepts a page size it offers', () => {
        expect(validateCatalogSearch({ pageSize: '25' })).toMatchObject({ pageSize: 25 });
        expect(validateCatalogSearch({ pageSize: '5000' })).toMatchObject({ pageSize: DEFAULT_PAGE_SIZE });
    });
});

describe('/catalog loader', () => {
    it('warms the cache from the same query the page reads, for the page that was asked for', async () => {
        listArtists.mockResolvedValue(emptyPage);
        const queryClient = createTestQueryClient();

        await runLoader(ArtistsRoute, { context: { queryClient }, deps: { page: 2, search: 'sig', ...ORDER } });

        expect(listArtists).toHaveBeenCalledWith(expect.objectContaining({ page: 2, search: 'sig' }));
        expect(queryClient.getQueryData(queryKeys.catalog.artists(2, 'sig', orderKey('name')))).toEqual(emptyPage);
    });

    it('resolves rather than rejecting when the catalog is unreachable, so navigation still lands', async () => {
        listArtists.mockRejectedValue(new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'no' }, new Headers()));
        const queryClient = createTestQueryClient();

        await expect(runLoader(ArtistsRoute, { context: { queryClient }, deps: { page: 0, search: '', ...ORDER } })).resolves.toBeUndefined();
        expect(queryClient.getQueryState(queryKeys.catalog.artists(0, '', orderKey('name')))?.status).toBe('error');
    });
});

describe('/catalog/tracks loader', () => {
    it('carries the search term through, since finding one song is what the flat list is for', async () => {
        listTracks.mockResolvedValue(emptyPage);
        const queryClient = createTestQueryClient();

        await runLoader(TracksRoute, { context: { queryClient }, deps: { page: 0, search: 'vaka', sortBy: 'title', sort: 'asc', pageSize: DEFAULT_PAGE_SIZE } });

        expect(listTracks).toHaveBeenCalledWith(expect.objectContaining({ search: 'vaka' }));
        expect(queryClient.getQueryData(queryKeys.catalog.tracks(0, 'vaka', undefined, orderKey('title')))).toEqual(emptyPage);
    });
});

describe('the drill-down loaders', () => {
    it('warm both halves of the artist page in one pass', async () => {
        getArtist.mockResolvedValue({ id: ARTIST_ID, name: 'Sigur Rós', rating: 'neutral', albumCount: 0, trackCount: 0 });
        listArtistAlbums.mockResolvedValue(emptyPage);
        const queryClient = createTestQueryClient();

        await runLoader(ArtistRoute, { context: { queryClient }, params: { artistId: ARTIST_ID }, deps: { page: 0, ...ORDER } });

        expect(queryClient.getQueryData(queryKeys.catalog.artist(ARTIST_ID))).toBeDefined();
        expect(queryClient.getQueryData(queryKeys.catalog.artistAlbums(ARTIST_ID, 0, undefined, orderKey('name')))).toEqual(emptyPage);
    });

    it('warm both halves of the album page in one pass', async () => {
        getAlbum.mockResolvedValue({ id: ALBUM_ID, name: '( )', artistId: ARTIST_ID, artistName: 'Sigur Rós', rating: 'neutral', trackCount: 0 });
        listAlbumTracks.mockResolvedValue(emptyPage);
        const queryClient = createTestQueryClient();

        await runLoader(AlbumRoute, { context: { queryClient }, params: { albumId: ALBUM_ID }, deps: { page: 0, sortBy: 'title', sort: 'asc', pageSize: DEFAULT_PAGE_SIZE } });

        expect(queryClient.getQueryData(queryKeys.catalog.album(ALBUM_ID))).toBeDefined();
        expect(queryClient.getQueryData(queryKeys.catalog.albumTracks(ALBUM_ID, 0, undefined, orderKey('title')))).toEqual(emptyPage);
    });

    it('land the navigation on an artist that was merged away, leaving the 404 for the page to render', async () => {
        getArtist.mockRejectedValue(new SdkError(404, 'Not Found', { statusCode: 404, message: 'gone' }, new Headers()));
        listArtistAlbums.mockResolvedValue(emptyPage);
        const queryClient = createTestQueryClient();

        await expect(
            runLoader(ArtistRoute, { context: { queryClient }, params: { artistId: ARTIST_ID }, deps: { page: 0, ...ORDER } }),
        ).resolves.toBeUndefined();
        expect(queryClient.getQueryState(queryKeys.catalog.artist(ARTIST_ID))?.status).toBe('error');
    });
});
