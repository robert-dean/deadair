import { createFileRoute } from '@tanstack/react-router';

import { CheckupShell } from '../components/station/checkup.shell';
import { TrendsPage } from '../components/trends/trends.page';

/**
 * The station's numbers over time, as the second tab on Check-up.
 *
 * Machinery says what the station is doing NOW, and this says how that has moved: an operator who
 * sees a library half measured on the first tab asks here whether it is getting there. Its own route
 * rather than a search param, on the `/activity` and `/traces` argument: it carries its own range.
 */
export const Route = createFileRoute('/trends')({ component: TrendsRoute });

function TrendsRoute() {
    return (
        <CheckupShell active="trends">
            <TrendsPage />
        </CheckupShell>
    );
}
