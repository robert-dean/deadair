import { keepPreviousData, queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Album, Artist, Rating } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long a catalog read stays fresh.
 *
 * Much longer than the playlists' ten seconds, because this is a different kind of data. A
 * playlist page is a live fan-out to whatever plugins are enabled and can drift the moment one of
 * them changes. The catalog is the station's own rows, and they only move when an ingest job runs.
 */
const CATALOG_STALE_TIME = 60_000;

/** Rows per page. Below the contract's `pageSize` ceiling of 100, and dense enough to scroll rather than page. */
export const CATALOG_PAGE_SIZE = 50;

/** A page of any catalog list, as the routes carry it in their search params. */
export interface CatalogPageInput {
    /** Zero-based, matching the API. The Mantine pager is one-based and converts at the edge. */
    page: number;
    search?: string;
}

/**
 * The wire query for a page.
 *
 * `sort: 'asc'` is sent explicitly because the shared `Pagination` contract defaults to `desc`,
 * which over the catalog's name ordering would open every list at Z. An empty search is dropped
 * rather than sent, since the contract's `search` has a `min=1`.
 */
function pageQuery({ page, search }: CatalogPageInput) {
    return { page, pageSize: CATALOG_PAGE_SIZE, sort: 'asc' as const, search: search === undefined || search === '' ? undefined : search };
}

export function catalogArtistsOptions(input: CatalogPageInput) {
    return queryOptions({
        queryKey: queryKeys.catalog.artists(input.page, input.search),
        queryFn: () => sdk.catalog.listArtists(pageQuery(input)),
        staleTime: CATALOG_STALE_TIME,
        // Paging and typing both change the key, so without this the table would blank out on
        // every keystroke and every page turn.
        placeholderData: keepPreviousData,
    });
}

export function catalogArtistOptions(id: string) {
    return queryOptions({
        queryKey: queryKeys.catalog.artist(id),
        queryFn: () => sdk.catalog.getArtist(id),
        staleTime: CATALOG_STALE_TIME,
    });
}

export function catalogArtistAlbumsOptions(id: string, input: CatalogPageInput) {
    return queryOptions({
        queryKey: queryKeys.catalog.artistAlbums(id, input.page, input.search),
        queryFn: () => sdk.catalog.listArtistAlbums(id, pageQuery(input)),
        staleTime: CATALOG_STALE_TIME,
        placeholderData: keepPreviousData,
    });
}

export function catalogAlbumsOptions(input: CatalogPageInput) {
    return queryOptions({
        queryKey: queryKeys.catalog.albums(input.page, input.search),
        queryFn: () => sdk.catalog.listAlbums(pageQuery(input)),
        staleTime: CATALOG_STALE_TIME,
        placeholderData: keepPreviousData,
    });
}

export function catalogAlbumOptions(id: string) {
    return queryOptions({
        queryKey: queryKeys.catalog.album(id),
        queryFn: () => sdk.catalog.getAlbum(id),
        staleTime: CATALOG_STALE_TIME,
    });
}

export function catalogAlbumTracksOptions(id: string, input: CatalogPageInput) {
    return queryOptions({
        queryKey: queryKeys.catalog.albumTracks(id, input.page, input.search),
        queryFn: () => sdk.catalog.listAlbumTracks(id, pageQuery(input)),
        staleTime: CATALOG_STALE_TIME,
        placeholderData: keepPreviousData,
    });
}

/**
 * How long a stored enrichment read stays fresh.
 *
 * Far longer than the catalog's own minute, because these rows barely move: a payload is trusted
 * for ninety days before the walk asks its provider again, and nothing in the console writes one.
 * The only thing that changes underneath is a background pass, which no amount of refetching would
 * catch at the moment it happens.
 */
const ENRICHMENT_STALE_TIME = 10 * 60_000;

export function catalogArtistEnrichmentOptions(id: string) {
    return queryOptions({
        queryKey: queryKeys.catalog.artistEnrichment(id),
        queryFn: () => sdk.catalog.getArtistEnrichment(id),
        staleTime: ENRICHMENT_STALE_TIME,
    });
}

export function catalogAlbumEnrichmentOptions(id: string) {
    return queryOptions({
        queryKey: queryKeys.catalog.albumEnrichment(id),
        queryFn: () => sdk.catalog.getAlbumEnrichment(id),
        staleTime: ENRICHMENT_STALE_TIME,
    });
}

export function catalogTrackEnrichmentOptions(id: string) {
    return queryOptions({
        queryKey: queryKeys.catalog.trackEnrichment(id),
        queryFn: () => sdk.catalog.getTrackEnrichment(id),
        staleTime: ENRICHMENT_STALE_TIME,
    });
}

export function catalogTracksOptions(input: CatalogPageInput) {
    return queryOptions({
        queryKey: queryKeys.catalog.tracks(input.page, input.search),
        queryFn: () => sdk.catalog.listTracks(pageQuery(input)),
        staleTime: CATALOG_STALE_TIME,
        placeholderData: keepPreviousData,
    });
}

/**
 * Every cached list that could be showing a row of this kind, marked stale.
 *
 * A prefix will not do it. The flat lists are keyed `['catalog', 'artists', …]`, but an artist's
 * albums are keyed under the artist (`['catalog', 'artist', id, 'albums', …]`) and an album's tracks
 * under the album, so `['catalog', 'albums']` reaches neither. Matching on the segment anywhere in
 * the key reaches all of them, and deliberately misses the enrichment keys: what a provider said
 * about a record has nothing to do with what the operator thinks of it, and their ten-minute
 * freshness is not worth spending on an opinion.
 */
function invalidateRatedLists(queryClient: QueryClient, kind: 'artists' | 'albums' | 'tracks'): void {
    void queryClient.invalidateQueries({
        predicate: query => query.queryKey[0] === 'catalog' && query.queryKey.includes(kind),
    });
}

/**
 * What the station thinks of an artist.
 *
 * The answer is the artist as it now stands, so it goes straight into the detail cache rather than
 * being re-read, the way the running order's edits do. The lists around it are invalidated instead:
 * they are paged and searched, and there is no telling which page this row is on.
 */
export function useRateArtist() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, rating }: { id: string; rating: Rating }) => sdk.catalog.rateArtist(id, { rating }),
        onSuccess: (artist: Artist) => {
            queryClient.setQueryData(queryKeys.catalog.artist(artist.id), artist);
            invalidateRatedLists(queryClient, 'artists');
        },
    });
}

/** What the station thinks of a record. */
export function useRateAlbum() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, rating }: { id: string; rating: Rating }) => sdk.catalog.rateAlbum(id, { rating }),
        onSuccess: (album: Album) => {
            queryClient.setQueryData(queryKeys.catalog.album(album.id), album);
            invalidateRatedLists(queryClient, 'albums');
        },
    });
}

/**
 * What the station thinks of a song.
 *
 * Also invalidates the running order, which carries each item's rating so the on-air table can draw
 * a control that is not lying. Without it the row would keep its old answer until the next poll.
 */
export function useRateTrack() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, rating }: { id: string; rating: Rating }) => sdk.catalog.rateTrack(id, { rating }),
        onSuccess: () => {
            invalidateRatedLists(queryClient, 'tracks');
            void queryClient.invalidateQueries({ queryKey: queryKeys.director.order() });
        },
    });
}
