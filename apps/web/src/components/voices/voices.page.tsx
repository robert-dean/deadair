import { ActionIcon, Anchor, Card, Group, Stack, Text } from '@mantine/core';
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { Persona } from '@deadair/sdk';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';

import { usePersonas } from '../../api/personas.queries';
import { fetchVoiceSample, voicesOptions } from '../../api/voices.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { severityColor } from '../shared/status';
import { useVoicePreview } from './voice.preview';

/**
 * The station voice the news is read in, whoever is presenting.
 *
 * A slot name here is a persona key everywhere else, which is the one exception: no character is
 * called this and every station has it, because a bulletin is read in its own voice.
 */
const NEWSREADER = 'newsreader';

/**
 * The voices the station can speak in, each with a preview.
 *
 * A sample is a PREVIEW and never something that can air: it has no row in the segment library, so
 * it cannot be planted by the break planner or named by a lineup. The API keeps that separation on
 * the filesystem; this page only plays what it is given.
 *
 * The audio is fetched rather than pointed at. An `<audio src>` sends no Authorization header, the
 * console holds its bearer token in memory, and the sample route is deliberately not anonymous the
 * way segment audio is — so the bytes come through the SDK and the player is pointed at a blob.
 *
 * ## The mapping is not edited here, so the page says where it is
 *
 * What a station voice maps to lives in the speech plugin's own config, which is the only thing
 * that knows its engine's vocabulary. This page can show that a voice is wrong and could not fix it
 * — so it links to the plugin rather than leaving an operator to find the settings form themselves.
 *
 * ## Who speaks in it is the other half of what a slot IS
 *
 * The ids here are persona keys, which is a design decision (one vocabulary rather than two and a
 * mapping between them) and is invisible from this page: a row called `videoage` reads as a word
 * somebody chose rather than as a character on the page next door. So the personas are joined in and
 * each row says who speaks in it. It costs nothing — the list is cached and the shell reads it on
 * every page carrying a transport bar.
 */
export function VoicesPage() {
    const { t } = useTranslation('voices');
    const voices = useQuery(voicesOptions);
    const personas = usePersonas();
    const preview = useVoicePreview();

    const pluginId = voices.data?.pluginId;

    return (
        <Stack gap="lg">
            <PageHeader
                title={t('title')}
                description={
                    pluginId ? (
                        <Text c="dimmed" size="sm">
                            {/* `renderRoot` rather than `component={Link}`: the polymorphic form
                                erases the router's own types, and with them the check that `params`
                                matches the path. */}
                            <Trans
                                t={t}
                                i18nKey="spokenBy"
                                values={{ plugin: pluginId }}
                                components={{
                                    anchor: <Anchor renderRoot={(props: object) => <Link to="/plugins/$id" params={{ id: pluginId }} {...props} />} />,
                                }}
                            />
                        </Text>
                    ) : (
                        <Text c="dimmed" size="sm">
                            {t('description')}
                        </Text>
                    )
                }
            />

            {voices.error ? <ErrorAlert title={t('error.title')} error={voices.error} fallback={t('error.fallback')} /> : undefined}

            {/* Not an error: a station with no TTS plugin plays records, which is a state rather
                than a fault. The API says which of the three ways it got here. */}
            {voices.data && voices.data.voices.length === 0 ? (
                <EmptyState title={t('empty.title')}>{voices.data.reason ?? t('empty.fallback')}</EmptyState>
            ) : undefined}

            {voices.isPending ? <PageSkeleton variant="table" /> : undefined}

            <Stack gap="xs">
                {voices.data?.voices.map(voice => (
                    <Card key={voice.id} padding="sm">
                        <Group justify="space-between" wrap="nowrap">
                            <Stack gap="xxxs">
                                <Group gap="xs" wrap="nowrap">
                                    <Text fw={500}>{voice.label}</Text>
                                    <Text size="xs" c="dimmed">
                                        {spokenBy(t, voice.id, personas.data?.personas)}
                                    </Text>
                                </Group>
                                {/* The wait is explained where it happens rather than in a footnote
                                    at the bottom of the page, which is read long before or long
                                    after the moment it describes. */}
                                {preview.isLoading(voice.id) ? (
                                    <Text c="dimmed" size="xs">
                                        {t('row.firstTime')}
                                    </Text>
                                ) : voice.description ? (
                                    <Text c="dimmed" size="xs">
                                        {voice.description}
                                    </Text>
                                ) : undefined}
                            </Stack>
                            <ActionIcon
                                variant="default"
                                size="lg"
                                loading={preview.isLoading(voice.id)}
                                aria-label={
                                    preview.isPlaying(voice.id) ? t('row.pause', { label: voice.label }) : t('row.play', { label: voice.label })
                                }
                                onClick={() => preview.play(voice.id, () => fetchVoiceSample(voice.id), t('row.playFailed'))}
                            >
                                {preview.isPlaying(voice.id) ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
                            </ActionIcon>
                        </Group>

                        {preview.failureFor(voice.id) ? (
                            <Text size="xs" c={severityColor.failure} mt="xs">
                                {preview.failureFor(voice.id)}
                            </Text>
                        ) : undefined}
                    </Card>
                ))}
            </Stack>

            {pluginId && (voices.data?.voices.length ?? 0) > 0 ? (
                <Text c="dimmed" size="xs">
                    <Trans
                        t={t}
                        i18nKey="wrongVoice"
                        values={{ plugin: pluginId }}
                        components={{
                            anchor: (
                                <Anchor size="xs" renderRoot={(props: object) => <Link to="/plugins/$id" params={{ id: pluginId }} {...props} />} />
                            ),
                        }}
                    />
                </Text>
            ) : undefined}
        </Stack>
    );
}

/**
 * What this slot is for, said in the station's own terms.
 *
 * A slot nothing uses says nothing rather than "unused": the mapping is what a station voice IS, and
 * a row that exists is already the operator saying they want it available. Naming it as spare would
 * read as something to tidy up.
 */
function spokenBy(t: TFunction<'voices'>, voiceId: string, personas: Persona[] | undefined): string {
    if (voiceId === NEWSREADER) return t('row.news');
    if (voiceId.length === 0 || personas === undefined) return '';

    const speakers = personas.filter(persona => persona.voice === voiceId).map(persona => persona.label);
    return speakers.length === 0 ? '' : speakers.join(', ');
}
