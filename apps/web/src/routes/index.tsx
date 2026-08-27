import { createFileRoute } from '@tanstack/react-router';

import { stationOrderOptions } from '../api/director.queries';
import { DeskPage } from '../components/desk/desk.page';

export const Route = createFileRoute('/')({
    component: DeskPage,
    // Reads through the same cache the page's hook reads from, so the loader and the render are one
    // request rather than two. The desk draws the running order now, so it wants what /onair wanted.
    loader: ({ context }) => context.queryClient.ensureQueryData(stationOrderOptions),
});
