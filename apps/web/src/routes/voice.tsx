import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { isVoiceTab, VoicePage, type VoiceTab } from '../components/voice/voice.page';

/** A destination at rest carries no query string, exactly as the catalog lists do. */
const DEFAULTS = { tab: 'characters' as VoiceTab };

/**
 * Everything about what the station says, behind one set of tabs.
 *
 * The tab rides the URL rather than component state, which is what makes each one a place: it
 * survives a reload, it can be sent to somebody, the back button steps through them, and an
 * attention row can point at the one that answers it. An unknown tab falls back to Characters
 * rather than throwing — a hand-typed or truncated link should land on the destination, not on an
 * error boundary.
 */
export const Route = createFileRoute('/voice')({
    component: VoiceRoute,
    validateSearch: (input: Record<string, unknown>): { tab: VoiceTab } => ({
        tab: isVoiceTab(input.tab) ? input.tab : 'characters',
    }),
    search: { middlewares: [stripSearchParams(DEFAULTS)] },
});

function VoiceRoute() {
    const { tab } = Route.useSearch();
    const navigate = useNavigate();

    return (
        <VoicePage
            tab={tab}
            onSelect={next => {
                // `replace` so eight tabs do not become eight back-button steps between the page an
                // operator came from and the one they are on.
                void navigate({ to: '/voice', search: { tab: next }, replace: true });
            }}
        />
    );
}
