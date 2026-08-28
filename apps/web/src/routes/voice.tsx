import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import { isVoiceTab, VoicePage, type VoiceTab } from '../components/voice/voice.page';

/**
 * A destination at rest carries no query string, exactly as the catalog lists do.
 *
 * The two narrowings default to the empty string rather than being absent, so the search shape is
 * one shape everywhere: `stripSearchParams` takes them back out of the URL, which is what keeps a
 * plain Voice link from rewriting itself to `?segment=&persona=` the moment it lands.
 */
const DEFAULTS = { tab: 'characters' as VoiceTab, segment: '', persona: '' };

/** Exported because the generated route tree names this type in `VoiceRoute`'s own declaration. */
export interface VoiceSearch {
    tab: VoiceTab;
    /** One break's attempts, as a link off the running order asks for. Empty means the whole history. */
    segment: string;
    /** One character's attempts, as a link off the personas page asks for. Empty means everybody. */
    persona: string;
}

/**
 * Everything about what the station says, behind one set of tabs.
 *
 * The tab rides the URL rather than component state, which is what makes each one a place: it
 * survives a reload, it can be sent to somebody, the back button steps through them, and an
 * attention row can point at the one that answers it. An unknown tab falls back to Characters
 * rather than throwing — a hand-typed or truncated link should land on the destination, not on an
 * error boundary.
 *
 * `segment` and `persona` ride it for the same reason and one more: a link off the running order is
 * about ONE break, and dropping the id here landed the operator on the whole history with their
 * break somewhere in it. Validated as free strings and not resolved to anything — an id the library
 * no longer holds narrows to a break with no attempts, which is a truthful answer rather than an
 * error.
 */
export const Route = createFileRoute('/voice')({
    component: VoiceRoute,
    validateSearch: (input: Record<string, unknown>): VoiceSearch => ({
        tab: isVoiceTab(input.tab) ? input.tab : 'characters',
        segment: typeof input.segment === 'string' ? input.segment : '',
        persona: typeof input.persona === 'string' ? input.persona : '',
    }),
    search: { middlewares: [stripSearchParams(DEFAULTS)] },
});

function VoiceRoute() {
    const { tab, segment, persona } = Route.useSearch();
    const navigate = useNavigate();

    return (
        <VoicePage
            tab={tab}
            segment={segment}
            persona={persona}
            onSelect={next => {
                // The narrowing is cleared on the way out. It belongs to the break or the character
                // an operator followed a link to, and carrying it across to Pronunciations and back
                // would re-narrow a page they had already left.
                //
                // `replace` so eight tabs do not become eight back-button steps between the page an
                // operator came from and the one they are on.
                void navigate({ to: '/voice', search: { tab: next, segment: '', persona: '' }, replace: true });
            }}
        />
    );
}
