import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Anchor, Card, Group, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { fetchVoiceSample, voicesOptions } from '../../api/voices.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';

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
 */
export function VoicesPage() {
    const voices = useQuery(voicesOptions);

    // Which voice is loading, and which is playing. Two pieces of state rather than one, because the
    // first render of a voice waits on a synthesis and the operator should see that it is working.
    const [loading, setLoading] = useState<string | undefined>();
    const [playing, setPlaying] = useState<string | undefined>();
    // Keyed by voice, so a failure sits on the row that failed. A page-level alert for a per-row
    // button puts the reason somewhere the operator is not looking.
    const [failed, setFailed] = useState<{ voiceId: string; message: string } | undefined>();

    const audio = useRef<HTMLAudioElement | undefined>(undefined);
    const objectUrl = useRef<string | undefined>(undefined);

    /** An object URL pins its blob until it is revoked, so every one this page mints is released. */
    const release = () => {
        if (objectUrl.current !== undefined) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = undefined;
    };

    useEffect(() => {
        return () => {
            audio.current?.pause();
            release();
        };
    }, []);

    const play = async (voiceId: string) => {
        // The button draws itself as a pause while this voice is playing, so it has to pause. It
        // used to fall through to the fetch below, which stopped the audio and started the same
        // sample again from the top — a restart wearing a pause button's clothes.
        if (playing === voiceId) {
            audio.current?.pause();
            setPlaying(undefined);
            return;
        }

        audio.current?.pause();
        release();
        setFailed(undefined);
        setPlaying(undefined);
        setLoading(voiceId);

        try {
            const url = await fetchVoiceSample(voiceId);
            objectUrl.current = url;

            const element = new Audio(url);
            element.addEventListener('ended', () => setPlaying(undefined), { once: true });
            audio.current = element;

            await element.play();
            setPlaying(voiceId);
        } catch (failure) {
            setFailed({ voiceId, message: apiErrorMessage(failure, 'That voice could not be previewed.') });
        } finally {
            setLoading(undefined);
        }
    };

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
                <Alert color="gray" title="The station has no voice yet">
                    {voices.data.reason ?? 'No plugin is available to speak.'}
                </Alert>
            ) : undefined}

            {voices.isPending ? <PageSkeleton variant="table" /> : undefined}

            <Stack gap="xs">
                {voices.data?.voices.map(voice => (
                    <Card key={voice.id} padding="sm" radius="md">
                        <Group justify="space-between" wrap="nowrap">
                            <Stack gap="xxxs">
                                <Text fw={500}>{voice.label}</Text>
                                {/* The wait is explained where it happens rather than in a footnote
                                    at the bottom of the page, which is read long before or long
                                    after the moment it describes. */}
                                {loading === voice.id ? (
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
                                loading={loading === voice.id}
                                aria-label={playing === voice.id ? `Pause the sample of ${voice.label}` : `Play a sample of ${voice.label}`}
                                onClick={() => {
                                    void play(voice.id);
                                }}
                            >
                                {playing === voice.id ? '❚❚' : '▶'}
                            </ActionIcon>
                        </Group>

                        {failed?.voiceId === voice.id ? (
                            <Text size="xs" c="red.4" mt="xs">
                                {failed.message}
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
