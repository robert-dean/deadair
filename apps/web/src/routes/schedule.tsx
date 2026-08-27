import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { isProgrammeTab, SchedulePage, type ProgrammeTab } from '../components/schedule/schedule.page';

/** A destination at rest carries no query string, exactly as Voice and the catalog lists do. */
const DEFAULTS = { tab: 'today' as ProgrammeTab };

/**
 * What the station plays across the day, and what it says inside the hour.
 *
 * The tab rides the URL for the reason Voice's does: it survives a reload, it can be sent to
 * somebody, and the back button steps through them. An unknown tab falls back to Today rather than
 * throwing.
 */
export const Route = createFileRoute('/schedule')({
    component: ProgrammeRoute,
    validateSearch: (input: Record<string, unknown>): { tab: ProgrammeTab } => ({
        tab: isProgrammeTab(input.tab) ? input.tab : 'today',
    }),
    search: { middlewares: [stripSearchParams(DEFAULTS)] },
});

function ProgrammeRoute() {
    const { tab } = Route.useSearch();
    const navigate = useNavigate();

    return (
        <SchedulePage
            tab={tab}
            onSelect={next => {
                // `replace`, so three tabs do not become three back-button steps between the page an
                // operator came from and the one they are on.
                void navigate({ to: '/schedule', search: { tab: next }, replace: true });
            }}
        />
    );
}
