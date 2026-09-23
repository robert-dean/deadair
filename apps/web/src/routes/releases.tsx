import { createFileRoute } from '@tanstack/react-router';

import { stationReleasesOptions } from '../api/station.queries';
import { CheckupShell } from '../components/station/checkup.shell';
import { ReleasesPage } from '../components/station/releases.page';

/**
 * What changed in each release, as the last tab on Check-up.
 *
 * Its own route rather than a search param on `/checkup`, matching the tabs beside it, and for a
 * reason of its own: it is a page somebody is sent to, from the build line on Check-up.
 */
export const Route = createFileRoute('/releases')({
    component: ReleasesRoute,
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(stationReleasesOptions).catch(() => undefined);
    },
});

function ReleasesRoute() {
    return (
        <CheckupShell active="releases">
            <ReleasesPage />
        </CheckupShell>
    );
}
