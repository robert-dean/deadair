import { createFileRoute } from '@tanstack/react-router';

import { stationOrderOptions } from '../api/director.queries';
import { OnAirPage } from '../components/onair/on.air.page';

export const Route = createFileRoute('/onair')({
    component: OnAirPage,
    // Reads through the same cache the page's hook reads from, so the loader and the render are
    // one request rather than two.
    loader: ({ context }) => context.queryClient.ensureQueryData(stationOrderOptions),
});
