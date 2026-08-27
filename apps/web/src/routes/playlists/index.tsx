import { createFileRoute } from '@tanstack/react-router';

import { playlistsListOptions } from '../../api/playlists.queries';
import { PlaylistsPage } from '../../components/playlists/playlists.page';
import { LibraryShell } from '../../components/library/library.shell';

export const Route = createFileRoute('/playlists/')({
    component: PlaylistsRoute,
    // Reads through the same cache the page's hook reads from, so the loader and the render are
    // one request rather than two.
    loader: ({ context }) => context.queryClient.ensureQueryData(playlistsListOptions),
});

function PlaylistsRoute() {
    return (
        <LibraryShell active="playlists">
            <PlaylistsPage />
        </LibraryShell>
    );
}
