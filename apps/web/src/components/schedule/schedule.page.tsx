import { useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { DayView, WeekView, type ScheduleEventData } from '@mantine/schedule';
import type { ScheduleSlot, ScheduleSlotInput, ScheduleTimetable } from '@deadair/sdk';

import { useCreateSlot, useCurrentSlot, useDeleteSlot, useSchedule, useTimetable, useUpdateSlot } from '../../api/schedule.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { colorOf, weekdayOf } from './schedule.day';
import { blockEdit, minutesOf, type DraggedBlock, type SlotEdit } from './schedule.edits';
import { SlotEditor, type EditorTarget } from './slot.editor';

/**
 * The station's day, drawn as the timetable it is.
 *
 * ## The blocks come from the API, not from here
 *
 * A slot stores only a START — it runs until the next one begins — so turning the schedule into
 * blocks with both ends is a projection, and it lives beside the resolver in the API. The browser
 * does not know `station.timezone` and has no business deriving real dates from a weekday mask, and
 * a grid computing its own answer is how a page comes to draw one thing while the station airs
 * another.
 *
 * ## The fetched range and the drawn range are the same by construction
 *
 * `firstDayOfWeek` is set to the weekday the range STARTS on, so the seven columns are exactly the
 * seven days asked for. Without it the view would render a calendar week (Monday first) while the
 * query returned seven days from today, and the two would disagree at both ends.
 *
 * ## Clicking an empty hour adds a block there
 *
 * Which works nearly everywhere now, because a schedule need not cover the day: the hours nothing
 * claims are real empty space on the grid. Under the old shape every pixel belonged to some slot and
 * this handler could not fire at all once a day was divided, which is why there used to be an
 * alt-click gesture that SPLIT a block. That has gone with the model that needed it — subdividing a
 * block is now dragging its edge in and clicking the hour that frees up, which is two gestures that
 * already exist rather than one that had to be explained.
 *
 * ## Nothing here changes what is on air
 *
 * Saving a slot takes effect when it next comes round, and the record playing at a boundary always
 * finishes. That is the invariant the schedule lives inside rather than a limitation of the page.
 *
 * ## A bulletin is not a slot
 *
 * The other half of the station's clock is `rotation.clockBands` in Settings, which anchors what the
 * station MAKES inside an hour — a bulletin at half past, an ident at the top. This is what it plays
 * between them.
 */
export function SchedulePage() {
    const schedule = useSchedule();
    const current = useCurrentSlot();
    const create = useCreateSlot();
    const update = useUpdateSlot();
    const remove = useDeleteSlot();

    const [view, setView] = useState<'week' | 'day'>('week');
    // `undefined` is the station's today, which only the API can work out. Every step after that is
    // adding days to the date it echoed back.
    const [anchor, setAnchor] = useState<string | undefined>(undefined);

    const days = view === 'week' ? 7 : 1;
    const timetable = useTimetable(anchor, days);
    const [editing, setEditing] = useState<EditorTarget | undefined>(undefined);
    // Why the last gesture sprang back. A drag that is refused looks identical to one that failed,
    // and the block returning to where it was is the only other feedback there is.
    const [refusal, setRefusal] = useState<string | undefined>(undefined);

    const slots = schedule.data?.slots ?? [];
    const from = timetable.data?.from;

    const dueId = current.data?.slotId;
    const airingId = current.data?.airingSlotId;
    // Absent counts, and is in fact the commonest form of it: a station put on by hand before there
    // was a schedule belongs to no slot at all.
    const takenOver = dueId !== undefined && dueId !== airingId;

    const close = () => {
        setEditing(undefined);
        create.reset();
        update.reset();
    };

    const submit = (draft: ScheduleSlotInput) => {
        const done = { onSuccess: close };
        if (editing?.kind === 'edit') update.mutate({ id: editing.slot.id, body: draft }, done);
        else create.mutate(draft, done);
    };

    /**
     * Carry out what a gesture came to, or say why it could not be.
     *
     * Saved straight away rather than through the editor, because a drag is a direct manipulation:
     * putting a modal in front of it would undo the point of dragging. The block springs back on its
     * own when nothing is written, since the grid is drawn from what the server last said.
     */
    const apply = (edit: SlotEdit) => {
        if (edit.kind === 'refused') {
            setRefusal(edit.reason);
            return;
        }

        const slot = slots.find(candidate => candidate.id === edit.slotId);
        if (slot === undefined) return;

        setRefusal(undefined);
        update.mutate({
            id: slot.id,
            body: { ...bodyOf(slot), startsAtMinutes: edit.startsAtMinutes, ...(edit.days ? { days: [...edit.days] } : {}) },
        });
    };

    const openSlot = (event: ScheduleEventData) => {
        const slot = slots.find(candidate => candidate.id === event.payload?.slotId);
        if (slot) setEditing({ kind: 'edit', slot });
    };

    /**
     * What both views take, which is nearly everything.
     *
     * The component draws its own header — the range label, today, forward and back — so the page
     * does not add a second set. The view select is narrowed to the two levels this schedule can
     * actually fill: a month or a year of a REPEATING week is thirty identical rows, and offering a
     * view we can only answer wrongly is worse than not offering it.
     */
    const shared = {
        events: toEvents(timetable.data, airingId),
        view,
        onViewChange: (next: 'day' | 'week' | 'month' | 'year') => {
            if (next === 'day' || next === 'week') setView(next);
        },
        viewSelectProps: { views: ['day', 'week'] as const },
        onDateChange: setAnchor,
        onEventClick: openSlot,
        onTimeSlotClick: ({ slotStart }: { slotStart: string }) => setEditing(newSlotAt(slotStart)),
        withEventsDragAndDrop: true,
        withEventResize: true,
        // A block that is last night carrying over has a top edge belonging to the DAY rather than
        // to the slot, so it is not draggable at all. `moveEdit` refuses it too; this is what stops
        // somebody trying and watching it spring back.
        canDragEvent: (event: ScheduleEventData) => beginsItsSlot(event, slots),
        // Move and resize are the same edit now: the block ends up where it was dropped. A slot
        // used to be a START, so its lower edge belonged to the NEXT slot and the two gestures meant
        // different things to different rows.
        onEventDrop: ({ event, newStart, newEnd }: { event: ScheduleEventData; newStart: string; newEnd: string }) => {
            const block = blockOf(event);
            if (block) apply(blockEdit(block, newStart, newEnd, slots));
        },
        onEventResize: ({ event, newStart, newEnd }: { event: ScheduleEventData; newStart: string; newEnd: string }) => {
            const block = blockOf(event);
            if (block) apply(blockEdit(block, newStart, newEnd, slots));
        },
    };

    return (
        <Stack gap="lg">
            <PageHeader
                title="Schedule"
                description={
                    <Text c="dimmed" size="sm">
                        What the station plays at each stretch of the day, on its own clock. Blocks may leave gaps, and the hours nothing covers play
                        whatever the station is set to sustain on. Changing a block takes effect when it next comes round, and the record playing at a
                        boundary always finishes.
                    </Text>
                }
                actions={<Button onClick={() => setEditing({ kind: 'new' })}>New slot</Button>}
            />

            {schedule.error ? (
                <ErrorAlert title="The schedule could not be loaded" error={schedule.error} fallback="The station's day is unavailable." />
            ) : undefined}

            {timetable.error ? (
                <ErrorAlert title="The timetable could not be drawn" error={timetable.error} fallback="The blocks are unavailable." />
            ) : undefined}

            {remove.error ? <ErrorAlert title="That slot could not be deleted" error={remove.error} fallback="Nothing was removed." /> : undefined}

            {update.error ? (
                <ErrorAlert title="That change could not be saved" error={update.error} fallback="The schedule is as it was." />
            ) : undefined}

            {takenOver ? (
                <Text size="sm" c="dimmed">
                    The station is airing something other than the slot that is due, which is what happens when it was put on by hand. It moves back
                    to the schedule when the next slot begins.
                </Text>
            ) : undefined}

            {schedule.isPending || timetable.isPending ? <PageSkeleton variant="card" /> : undefined}

            {schedule.data && slots.length === 0 ? (
                <EmptyState>
                    This station has no schedule, which is an ordinary state rather than a fault: it keeps playing whatever you put on until you put
                    something else on. Click any hour below to add a block there. A bulletin or an ident inside the hour is the station clock in
                    Settings, not a block here.
                </EmptyState>
            ) : undefined}

            {from === undefined ? undefined : (
                <Stack gap="sm">
                    {view === 'week' ? (
                        <WeekView
                            {...shared}
                            date={from}
                            // The seven columns are the seven days that were FETCHED, rather than a
                            // calendar week running past both ends of them. Without this the view
                            // would draw Monday to Sunday while the query returned seven days from
                            // today, and the two would disagree at each end.
                            firstDayOfWeek={weekdayOf(from) as 0 | 1 | 2 | 3 | 4 | 5 | 6}
                            highlightToday
                        />
                    ) : (
                        <DayView {...shared} date={from} />
                    )}

                    {refusal ? (
                        <Text size="xs" c="dimmed">
                            {refusal}
                        </Text>
                    ) : undefined}

                    <Text size="xs" c="dimmed">
                        {caption(slots.length)} Drag a block to move it, drag an edge to change when it starts or ends, or click an empty hour to add
                        one.
                        {airingId === undefined ? '' : ' The block the station is airing now is filled in.'}
                    </Text>
                </Stack>
            )}

            <SlotEditor
                // Keyed, so opening a different slot — or the same hour on a different day — builds
                // a fresh form rather than showing the last one's values. `useForm` reads its
                // `initialValues` once per mount, so without this the editor opens on whatever it
                // was first constructed with, which is an empty new slot. Same reason and same
                // spelling as the persona editor.
                key={keyOf(editing)}
                target={editing}
                onClose={close}
                onSubmit={submit}
                onDelete={id => remove.mutate(id, { onSuccess: close })}
                saving={create.isPending || update.isPending}
                deleting={remove.isPending}
                error={create.error ?? update.error}
            />
        </Stack>
    );
}

/**
 * The API's blocks as the component's events.
 *
 * `payload.slotId` rather than parsing it back out of `id`, because one slot appears once per day
 * and the id therefore has to carry the occurrence too. The colour is a console concern and stays
 * out of the API; it is derived from the slot id so one show is one colour across the week.
 *
 * The slot ON AIR is drawn filled rather than in a different colour, so it reads as emphasis on a
 * show rather than as a show of a different kind — the colours are identities here, not states.
 */
function toEvents(timetable: ScheduleTimetable | undefined, airingSlotId: string | undefined): ScheduleEventData[] {
    return (timetable?.occurrences ?? []).map(block => ({
        id: `${block.slotId}@${block.start}`,
        title: block.label || 'Untitled',
        start: block.start,
        end: block.end,
        color: colorOf(block.slotId),
        variant: block.slotId === airingSlotId ? ('filled' as const) : ('light' as const),
        payload: { slotId: block.slotId },
    }));
}

/**
 * A new slot prefilled from the hour somebody clicked: that weekday, at that time.
 *
 * Reachable only on a station with no schedule yet, since a partition leaves nothing else to click.
 * That is the case it exists for.
 */
function newSlotAt(slotStart: string): EditorTarget {
    const [date, time] = slotStart.split(' ');
    const [hour, minute] = (time ?? '00:00:00').split(':').map(Number);

    return { kind: 'new', startsAtMinutes: (hour ?? 0) * 60 + (minute ?? 0), days: [weekdayOf(date!)] };
}

/**
 * What the grid needs saying about it in words.
 *
 * The middle case is the one worth having. A single slot covers every hour of every day, and the
 * scheduler draws a block running midnight to midnight in its ALL-DAY row rather than down the grid
 * — which is its own definition of all-day and a fair one, but it leaves the hours below empty on
 * exactly the station that has just made its first slot. Saying so beats leaving somebody to
 * conclude nothing was saved.
 */
function caption(slotCount: number): string {
    if (slotCount === 0) return 'Nothing is scheduled, so the station plays whatever it is set to sustain on.';

    return 'A repeating week: every block runs on the days it is set to, so these dates show the pattern rather than one-off programming. The hours nothing covers play the sustaining source.';
}

/**
 * A key that changes whenever the editor should start over.
 *
 * The hour and the day are in it, not just the kind: clicking six on Wednesday and then six on
 * Thursday are two different forms, and a key of `new` for both would leave the second showing the
 * first's day.
 */
function keyOf(target: EditorTarget | undefined): string {
    if (target === undefined) return 'closed';
    if (target.kind === 'edit') return target.slot.id;

    return `new:${target.startsAtMinutes ?? ''}:${(target.days ?? []).join(',')}`;
}

/** The slice of a rendered event the edit rules read, or nothing for one that carries no slot. */
function blockOf(event: ScheduleEventData): DraggedBlock | undefined {
    const slotId = event.payload?.slotId;
    if (typeof slotId !== 'string' || typeof event.start !== 'string' || typeof event.end !== 'string') return undefined;

    return { slotId, start: event.start, end: event.end };
}

/** Whether a rendered block begins where its slot does, rather than being the night before carrying over. */
function beginsItsSlot(event: ScheduleEventData, slots: readonly ScheduleSlot[]): boolean {
    const block = blockOf(event);
    const slot = slots.find(candidate => candidate.id === block?.slotId);

    return block !== undefined && slot !== undefined && minutesOf(block.start) === slot.startsAtMinutes;
}

/**
 * A slot as the shape a write takes.
 *
 * Every field has to go back, because `PUT` replaces the row rather than patching it — so a drag
 * that sent only the new time would quietly clear the brief, the host and the source.
 */
function bodyOf(slot: ScheduleSlot): ScheduleSlotInput {
    return {
        label: slot.label,
        startsAtMinutes: slot.startsAtMinutes,
        endsAtMinutes: slot.endsAtMinutes,
        days: [...(slot.days ?? [])],
        ...(slot.sourcePluginId === undefined ? {} : { sourcePluginId: slot.sourcePluginId }),
        ...(slot.sourcePlaylistId === undefined ? {} : { sourcePlaylistId: slot.sourcePlaylistId }),
        ...(slot.personaId === undefined ? {} : { personaId: slot.personaId }),
        ...(slot.brief === undefined ? {} : { brief: slot.brief }),
        mode: slot.mode,
        onEnd: slot.onEnd,
    };
}
