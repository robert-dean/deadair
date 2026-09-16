import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the list of series stays fresh.
 *
 * Long, on `podcast.queries.ts`' reason: what a plugin offers changes when an operator points it at
 * something new, not on its own, and asking may mean opening every file on the list.
 */
const SERIES_STALE_TIME = 5 * 60_000;

/**
 * How long a page of pieces stays fresh.
 *
 * Short, because it is the station's own table and answering costs nothing, and because what an
 * operator watches here moves while they watch: a chapter they asked for finishing being spoken, a
 * reading airing.
 */
const PIECES_STALE_TIME = 15_000;

export const narrationSeriesOptions = queryOptions({
    queryKey: queryKeys.narrations.series(),
    queryFn: () => sdk.narrations.listSeries(),
    staleTime: SERIES_STALE_TIME,
});

/** Every series the installed narration plugins offer. */
export function useNarrationSeries() {
    return useQuery(narrationSeriesOptions);
}

export function narrationPiecesOptions(seriesId?: string) {
    return queryOptions({
        queryKey: queryKeys.narrations.pieces(seriesId),
        queryFn: () => sdk.narrations.listPieces(seriesId === undefined ? {} : { seriesId }),
        staleTime: PIECES_STALE_TIME,
    });
}

/** The pieces the station knows about, in their series' own order. Absent `seriesId` is every series'. */
export function useNarrationPieces(seriesId?: string) {
    return useQuery(narrationPiecesOptions(seriesId));
}

/**
 * Ask for every series to be read again now. The station does it in the background, so what this
 * resolves to is the request being taken rather than the pieces having arrived.
 */
export function useRefreshNarrations() {
    return useMutation({ mutationFn: () => sdk.narrations.refreshNarrations() });
}

/**
 * Ask for one piece to be spoken now. Every cached page of pieces is read again once the request is
 * taken, so the button becomes "Reading" without waiting for the page to go stale.
 */
export function useRenderPiece() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => sdk.narrations.renderPiece(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['narrations', 'pieces'] });
        },
    });
}
