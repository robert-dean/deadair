import { Button, Card, Group, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useState } from 'react';

import { usePutStationOnAir } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';

/**
 * Starting a broadcast by saying what it should be.
 *
 * The other way on air is a playlist, from the playlists page, and this is the one that needs no
 * prepared material at all: the station is put on with an empty running order and a brief, and the
 * generator fills it against that brief. It keeps steering every refill for as long as the
 * broadcast runs, which is why the brief is stored on the running order rather than spent on the
 * first batch.
 *
 * **A broadcast action, like everything else on this page.** There is no draft and no save: pressing
 * this puts the station on air and every listener hears the result. The copy says so.
 *
 * It needs a model to programme with (`llm.setGenerator`, off by default) and it will not say so,
 * because this component cannot tell the difference between that being off and a model that answered
 * badly — what an operator sees either way is the station's own rotation, which is the designed
 * degradation rather than a failure to report. The help text names the setting instead.
 */
export function BriefTheStation() {
    const [brief, setBrief] = useState('');
    const onAir = usePutStationOnAir();

    const asked = brief.trim();
    const failure = onAir.isError ? apiErrorMessage(onAir.error, 'The station could not be put on air.') : undefined;

    const start = () => {
        if (asked.length === 0) return;
        // The brief doubles as the label for this broadcast. An operator who asked for heavy metal
        // hits should see that on the page rather than "The station", and naming it anything else
        // would be inventing a second thing to read.
        onAir.mutate({ brief: asked, name: asked });
    };

    return (
        <Card withBorder padding="xl" radius="sm">
            <Stack gap="sm" align="flex-start">
                <Text fw={500}>Tell the station what to play</Text>
                <Text size="sm" c="dimmed">
                    It programmes itself against this, from your own library first and from your providers when the library cannot fill it. A record
                    it does not own yet is fetched and kept. What you like and dislike is taken into account either way.
                </Text>
                <Group gap="sm" wrap="nowrap" w="100%">
                    <TextInput
                        flex={1}
                        placeholder="heavy metal hits"
                        aria-label="What the station should play"
                        value={brief}
                        maxLength={500}
                        onChange={event => setBrief(event.currentTarget.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') start();
                        }}
                    />
                    <Tooltip
                        label={failure ?? 'Puts the station on air and starts programming against this. Every listener hears the result.'}
                        color={failure ? 'red' : undefined}
                        multiline
                        maw={320}
                    >
                        <Button
                            color={failure ? 'red' : undefined}
                            loading={onAir.isPending}
                            disabled={asked.length === 0}
                            onClick={start}
                        >
                            Go on air
                        </Button>
                    </Tooltip>
                </Group>
                <Text size="xs" c="dimmed">
                    Needs a model to programme with: turn on “Let a model choose what the station plays” in settings. Without one the station falls
                    back to its own rotation, which ignores the brief.
                </Text>
            </Stack>
        </Card>
    );
}
