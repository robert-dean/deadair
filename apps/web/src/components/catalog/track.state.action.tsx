import { useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

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
// Each action's button, title, consequence and confirm are `stateAction.<state>` in the catalog namespace.
const ACTIONS: Record<'benched' | 'failing', TrackClear> = {
    benched: 'offer',
    failing: 'retry',
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
    const { t } = useTranslation(['catalog', 'common']);
    const [asking, setAsking] = useState(false);
    const [outcome, setOutcome] = useState<Outcome>();
    const [running, setRunning] = useState(false);
    const clear = useClearTrack();
    const queryClient = useQueryClient();

    const faulted = state === 'benched' || state === 'failing' ? state : undefined;
    // An outcome outlives the rows it was about, deliberately. A press that WORKS empties the list it
    // was pressed on, so a component that vanished with the last row would take the answer away at
    // exactly the moment there was one — leaving an operator looking at an empty page with no idea
    // whether anything happened.
    if (faulted === undefined || (trackIds.length === 0 && outcome === undefined)) return undefined;

    const run = async () => {
        setRunning(true);
        let done = 0;
        let failed = 0;

        // Sequential, not `Promise.all`. Every one of these sends the station off to fetch a record,
        // and firing a hundred of them at one provider at once is the shape of request storm the
        // backoff these are clearing exists to prevent.
        for (const id of trackIds) {
            try {
                await clear.mutateAsync({ id, what: ACTIONS[faulted] });
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
                        {t(`stateAction.${faulted}.button`, { count: trackIds.length })}
                    </Button>
                ) : undefined}
                {outcome ? (
                    <Text size="xs" c="dimmed">
                        {outcome.failed === 0
                            ? t('stateAction.outcome.reopened', { count: outcome.done })
                            : t('stateAction.outcome.reopenedSomeRefused', { count: outcome.done, failed: outcome.failed })}
                    </Text>
                ) : undefined}
            </Group>

            <Modal opened={asking} onClose={() => setAsking(false)} title={t(`stateAction.${faulted}.title`)} centered>
                <Stack gap="md">
                    <Text size="sm">{t(`stateAction.${faulted}.consequence`)}</Text>
                    <Text size="sm" c="dimmed">
                        {t('stateAction.scope', { count: trackIds.length })}
                    </Text>

                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setAsking(false)} disabled={running}>
                            {t('common:action.cancel')}
                        </Button>
                        <Button color="red" loading={running} onClick={() => void run()}>
                            {t(`stateAction.${faulted}.confirm`)}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}
