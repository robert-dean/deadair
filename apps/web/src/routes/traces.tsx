import { createFileRoute } from '@tanstack/react-router';

import { TracesPage } from '../components/station/traces.page';
import { CheckupShell } from '../components/station/checkup.shell';

/**
 * What the station's work cost, as a third tab on Check-up.
 *
 * The three tabs are one question in three tenses. Machinery is what the station is doing NOW, the
 * activity feed is what it DID, and this is what that cost — and an operator who finds a stalled
 * loop on the first, or a warning on the second, arrives here asking which decision it belonged to.
 *
 * Its own route rather than a search param on `/checkup`, matching `/activity` beside it and for the
 * same reason: it carries its own filter and its own drawer state.
 */
export const Route = createFileRoute('/traces')({ component: TracesRoute });

function TracesRoute() {
    return (
        <CheckupShell active="cost">
            <TracesPage />
        </CheckupShell>
    );
}
