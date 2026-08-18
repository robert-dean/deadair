import { useState } from 'react';
import { Button, Group, Menu, Modal, Stack, Text } from '@mantine/core';

import { useClearTrack, type TrackClear } from '../../api/catalog.queries';
import { ErrorAlert } from '../shared/error.alert';

/**
 * The four things an operator can throw away, and what each one costs.
 *
 * `consequence` is the sentence on the confirmation, and it is the point of having one: every verb
 * here makes the station go and do work again, and the only question worth asking before pressing is
 * "what happens next". None of them destroys anything the station cannot rebuild, which is why the
 * copy says what will be rebuilt rather than warning about loss.
 */
const CLEARS: { what: TrackClear; label: string; title: string; consequence: string; confirm: string }[] = [
    {
        what: 'audio',
        label: 'Throw away the local copies',
        title: 'Throw away the local copies?',
        consequence:
            'The files come off this machine and the rows stay. The station fetches the record again the next time it comes round, which costs one download. Useful when a cached file sounds wrong.',
        confirm: 'Throw them away',
    },
    {
        what: 'analysis',
        label: 'Forget the measurement',
        title: 'Forget the measurement?',
        consequence:
            'The cue points and the loudness go, and the measurement walk picks the record up again on its next pass. Until it does, the record still plays — untrimmed, and levelled live rather than before air.',
        confirm: 'Forget it',
    },
    {
        what: 'enrichment',
        label: 'Forget what the providers said',
        title: 'Forget what the providers said?',
        consequence:
            'Every provider’s stored answer goes and the enrichment pass asks again. The station’s own facts, the ones with a source and a quote, are not touched — nor is anything already promoted onto the record, like its year or its cover.',
        confirm: 'Forget them',
    },
    {
        what: 'retry',
        label: 'Try the copies again now',
        title: 'Try the copies again now?',
        consequence:
            'Clears the backoff and un-benches every copy, so the station may try each of them straight away rather than waiting. This is what to press once an upstream that was failing is working again.',
        confirm: 'Try again',
    },
];

/**
 * What an operator can throw away about one record.
 *
 * A menu rather than four buttons on the page, because none of these is a thing somebody arrives
 * wanting to do: they come to find out why a record will not air, and this is what they reach for
 * once they know. Behind a confirmation each, since every one of them sends the station off to do
 * work — and the confirmation says what work, which is the part worth reading.
 *
 * The answer stays on screen after the fact. "Dropped 2 copies" and "The station was not holding any
 * copies of this record" are different facts about the record, and a menu that closed silently would
 * throw away the more interesting one.
 */
export function TrackClearMenu({ trackId }: { trackId: string }) {
    const [asking, setAsking] = useState<(typeof CLEARS)[number] | undefined>();
    const [answer, setAnswer] = useState<string | undefined>();
    const clear = useClearTrack();

    return (
        <>
            <Stack gap="xs" align="flex-end">
                <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                        <Button variant="default" size="xs">
                            Clear…
                        </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                        <Menu.Label>Throw away what the station can work out again</Menu.Label>
                        {CLEARS.map(entry => (
                            <Menu.Item
                                key={entry.what}
                                onClick={() => {
                                    setAnswer(undefined);
                                    clear.reset();
                                    setAsking(entry);
                                }}
                            >
                                {entry.label}
                            </Menu.Item>
                        ))}
                    </Menu.Dropdown>
                </Menu>

                {answer ? (
                    <Text size="xs" c="dimmed" maw={420} ta="right">
                        {answer}
                    </Text>
                ) : undefined}
            </Stack>

            <Modal opened={asking !== undefined} onClose={() => setAsking(undefined)} title={asking?.title} centered>
                <Stack gap="md">
                    <Text size="sm">{asking?.consequence}</Text>

                    {/* The 409 is the one refusal worth reading in full: a record about to air is
                        left alone deliberately, and the message says what to do instead. */}
                    {clear.error ? (
                        <ErrorAlert tone="warning" title="Left alone" error={clear.error} fallback="The station could not do that just now." />
                    ) : undefined}

                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setAsking(undefined)} disabled={clear.isPending}>
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            loading={clear.isPending}
                            onClick={() => {
                                if (asking === undefined) return;
                                clear.mutate(
                                    { id: trackId, what: asking.what },
                                    {
                                        onSuccess: result => {
                                            setAnswer(result.detail);
                                            setAsking(undefined);
                                        },
                                    },
                                );
                            }}
                        >
                            {asking?.confirm}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}
