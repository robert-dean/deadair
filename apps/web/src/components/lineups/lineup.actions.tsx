import { useState } from 'react';
import { Button, Group, Modal, Stack, Text, Tooltip } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import type { Lineup } from '@deadair/sdk';

import { useDeleteLineup, useExtendLineup, useShuffleLineup } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';

export interface LineupActionsProps {
    lineup: Lineup;
    /** The edit guard's `onError`, so a refused revision is reported once rather than per button. */
    onEditError: (error: unknown) => void;
}

/**
 * Everything an operator can do to a stored lineup from its own page.
 *
 * **Airing one is not among them any more.** A lineup is prepared material now, and what airs is
 * built from a playlist when the station goes on: see `docs/decisions/on-air-ownership.md`. Put on
 * air lives on the playlists page, beside the thing it reads.
 */
export function LineupActions({ lineup, onEditError }: LineupActionsProps) {
    const navigate = useNavigate();
    const extend = useExtendLineup();
    const shuffle = useShuffleLineup();
    const remove = useDeleteLineup();
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const uncommitted = lineup.items.filter(item => !item.committed).length;

    // Kept per action rather than raised as one page-level alert: each belongs to the button that
    // asked for it.
    const extendFailure = extend.isError ? apiErrorMessage(extend.error, 'A refill could not be queued.') : undefined;
    const shuffleFailure = shuffle.isError ? apiErrorMessage(shuffle.error, 'That lineup could not be shuffled.') : undefined;
    const deleteFailure = remove.isError ? apiErrorMessage(remove.error, 'That lineup could not be deleted.') : undefined;

    return (
        <Group gap="sm" wrap="nowrap">
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
