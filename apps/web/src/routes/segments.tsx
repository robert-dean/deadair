import { createFileRoute } from '@tanstack/react-router';

import { segmentsOptions } from '../api/segments.queries';
import { SegmentsPage } from '../components/segments/segments.page';

export const Route = createFileRoute('/segments')({
    component: SegmentsPage,
    // Warms the same cache the page's hook reads from. The rejection is swallowed on purpose: it
    // stays in the query cache for the page's own alert, which keeps the write form reachable.
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(segmentsOptions).catch(() => undefined);
    },
});
