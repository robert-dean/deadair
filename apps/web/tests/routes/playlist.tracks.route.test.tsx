// The route module rather than the page: what is under test is the loader's contract with the
// router, namely that a failed prefetch does not abandon the navigation. The page's own error
// rendering is covered in `components/playlists/playlist.tracks.page.test.tsx`, and that alert is
// only reachable because of what this file pins.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { queryKeys } from '../../src/api/query.keys';
import { createTestQueryClient } from '../utils/render';

const getPlaylistTracks = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: { playlists: { getPlaylistTracks: (pluginId: string, playlistId: string) => getPlaylistTracks(pluginId, playlistId) } },
}));

// Curried like the real thing — `createFileRoute(path)(options)` — but handing the options back
// so the loader can be called directly, without standing up the generated route tree.
vi.mock('@tanstack/react-router', () => ({
    createFileRoute: () => (options: unknown) => options,
}));

const { Route } = await import('../../src/routes/playlists/$pluginId/$playlistId');

const PLUGIN_ID = 'deadair.spotify';
const PLAYLIST_ID = 'playlist-1';

/** Calls the route loader the way the router does. */
async function runLoader(queryClient: ReturnType<typeof createTestQueryClient>) {
    const loader = (Route as unknown as { loader: (args: unknown) => Promise<unknown> }).loader;
    return loader({ context: { queryClient }, params: { pluginId: PLUGIN_ID, playlistId: PLAYLIST_ID } });
}

afterEach(() => {
    getPlaylistTracks.mockReset();
});

describe('/playlists/$pluginId/$playlistId loader', () => {
    it('warms the cache from the same query the page reads', async () => {
        const tracks = { pluginId: PLUGIN_ID, playlistId: PLAYLIST_ID, tracks: [] };
        getPlaylistTracks.mockResolvedValue(tracks);
        const queryClient = createTestQueryClient();

        await runLoader(queryClient);

        expect(getPlaylistTracks).toHaveBeenCalledWith(PLUGIN_ID, PLAYLIST_ID);
        expect(queryClient.getQueryData(queryKeys.playlists.tracks(PLUGIN_ID, PLAYLIST_ID))).toEqual(tracks);
    });

    it('resolves rather than rejecting when the plugin is unavailable, so navigation still lands', async () => {
        getPlaylistTracks.mockRejectedValue(
            new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'plugin is not running' }, new Headers()),
        );
        const queryClient = createTestQueryClient();

        await expect(runLoader(queryClient)).resolves.toBeUndefined();
    });

    it('leaves the failure in the query cache, which is what the page renders its alert from', async () => {
        getPlaylistTracks.mockRejectedValue(
            new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'plugin is not running' }, new Headers()),
        );
        const queryClient = createTestQueryClient();

        await runLoader(queryClient);

        const state = queryClient.getQueryState(queryKeys.playlists.tracks(PLUGIN_ID, PLAYLIST_ID));
        expect(state?.status).toBe('error');
        expect(state?.error).toBeInstanceOf(SdkError);
    });
});
