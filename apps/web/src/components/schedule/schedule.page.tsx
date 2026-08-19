import { useState } from 'react';
import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import type { ScheduleSlot, ScheduleSlotInput } from '@deadair/sdk';

import { useCreateSlot, useCurrentSlot, useDeleteSlot, useSchedule, useUpdateSlot } from '../../api/schedule.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';
import { daysOf, minutesToClock, spanOf } from './schedule.day';
import { SlotEditor } from './slot.editor';

/**
 * The station's day: which source, which host and which brief, by the clock.
 *
 * ## What this page does NOT do
 *
 * Nothing here changes what is on air now, and the header says so. The schedule says WHAT should be
 * on air and never WHEN the changeover happens, because only the director knows where the track
 * boundaries are — so a slot saved at ten past takes effect when it next begins, and the record
 * playing at a boundary always finishes.
 *
 * ## A slot has no end, and the span is derived
 *
 * It runs until the next one begins, and the last of the week wraps round, so there is no gap to
 * represent. The span each card shows is computed from its neighbour rather than stored, which is
 * what keeps it from going stale when a different slot moves.
 *
 * ## A bulletin is not a slot
 *
 * The other half of the station's clock is `rotation.clockBands` in Settings, which anchors the
 * things the station MAKES inside an hour — a bulletin at half past, an ident at the top. This page
 * is what it plays between them. That division is worth saying out loud here, because "9 to 9:30
 * news" is the first thing anybody tries to type into a schedule.
 */
export function SchedulePage() {
    const schedule = useSchedule();
    const current = useCurrentSlot();
    const create = useCreateSlot();
    const update = useUpdateSlot();
    const remove = useDeleteSlot();

    // `undefined` is closed, a slot is editing that one, `null` is a new one. The same three states
    // the personas page has, for the same reason: "no editor" and "an empty editor" are different.
    const [editing, setEditing] = useState<ScheduleSlot | null | undefined>(undefined);

    const close = () => {
        setEditing(undefined);
        create.reset();
        update.reset();
    };

    const submit = (draft: ScheduleSlotInput) => {
        const done = { onSuccess: close };
        if (editing === null) create.mutate(draft, done);
        else if (editing !== undefined) update.mutate({ id: editing.id, body: draft }, done);
    };

    const slots = schedule.data?.slots ?? [];

    // The two answers differ for exactly as long as an operator's own choice is holding, which it
    // does until the next slot begins. Saying so is the point: otherwise the page shows a slot
    // marked as due and a station doing something else, with nothing connecting them.
    //
    // `airingId` being absent counts, and is in fact the commonest form of it: a station put on by
    // hand before there was a schedule at all belongs to no slot. Requiring both to be present
    // would leave exactly that case with a badge and no explanation.
    const dueId = current.data?.slotId;
    const airingId = current.data?.airingSlotId;
    const takenOver = dueId !== undefined && dueId !== airingId;

    return (
        <Stack gap="lg">
            <PageHeader
                title="Schedule"
                description={
                    <Text c="dimmed" size="sm">
                        What the station plays at each stretch of the day, on its own clock. A slot runs until the next one begins. Changing one takes
                        effect when it next comes round, and the record playing at a boundary always finishes.
                    </Text>
                }
                actions={<Button onClick={() => setEditing(null)}>New slot</Button>}
            />

            {schedule.error ? (
                <ErrorAlert title="The schedule could not be loaded" error={schedule.error} fallback="The station's day is unavailable." />
            ) : undefined}

            {remove.error ? <ErrorAlert title="That slot could not be deleted" error={remove.error} fallback="Nothing was removed." /> : undefined}

            {schedule.isPending ? (
                <Stack gap="sm">
                    <PageSkeleton variant="card" />
                    <PageSkeleton variant="card" />
                </Stack>
            ) : undefined}

            {takenOver ? (
                <Text size="sm" c="dimmed">
                    The station is airing something other than the slot that is due, which is what happens when it was put on by hand. It moves back
                    to the schedule when the next slot begins.
                </Text>
            ) : undefined}

            {schedule.data && slots.length === 0 ? (
                <EmptyState>
                    This station has no schedule, which is an ordinary state rather than a fault: it keeps playing whatever you put on until you put
                    something else on. Add a slot to have it change over on its own. A bulletin or an ident inside the hour is the station clock in
                    Settings, not a slot here.
                </EmptyState>
            ) : undefined}

            <Stack gap="sm">
                {slots.map(slot => (
                    <Card key={slot.id}>
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                            <Stack gap="xxs" style={{ minWidth: 0 }}>
                                <Group gap="xs">
                                    <Text fw={600} className="da-num">
                                        {minutesToClock(slot.startsAtMinutes)}
                                    </Text>
                                    <Text fw={600}>{slot.label || 'Untitled'}</Text>
                                    <Badge variant="outline" color="gray">
                                        {daysOf(slot)}
                                    </Badge>
                                    {/* `live` for what a listener is actually hearing, and only
                                        that. A slot the clock is asking for while somebody else's
                                        choice holds is `standby`, which is the tone for waiting
                                        rather than for anything wrong. */}
                                    {slot.id === airingId ? <StatusLamp tone="live" label="On air" /> : undefined}
                                    {slot.id === dueId && slot.id !== airingId ? <StatusLamp tone="standby" label="Due now" /> : undefined}
                                    {spanOf(slot, slots) ? (
                                        <Badge variant="light" color="gray">
                                            {spanOf(slot, slots)}
                                        </Badge>
                                    ) : undefined}
                                </Group>
                                <Text size="sm" c="dimmed">
                                    {describe(slot)}
                                </Text>
                                {slot.brief ? (
                                    <Text size="xs" c="dimmed">
                                        Asked for: {slot.brief}
                                    </Text>
                                ) : undefined}
                            </Stack>
                            <Group gap="xs" wrap="nowrap">
                                <Button variant="subtle" size="compact-sm" onClick={() => setEditing(slot)}>
                                    Edit
                                </Button>
                                <Button
                                    variant="subtle"
                                    color="red"
                                    size="compact-sm"
                                    loading={remove.isPending && remove.variables === slot.id}
                                    onClick={() => remove.mutate(slot.id)}
                                >
                                    Delete
                                </Button>
                            </Group>
                        </Group>
                    </Card>
                ))}
            </Stack>

            <SlotEditor
                {...(editing ? { slot: editing } : {})}
                opened={editing !== undefined}
                onClose={close}
                onSubmit={submit}
                saving={create.isPending || update.isPending}
                error={create.error ?? update.error}
            />
        </Stack>
    );
}

/** The one-line summary under a slot's name: where it plays from, and who hosts it. */
function describe(slot: ScheduleSlot): string {
    const parts: string[] = [];

    parts.push(slot.sourcePlaylistId ? 'From a playlist' : 'The station programmes itself');
    if (slot.personaId) parts.push('with its own host');
    if (slot.mode !== 'rotation') parts.push(slot.mode);

    return parts.join(', ');
}
