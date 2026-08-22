import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import type { Persona } from '@deadair/sdk';

import { usePersonaNotes } from '../../api/personas.queries';
import { ErrorAlert } from '../shared/error.alert';

/**
 * Asking before a character is deleted, and saying what goes with it.
 *
 * The rest of this page is deliberately plain buttons, each with a comment saying why: restoring the
 * built-ins writes only what is missing, a rehearsal changes no row, putting one on air is undone by
 * putting another one there. Delete is the one that is none of those things — a sheet somebody wrote
 * is gone, and so is everything the character accumulated under it.
 *
 * The notebook is COUNTED rather than mentioned, on the format clock's rule: "and its notebook goes
 * too" is a sentence an operator skims, and "and the four notes it has settled into go too" is one
 * they read. It costs a read of the notebook the moment the dialog opens, which is the same per-
 * character request the panel behind it makes, and it is only made for the persona actually being
 * deleted.
 *
 * The station's own characters are named as restorable, because that is the difference between a
 * decision to think about and one to make: a seeded persona comes back from the button at the top of
 * the page, and a persona somebody wrote does not come back at all.
 */
export function PersonaDeleteModal({ persona, opened, onClose, onConfirm, deleting, error }: Props) {
    // Only while the dialog is open, and only for this one. `usePersonaNotes` is already keyed per
    // persona with the list's own staleness, so an operator who had the notebook open pays nothing.
    const notes = usePersonaNotes(opened ? persona?.id : undefined);

    if (persona === undefined) return undefined;

    return (
        <Modal opened={opened} onClose={onClose} title={`Delete ${persona.label}?`} centered>
            <Stack gap="md">
                <Text size="sm">
                    Its sheet goes, and so do its own phrasings{notebookClause(notes.data?.notes.length)}. Anything it has already written and
                    rendered keeps the words it has; nothing on air changes.
                </Text>

                <Text size="sm" c="dimmed">
                    The station&apos;s own characters can be written back with Restore built-ins. One you wrote yourself cannot.
                </Text>

                {error ? <ErrorAlert title="That persona could not be deleted" error={error} fallback="Nothing was removed." /> : undefined}

                <Group justify="flex-end">
                    <Button variant="default" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button color="red" loading={deleting} onClick={onConfirm}>
                        Delete
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}

/**
 * What the notebook adds to the sentence, or nothing.
 *
 * Silent while the count is still being read and silent when it is zero, because a clause saying
 * "and its zero notes" is worse than no clause: the fact worth stopping for is that there IS
 * something accumulated here that no sheet holds.
 */
function notebookClause(count: number | undefined): string {
    if (count === undefined || count === 0) return '';
    return `, and the ${count} note${count === 1 ? '' : 's'} in its notebook`;
}

interface Props {
    /** The persona being deleted, or absent when the dialog is closed. */
    persona?: Persona;
    opened: boolean;
    onClose: () => void;
    onConfirm: () => void;
    deleting: boolean;
    error?: unknown;
}
