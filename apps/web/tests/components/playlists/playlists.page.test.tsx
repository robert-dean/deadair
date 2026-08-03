import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { PlaylistsPage } from '../../../src/components/playlists/playlists.page';
import { catalogPlaylist, catalogPlaylistPage, catalogSourceError } from '../../utils/playlist.fixture';
import { render, screen } from '../../utils/render';

const listImportablePlaylists = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { playlists: { listImportablePlaylists: () => listImportablePlaylists() } },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
}));

afterEach(() => {
    listImportablePlaylists.mockReset();
});

describe('PlaylistsPage', () => {
    it('renders a card per playlist and the available count', async () => {
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({
                playlists: [catalogPlaylist(), catalogPlaylist({ id: 'playlist-2', name: 'Late Night', pluginName: 'Navidrome' })],
            }),
        );

        render(<PlaylistsPage />);

        expect(await screen.findByText('Friday Night')).toBeInTheDocument();
        expect(screen.getByText('Late Night')).toBeInTheDocument();
        expect(screen.getByText('2 available')).toBeInTheDocument();
    });

    it('says so when no plugin has anything to offer', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [] }));

        render(<PlaylistsPage />);

        expect(await screen.findByText('No playlists are available')).toBeInTheDocument();
    });

    it('reports a partial failure alongside whichever playlists did come back', async () => {
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({
                playlists: [catalogPlaylist()],
                errors: [catalogSourceError()],
            }),
        );

        render(<PlaylistsPage />);

        expect(await screen.findByText('Friday Night')).toBeInTheDocument();
        expect(screen.getByText('Some plugins could not be reached')).toBeInTheDocument();
        expect(screen.getByText('Navidrome: Connection timed out')).toBeInTheDocument();
    });

    it('shows an error alert when the whole list fails to load', async () => {
        listImportablePlaylists.mockRejectedValue(
            new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'The catalog service is down.' }, new Headers()),
        );

        render(<PlaylistsPage />);

        expect(await screen.findByText('Playlists could not be loaded')).toBeInTheDocument();
        expect(screen.getByText('The catalog service is down.')).toBeInTheDocument();
    });
});
