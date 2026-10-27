import { createFileRoute } from '@tanstack/react-router';

import { CheckupShell } from '../components/station/checkup.shell';
import { RecordingsPage } from '../components/station/recordings.page';

/**
 * What the station sounded like, as a tab on Check-up beside As run.
 *
 * Its own route for `/as-run`'s reason: it carries its own state (which recording is playing), and
 * nothing is gained by putting that into a sibling's query string.
 */
export const Route = createFileRoute('/recordings')({ component: RecordingsRoute });

function RecordingsRoute() {
    return (
        <CheckupShell active="recordings">
            <RecordingsPage />
        </CheckupShell>
    );
}
