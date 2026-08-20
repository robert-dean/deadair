import { createFileRoute, stripSearchParams } from '@tanstack/react-router';

import { ScriptsPage } from '../components/scripts/scripts.page';

/** A page at rest carries no query string, exactly as the catalog lists do. */
const DEFAULTS = { segment: '' };

/**
 * Everything the station has written, optionally narrowed to one break.
 *
 * The segment rides the URL rather than component state so a link off the running order is a link:
 * it survives a reload, it can be sent to somebody, and the back button means what it looks like it
 * means. Anything unparseable falls back to the whole history rather than throwing, which is the
 * same rule `catalog.page.params.ts` states — a hand-typed or truncated link should land on the
 * page, not on an error boundary.
 */
export const Route = createFileRoute('/scripts')({
    component: ScriptsRoute,
    validateSearch: (input: Record<string, unknown>): { segment: string } => ({
        segment: typeof input.segment === 'string' ? input.segment : '',
    }),
    search: { middlewares: [stripSearchParams(DEFAULTS)] },
});

function ScriptsRoute() {
    const { segment } = Route.useSearch();

    return <ScriptsPage segmentId={segment === '' ? undefined : segment} />;
}
