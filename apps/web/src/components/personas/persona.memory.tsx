import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Group, Modal, Stack, Text, Tooltip } from '@mantine/core';
import type { PersonaMemoryChange, PersonaTelling } from '@deadair/sdk';

import { usePersonaMemory, usePreviewPersonaRollback, useRollbackPersonaMemory } from '../../api/personas.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PageSkeleton } from '../shared/page.skeleton';
import { formatMomentFull } from '../shared/feed.moment';

/**
 * What a character has actually told, and the way back.
 *
 * ## The timeline is the control, not a log beside one
 *
 * There is no date picker here, and that is the design rather than a shortcut. A rollback is chosen
 * by pointing at a row — "back to before this" — because the moment that actually matters to an
 * operator is always "just before the thing I did not like", and a picker makes them read a
 * timestamp off one row and type it into another field. It is also the safer shape: the string
 * handed back is the row's own, so nothing is re-rendered or rounded on the way.
 *
 * ## Nothing happens without the preview
 *
 * Picking a row asks the station what that would undo and shows the counts before the button that
 * does it appears. Two of those counts exist because they are the only ways a rollback can cost
 * something an operator did not expect: a proposal they turned down becomes proposable again, and a
 * proposal they had ACCEPTED is still the station's row and still goes.
 *
 * ## Re-learning is off, and it is a separate question
 *
 * Dragging the distil watermark back is right when an operator is testing and wrong when they are
 * undoing a character that drifted: the second wants the conclusions gone, and re-reading the window
 * invites tonight's pass to reach them again. So it is a checkbox that starts clear.
 */
export function PersonaMemoryPanel({ personaId, label }: { personaId: string; label: string }) {
    const memory = usePersonaMemory(personaId);
    const preview = usePreviewPersonaRollback();
    const rollback = useRollbackPersonaMemory();

    // Which row an operator is asking about, or `reset` for all of it. Held rather than derived,
    // because the dialog has to keep naming what it is about to do after the preview lands.
    const [asking, setAsking] = useState<PersonaTelling | 'reset' | undefined>(undefined);
    const [relearn, setRelearn] = useState(false);

    const tellings = memory.data?.tellings ?? [];

    const ask = (what: PersonaTelling | 'reset') => {
        setAsking(what);
        setRelearn(false);
        preview.reset();
        preview.mutate(what === 'reset' ? { id: personaId } : { id: personaId, to: what.at });
    };

    const confirm = () => {
        if (asking === undefined) return;

        rollback.mutate(
            {
                id: personaId,
                // The row's OWN string, never a re-rendering of it. Postgres keeps a timestamp to the
                // microsecond and JavaScript cannot, so a value that went through a Date here would
                // compare as earlier than its own row and take the row an operator pointed at.
                body: { ...(asking === 'reset' ? {} : { to: asking.at }), ...(relearn ? { relearn: true } : {}) },
            },
            { onSuccess: () => setAsking(undefined) },
        );
    };

    return (
        <Card withBorder mt="sm" padding="sm">
            <Stack gap="sm">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Eyebrow>Memory</Eyebrow>
                    <Text size="xs" c="dimmed" ta="right">
                        what this character has told, and how far back to undo it
                    </Text>
                </Group>

                {memory.error ? (
                    <ErrorAlert title="The timeline could not be loaded" error={memory.error} fallback="Nothing about this character has changed." />
                ) : undefined}

                {rollback.error ? (
                    <ErrorAlert title="Nothing was rolled back" error={rollback.error} fallback="This character is exactly as it was." />
                ) : undefined}

                {memory.isPending ? <PageSkeleton variant="card" /> : undefined}

                {!memory.isPending && tellings.length === 0 ? (
                    <EmptyState title="This character has not told anything yet">
                        A story goes on the timeline when a break carries it. Until then there is nothing to undo.
                    </EmptyState>
                ) : undefined}

                {tellings.map(telling => (
                    <TellingRow key={telling.id} telling={telling} busy={rollback.isPending} onRollBack={() => ask(telling)} />
                ))}

                {tellings.length > 0 ? (
                    <Group justify="flex-end">
                        <Tooltip label="Clears everything this character accumulated on its own. What you wrote by hand stays." withArrow>
                            <Button variant="subtle" color="red" size="compact-xs" disabled={rollback.isPending} onClick={() => ask('reset')}>
                                Clear all of it
                            </Button>
                        </Tooltip>
                    </Group>
                ) : undefined}
            </Stack>

            <Modal
                opened={asking !== undefined}
                onClose={() => setAsking(undefined)}
                title={asking === 'reset' ? `Clear everything ${label} has accumulated?` : `Roll ${label} back to before this?`}
                centered
            >
                <Stack gap="sm">
                    {asking !== undefined && asking !== 'reset' ? (
                        <Text size="sm" c="dimmed">
                            Everything after {formatMomentFull(asking.at)} goes. That telling itself stays.
                        </Text>
                    ) : undefined}

                    {preview.isPending ? <PageSkeleton variant="card" /> : undefined}

                    {preview.error ? (
                        <ErrorAlert title="That could not be worked out" error={preview.error} fallback="Nothing has been changed." />
                    ) : undefined}

                    {preview.data !== undefined ? <RollbackSummary change={preview.data} /> : undefined}

                    <Checkbox
                        checked={relearn}
                        onChange={event => setRelearn(event.currentTarget.checked)}
                        label="Read those broadcasts again tonight"
                        description="Leave this off to undo what the station concluded. Turn it on to have it work through the same scripts from scratch, which is what you want when you are testing."
                    />

                    <Group justify="flex-end" gap="xs">
                        <Button variant="subtle" size="compact-sm" onClick={() => setAsking(undefined)}>
                            Leave it
                        </Button>
                        <Button
                            color="red"
                            size="compact-sm"
                            loading={rollback.isPending}
                            disabled={preview.isPending || preview.data === undefined}
                            onClick={confirm}
                        >
                            {asking === 'reset' ? 'Clear it' : 'Roll back'}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Card>
    );
}

