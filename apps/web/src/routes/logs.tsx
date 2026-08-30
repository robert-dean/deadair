import { createFileRoute } from '@tanstack/react-router';

import { LogsPage } from '../components/station/logs.page';
import { CheckupShell } from '../components/station/checkup.shell';

/**
 * What the station and the two processes beside it actually wrote, as a fourth tab on Check-up.
 *
 * The other three tabs are the station's own account of itself. This is the record under them, and
 * it is the answer to the question the console could not answer at all before: reading `api.log`
 * needed a shell on the box, which is exactly what the single-container deployment exists to avoid.
 *
 * Its own route rather than a search param on `/checkup`, matching `/activity` and `/traces` beside
 * it and for the same reason: it carries its own source and level state.
 */
export const Route = createFileRoute('/logs')({ component: LogsRoute });

function LogsRoute() {
    return (
        <CheckupShell active="logs">
            <LogsPage />
        </CheckupShell>
    );
}
