import { createFileRoute } from '@tanstack/react-router';

import { playlistTracksOptions } from '../../../api/playlists.queries';
import { PlaylistTracksPage } from '../../../components/playlists/playlist.tracks.page';

export const Route = createFileRoute('/playlists/$pluginId/$playlistId')({
    component: PlaylistTracksRoute,
    // Reads through the same cache the page's hook reads from, so the loader and the render are
    // one request rather than two.
    loader: ({ context, params }) => context.queryClient.ensureQueryData(playlistTracksOptions(params.pluginId, params.playlistId)),
});

function PlaylistTracksRoute() {
    const { pluginId, playlistId } = Route.useParams();
    return <PlaylistTracksPage pluginId={pluginId} playlistId={playlistId} />;
}
