import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CatalogPlaylistPage } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long a playlist read stays fresh.
 *
 * The listing is what the library sync last read of every enabled source, and the one thing an
 * operator can change about it here (hiding a playlist) is written straight into the cache rather
 * than refetched. A short stale time is what stands between the operator and a list that quietly
 * drifts from what the sync has since read.
 */
const PLAYLIST_STALE_TIME = 10_000;

export const playlistsListOptions = queryOptions({
    queryKey: queryKeys.playlists.list(),
    queryFn: () => sdk.playlists.listImportablePlaylists(),
    staleTime: PLAYLIST_STALE_TIME,
});

/** How often the listing is read again while a refresh the operator asked for is under way. */
export const REFRESH_POLL_INTERVAL = 5_000;

/**
 * How long the listing is read again for after a refresh. The walk reads each source's list before
 * any of its tracks, so a list is normally new within seconds; this is the ceiling for a source that
 * never answers, whose list stays as old as it was.
 */
export const REFRESH_POLL_LIMIT = 180_000;

/**
 * Whether the listing still needs reading again after a refresh asked for at `since` (epoch millis):
 * until every source's list is at least that new, or the limit has passed. A page from a station
 * that says nothing about its sources has nothing to wait for.
 */
export function awaitingRefresh(page: CatalogPlaylistPage | undefined, since: number | undefined, now = Date.now()): boolean {
    if (since === undefined || now - since > REFRESH_POLL_LIMIT) return false;
    if (page?.sources === undefined) return page === undefined;
    return page.sources.some(source => source.listedAt.toMillis() < since);
}

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

/**
 * Ask for every playlist on every source to be read again now. The station walks them in the
 * background, so this resolves when the request is taken rather than when the walk is done. The page
 * reads the listing again until each source's list is newer than the request (see
 * {@link awaitingRefresh}); the finished walk, tracks and all, is announced on the activity feed.
 */
export function useRefreshPlaylists() {
    return useMutation({ mutationFn: () => sdk.playlists.refreshPlaylists() });
}

/** Ask for one playlist to be read again now, on the same terms as {@link useRefreshPlaylists}. */
export function useRefreshPlaylist() {
    return useMutation({
        mutationFn: ({ pluginId, playlistId }: { pluginId: string; playlistId: string }) => sdk.playlists.refreshPlaylist(pluginId, playlistId),
    });
}
