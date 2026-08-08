import { useState } from 'react';
import { Button, Group, Modal, Stack, Text, Tooltip } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import type { Lineup } from '@deadair/sdk';

import { useDeleteLineup, useExtendLineup, usePutLineupOnAir, useShuffleLineup } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';

export interface LineupActionsProps {
    lineup: Lineup;
    /** Whether this is the lineup the station is programmed with, however the station is currently faring. */
    onAir: boolean;
    /** The edit guard's `onError`, so a refused revision is reported once rather than per button. */
    onEditError: (error: unknown) => void;
}

/**
 * Everything an operator can do to a lineup from its own page.
 *
 * Airing one is a broadcast action: it changes what every listener hears, which is why the label
 * says what it does to the station rather than "Play". The rest act on the plan, and each of them
 * carries the revision the operator was looking at, so an edit made against an order that has since
 * moved is refused rather than applied to whatever is in that position now.
 */
export function LineupActions({ lineup, onAir, onEditError }: LineupActionsProps) {
    const navigate = useNavigate();
    const putOnAir = usePutLineupOnAir();
    const extend = useExtendLineup();
    const shuffle = useShuffleLineup();
    const remove = useDeleteLineup();
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const uncommitted = lineup.items.filter(item => !item.committed).length;
    const empty = lineup.items.length === 0;

    // Kept per action rather than raised as one page-level alert: each belongs to the button that
    // asked for it, and the air state above reports the station independently of any of them.
    const airFailure = putOnAir.isError ? apiErrorMessage(putOnAir.error, 'That lineup could not be put on air.') : undefined;
    const extendFailure = extend.isError ? apiErrorMessage(extend.error, 'A refill could not be queued.') : undefined;
    const shuffleFailure = shuffle.isError ? apiErrorMessage(shuffle.error, 'That lineup could not be shuffled.') : undefined;
    // The API answers 409 here to say the lineup is on air, which is a different thing from a stale
    // revision and is worth showing in the API's own words.
    const deleteFailure = remove.isError ? apiErrorMessage(remove.error, 'That lineup could not be deleted.') : undefined;

    return (
        <Group gap="sm" wrap="nowrap">
            <Tooltip
                label={airFailure ?? 'Airs this lineup from the top. What is playing finishes first.'}
                color={airFailure ? 'red' : undefined}
                multiline
                maw={320}
            >
                <Button
                    color={airFailure ? 'red' : undefined}
                    loading={putOnAir.isPending}
                    // Airing an empty lineup would air silence, and the API refuses it anyway.
                    disabled={empty}
                    // Deliberately not `interrupting`: that flag remembers what was displaced so a
                    // lineup ending with `resume` hands the station back, which is what a feature
                    // wants, not what an operator changing the programming means.
                    onClick={() => putOnAir.mutate({ lineupId: lineup.id })}
                >
                    {onAir ? 'Restart from the top' : 'Put on air'}
                </Button>
            </Tooltip>

            <Tooltip
                label={extendFailure ?? 'Queues a refill. The tracks land a few seconds later.'}
                color={extendFailure ? 'red' : undefined}
                multiline
                maw={320}
            >
                <Button variant="light" loading={extend.isPending} onClick={() => extend.mutate({ lineupId: lineup.id })}>
                    Extend
                </Button>
            </Tooltip>

            <Tooltip
                label={shuffleFailure ?? 'Shuffles everything not yet handed to the player.'}
                color={shuffleFailure ? 'red' : undefined}
                multiline
                maw={320}
            >
                <Button
                    variant="light"
                    loading={shuffle.isPending}
                    // Nothing left to shuffle: the whole lineup is in the player's hands.
                    disabled={uncommitted < 2}
                    onClick={() => shuffle.mutate({ lineupId: lineup.id, revision: lineup.revision }, { onError: onEditError })}
                >
                    Shuffle
                </Button>
            </Tooltip>

            <Tooltip label={deleteFailure} disabled={!deleteFailure} color="red" multiline maw={320}>
                <Button
                    variant="subtle"
                    color="red"
                    loading={remove.isPending}
                    onClick={() => {
                        setConfirmingDelete(true);
                    }}
                >
                    {deleteFailure ? 'Failed' : 'Delete'}
                </Button>
            </Tooltip>

            <Modal
                opened={confirmingDelete}
                onClose={() => {
                    setConfirmingDelete(false);
                }}
                title={`Delete ${lineup.name}?`}
                centered
            >
                <Stack gap="md">
                    <Text size="sm">
                        The order goes with it. What was imported can be imported again, but anything the director built for this lineup cannot.
                    </Text>
                    {/* Said before they press it rather than after the 409: an operator who has to
                        take the station off air first would rather know now. */}
                    {onAir ? (
                        <Text size="sm" c="dimmed">
                            This is the lineup the station is programmed with. Deleting it will be refused until another one is put on air, or the
                            station is stopped.
                        </Text>
                    ) : undefined}
                    <Group justify="flex-end">
                        <Button
                            variant="default"
                            onClick={() => {
                                setConfirmingDelete(false);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            loading={remove.isPending}
                            onClick={() => {
                                remove.mutate(lineup.id, {
                                    onSuccess: () => {
                                        setConfirmingDelete(false);
                                        void navigate({ to: '/lineups' });
                                    },
                                    onError: () => {
                                        // Shut the dialog and leave the failure on the button: the
                                        // reason is the API's, and it is worth reading next to the
                                        // lineup it is about.
                                        setConfirmingDelete(false);
                                    },
                                });
                            }}
                        >
                            Delete
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Group>
    );
}
