import { createFileRoute, stripSearchParams } from '@tanstack/react-router';

import { ScriptsPage } from '../components/scripts/scripts.page';

/** A page at rest carries no query string, exactly as the catalog lists do. */
const DEFAULTS = { segment: '', persona: '' };

/**
 * Everything the station has written, optionally narrowed to one break or one character.
 *
 * Both narrowings ride the URL rather than component state so a link into here is a link: it
 * survives a reload, it can be sent to somebody, and the back button means what it looks like it
 * means. That is what the outcome and writer controls on the page are NOT, deliberately — they are
 * a reader's own passing choice, where these two arrive from somewhere else and answer a question
 * that was asked on another page.
 *
 * Anything unparseable falls back to the whole history rather than throwing, which is the same rule
 * `catalog.page.params.ts` states — a hand-typed or truncated link should land on the page, not on
 * an error boundary.
 */
export const Route = createFileRoute('/scripts')({
    component: ScriptsRoute,
    validateSearch: (input: Record<string, unknown>): { segment: string; persona: string } => ({
        segment: typeof input.segment === 'string' ? input.segment : '',
        persona: typeof input.persona === 'string' ? input.persona : '',
    }),
    search: { middlewares: [stripSearchParams(DEFAULTS)] },
});

function ScriptsRoute() {
    const { segment, persona } = Route.useSearch();

    return <ScriptsPage segmentId={segment === '' ? undefined : segment} personaKey={persona === '' ? undefined : persona} />;
}
