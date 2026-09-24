import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StationPlaylistPage } from '../../../src/components/playlists/station.playlist.page';
import { stationPlaylist } from '../../utils/playlist.fixture';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const getStationPlaylist = vi.fn();
const deleteStationPlaylist = vi.fn();
const navigate = vi.fn();
const playAStationPlaylist = vi.fn();
const fillStationPlaylist = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playlists: {
            getStationPlaylist: (id: string) => getStationPlaylist(id),
            deleteStationPlaylist: (id: string) => deleteStationPlaylist(id),
            fillStationPlaylist: (id: string) => fillStationPlaylist(id),
        },
        playout: { playAStationPlaylist: (body: unknown) => playAStationPlaylist(body) },
        plugins: { listPlugins: () => Promise.resolve([{ id: 'deadair.spotify', name: 'Spotify' }]) },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
    useNavigate: () => navigate,
}));

afterEach(() => {
    getStationPlaylist.mockReset();
    deleteStationPlaylist.mockReset();
    navigate.mockReset();
    playAStationPlaylist.mockReset();
});

const detail = () => ({
    ...stationPlaylist({ originPluginId: 'deadair.spotify', trackCount: 2, resolvedCount: 1 }),
    tracks: [
        { id: 'row-1', position: 0, title: 'Teardrop', artists: ['Massive Attack'], trackId: 'track-1', durationMs: 330_000 },
        { id: 'row-2', position: 1, title: 'Roads', artists: ['Portishead'], originPluginId: 'deadair.spotify' },
    ],
});

describe('StationPlaylistPage', () => {
    it('draws a placeholder in its place, labelled, rather than leaving it out', async () => {
        getStationPlaylist.mockResolvedValue(detail());

        render(<StationPlaylistPage id="station-playlist-1" />);

        expect(await screen.findByText('Teardrop')).toBeInTheDocument();
        expect(screen.getByText('Roads')).toBeInTheDocument();
        expect(screen.getAllByText('Not in the library')).toHaveLength(1);
        expect(await screen.findByText(/cloned from Spotify/)).toBeInTheDocument();
        expect(screen.getByText(/2 records · 1 in the library/)).toBeInTheDocument();
    });

    it('asks before deleting, and goes back to the list once it is gone', async () => {
        getStationPlaylist.mockResolvedValue(detail());
        deleteStationPlaylist.mockResolvedValue(undefined);
        const user = setupUser();

        render(<StationPlaylistPage id="station-playlist-1" />);
        await user.click(await screen.findByRole('button', { name: 'Delete' }));
        expect(await screen.findByText('The playlist goes. The records it named stay in the library.')).toBeInTheDocument();
        await user.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);

        await waitFor(() => expect(deleteStationPlaylist).toHaveBeenCalledWith('station-playlist-1'));
        await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/playlists' }));
    });

    it('airs the playlist from its page', async () => {
        getStationPlaylist.mockResolvedValue(detail());
        playAStationPlaylist.mockResolvedValue({ queue: [], stream: { up: true } });
        const user = setupUser();

        render(<StationPlaylistPage id="station-playlist-1" />);
        await user.click(await screen.findByRole('button', { name: 'Air this playlist' }));

        await waitFor(() => expect(playAStationPlaylist).toHaveBeenCalledWith({ stationPlaylistId: 'station-playlist-1' }));
    });

    it('offers no Air button when nothing on the playlist is in the library', async () => {
        getStationPlaylist.mockResolvedValue({ ...detail(), resolvedCount: 0 });

        render(<StationPlaylistPage id="station-playlist-1" />);

        expect(await screen.findByText('Teardrop')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Air this playlist' })).not.toBeInTheDocument();
    });

    it('asks for the missing records to be looked up', async () => {
        getStationPlaylist.mockResolvedValue(detail());
        fillStationPlaylist.mockResolvedValue(undefined);
        const user = setupUser();

        render(<StationPlaylistPage id="station-playlist-1" />);
        await user.click(await screen.findByRole('button', { name: 'Look up missing records' }));

        await waitFor(() => expect(fillStationPlaylist).toHaveBeenCalledWith('station-playlist-1'));
    });

    it('offers no look-up when every record is in the library', async () => {
        getStationPlaylist.mockResolvedValue({ ...detail(), resolvedCount: 2, tracks: [detail().tracks[0]!] });

        render(<StationPlaylistPage id="station-playlist-1" />);

        expect(await screen.findByText('Teardrop')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Look up missing records' })).not.toBeInTheDocument();
    });
});
