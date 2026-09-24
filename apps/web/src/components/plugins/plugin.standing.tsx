import { Anchor, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ProviderCapabilityState } from '@deadair/sdk';

import { usePluginProviders } from '../../api/plugins.queries';

/** The same station vocabulary the Providers section uses, for the jobs a plugin can hold. */
const JOBS = ['speech', 'llm', 'mixer', 'analysis', 'similarity', 'weather', 'charts', 'enrichment'] as const;
type Job = (typeof JOBS)[number];

function isJob(capability: string): capability is Job {
    return (JOBS as readonly string[]).includes(capability);
}

// 1st, 2nd, 3rd come from the catalog's ordinal plurals (`asked_ordinal_one` and its siblings),
// so the suffix is the locale's rather than English's. Only ever small numbers: it counts
// installed plugins, not records.

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
    const { t } = useTranslation('plugins');
    const providers = usePluginProviders();

    // Silent while it loads and silent if it fails: this annotates something that is already on
    // screen and is worth nothing at the cost of an error where a badge should be.
    const standings = (providers.data?.capabilities ?? [])
        .map(state => ({ state, line: standingFor(state, pluginId, t) }))
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
function standingFor(state: ProviderCapabilityState, pluginId: string, t: TFunction<'plugins'>): string | undefined {
    const job = isJob(state.capability) ? t(`standing.job.${state.capability}`) : state.capability;
    const candidate = state.candidates.find(one => one.pluginId === pluginId);
    if (candidate === undefined) return undefined;

    if (state.unanswered && candidate.listed) return t('standing.namedNotRunning', { job });

    // Nothing to report where there is nothing to choose.
    if (state.candidates.length < 2) return undefined;

    if (candidate.position === undefined) {
        return state.mode === 'one' ? t('standing.notInUse', { job }) : t('standing.notAsked', { job });
    }

    if (state.mode === 'one') return candidate.inUse ? t('standing.inUse', { job }) : t('standing.couldDo', { job });

    const asked = state.candidates.filter(one => one.position !== undefined).length;
    return t('standing.asked', { count: candidate.position, ordinal: true, asked, job });
}
