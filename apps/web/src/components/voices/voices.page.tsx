import { ActionIcon, Anchor, Card, Group, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { Persona } from '@deadair/sdk';

import { usePersonas } from '../../api/personas.queries';
import { fetchVoiceSample, voicesOptions } from '../../api/voices.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
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
    const voices = useQuery(voicesOptions);
    const personas = usePersonas();
    const preview = useVoicePreview();

    const pluginId = voices.data?.pluginId;

    return (
        <Stack gap="lg">
            <PageHeader
                title="Voices"
                description={
                    pluginId ? (
                        <Text c="dimmed" size="sm">
                            Spoken by{' '}
                            {/* `renderRoot` rather than `component={Link}`: the polymorphic form
                                erases the router's own types, and with them the check that `params`
                                matches the path. */}
                            <Anchor renderRoot={props => <Link to="/plugins/$id" params={{ id: pluginId }} {...props} />}>{pluginId}</Anchor>, where
                            what each of these maps to is set.
                        </Text>
                    ) : (
                        <Text c="dimmed" size="sm">
                            What the station can sound like.
                        </Text>
                    )
                }
            />

            {voices.error ? (
                <ErrorAlert title="Voices could not be loaded" error={voices.error} fallback="The voice list is unavailable." />
            ) : undefined}

            {/* Not an error: a station with no TTS plugin plays records, which is a state rather
                than a fault. The API says which of the three ways it got here. */}
            {voices.data && voices.data.voices.length === 0 ? (
                <EmptyState title="The station has no voice yet">{voices.data.reason ?? 'No plugin is available to speak.'}</EmptyState>
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
                                        {spokenBy(voice.id, personas.data?.personas)}
                                    </Text>
                                </Group>
                                {/* The wait is explained where it happens rather than in a footnote
                                    at the bottom of the page, which is read long before or long
                                    after the moment it describes. */}
                                {preview.isLoading(voice.id) ? (
                                    <Text c="dimmed" size="xs">
                                        Speaking it for the first time, which takes a moment. After that it is cached.
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
                                aria-label={preview.isPlaying(voice.id) ? `Pause the sample of ${voice.label}` : `Play a sample of ${voice.label}`}
                                onClick={() => preview.play(voice.id, () => fetchVoiceSample(voice.id), 'That voice could not be previewed.')}
                            >
                                {preview.isPlaying(voice.id) ? '❚❚' : '▶'}
                            </ActionIcon>
                        </Group>

                        {preview.failureFor(voice.id) ? (
                            <Text size="xs" c="red.4" mt="xs">
                                {preview.failureFor(voice.id)}
                            </Text>
                        ) : undefined}
                    </Card>
                ))}
            </Stack>

            {pluginId && (voices.data?.voices.length ?? 0) > 0 ? (
                <Text c="dimmed" size="xs">
                    A voice that sounds wrong is a mapping to change:{' '}
                    <Anchor size="xs" renderRoot={props => <Link to="/plugins/$id" params={{ id: pluginId }} {...props} />}>
                        edit the voice table in {pluginId}&apos;s settings
                    </Anchor>
                    .
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
function spokenBy(voiceId: string, personas: Persona[] | undefined): string {
    if (voiceId === NEWSREADER) return 'the news';
    if (voiceId.length === 0 || personas === undefined) return '';

    const speakers = personas.filter(persona => persona.voice === voiceId).map(persona => persona.label);
    return speakers.length === 0 ? '' : speakers.join(', ');
}
