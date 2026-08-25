import { createFileRoute } from '@tanstack/react-router';

import { stationCheckupOptions } from '../api/station.queries';
import { CheckupPage } from '../components/station/checkup.page';

export const Route = createFileRoute('/checkup')({
    component: CheckupPage,
    // Only the reading this page added. The other four are already warm on any console that has
    // been open a moment, and a loader that waited on all five would hold the navigation for the
    // slowest of them to say something the page can draw a section at a time.
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(stationCheckupOptions).catch(() => undefined);
    },
});
