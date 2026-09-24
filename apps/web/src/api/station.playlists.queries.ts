import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlaylistImportInput, PlaylistImportPlan, PlaylistImportResult, StationPlaylist, StationPlaylistUpdate } from '@deadair/sdk';

import { downloadFilename, saveJsonDownload } from '../components/shared/download';
import { sdk } from './client';
import { queryKeys } from './query.keys';

/** Every playlist the station owns. Written only from this console, so it is fresh until a write here invalidates it. */
export const stationPlaylistsListOptions = queryOptions({
    queryKey: queryKeys.stationPlaylists.list(),
    queryFn: () => sdk.playlists.listStationPlaylists(),
});

/**
 * One station playlist with its rows. Stale on a short timer rather than never, because a
 * placeholder resolves in the background whenever the library grows, and nothing here is told.
 */
export function stationPlaylistOptions(id: string) {
    return queryOptions({
        queryKey: queryKeys.stationPlaylists.detail(id),
        queryFn: () => sdk.playlists.getStationPlaylist(id),
        staleTime: 10_000,
    });
}

/**
 * What a source would become here. A mutation rather than a query, as the persona import's preview
 * is: the console asks it the moment a source is chosen, and it writes nothing and caches nothing.
 */
export const usePreviewPlaylistImport = () =>
    useMutation<PlaylistImportPlan, Error, PlaylistImportInput>({
        mutationFn: (input: PlaylistImportInput) => sdk.playlists.previewPlaylistImport(input),
    });

/**
 * What cloning one of a music source's playlists would do, as a query: the preview of a source there
 * is nothing to choose about. Never cached past the dialog that asked, since the provider's list and
 * the library can both move between one opening and the next.
 */
export function providerPlaylistPreviewOptions(pluginId: string, playlistId: string) {
    return queryOptions({
        queryKey: [...queryKeys.stationPlaylists.all(), 'preview', pluginId, playlistId] as const,
        queryFn: () => sdk.playlists.previewPlaylistImport({ providerPlaylist: { pluginId, playlistId } }),
        staleTime: 0,
        gcTime: 0,
    });
}

export function useImportPlaylist() {
    const queryClient = useQueryClient();
    return useMutation<PlaylistImportResult, Error, PlaylistImportInput>({
        mutationFn: (input: PlaylistImportInput) => sdk.playlists.importPlaylist(input),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.stationPlaylists.list() }),
    });
}

export function useUpdateStationPlaylist() {
    const queryClient = useQueryClient();
    return useMutation<StationPlaylist, Error, { id: string; changes: StationPlaylistUpdate }>({
        mutationFn: ({ id, changes }) => sdk.playlists.updateStationPlaylist(id, changes),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.stationPlaylists.all() }),
    });
}

export function useDeleteStationPlaylist() {
    const queryClient = useQueryClient();
    return useMutation<void, Error, string>({
        mutationFn: (id: string) => sdk.playlists.deleteStationPlaylist(id),
        onSuccess: (_answer, id) => {
            queryClient.removeQueries({ queryKey: queryKeys.stationPlaylists.detail(id) });
            return queryClient.invalidateQueries({ queryKey: queryKeys.stationPlaylists.list() });
        },
    });
}

/**
 * Ask for the records a station playlist names and the library lacks to be looked up now. It
 * resolves when the request is taken rather than when the look-up is done, and touches no cache: the
 * finished run is announced on the activity feed, and the page reads the rows again on its timer.
 */
export function useFillStationPlaylist() {
    return useMutation<void, Error, string>({ mutationFn: (id: string) => sdk.playlists.fillStationPlaylist(id) });
}

/**
 * Save one station playlist as a file. A plain function rather than a mutation, on the persona
 * export's rule: the result is a file rather than state this app holds, and the filename comes off
 * the response's own `Content-Disposition`.
 */
export async function exportStationPlaylist(id: string): Promise<void> {
    const { data, headers } = await sdk.playlists.exportStationPlaylist(id);
    saveJsonDownload(data, downloadFilename(headers.contentDisposition, 'playlist.json'));
}
