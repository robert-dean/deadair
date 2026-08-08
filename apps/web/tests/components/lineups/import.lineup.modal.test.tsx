// Importing is not airing, and the modal's job is to make that plain while still asking for the
// two things that cannot be changed afterwards: what kind of programming this is, and what the
// station should do when it runs out.

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { ImportLineupModal } from '../../../src/components/lineups/import.lineup.modal';
import { catalogPlaylist, catalogPlaylistPage } from '../../utils/playlist.fixture';
import { lineup } from '../../utils/lineup.fixture';
import { render, screen, waitFor } from '../../utils/render';

const listImportablePlaylists = vi.fn();
const importALineup = vi.fn();
const navigate = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playlists: { listImportablePlaylists: () => listImportablePlaylists() },
        director: { importALineup: (...args: unknown[]) => importALineup(...args) },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
    useNavigate: () => navigate,
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('ImportLineupModal', () => {
    it('imports the chosen playlist with the mode and ending the operator picked', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));
        importALineup.mockResolvedValue(lineup({ id: 'lineup-9' }));

        render(<ImportLineupModal opened onClose={vi.fn()} />);

        await userEvent.click(await screen.findByRole('combobox', { name: 'Playlist' }));
        await userEvent.click(await screen.findByText(/Friday Night/));
        await userEvent.click(screen.getByRole('button', { name: 'Import' }));

        await waitFor(() =>
            expect(importALineup).toHaveBeenCalledWith({
                pluginId: 'deadair.spotify',
                playlistId: 'playlist-1',
                // The playlist's own name is the default, and only the list knows it.
                name: 'Friday Night',
                mode: 'rotation',
                onEnd: 'extend',
            }),
        );
        // The next thing an operator wants is the order they just made.
        expect(navigate).toHaveBeenCalledWith({ to: '/lineups/$lineupId', params: { lineupId: 'lineup-9' } });
    });

    it('will not import until a playlist is chosen', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));

        render(<ImportLineupModal opened onClose={vi.fn()} />);

        expect(await screen.findByRole('button', { name: 'Import' })).toBeDisabled();
    });

    it('leaves out a playlist the source will not hand over', async () => {
        // The same rule the playlist card follows: a playlist whose tracks cannot be read cannot be
        // imported either, and offering it would only produce a failure.
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({
                playlists: [catalogPlaylist(), catalogPlaylist({ id: 'playlist-2', name: 'Private Mix', permissions: [] })],
            }),
        );

        render(<ImportLineupModal opened onClose={vi.fn()} />);
        await userEvent.click(await screen.findByRole('combobox', { name: 'Playlist' }));

        expect(await screen.findByText(/Friday Night/)).toBeInTheDocument();
        expect(screen.queryByText(/Private Mix/)).not.toBeInTheDocument();
    });

    it('says an import failed rather than closing as though it worked', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));
        importALineup.mockRejectedValue(new Error('nope'));
        const onClose = vi.fn();

        render(<ImportLineupModal opened onClose={onClose} />);
        await userEvent.click(await screen.findByRole('combobox', { name: 'Playlist' }));
        await userEvent.click(await screen.findByText(/Friday Night/));
        await userEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findByText('Import failed')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });
});
