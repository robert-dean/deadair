import { createFileRoute } from '@tanstack/react-router';

import { narrationPiecesOptions, narrationSeriesOptions } from '../api/narration.queries';
import { LibraryShell } from '../components/library/library.shell';
import { NarrationsPage } from '../components/narrations/narrations.page';

export const Route = createFileRoute('/narrations')({
    component: NarrationsRoute,
    // The Podcasts route's shape exactly. The pieces are the station's own table and answer at once,
    // so they are waited on; the series are asked of the plugins, which may open and parse whatever
    // each one lives in, so they are started here and not awaited, and the page draws its series
    // filter when they land. A failure is swallowed because the page draws its own alert.
    loader: async ({ context }) => {
        void context.queryClient.prefetchQuery(narrationSeriesOptions);
        await context.queryClient.ensureQueryData(narrationPiecesOptions()).catch(() => undefined);
    },
});

function NarrationsRoute() {
    return (
        <LibraryShell active="narrations">
            <NarrationsPage />
        </LibraryShell>
    );
}
