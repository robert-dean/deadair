import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { PlaylistTracksPage } from '../../../src/components/playlists/playlist.tracks.page';
import { queryKeys } from '../../../src/api/query.keys';
import { stubPhoneMedia } from '../../utils/phone';
import { catalogPlaylistPage, catalogTrack } from '../../utils/playlist.fixture';
import { createTestQueryClient, render, screen } from '../../utils/render';

const getPlaylistTracks = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { playlists: { getPlaylistTracks: (pluginId: string, playlistId: string) => getPlaylistTracks(pluginId, playlistId) } },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: ReactNode }) => (
        <a href={Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)} {...rest}>
            {children}
        </a>
    ),
    // The import button lands on the lineup it just made.
    useNavigate: () => vi.fn(),
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

    // A playlist is the provider's list, so both halves are ordinary here and the default fixture is
    // the unowned one: a copy the station has ingested reaches its catalog pages, and one it has not
    // is the same words with nowhere to go.
    it('reaches the catalog for a copy the station holds, and not for one it does not', async () => {
        getPlaylistTracks.mockResolvedValue({
            pluginId: 'deadair.spotify',
            playlistId: 'playlist-1',
            tracks: [
                catalogTrack({ trackId: 'trk_1', artistId: 'art_1', albumId: 'alb_1' }),
                catalogTrack({ id: 'track-2', title: 'Le Freak', artists: ['Nile Rodgers'], album: undefined }),
            ],
        });

        render(<PlaylistTracksPage pluginId="deadair.spotify" playlistId="playlist-1" />);

        expect(await screen.findByRole('link', { name: 'Good Times' })).toHaveAttribute('href', '/catalog/tracks/trk_1');
        expect(screen.getByRole('link', { name: 'Chic' })).toHaveAttribute('href', '/catalog/artists/art_1');
        expect(screen.getByRole('link', { name: "C'est Chic" })).toHaveAttribute('href', '/catalog/albums/alb_1');

        expect(screen.getByText('Le Freak')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Le Freak' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Nile Rodgers' })).not.toBeInTheDocument();
    });

    it('says so when the playlist has no tracks', async () => {
        getPlaylistTracks.mockResolvedValue({ pluginId: 'deadair.spotify', playlistId: 'playlist-1', tracks: [] });

        render(<PlaylistTracksPage pluginId="deadair.spotify" playlistId="playlist-1" />);

        expect(await screen.findByText('This playlist has no tracks.')).toBeInTheDocument();
    });

    // The selection, not the shape, is what these two cases pin: a phone reader still gets the
    // title, the credit and the duration, and the album is the deliberately dropped column rather
    // than one that happened to fall off the right edge.
    it('gives a phone cards rather than a sideways-scrolling table', async () => {
        const restore = stubPhoneMedia();
        try {
            getPlaylistTracks.mockResolvedValue({
                pluginId: 'deadair.spotify',
                playlistId: 'playlist-1',
                tracks: [catalogTrack({ trackId: 'trk_1' })],
            });

            render(<PlaylistTracksPage pluginId="deadair.spotify" playlistId="playlist-1" />);

            expect(await screen.findByRole('link', { name: 'Good Times' })).toBeInTheDocument();
            expect(screen.getByText('Chic')).toBeInTheDocument();
            expect(screen.getByText('3:38')).toBeInTheDocument();
            expect(screen.queryByRole('table')).not.toBeInTheDocument();
            expect(screen.queryByText("C'est Chic")).not.toBeInTheDocument();
        } finally {
            restore();
        }
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
