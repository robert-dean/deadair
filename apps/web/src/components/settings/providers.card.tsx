import { Card, Stack, Text, Title } from '@mantine/core';
import type { ProviderCapabilityState } from '@deadair/sdk';

import { usePluginProviders } from '../../api/plugins.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { ProviderPick } from './provider.pick';
import { ProviderRanking } from './provider.ranking';

/**
 * What each contested capability is called, and what the choice actually changes.
 *
 * The station's vocabulary rather than the SDK's: an operator came here to decide who speaks, not
 * to configure the `speech` capability. The sentence is the part that was missing everywhere —
 * "which is asked first" means something different for each of these, and until now that lived in
 * a ninety-word paragraph under a table header, or nowhere.
 */
const CAPABILITY_WORDING: Record<string, { title: string; meaning: string; only: string }> = {
    speech: {
        title: 'Speaking',
        meaning: 'The voice the station talks in. One plugin does it: two engines rendering one break would be two breaks.',
        only: 'can speak, so there is nothing to choose',
    },
    llm: {
        title: 'Writing',
        meaning: 'Which plugin the station asks for words. One plugin does it, since two models writing one line is one wasted generation.',
        only: 'can write, so there is nothing to choose',
    },
    mixer: {
        title: 'Joining audio',
        meaning: 'Which plugin makes one piece of audio out of several. Its own choice, so a station can measure with one engine and join with another.',
        only: 'can join audio, so there is nothing to choose',
    },
    analysis: {
        title: 'Measuring records',
        meaning: 'Which plugin measures records, so the station can trim the dead air off each one and know how long it may talk over an intro.',
        only: 'can measure records, so there is nothing to choose',
    },
    similarity: {
        title: 'Who sounds like whom',
        meaning:
            'Every source is asked who resembles an artist and the answers are pooled, because two sources disagreeing about that are not in conflict. What to PLAY by an artist, and what sounds like a particular record, take the first usable answer — so this order decides whose judgement airs.',
        only: 'can say who sounds like whom, so there is nothing to order',
    },
    weather: {
        title: 'The weather',
        meaning:
            'The station asks in this order and reads out the first forecast it gets, because two services asked about one sky are two readings of the same thing rather than two facts.',
        only: 'can report the weather, so there is nothing to order',
    },
    charts: {
        title: 'Charts',
        meaning:
            'Every service’s charts stay on the menu whatever this says — two top forties are two published documents. This sets the order they appear in, and decides outright which service answers when a chart is asked for by style.',
        only: 'publishes charts, so there is nothing to order',
    },
    enrichment: {
        title: 'What the station believes about a record',
        meaning:
            'Every source is asked about a record and the answers are merged field by field, so this decides who wins where two of them disagree about a year, a label or a running time. Each plugin declares how much to trust it; this overrides that with what you can see on your own library.',
        only: 'fills in details about records, so there is nothing to order',
    },
};

/**
 * Who does each job more than one plugin can do.
 *
 * ## Why this is a page of its own, and not eight fields in five sections
 *
 * The choices were spread across Rotation, Voice and audio, Words and Measurement, in the section
 * that owned the FEATURE rather than the one that owned the question. So an operator who had just
 * installed a second similarity plugin had to already know that the thing deciding which one gets
 * asked was a field called "Which similarity source to ask first", under Rotation. Nothing on the
 * Plugins page said the choice existed, and nothing in those sections said the choice was one of a
 * family. Here they are one question asked eight times.
 *
 * ## It shows what is there, not what could be
 *
 * A capability nothing installed can answer is left out entirely, by the endpoint: a station with
 * no chart plugin has no question to answer about chart plugins. A capability with exactly ONE
 * candidate is drawn as a sentence rather than a control, because a picker with one option is an
 * invitation to look for a decision that does not exist.
 */
export function ProvidersCard() {
    const providers = usePluginProviders();

    if (providers.isPending) return <PageSkeleton variant="rows" count={3} />;

    if (providers.error || !providers.data) {
        return <ErrorAlert title="Providers unavailable" error={providers.error} fallback="The station could not say which plugins do what." />;
    }

    if (providers.data.capabilities.length === 0) {
        return (
            <EmptyState title="Nothing to choose between yet">
                No installed plugin does a job another one could do. Install a second plugin that can speak, write, or say who sounds like whom, and the
                choice appears here.
            </EmptyState>
        );
    }

    return (
        <Stack gap="lg">
            {providers.data.capabilities.map(state => (
                <CapabilityCard key={state.capability} state={state} />
            ))}
        </Stack>
    );
}

/**
 * One capability.
 *
 * `id` is the capability name, which is what a plugin card links to: `/settings/providers#speech`
 * lands on the block that decides speech rather than at the top of a page of eight.
 */
function CapabilityCard({ state }: { state: ProviderCapabilityState }) {
    const wording = CAPABILITY_WORDING[state.capability];
    const only = state.candidates.length === 1 ? state.candidates[0] : undefined;

    return (
        <Card id={state.capability} withBorder padding="md">
            <Stack gap="sm">
                <div>
                    <Title order={4}>{wording?.title ?? state.capability}</Title>
                    <Text size="sm" c="dimmed">
                        {wording?.meaning ?? 'Which plugin the station uses for this.'}
                    </Text>
                </div>

                {only !== undefined ? (
                    <Text size="sm" c="dimmed">
                        Only {only.name} {wording?.only ?? 'can do this, so there is nothing to choose'}.
                    </Text>
                ) : state.mode === 'one' ? (
                    <ProviderPick state={state} />
                ) : (
                    <ProviderRanking state={state} />
                )}
            </Stack>
        </Card>
    );
}
