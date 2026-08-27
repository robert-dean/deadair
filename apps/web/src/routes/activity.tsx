import { createFileRoute } from '@tanstack/react-router';

import { ActivityPage } from '../components/activity/activity.page';
import { CheckupShell } from '../components/station/checkup.shell';

/**
 * What the station has been doing, as a tab on Check-up.
 *
 * Its own route rather than a search param on `/checkup`: the feed carries its own module and
 * severity filters and its own infinite scroll, and there is nothing to gain by moving that into a
 * sibling's query string.
 */
export const Route = createFileRoute('/activity')({ component: ActivityRoute });

function ActivityRoute() {
    return (
        <CheckupShell active="history">
            <ActivityPage />
        </CheckupShell>
    );
}