/** What is about to go, and the two things about it an operator might not expect. */
function RollbackSummary({ change }: { change: PersonaMemoryChange }) {
    const nothing = change.tellings + change.notes + change.stories + change.details === 0;

    if (nothing)
        return (
            <Text size="sm" c="dimmed">
                There is nothing after that moment to undo.
            </Text>
        );

    return (
        <Stack gap={6}>
            <Group gap="xs">
                <Count label="tellings forgotten" value={change.tellings} />
                <Count label="notes" value={change.notes} />
                <Count label="stories" value={change.stories} />
                <Count label="details" value={change.details} />
            </Group>
            <Text size="xs" c="dimmed">
                Only what the station wrote itself. Anything you typed stays exactly where it is.
            </Text>
            {/* The two ways this costs something an operator did not ask for. Stated here rather
                than discovered afterwards. */}
            {change.rejected > 0 ? (
                <Text size="xs" c="orange">
                    {change.rejected === 1
                        ? 'One of them was a proposal you turned down'
                        : `${change.rejected} of them were proposals you turned down`}
                    , so the nightly pass may offer it again.
                </Text>
            ) : undefined}
            {change.touched > 0 ? (
                <Text size="xs" c="orange">
                    {change.touched === 1 ? 'One of them you had accepted or edited' : `${change.touched} of them you had accepted or edited`}, and it
                    still goes.
                </Text>
            ) : undefined}
        </Stack>
    );
}

function Count({ label, value }: { label: string; value: number }) {
    if (value === 0) return undefined;

    return (
        <Badge variant="light" color="gray">
            <span className="da-num">{value}</span> {label}
        </Badge>
    );
}

/**
 * One telling.
 *
 * `told` is drawn rather than assumed, because an offered story the writer passed over is a real and
 * ordinary outcome: the row records that the character was handed it and said nothing. Anything not
 * yet aired is marked too, since that is exactly the state a beat is still owed in.
 */
function TellingRow({ telling, busy, onRollBack }: { telling: PersonaTelling; busy: boolean; onRollBack: () => void }) {
    return (
        <Card withBorder padding="xs" radius="sm">
            <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
                <Stack gap={4} style={{ minWidth: 0 }}>
                    <Group gap="xs">
                        <Text size="sm" fw={500}>
                            {telling.title}
                        </Text>
                        {telling.told ? undefined : (
                            <Tooltip label="It was offered and the writer did not use it" withArrow>
                                <Badge variant="light" color="gray" size="xs">
                                    passed over
                                </Badge>
                            </Tooltip>
                        )}
                        {telling.airedAt === undefined ? (
                            <Tooltip label="Written, but no listener has heard it yet" withArrow>
                                <Badge variant="light" color="yellow" size="xs">
                                    not aired
                                </Badge>
                            </Tooltip>
                        ) : undefined}
                    </Group>
                    {telling.said === undefined ? undefined : (
                        <Text size="xs" c="dimmed" lineClamp={2}>
                            {telling.said}
                        </Text>
                    )}
                    <Text size="xs" c="dimmed" className="da-num">
                        {formatMomentFull(telling.airedAt ?? telling.at)}
                    </Text>
                </Stack>
                <Tooltip label="Undo everything after this" withArrow>
                    <Button variant="subtle" size="compact-xs" disabled={busy} onClick={onRollBack}>
                        Roll back to here
                    </Button>
                </Tooltip>
            </Group>
        </Card>
    );
}
