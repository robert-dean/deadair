import { createFileRoute } from '@tanstack/react-router';

import { playlistTracksOptions } from '../../../api/playlists.queries';
import { PlaylistTracksPage } from '../../../components/playlists/playlist.tracks.page';

export const Route = createFileRoute('/playlists/$pluginId/$playlistId')({
    component: PlaylistTracksRoute,
    // Warms the same cache the page's hook reads from, so the loader and the render are one
    // request rather than two.
    //
    // The rejection is swallowed on purpose. A failed prefetch leaves the error in the query
    // cache, where the page's own "Tracks could not be loaded" alert reads it and still offers a
    // heading and a way back to the list. Propagating it would abandon the navigation to the
    // router's default error component instead, so a plugin that merely went inactive would cost
    // the operator the whole screen — the same reasoning as the root `beforeLoad`, which renders
    // the app rather than trapping the user when the API cannot answer.
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(playlistTracksOptions(params.pluginId, params.playlistId)).catch(() => undefined);
    },
});

function PlaylistTracksRoute() {
    const { pluginId, playlistId } = Route.useParams();
    return <PlaylistTracksPage pluginId={pluginId} playlistId={playlistId} />;
}
