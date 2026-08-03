import { createFileRoute } from '@tanstack/react-router';

import { playlistsListOptions } from '../../api/playlists.queries';
import { PlaylistsPage } from '../../components/playlists/playlists.page';

export const Route = createFileRoute('/playlists/')({
    component: PlaylistsPage,
    // Reads through the same cache the page's hook reads from, so the loader and the render are
    // one request rather than two.
    loader: ({ context }) => context.queryClient.ensureQueryData(playlistsListOptions),
});
