import { createFileRoute } from '@tanstack/react-router';

import { catalogTrackOptions } from '../../../api/catalog.queries';
import { TrackDetailPage } from '../../../components/catalog/track.detail.page';

/**
 * One record and everything it has accumulated.
 *
 * No search params, unlike its album and artist siblings: there is nothing here to page through.
 * The airings are the head of a list with its own total, and the log itself is `/activity`.
 */
export const Route = createFileRoute('/catalog/tracks/$trackId')({
    component: TrackDetailRoute,
    // The rejection stays in the cache for the page's own alert, as on every other catalog route:
    // a failed load should draw the page saying why rather than the router's error boundary.
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(catalogTrackOptions(params.trackId)).catch(() => undefined);
    },
});

function TrackDetailRoute() {
    const { trackId } = Route.useParams();

    return <TrackDetailPage trackId={trackId} />;
}
