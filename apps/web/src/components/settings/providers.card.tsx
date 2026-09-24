import { Card, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
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
 * a ninety-word paragraph under a table header, or nowhere. The words are in the `settings`
 * catalog under `providers.capability`; this is the list of capabilities that have them.
 */
const WORDED_CAPABILITIES = ['speech', 'llm', 'mixer', 'analysis', 'similarity', 'weather', 'charts', 'enrichment'] as const;
type WordedCapability = (typeof WORDED_CAPABILITIES)[number];

function isWorded(capability: string): capability is WordedCapability {
    return (WORDED_CAPABILITIES as readonly string[]).includes(capability);
}

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
    const { t } = useTranslation('settings');
    const providers = usePluginProviders();

    if (providers.isPending) return <PageSkeleton variant="rows" count={3} />;

    if (providers.error || !providers.data) {
        return <ErrorAlert title={t('providers.unavailable.title')} error={providers.error} fallback={t('providers.unavailable.fallback')} />;
    }

    if (providers.data.capabilities.length === 0) {
        return <EmptyState title={t('providers.empty.title')}>{t('providers.empty.body')}</EmptyState>;
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
    const { t } = useTranslation('settings');
    const worded = isWorded(state.capability) ? state.capability : undefined;
    const only = state.candidates.length === 1 ? state.candidates[0] : undefined;

    return (
        <Card id={state.capability} withBorder padding="md">
            <Stack gap="sm">
                <div>
                    <Title order={4}>{worded ? t(`providers.capability.${worded}.title`) : state.capability}</Title>
                    <Text size="sm" c="dimmed">
                        {worded ? t(`providers.capability.${worded}.meaning`) : t('providers.fallback.meaning')}
                    </Text>
                </div>

                {only !== undefined ? (
                    <Text size="sm" c="dimmed">
                        {worded ? t(`providers.capability.${worded}.only`, { name: only.name }) : t('providers.fallback.only', { name: only.name })}
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
