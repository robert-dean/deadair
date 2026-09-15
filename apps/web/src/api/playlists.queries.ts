import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CatalogPlaylistPage } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long a playlist read stays fresh.
 *
 * The listing is live catalog data fanned out from whatever plugins happen to be enabled, and the
 * one thing an operator can change about it here (hiding a playlist) is written straight into the
 * cache rather than refetched. A short stale time is what stands between the operator and a list
 * that quietly drifts from what the plugins actually have.
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

export interface PlaylistHiddenChange {
    pluginId: string;
    playlistId: string;
    /** True to hide it from this station, false to show it again. */
    hidden: boolean;
}

/**
 * Hide a playlist from this station, or show it again.
 *
 * The answer is written into the cached listing rather than refetched. A refetch would ask every
 * enabled plugin for its whole playlist list again to learn one flag the server has just confirmed,
 * and every picker on the console reads that same cache, so they stop offering the playlist at once.
 */
export function useSetPlaylistHidden() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ pluginId, playlistId, hidden }: PlaylistHiddenChange) =>
            hidden ? sdk.playlists.hidePlaylist(pluginId, playlistId) : sdk.playlists.showPlaylist(pluginId, playlistId),
        onSuccess: (_answer, { pluginId, playlistId, hidden }) => {
            queryClient.setQueryData<CatalogPlaylistPage>(queryKeys.playlists.list(), page =>
                page === undefined
                    ? undefined
                    : {
                          ...page,
                          playlists: page.playlists.map(playlist =>
                              playlist.pluginId === pluginId && playlist.id === playlistId
                                  ? { ...playlist, hidden: hidden ? true : undefined }
                                  : playlist,
                          ),
                      },
            );
        },
    });
}
