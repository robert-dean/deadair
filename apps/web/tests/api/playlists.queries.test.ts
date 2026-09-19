import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { playlistTracksOptions, playlistsListOptions, useRefreshPlaylist, useRefreshPlaylists } from '../../src/api/playlists.queries';
import { queryKeys } from '../../src/api/query.keys';
import { catalogPlaylistPage, catalogTrack } from '../utils/playlist.fixture';
import { createTestQueryClient } from '../utils/render';

const listImportablePlaylists = vi.fn();
const getPlaylistTracks = vi.fn();
const refreshPlaylists = vi.fn();
const refreshPlaylist = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        playlists: {
            listImportablePlaylists: () => listImportablePlaylists(),
            getPlaylistTracks: (...args: unknown[]) => getPlaylistTracks(...args),
            refreshPlaylists: () => refreshPlaylists(),
            refreshPlaylist: (...args: unknown[]) => refreshPlaylist(...args),
        },
    },
}));

afterEach(() => {
    listImportablePlaylists.mockReset();
    getPlaylistTracks.mockReset();
    refreshPlaylists.mockReset();
    refreshPlaylist.mockReset();
});

describe('playlistsListOptions', () => {
    it('keys on the shared playlists.list tuple', () => {
        expect(playlistsListOptions.queryKey).toEqual(queryKeys.playlists.list());
    });

    it('reads through to the SDK and hands back the page unchanged', async () => {
        const page = catalogPlaylistPage();
        listImportablePlaylists.mockResolvedValue(page);

        await expect(playlistsListOptions.queryFn?.({} as never)).resolves.toEqual(page);
        expect(listImportablePlaylists).toHaveBeenCalledTimes(1);
    });
});

describe('playlistTracksOptions', () => {
    it('keys on the plugin and playlist so two playlists never collide', () => {
        const options = playlistTracksOptions('deadair.spotify', 'playlist-1');

        expect(options.queryKey).toEqual(queryKeys.playlists.tracks('deadair.spotify', 'playlist-1'));
    });

    it('passes the plugin and playlist ids through to the SDK in order', async () => {
        const tracks = { pluginId: 'deadair.spotify', playlistId: 'playlist-1', tracks: [catalogTrack()] };
        getPlaylistTracks.mockResolvedValue(tracks);

        const options = playlistTracksOptions('deadair.spotify', 'playlist-1');
        await expect(options.queryFn?.({} as never)).resolves.toEqual(tracks);
        expect(getPlaylistTracks).toHaveBeenCalledWith('deadair.spotify', 'playlist-1');
    });
});

describe('the refresh mutations', () => {
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: createTestQueryClient() }, children);

    it('asks for every playlist to be read again', async () => {
        refreshPlaylists.mockResolvedValue(undefined);
        const { result } = renderHook(() => useRefreshPlaylists(), { wrapper });

        await result.current.mutateAsync();

        expect(refreshPlaylists).toHaveBeenCalledTimes(1);
    });

    it('asks for one playlist by its plugin and id, in that order', async () => {
        refreshPlaylist.mockResolvedValue(undefined);
        const { result } = renderHook(() => useRefreshPlaylist(), { wrapper });

        await result.current.mutateAsync({ pluginId: 'deadair.spotify', playlistId: 'playlist-1' });

        expect(refreshPlaylist).toHaveBeenCalledWith('deadair.spotify', 'playlist-1');
    });
});
