import { useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { DayView, WeekView, type ScheduleEventData } from '@mantine/schedule';
import type { ScheduleSlotInput, ScheduleTimetable } from '@deadair/sdk';

import { useCreateSlot, useCurrentSlot, useDeleteSlot, useSchedule, useTimetable, useUpdateSlot } from '../../api/schedule.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { colorOf, weekdayOf } from './schedule.day';
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
 * ## There is no empty space to click, which is the partition showing through
 *
 * `onTimeSlotClick` is deliberately not wired. The scheduler offers it because an event calendar has
 * gaps between events, and this has none by construction: every minute of every column belongs to
 * some slot, so the handler could never fire. Creating goes through the button instead.
 *
 * The gesture that WOULD suit a partition is splitting a block at the point it was clicked, since a
 * partition is a set of boundaries — but that collides with clicking a block to edit it, and picking
 * between them is a decision rather than a wiring job.
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
    };

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
                actions={<Button onClick={() => setEditing({ kind: 'new' })}>New slot</Button>}
            />

            {schedule.error ? (
                <ErrorAlert title="The schedule could not be loaded" error={schedule.error} fallback="The station's day is unavailable." />
            ) : undefined}

            {timetable.error ? (
                <ErrorAlert title="The timetable could not be drawn" error={timetable.error} fallback="The blocks are unavailable." />
            ) : undefined}

            {remove.error ? <ErrorAlert title="That slot could not be deleted" error={remove.error} fallback="Nothing was removed." /> : undefined}

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
                    something else on. Add a slot to have it change over on its own. A bulletin or an ident inside the hour is the station clock in
                    Settings, not a slot here.
                </EmptyState>
            ) : undefined}

            {from !== undefined && slots.length > 0 ? (
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

                    <Text size="xs" c="dimmed">
                        A repeating week: every slot runs on the days it is set to, so these dates show the pattern rather than one-off programming.
                        {airingId === undefined ? '' : ' The block the station is airing now is outlined.'}
                    </Text>
                </Stack>
            ) : undefined}

            <SlotEditor
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
