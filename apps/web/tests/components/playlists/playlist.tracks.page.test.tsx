import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { PlaylistTracksPage } from '../../../src/components/playlists/playlist.tracks.page';
import { queryKeys } from '../../../src/api/query.keys';
import { catalogPlaylistPage, catalogTrack } from '../../utils/playlist.fixture';
import { createTestQueryClient, render, screen } from '../../utils/render';

const getPlaylistTracks = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { playlists: { getPlaylistTracks: (pluginId: string, playlistId: string) => getPlaylistTracks(pluginId, playlistId) } },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
}));

afterEach(() => {
    getPlaylistTracks.mockReset();
});

describe('PlaylistTracksPage', () => {
    it('renders a row per track with the count in the subheading', async () => {
        getPlaylistTracks.mockResolvedValue({
            pluginId: 'deadair.spotify',
            playlistId: 'playlist-1',
            tracks: [
                catalogTrack(),
                catalogTrack({ id: 'track-2', title: 'Le Freak', artists: ['Chic', 'Nile Rodgers'], album: undefined, durationMs: 195000 }),
            ],
        });

        render(<PlaylistTracksPage pluginId="deadair.spotify" playlistId="playlist-1" />);

        expect(await screen.findByText('Good Times')).toBeInTheDocument();
        expect(screen.getByText('Chic')).toBeInTheDocument();
        expect(screen.getByText("C'est Chic")).toBeInTheDocument();
        expect(screen.getByText('3:38')).toBeInTheDocument();
        expect(screen.getByText('Le Freak')).toBeInTheDocument();
        expect(screen.getByText('Chic, Nile Rodgers')).toBeInTheDocument();
        expect(screen.getByText('From deadair.spotify • 2 tracks')).toBeInTheDocument();
        expect(getPlaylistTracks).toHaveBeenCalledWith('deadair.spotify', 'playlist-1');
    });

    it('uses the cached playlist name from the list query when available', async () => {
        getPlaylistTracks.mockResolvedValue({ pluginId: 'deadair.spotify', playlistId: 'playlist-1', tracks: [] });

        const queryClient = createTestQueryClient();
        queryClient.setQueryData(queryKeys.playlists.list(), catalogPlaylistPage());

        render(<PlaylistTracksPage pluginId="deadair.spotify" playlistId="playlist-1" />, { queryClient });

        expect(await screen.findByRole('heading', { name: 'Friday Night' })).toBeInTheDocument();
    });

    it('falls back to the raw playlist id when the list cache is cold', async () => {
        getPlaylistTracks.mockResolvedValue({ pluginId: 'deadair.spotify', playlistId: 'playlist-9', tracks: [] });

        render(<PlaylistTracksPage pluginId="deadair.spotify" playlistId="playlist-9" />);

        expect(await screen.findByRole('heading', { name: 'playlist-9' })).toBeInTheDocument();
    });

    it('says so when the playlist has no tracks', async () => {
        getPlaylistTracks.mockResolvedValue({ pluginId: 'deadair.spotify', playlistId: 'playlist-1', tracks: [] });

        render(<PlaylistTracksPage pluginId="deadair.spotify" playlistId="playlist-1" />);

        expect(await screen.findByText('This playlist has no tracks.')).toBeInTheDocument();
    });

    it('shows an error alert when the tracks fail to load', async () => {
        getPlaylistTracks.mockRejectedValue(
            new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'The catalog service is down.' }, new Headers()),
        );

        render(<PlaylistTracksPage pluginId="deadair.spotify" playlistId="playlist-1" />);

        expect(await screen.findByText('Tracks could not be loaded')).toBeInTheDocument();
        expect(screen.getByText('The catalog service is down.')).toBeInTheDocument();
    });
});
