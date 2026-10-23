import { createFileRoute } from '@tanstack/react-router';

import { AsRunPage } from '../components/activity/as.run.page';
import { CheckupShell } from '../components/station/checkup.shell';

/**
 * What actually went out, as a tab on Check-up beside the activity feed.
 *
 * Its own route for `/activity`'s reason: it carries its own moment to read back from and its own
 * scroll, and nothing is gained by putting either into a sibling's query string.
 */
export const Route = createFileRoute('/as-run')({ component: AsRunRoute });

function AsRunRoute() {
    return (
        <CheckupShell active="asRun">
            <AsRunPage />
        </CheckupShell>
    );
}
