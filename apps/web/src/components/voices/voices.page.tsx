import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Card, Group, Stack, Text } from '@mantine/core';
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
 */
export function VoicesPage() {
    const voices = useQuery(voicesOptions);

    // Which voice is loading, and which is playing. Two pieces of state rather than one, because the
    // first render of a voice waits on a synthesis and the operator should see that it is working.
    const [loading, setLoading] = useState<string | undefined>();
    const [playing, setPlaying] = useState<string | undefined>();
    const [error, setError] = useState<string | undefined>();

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
        audio.current?.pause();
        release();
        setError(undefined);
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
            setError(apiErrorMessage(failure, 'That voice could not be previewed.'));
        } finally {
            setLoading(undefined);
        }
    };

    return (
        <Stack gap="lg">
            <PageHeader
                title="Voices"
                description={
                    <Text c="dimmed" size="sm">
                        {voices.data?.pluginId ? `Spoken by ${voices.data.pluginId}.` : 'What the station can sound like.'}
                    </Text>
                }
            />

            {voices.error ? (
                <ErrorAlert title="Voices could not be loaded" error={voices.error} fallback="The voice list is unavailable." />
            ) : undefined}

            {error ? (
                <Alert color="yellow" title="Preview failed">
                    {error}
                </Alert>
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
                                {voice.description ? (
                                    <Text c="dimmed" size="xs">
                                        {voice.description}
                                    </Text>
                                ) : undefined}
                            </Stack>
                            <ActionIcon
                                variant="default"
                                size="lg"
                                loading={loading === voice.id}
                                aria-label={`Play a sample of ${voice.label}`}
                                onClick={() => {
                                    void play(voice.id);
                                }}
                            >
                                {playing === voice.id ? '❚❚' : '▶'}
                            </ActionIcon>
                        </Group>
                    </Card>
                ))}
            </Stack>

            <Text c="dimmed" size="xs">
                The first play of a voice waits for it to be spoken; after that it is cached.
            </Text>
        </Stack>
    );
}
