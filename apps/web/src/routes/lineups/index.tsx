import { createFileRoute } from '@tanstack/react-router';

import { lineupsListOptions } from '../../api/director.queries';
import { LineupsPage } from '../../components/lineups/lineups.page';

export const Route = createFileRoute('/lineups/')({
    component: LineupsPage,
    // Reads through the same cache the page's hook reads from, so the loader and the render are
    // one request rather than two.
    loader: ({ context }) => context.queryClient.ensureQueryData(lineupsListOptions),
});
