import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { PlaylistsPage } from '../../../src/components/playlists/playlists.page';
import { catalogPlaylist, catalogPlaylistPage, catalogSourceError, stationPlaylist } from '../../utils/playlist.fixture';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listImportablePlaylists = vi.fn();
const refreshPlaylists = vi.fn();
const listStationPlaylists = vi.fn();
const previewPlaylistImport = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playlists: {
            listImportablePlaylists: () => listImportablePlaylists(),
            refreshPlaylists: () => refreshPlaylists(),
            listStationPlaylists: () => listStationPlaylists(),
            previewPlaylistImport: (input: unknown) => previewPlaylistImport(input),
        },
        plugins: { listPlugins: () => Promise.resolve([{ id: 'deadair.spotify', name: 'Spotify' }]) },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
    useNavigate: () => vi.fn(),
}));

beforeEach(() => {
    listStationPlaylists.mockResolvedValue({ playlists: [] });
});

afterEach(() => {
    listImportablePlaylists.mockReset();
    refreshPlaylists.mockReset();
    listStationPlaylists.mockReset();
    previewPlaylistImport.mockReset();
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

    it('asks for every playlist to be read again from the header', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));
        refreshPlaylists.mockResolvedValue(undefined);
        const user = setupUser();

        render(<PlaylistsPage />);
        await user.click(await screen.findByRole('button', { name: 'Refresh now' }));

        await waitFor(() => expect(refreshPlaylists).toHaveBeenCalledTimes(1));
    });

    it('says so on the page when the refresh is refused', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));
        refreshPlaylists.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Only an admin can do that.' }, new Headers()));
        const user = setupUser();

        render(<PlaylistsPage />);
        await user.click(await screen.findByRole('button', { name: 'Refresh now' }));

        expect(await screen.findByText('The playlists could not be read again')).toBeInTheDocument();
    });

    it('puts the station own playlists first, under a heading, with where each was cloned from', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));
        listStationPlaylists.mockResolvedValue({
            playlists: [stationPlaylist({ originPluginId: 'deadair.spotify', trackCount: 3, resolvedCount: 2 })],
        });

        render(<PlaylistsPage />);

        expect(await screen.findByText('Late Night Clone')).toBeInTheDocument();
        expect(screen.getByText("The station's own")).toBeInTheDocument();
        expect(screen.getByText('3 records · 2 in the library')).toBeInTheDocument();
        expect(screen.getByText("1 of the station's own, 1 from music sources")).toBeInTheDocument();
        expect(await screen.findByText('From Spotify')).toBeInTheDocument();
        expect(screen.getByText('Friday Night')).toBeInTheDocument();
    });

    it('draws no heading for the station own playlists when it has none', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));

        render(<PlaylistsPage />);

        expect(await screen.findByText('Friday Night')).toBeInTheDocument();
        expect(screen.queryByText("The station's own")).not.toBeInTheDocument();
    });

    it('previews a chosen file before offering to import it', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));
        previewPlaylistImport.mockResolvedValue({
            name: 'Late night',
            matched: 1,
            toAdd: 0,
            toLookUp: 1,
            skipped: 0,
            notices: [],
            entries: [
                { position: 0, title: 'Teardrop', artists: ['Massive Attack'], outcome: 'matched', trackId: 'track-1' },
                { position: 1, title: 'Angel', artists: ['Massive Attack'], outcome: 'toLookUp' },
            ],
        });
        const user = setupUser();

        render(<PlaylistsPage />);
        await user.click(await screen.findByRole('button', { name: 'Import' }));

        const file = new File([JSON.stringify({ format: 'deadair.playlist/1', takenAt: 'x', name: 'Late night', tracks: [] })], 'late.json', {
            type: 'application/json',
        });
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await user.upload(input, file);

        expect(
            await screen.findByText('1 record is in the library, and 1 is not: the station looks it up once the playlist is made.'),
        ).toBeInTheDocument();
        expect(previewPlaylistImport).toHaveBeenCalledWith({ file: expect.objectContaining({ name: 'Late night' }) });
        expect(screen.getByRole('button', { name: 'Import 2 records' })).toBeEnabled();
    });

    it('says a file that is not JSON cannot be read, without asking the station', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));
        const user = setupUser();

        render(<PlaylistsPage />);
        await user.click(await screen.findByRole('button', { name: 'Import' }));
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await user.upload(input, new File(['not json'], 'late.json', { type: 'application/json' }));

        expect(await screen.findByText(/is not a file this can read/)).toBeInTheDocument();
        expect(previewPlaylistImport).not.toHaveBeenCalled();
    });

    it('sends an M3U as text, named by its file, for the station to read', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));
        previewPlaylistImport.mockResolvedValue({ name: 'late', matched: 0, toAdd: 0, toLookUp: 1, skipped: 0, notices: [], entries: [] });
        const user = setupUser();

        render(<PlaylistsPage />);
        await user.click(await screen.findByRole('button', { name: 'Import' }));
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await user.upload(input, new File(['#EXTM3U\n#EXTINF:1,A - B\na.mp3'], 'late.m3u', { type: 'audio/x-mpegurl' }));

        await waitFor(() => expect(previewPlaylistImport).toHaveBeenCalledWith({ text: '#EXTM3U\n#EXTINF:1,A - B\na.mp3', fileName: 'late.m3u' }));
    });

    it('previews a pasted list', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));
        previewPlaylistImport.mockResolvedValue({
            name: 'Imported playlist',
            matched: 1,
            toAdd: 0,
            toLookUp: 0,
            skipped: 0,
            notices: [],
            entries: [{ position: 0, title: 'Teardrop', artists: ['Massive Attack'], outcome: 'matched', trackId: 't1' }],
        });
        const user = setupUser();

        render(<PlaylistsPage />);
        await user.click(await screen.findByRole('button', { name: 'Import' }));
        await user.click(await screen.findByRole('tab', { name: 'Paste a list' }));
        await user.type(screen.getByLabelText(/One record per line/), 'Massive Attack - Teardrop');
        await user.click(screen.getByRole('button', { name: 'Preview' }));

        await waitFor(() => expect(previewPlaylistImport).toHaveBeenCalledWith({ text: 'Massive Attack - Teardrop' }));
        expect(await screen.findByRole('button', { name: 'Import 1 record' })).toBeEnabled();
    });

    it('previews a pasted link', async () => {
        listImportablePlaylists.mockResolvedValue(catalogPlaylistPage({ playlists: [catalogPlaylist()] }));
        previewPlaylistImport.mockResolvedValue({ name: 'From Spotify', matched: 0, toAdd: 1, toLookUp: 0, skipped: 0, notices: [], entries: [] });
        const user = setupUser();

        render(<PlaylistsPage />);
        await user.click(await screen.findByRole('button', { name: 'Import' }));
        await user.click(await screen.findByRole('tab', { name: 'Link' }));
        await user.type(screen.getByLabelText(/Playlist link/), ' https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M ');
        await user.click(screen.getByRole('button', { name: 'Preview' }));

        await waitFor(() => expect(previewPlaylistImport).toHaveBeenCalledWith({ url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' }));
        expect(await screen.findByDisplayValue('From Spotify')).toBeInTheDocument();
    });
});
