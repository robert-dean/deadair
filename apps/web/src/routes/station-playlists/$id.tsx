import { createFileRoute } from '@tanstack/react-router';

import { stationPlaylistOptions } from '../../api/station.playlists.queries';
import { StationPlaylistPage } from '../../components/playlists/station.playlist.page';

export const Route = createFileRoute('/station-playlists/$id')({
    component: StationPlaylistRoute,
    // Warms the cache the page reads. A failure is swallowed, on the provider playlist route's
    // argument: the page's own alert reports it and still offers the way back.
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(stationPlaylistOptions(params.id)).catch(() => undefined);
    },
});

function StationPlaylistRoute() {
    const { id } = Route.useParams();
    return <StationPlaylistPage id={id} />;
}
