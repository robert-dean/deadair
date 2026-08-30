import { useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';

import { invalidateCatalogLists, useClearTrack, type TrackClear } from '../../api/catalog.queries';
import type { TrackStateParam } from './catalog.page.params';

/**
 * What to do about a whole list of records at once, where the list is one of the two fault states.
 *
 * ## Why the list and not the row
 *
 * These faults arrive in runs. A provider having a bad hour benches a dozen records at the same
 * moment, and the honest remedy for all of them is the same one press — so the alternative to this
 * is opening a dozen record pages, working a menu on each, and confirming a dozen times to carry out
 * one decision the operator made once. That is also the answer to "how do I clear this off the desk",
 * which the attention list could otherwise only point at.
 *
 * Nothing is offered for the other three states. `cached`, `uncached` and `unmeasured` are not
 * faults — most of a library is `uncached` — and a bulk verb over them would be a button whose worst
 * case is re-fetching a healthy library.
 *
 * ## It loops the per-record verbs rather than adding a bulk one
 *
 * Deliberate at this scale, and it is a real choice rather than a shortcut. The verbs already exist,
 * each already stamps the activity feed with the actor who asked, and `clearAudio`'s refusal of a
 * record inside the commit window is the kind of per-record answer a bulk endpoint would have to
 * invent a shape for. What it costs is one request per record, over a PAGE of them — the pager caps
 * at 100 — which is a bounded cost paid once by hand.
 *
 * It acts on the rows the list is currently showing and says so, rather than on every record in the
 * state: the page is what the operator is looking at, and a button that quietly reached past it
 * would be acting on records they have not seen.
 */
const ACTIONS: Record<'benched' | 'failing', { what: TrackClear; verb: string; title: string; consequence: string; confirm: string }> = {
    benched: {
        what: 'offer',
        verb: 'Offer these again',
        title: 'Offer these copies again?',
        consequence:
            'Puts back on offer every copy a provider refused, and clears the backoff on the rest. A refused copy is one the provider answered about — it said it holds no audio and never will — so nothing in the station brings it back on its own, and this overrides that. If the provider still means it, they are refused again the next time the station asks.',
        confirm: 'Offer them again',
    },
    failing: {
        what: 'retry',
        verb: 'Try these again',
        title: 'Try these records again?',
        consequence:
            'Clears the backoff and un-benches every copy, so the station may try each of them straight away rather than waiting out its gate. This is what to press once an upstream that was failing is working again.',
        confirm: 'Try again',
    },
};

export interface TrackStateActionProps {
    state: TrackStateParam | '';
    /** The records the list is showing, which is exactly what this acts on. */
    trackIds: readonly string[];
}

/** What happened, kept on screen: the counts are the interesting half and a toast would take them away. */
interface Outcome {
    done: number;
    failed: number;
}

export function TrackStateAction({ state, trackIds }: TrackStateActionProps) {
    const [asking, setAsking] = useState(false);
    const [outcome, setOutcome] = useState<Outcome>();
    const [running, setRunning] = useState(false);
    const clear = useClearTrack();
    const queryClient = useQueryClient();

    const action = state === 'benched' || state === 'failing' ? ACTIONS[state] : undefined;
    // An outcome outlives the rows it was about, deliberately. A press that WORKS empties the list it
    // was pressed on, so a component that vanished with the last row would take the answer away at
    // exactly the moment there was one — leaving an operator looking at an empty page with no idea
    // whether anything happened.
    if (action === undefined || (trackIds.length === 0 && outcome === undefined)) return undefined;

    const run = async () => {
        setRunning(true);
        let done = 0;
        let failed = 0;

        // Sequential, not `Promise.all`. Every one of these sends the station off to fetch a record,
        // and firing a hundred of them at one provider at once is the shape of request storm the
        // backoff these are clearing exists to prevent.
        for (const id of trackIds) {
            try {
                await clear.mutateAsync({ id, what: action.what });
                done += 1;
            } catch {
                // Counted rather than thrown: one record the station will not act on must not stop
                // the other ninety-nine, and the tally below is what the operator needs to see.
                failed += 1;
            }
        }

        // The lists themselves, which the per-record mutation does not touch: a record that is no
        // longer benched has to leave the one an operator is looking at, and the counts above it
        // come down with the same read.
        invalidateCatalogLists(queryClient, 'tracks');
        setOutcome({ done, failed });
        setRunning(false);
        setAsking(false);
    };

    return (
        <>
            <Group gap="sm" align="center">
                {trackIds.length > 0 ? (
                    <Button
                        variant="default"
                        size="compact-sm"
                        onClick={() => {
                            setOutcome(undefined);
                            setAsking(true);
                        }}
                    >
                        {action.verb} ({trackIds.length})
                    </Button>
                ) : undefined}
                {outcome ? (
                    <Text size="xs" c="dimmed">
                        {outcome.done} {outcome.done === 1 ? 'record' : 'records'} reopened
                        {outcome.failed === 0 ? '' : `, ${outcome.failed} the station would not act on`}.
                    </Text>
                ) : undefined}
            </Group>

            <Modal opened={asking} onClose={() => setAsking(false)} title={action.title} centered>
                <Stack gap="md">
                    <Text size="sm">{action.consequence}</Text>
                    <Text size="sm" c="dimmed">
                        This acts on the {trackIds.length} {trackIds.length === 1 ? 'record' : 'records'} on this page.
                    </Text>

                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setAsking(false)} disabled={running}>
                            Cancel
                        </Button>
                        <Button color="red" loading={running} onClick={() => void run()}>
                            {action.confirm}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}
