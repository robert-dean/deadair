import { createFileRoute } from '@tanstack/react-router';

import { CheckupShell } from '../components/station/checkup.shell';
import { ListenersPage } from '../components/station/listeners.page';

/**
 * Who is listening right now, connection by connection, as a tab on Check-up.
 *
 * Second, after Machinery, because the two answer the same tense: what is happening now. Its own
 * route rather than a search param on `/checkup`, as every other tab beside it is.
 */
export const Route = createFileRoute('/listeners')({ component: ListenersRoute });

function ListenersRoute() {
    return (
        <CheckupShell active="listeners">
            <ListenersPage />
        </CheckupShell>
    );
}
