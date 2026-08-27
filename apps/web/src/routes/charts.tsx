import { createFileRoute } from '@tanstack/react-router';

import { chartsListOptions } from '../api/charts.queries';
import { ChartsPage } from '../components/charts/charts.page';
import { LibraryShell } from '../components/library/library.shell';

export const Route = createFileRoute('/charts')({
    component: ChartsRoute,
    // Warms the same cache the page's hook reads from. The rejection is swallowed on purpose: the
    // failure stays in the query cache for the page's own alert, which keeps the picker reachable
    // instead of abandoning the navigation to the router's error component.
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(chartsListOptions).catch(() => undefined);
    },
});

function ChartsRoute() {
    return (
        <LibraryShell active="charts">
            <ChartsPage />
        </LibraryShell>
    );
}
