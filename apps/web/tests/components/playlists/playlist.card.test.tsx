import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError, type CatalogPlaylistPage } from '@deadair/sdk';

import { queryKeys } from '../../../src/api/query.keys';
import { PlaylistCard } from '../../../src/components/playlists/playlist.card';
import { catalogPlaylist, catalogPlaylistPage } from '../../utils/playlist.fixture';
import { createTestQueryClient, render, screen, setupUser, waitFor } from '../../utils/render';

const hidePlaylist = vi.fn();
const showPlaylist = vi.fn();
const refreshPlaylist = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playlists: {
            hidePlaylist: (...args: unknown[]) => hidePlaylist(...args),
            showPlaylist: (...args: unknown[]) => showPlaylist(...args),
            refreshPlaylist: (...args: unknown[]) => refreshPlaylist(...args),
        },
    },
}));

afterEach(() => {
    vi.resetAllMocks();
});

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

    it('replaces the link with a reason when the source will not share the tracks', () => {
        render(<PlaylistCard playlist={catalogPlaylist({ permissions: [] })} />);

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText("Spotify won't share this playlist's tracks.")).toBeInTheDocument();
    });

    it('disables on any permission list without `read`, not just an empty one', () => {
        render(<PlaylistCard playlist={catalogPlaylist({ permissions: ['edit'] })} />);

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('keeps the link when the source granted read', () => {
        render(<PlaylistCard playlist={catalogPlaylist({ permissions: ['read', 'edit'] })} />);

        expect(screen.getByRole('link', { name: 'View tracks' })).toBeInTheDocument();
    });

    it('keeps the link when the source said nothing at all', () => {
        // Absent is "did not say", not "refused". Treating it as a refusal
        // would hide every playlist whenever the source cannot be asked.
        render(<PlaylistCard playlist={catalogPlaylist({ permissions: undefined })} />);

        expect(screen.getByRole('link', { name: 'View tracks' })).toBeInTheDocument();
    });

    describe('its menu', () => {
        const openMenu = async (user: ReturnType<typeof setupUser>, name: string) => {
            await user.click(screen.getByRole('button', { name: `More about ${name}` }));
        };

        it('hides the playlist and marks it hidden in the cached listing, without refetching', async () => {
            hidePlaylist.mockResolvedValue(undefined);
            const queryClient = createTestQueryClient();
            const playlist = catalogPlaylist();
            queryClient.setQueryData(queryKeys.playlists.list(), catalogPlaylistPage({ playlists: [playlist, catalogPlaylist({ id: 'other' })] }));
            const user = setupUser();

            render(<PlaylistCard playlist={playlist} />, { queryClient });
            await openMenu(user, 'Friday Night');
            await user.click(await screen.findByRole('menuitem', { name: 'Hide' }));

            await waitFor(() => expect(hidePlaylist).toHaveBeenCalledWith('deadair.spotify', 'playlist-1'));
            await waitFor(() => {
                const page = queryClient.getQueryData<CatalogPlaylistPage>(queryKeys.playlists.list());
                expect(page?.playlists.find(one => one.id === 'playlist-1')?.hidden).toBe(true);
            });
            // Only the one it named: the other card on the page is untouched.
            const page = queryClient.getQueryData<CatalogPlaylistPage>(queryKeys.playlists.list());
            expect(page?.playlists.find(one => one.id === 'other')?.hidden).toBeUndefined();
        });

        it('offers a hidden playlist back, and unmarks it once shown', async () => {
            showPlaylist.mockResolvedValue(undefined);
            const queryClient = createTestQueryClient();
            const playlist = catalogPlaylist({ hidden: true });
            queryClient.setQueryData(queryKeys.playlists.list(), catalogPlaylistPage({ playlists: [playlist] }));
            const user = setupUser();

            render(<PlaylistCard playlist={playlist} />, { queryClient });
            await openMenu(user, 'Friday Night');
            await user.click(await screen.findByRole('menuitem', { name: 'Show again' }));

            await waitFor(() => expect(showPlaylist).toHaveBeenCalledWith('deadair.spotify', 'playlist-1'));
            await waitFor(() => {
                const page = queryClient.getQueryData<CatalogPlaylistPage>(queryKeys.playlists.list());
                expect(page?.playlists[0]?.hidden).toBeUndefined();
            });
        });

        it('asks for the playlist to be read again', async () => {
            refreshPlaylist.mockResolvedValue(undefined);
            const user = setupUser();

            render(<PlaylistCard playlist={catalogPlaylist()} />);
            await openMenu(user, 'Friday Night');
            await user.click(await screen.findByRole('menuitem', { name: 'Refresh this playlist' }));

            await waitFor(() => expect(refreshPlaylist).toHaveBeenCalledWith('deadair.spotify', 'playlist-1'));
        });

        // Only where the station would read it: the walk refuses a hidden playlist, and a source
        // that will not share its tracks would answer the refresh with nothing.
        it('does not offer a refresh the station would not carry out', async () => {
            const user = setupUser();

            render(
                <>
                    <PlaylistCard playlist={catalogPlaylist({ name: 'Hidden One', hidden: true })} />
                    <PlaylistCard playlist={catalogPlaylist({ id: 'refused', name: 'Discover Weekly', permissions: [] })} />
                </>,
            );
            await openMenu(user, 'Hidden One');
            expect(await screen.findByRole('menuitem', { name: 'Show again' })).toBeInTheDocument();
            expect(screen.queryByRole('menuitem', { name: 'Refresh this playlist' })).not.toBeInTheDocument();
            await user.keyboard('{Escape}');

            await openMenu(user, 'Discover Weekly');
            expect(await screen.findByRole('menuitem', { name: 'Hide' })).toBeInTheDocument();
            expect(screen.queryByRole('menuitem', { name: 'Refresh this playlist' })).not.toBeInTheDocument();
        });

        it('says so on the trigger when a refresh is refused', async () => {
            refreshPlaylist.mockRejectedValue(new SdkError(409, 'Conflict', { statusCode: 409, message: 'This playlist is hidden.' }, new Headers()));
            const user = setupUser();

            render(<PlaylistCard playlist={catalogPlaylist()} />);
            await openMenu(user, 'Friday Night');
            await user.click(await screen.findByRole('menuitem', { name: 'Refresh this playlist' }));

            await waitFor(() => expect(refreshPlaylist).toHaveBeenCalled());
            await user.hover(screen.getByRole('button', { name: 'More about Friday Night' }));
            expect(await screen.findByText('This playlist is hidden.')).toBeInTheDocument();
        });

        // The refused card has no footer controls at all, and it is the first kind an operator
        // wants gone, so the menu cannot live down there with Air.
        it('is on a card whose source refuses its tracks', () => {
            render(<PlaylistCard playlist={catalogPlaylist({ name: 'Discover Weekly', permissions: [] })} />);

            expect(screen.getByRole('button', { name: 'More about Discover Weekly' })).toBeInTheDocument();
        });

        it('says so on the trigger when the station refuses', async () => {
            hidePlaylist.mockRejectedValue(
                new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Only an admin can hide a playlist.' }, new Headers()),
            );
            const user = setupUser();

            render(<PlaylistCard playlist={catalogPlaylist()} />);
            await openMenu(user, 'Friday Night');
            await user.click(await screen.findByRole('menuitem', { name: 'Hide' }));

            await waitFor(() => expect(hidePlaylist).toHaveBeenCalled());
            await user.hover(screen.getByRole('button', { name: 'More about Friday Night' }));
            expect(await screen.findByText('Only an admin can hide a playlist.')).toBeInTheDocument();
        });
    });
});
