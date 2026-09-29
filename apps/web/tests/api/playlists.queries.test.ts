import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DateTime } from 'luxon';
import {
    awaitingRefresh,
    playlistTracksOptions,
    playlistsListOptions,
    REFRESH_POLL_LIMIT,
    useRefreshPlaylist,
    useRefreshPlaylists,
} from '../../src/api/playlists.queries';
import { queryKeys } from '../../src/api/query.keys';
import { catalogPlaylistPage, catalogPlaylistSource, catalogTrack } from '../utils/playlist.fixture';
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

describe('awaitingRefresh', () => {
    const asked = DateTime.fromISO('2026-09-29T08:00:00Z').toMillis();
    const listed = (iso: string, pluginId = 'deadair.spotify') => catalogPlaylistSource({ pluginId, listedAt: DateTime.fromISO(iso) });

    it('waits on nothing when no refresh was asked for', () => {
        expect(awaitingRefresh(catalogPlaylistPage({ sources: [listed('2026-09-29T07:00:00Z')] }), undefined, asked)).toBe(false);
    });

    it("waits while any source's list is older than the refresh", () => {
        const page = catalogPlaylistPage({ sources: [listed('2026-09-29T08:00:05Z'), listed('2026-09-29T07:00:00Z', 'deadair.other')] });

        expect(awaitingRefresh(page, asked, asked + 10_000)).toBe(true);
    });

    it('stops once every list is at least as new as the refresh', () => {
        const page = catalogPlaylistPage({ sources: [listed('2026-09-29T08:00:05Z'), listed('2026-09-29T08:00:00Z', 'deadair.other')] });

        expect(awaitingRefresh(page, asked, asked + 10_000)).toBe(false);
    });

    it('gives up on a source that never answers once the limit has passed', () => {
        const page = catalogPlaylistPage({ sources: [listed('2026-09-29T07:00:00Z')] });

        expect(awaitingRefresh(page, asked, asked + REFRESH_POLL_LIMIT + 1)).toBe(false);
    });

    it('has nothing to wait for from a station that does not say how old its lists are', () => {
        expect(awaitingRefresh(catalogPlaylistPage(), asked, asked)).toBe(false);
    });
});
