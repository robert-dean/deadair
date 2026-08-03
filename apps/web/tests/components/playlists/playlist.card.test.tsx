import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlaylistCard } from '../../../src/components/playlists/playlist.card';
import { catalogPlaylist } from '../../utils/playlist.fixture';
import { render, screen } from '../../utils/render';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, to, params, ...rest }: { children?: ReactNode; to?: string; params?: Record<string, string> }) => (
        <a href={to} data-params={JSON.stringify(params)} {...rest}>
            {children}
        </a>
    ),
}));

describe('PlaylistCard', () => {
    it('renders the name, plugin badge, description and track count', () => {
        render(<PlaylistCard playlist={catalogPlaylist()} />);

        expect(screen.getByText('Friday Night')).toBeInTheDocument();
        expect(screen.getByText('Spotify')).toBeInTheDocument();
        expect(screen.getByText('Upbeat tracks for a Friday night set.')).toBeInTheDocument();
        expect(screen.getByText('24 tracks')).toBeInTheDocument();
    });

    it('falls back to a placeholder when there is no description', () => {
        render(<PlaylistCard playlist={catalogPlaylist({ description: undefined })} />);

        expect(screen.getByText('No description.')).toBeInTheDocument();
    });

    it('omits the track count line when the plugin never reported one', () => {
        render(<PlaylistCard playlist={catalogPlaylist({ trackCount: undefined })} />);

        expect(screen.queryByText(/^\d+ tracks$/)).not.toBeInTheDocument();
    });

    it('links to the tracks route keyed on the plugin and playlist ids', () => {
        render(<PlaylistCard playlist={catalogPlaylist({ pluginId: 'deadair.navidrome', id: 'playlist-9' })} />);

        const link = screen.getByRole('link', { name: 'View tracks' });
        expect(link).toHaveAttribute('data-params', JSON.stringify({ pluginId: 'deadair.navidrome', playlistId: 'playlist-9' }));
    });
});
