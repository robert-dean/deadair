import { createFileRoute } from '@tanstack/react-router';

import { lineupOptions } from '../../api/director.queries';
import { LineupDetailPage } from '../../components/lineups/lineup.detail.page';

export const Route = createFileRoute('/lineups/$lineupId')({
    component: LineupDetailRoute,
    // Warms the same cache the page's hook reads from, so the loader and the render are one
    // request rather than two.
    //
    // The rejection is swallowed on purpose. A failed prefetch leaves the error in the query cache,
    // where the page's own "This lineup could not be loaded" alert reads it and still offers a
    // heading and a way back to the list. Propagating it would abandon the navigation to the
    // router's default error component instead, so a lineup deleted in another tab would cost the
    // operator the whole screen.
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(lineupOptions(params.lineupId)).catch(() => undefined);
    },
});

function LineupDetailRoute() {
    const { lineupId } = Route.useParams();
    return <LineupDetailPage lineupId={lineupId} />;
}
