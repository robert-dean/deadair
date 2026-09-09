import { Stack, Text, Title } from '@mantine/core';

import { PadsPage } from '../pads/pads.page';
import { PersonasPage } from '../personas/personas.page';
import { PersonaAuditionsPage } from '../personas/persona.auditions.page';
import { ProductionsPage } from '../productions/productions.page';
import { PronunciationsPage } from '../pronunciations/pronunciations.page';
import { ScriptsPage } from '../scripts/scripts.page';
import { SegmentsPage } from '../segments/segments.page';
import { TopicsPage } from '../topics/topics.page';
import { VoicesPage } from '../voices/voices.page';
import { DestinationTabs, type DestinationTab } from '../shared/destination.tabs';
import { EmbeddedPage } from '../shared/page.header';

/** The tabs, in the order an operator meets them: who is talking, then everything they need to talk. */
export const VOICE_TABS = [
    { key: 'characters', label: 'Characters', hint: 'Who the station is when it talks' },
    { key: 'auditions', label: 'Auditions', hint: 'A character over an hour of records, before it goes on air' },
    { key: 'voices', label: 'Voices', hint: 'Which voice reads which character' },
    { key: 'segments', label: 'Segments', hint: 'Recordings it plays rather than speaks' },
    { key: 'pronunciations', label: 'Pronunciations', hint: 'Names it was getting wrong' },
    { key: 'soundboard', label: 'Soundboard', hint: 'Beds, stings and what plays under a break' },
    { key: 'subjects', label: 'Subjects', hint: 'What it is allowed to talk about' },
    { key: 'productions', label: 'Productions', hint: 'Phone-ins and anything with more than one voice' },
    { key: 'said', label: 'What it said', hint: 'Every break it has written, and every one it declined' },
] as const satisfies readonly DestinationTab<string>[];

export type VoiceTab = (typeof VOICE_TABS)[number]['key'];

/** Whether a string off the URL is a tab this destination has. */
export function isVoiceTab(value: unknown): value is VoiceTab {
    return typeof value === 'string' && VOICE_TABS.some(tab => tab.key === value);
}

export interface VoicePageProps {
    tab: VoiceTab;
    /**
     * One break rather than everything the station has written, for the What it said tab.
     *
     * A string off the URL, so the empty one means "not narrowed" rather than "narrowed to
     * nothing". That is the only place either of these is read.
     */
    segment?: string;
    /** One character rather than everybody, on the same terms as {@link VoicePageProps.segment}. */
    persona?: string;
    onSelect: (tab: VoiceTab) => void;
}

/**
 * Who the station is when it talks, and everything it needs to say it.
 *
 * Eight nav links, one page. They were eight because each is a real thing with its own table — but
 * an operator does not arrive wanting "the pronunciations page", they arrive because the station
 * said a name wrong, and the question they are actually holding is "why did it sound like that".
 * Every answer to that question is now on one destination.
 *
 * The bodies are the pages that were already there, unchanged. That is deliberate rather than lazy:
 * each of them carries its own hard-won behaviour, and re-hosting them is a change to where they
 * are rather than to what they do. `EmbeddedPage` is what stops each one drawing a second `<h1>`
 * under this one.
 *
 * Subjects is here on the operator's question rather than on the API's shape. It is not speech and
 * it has no voice, but it is what the station HAS to talk about — the categories a bulletin can
 * cover, the places a weather break can be about — and somebody editing what the station says is
 * exactly who needs it.
 */
export function VoicePage({ tab, segment, persona, onSelect }: VoicePageProps) {
    return (
        <Stack gap="lg">
            {/* Name only: each tab opens with its own description, and the rail says what every
                section is. See `library.shell.tsx`. */}
            <Title order={1}>Voice</Title>

            <DestinationTabs tabs={VOICE_TABS} active={tab} onSelect={onSelect} label="Voice" />

            <EmbeddedPage>{body(tab, segment, persona)}</EmbeddedPage>
        </Stack>
    );
}

/**
 * The tab's body.
 *
 * A switch rather than a lookup table of elements, so only the selected page is constructed: each of
 * these opens queries on mount, and building all eight to show one would put the whole destination's
 * network cost on every visit.
 */
function body(tab: VoiceTab, segment?: string, persona?: string) {
    switch (tab) {
        case 'characters':
            return <PersonasPage />;
        case 'auditions':
            // The `persona` narrowing means the same thing here as it does on the Scripts tab: a link
            // off a character opens this page about that character rather than about whoever is on
            // air. The empty string is how "not narrowed" arrives off the URL.
            return <PersonaAuditionsPage {...(persona === undefined || persona === '' ? {} : { persona })} />;
        case 'voices':
            return <VoicesPage />;
        case 'segments':
            return <SegmentsPage />;
        case 'pronunciations':
            return <PronunciationsPage />;
        case 'soundboard':
            return <PadsPage />;
        case 'subjects':
            return <TopicsPage />;
        case 'productions':
            return <ProductionsPage />;
        case 'said':
            // The empty string is how "not narrowed" arrives off the URL, and `ScriptsPage` asks
            // for an absent prop: an empty `segmentId` would be a query for a break with that id.
            return <ScriptsPage segmentId={segment === '' ? undefined : segment} personaKey={persona === '' ? undefined : persona} />;
    }
}
