import { Anchor, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { ProviderCapabilityState } from '@deadair/sdk';

import { usePluginProviders } from '../../api/plugins.queries';

/** The same station vocabulary the Providers section uses, for the jobs a plugin can hold. */
const JOB: Record<string, string> = {
    speech: 'speaking',
    llm: 'writing',
    mixer: 'joining audio',
    analysis: 'measuring records',
    similarity: 'who sounds like whom',
    weather: 'the weather',
    charts: 'charts',
    enrichment: 'details about records',
};

/** 1st, 2nd, 3rd. Only ever small numbers: it counts installed plugins, not records. */
function ordinal(position: number): string {
    const tens = position % 100;
    if (tens >= 11 && tens <= 13) return `${position}th`;
    const suffix = ['th', 'st', 'nd', 'rd'][position % 10] ?? 'th';
    return `${position}${suffix}`;
}

/**
 * Where this plugin stands for each job it can do, and a way to the page that decides.
 *
 * ## The gap this closes
 *
 * A plugin card said `similarity` in a grey badge and stopped. Nothing on it, or on the plugin's
 * own page, said that two other plugins also claimed that job, that this one was asked third, or
 * where an operator would go to change it — so the choice was invisible from the one place they
 * were certainly looking when they made it, which is the moment they installed the second plugin.
 *
 * A capability with only one plugin gets no line at all. "Asked 1st of 1" is a decision reported
 * where no decision exists, which is the noise that makes the real lines easy to skip.
 */
export function PluginStanding({ pluginId }: { pluginId: string }) {
    const providers = usePluginProviders();

    // Silent while it loads and silent if it fails: this annotates something that is already on
    // screen and is worth nothing at the cost of an error where a badge should be.
    const standings = (providers.data?.capabilities ?? [])
        .map(state => ({ state, line: standingFor(state, pluginId) }))
        .filter((entry): entry is { state: ProviderCapabilityState; line: string } => entry.line !== undefined);

    if (standings.length === 0) return undefined;

    return (
        <Stack gap={2}>
            {standings.map(({ state, line }) => (
                <Text key={state.capability} size="xs" c="dimmed">
                    <Anchor
                        size="xs"
                        c="dimmed"
                        underline="always"
                        renderRoot={(props: object) => <Link to="/settings/providers" hash={state.capability} {...props} />}
                    >
                        {line}
                    </Anchor>
                </Text>
            ))}
        </Stack>
    );
}

/**
 * What to say about one plugin's part in one capability, or nothing worth saying.
 *
 * Four states, and the one that earns the most is the fourth: a plugin the operator NAMED that
 * cannot answer means the station is doing that job with nothing at all, and the plugin page is
 * exactly where somebody would be standing when they disabled it.
 */
function standingFor(state: ProviderCapabilityState, pluginId: string): string | undefined {
    const job = JOB[state.capability] ?? state.capability;
    const candidate = state.candidates.find(one => one.pluginId === pluginId);
    if (candidate === undefined) return undefined;

    if (state.unanswered && candidate.listed) return `named for ${job}, and not running`;

    // Nothing to report where there is nothing to choose.
    if (state.candidates.length < 2) return undefined;

    if (candidate.position === undefined) {
        return state.mode === 'one' ? `not in use for ${job}` : `not asked for ${job}`;
    }

    if (state.mode === 'one') return candidate.inUse ? `in use for ${job}` : `could do ${job}, and is not the one in use`;

    const asked = state.candidates.filter(one => one.position !== undefined).length;
    return `asked ${ordinal(candidate.position)} of ${asked} for ${job}`;
}
