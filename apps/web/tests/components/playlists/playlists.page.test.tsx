import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { PlaylistsPage } from '../../../src/components/playlists/playlists.page';
import { catalogPlaylist, catalogPlaylistPage, catalogSourceError } from '../../utils/playlist.fixture';
import { render, screen, setupUser } from '../../utils/render';

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

    it('folds the playlists a provider made behind a button that counts them and names the maker', async () => {
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({
                playlists: [
                    catalogPlaylist(),
                    catalogPlaylist({ id: 'discover', name: 'Discover Weekly', madeByProvider: true }),
                    catalogPlaylist({ id: 'mix-1', name: 'Daily Mix 1', madeByProvider: true }),
                ],
            }),
        );
        const user = setupUser();

        render(<PlaylistsPage />);

        expect(await screen.findByText('Friday Night')).toBeInTheDocument();
        // The count is what a person chose, not everything the source pushes at the account.
        expect(screen.getByText('1 available')).toBeInTheDocument();
        expect(screen.queryByText('Discover Weekly')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Show 2 made by Spotify' }));

        expect(screen.getByText('Discover Weekly')).toBeInTheDocument();
        expect(screen.getByText('Daily Mix 1')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Collapse the 2 made by Spotify' }));

        expect(screen.queryByText('Discover Weekly')).not.toBeInTheDocument();
    });

    // A page holding nothing but Spotify's own playlists still has something to show: the button is
    // the story, and an empty state beside it would tell the operator to enable a plugin that is
    // plainly working.
    it('offers the folded playlists rather than an empty state when those are all there is', async () => {
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({ playlists: [catalogPlaylist({ id: 'discover', name: 'Discover Weekly', madeByProvider: true })] }),
        );

        render(<PlaylistsPage />);

        expect(await screen.findByRole('button', { name: 'Show 1 made by Spotify' })).toBeInTheDocument();
        expect(screen.getByText('0 available')).toBeInTheDocument();
        expect(screen.queryByText('No playlists are available')).not.toBeInTheDocument();
    });

    it('names every provider whose playlists are folded', async () => {
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({
                playlists: [
                    catalogPlaylist({ id: 'discover', madeByProvider: true }),
                    catalogPlaylist({ id: 'station', pluginId: 'deadair.tidal', pluginName: 'Tidal', madeByProvider: true }),
                ],
            }),
        );

        render(<PlaylistsPage />);

        expect(await screen.findByRole('button', { name: 'Show 2 made by Spotify and Tidal' })).toBeInTheDocument();
    });

    it('folds what the operator hid into its own group, last', async () => {
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({
                playlists: [catalogPlaylist(), catalogPlaylist({ id: 'gone', name: "A friend's mix", hidden: true })],
            }),
        );
        const user = setupUser();

        render(<PlaylistsPage />);

        expect(await screen.findByText('Friday Night')).toBeInTheDocument();
        expect(screen.getByText('1 available')).toBeInTheDocument();
        expect(screen.queryByText("A friend's mix")).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Show 1 hidden' }));

        expect(screen.getByText("A friend's mix")).toBeInTheDocument();
    });

    // The hidden group is where an operator goes to take a decision back, so a hidden Daily Mix is
    // there and not also among Spotify's own.
    it('counts a hidden playlist the provider made as hidden, not as made by the provider', async () => {
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({
                playlists: [
                    catalogPlaylist({ id: 'discover', name: 'Discover Weekly', madeByProvider: true }),
                    catalogPlaylist({ id: 'mix', name: 'Daily Mix 1', madeByProvider: true, hidden: true }),
                ],
            }),
        );

        render(<PlaylistsPage />);

        expect(await screen.findByRole('button', { name: 'Show 1 made by Spotify' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show 1 hidden' })).toBeInTheDocument();
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
        expect(screen.getByText('Some plugins could not be listed')).toBeInTheDocument();
        expect(screen.getByText('Navidrome: Connection timed out')).toBeInTheDocument();
    });

    // The alert covers plugins that were never contacted as well as calls that failed: a
    // quarantined or misconfigured plugin cannot be asked for playlists at all. That is why the
    // heading says "listed" rather than "reached" — see the API's `unavailableReason`.
    it('reports a plugin that could not be asked at all, not only one that failed mid-call', async () => {
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({
                playlists: [catalogPlaylist()],
                errors: [
                    catalogSourceError({
                        pluginId: 'deadair.spotify',
                        pluginName: 'Spotify',
                        message: 'quarantined after a failure. Reload the plugin once the cause is fixed',
                    }),
                ],
            }),
        );

        render(<PlaylistsPage />);

        expect(await screen.findByText('Some plugins could not be listed')).toBeInTheDocument();
        expect(screen.getByText(/Spotify: quarantined after a failure/)).toBeInTheDocument();
    });

    // An empty list under a failure alert must not tell the operator to go and enable a plugin:
    // theirs IS enabled and has fallen over, and the two messages together send them to the wrong
    // screen. The alert above is the whole story.
    it('defers to the alert instead of advising an install when the only plugin failed', async () => {
        listImportablePlaylists.mockResolvedValue(
            catalogPlaylistPage({
                playlists: [],
                errors: [catalogSourceError()],
            }),
        );

        render(<PlaylistsPage />);

        expect(await screen.findByText('No playlists are available')).toBeInTheDocument();
        expect(screen.getByText(/listed above, with why each one could not be/)).toBeInTheDocument();
        expect(screen.queryByText(/Enable a plugin with the/)).not.toBeInTheDocument();
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
