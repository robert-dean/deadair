import { queryOptions } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long a playlist read stays fresh.
 *
 * Unlike the plugins module, nothing here writes to the cache on the operator's behalf: this is
 * live catalog data fanned out from whatever plugins happen to be enabled, with no mutation to
 * hang a refetch off of. A short stale time is the only thing standing between the operator and a
 * list that quietly drifts from what the plugins actually have.
 */
const PLAYLIST_STALE_TIME = 10_000;

export const playlistsListOptions = queryOptions({
    queryKey: queryKeys.playlists.list(),
    queryFn: () => sdk.playlists.listImportablePlaylists(),
    staleTime: PLAYLIST_STALE_TIME,
});

export function playlistTracksOptions(pluginId: string, playlistId: string) {
    return queryOptions({
        queryKey: queryKeys.playlists.tracks(pluginId, playlistId),
        queryFn: () => sdk.playlists.getPlaylistTracks(pluginId, playlistId),
        staleTime: PLAYLIST_STALE_TIME,
    });
}
