import { keepPreviousData, queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Album, Artist, Rating, TrackState } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';
import { TRACK_STATES } from '../components/catalog/catalog.page.params';

/**
 * How long a catalog read stays fresh.
 *
 * Much longer than the playlists' ten seconds, because this is a different kind of data. A
 * playlist page is a live fan-out to whatever plugins are enabled and can drift the moment one of
 * them changes. The catalog is the station's own rows, and they only move when an ingest job runs.
 */
const CATALOG_STALE_TIME = 60_000;

/**
 * How long one record's accumulated state stays fresh.
 *
 * Shorter than the catalog's own minute, because the facts on that page are not catalogue facts: the
 * bytes arrive, the measurement lands and the record airs on the station's schedule rather than on
 * an ingest's, and somebody has the page open precisely because they are waiting for one of them.
 */
const TRACK_DETAIL_STALE_TIME = 15_000;

/** Rows per page. Below the contract's `pageSize` ceiling of 100, and dense enough to scroll rather than page. */
export const CATALOG_PAGE_SIZE = 50;

/** A page of any catalog list, as the routes carry it in their search params. */
export interface CatalogPageInput {
    /** Zero-based, matching the API. The Mantine pager is one-based and converts at the edge. */
    page: number;
    search?: string;
}

/** A page of tracks, which can also be narrowed by what the station has of each record. */
export interface CatalogTrackPageInput extends CatalogPageInput {
    state?: string;
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

/**
 * One record and everything it has accumulated.
 *
 * Its own stale time, shorter than the rest of the catalog's minute, because unlike a catalogue row
 * this moves without an ingest: the station fetches the audio, serves it, measures it and airs it,
 * and an operator on this page is usually watching for exactly one of those to happen.
 */
export function catalogTrackOptions(id: string) {
    return queryOptions({
        queryKey: queryKeys.catalog.track(id),
        queryFn: () => sdk.catalog.getTrack(id),
        staleTime: TRACK_DETAIL_STALE_TIME,
    });
}

export function catalogTrackEnrichmentOptions(id: string) {
    return queryOptions({
        queryKey: queryKeys.catalog.trackEnrichment(id),
        queryFn: () => sdk.catalog.getTrackEnrichment(id),
        staleTime: ENRICHMENT_STALE_TIME,
    });
}

export function catalogTracksOptions(input: CatalogTrackPageInput) {
    return queryOptions({
        queryKey: queryKeys.catalog.tracks(input.page, input.search, input.state),
        // The state rides the same query as the page and the search, so a filtered list is a
        // different request rather than the same one filtered afterwards — which is what keeps
        // `meta.total` describing the set the pager is paging through.
        queryFn: () => sdk.catalog.listTracks({ ...pageQuery(input), state: trackState(input.state) }),
        staleTime: CATALOG_STALE_TIME,
        placeholderData: keepPreviousData,
    });
}

/** An empty filter is no filter, matching how `search` is dropped rather than sent empty. */
const trackState = (state: string | undefined): TrackState | undefined =>
    TRACK_STATES.find((known): known is TrackState => known === state);

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
/** Which of a record's derived things to throw away. Each is a verb of its own; see `catalog.ck`. */
export type TrackClear = 'audio' | 'analysis' | 'enrichment' | 'retry';

/**
 * Throw away one of the things the station can work out again about a record.
 *
 * One mutation for the four rather than four hooks, because they are one gesture with a different
 * object: the page holds a single pending state and shows a single answer, and a menu of four
 * buttons wired to four hooks would have four of each.
 *
 * The detail read is invalidated and nothing else: a clear changes what the station HAS of a record,
 * which is what that read describes. The lists get it on their own next fetch, and the enrichment
 * read is invalidated only when the clear was about enrichment.
 */
export function useClearTrack() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, what }: { id: string; what: TrackClear }) => {
            if (what === 'audio') return sdk.catalog.clearTrackAudio(id);
            if (what === 'analysis') return sdk.catalog.clearTrackAnalysis(id);
            if (what === 'enrichment') return sdk.catalog.clearTrackEnrichment(id);
            return sdk.catalog.retryTrackAudio(id);
        },
        onSuccess: (_result, { id, what }) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.track(id) });
            if (what === 'enrichment') void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.trackEnrichment(id) });
        },
    });
}

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
