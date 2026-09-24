import { useState } from 'react';
import { Stack, Text, Title } from '@mantine/core';
import { DayView, WeekView, type ScheduleEventData } from '@mantine/schedule';
import type { ScheduleSlot, ScheduleSlotInput, ScheduleTimetable } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { usePersonas } from '../../api/personas.queries';
import { useCreateSlot, useCurrentSlot, useDeleteSlot, useSchedule, useTimetable, useUpdateSlot } from '../../api/schedule.queries';
import { DestinationTabs, type DestinationTab } from '../shared/destination.tabs';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { ClockPanel } from './clock.panel';
import { OnNowStrip } from './on.now.strip';
import { OverrunPanel } from './overrun.panel';
import { colorOf, weekdayOf } from './schedule.day';
import { blockEdit, minutesOf, type DraggedBlock, type SlotEdit } from './schedule.edits';
import { SlotEditor, type EditorTarget } from './slot.editor';
import { RequestsPanel } from '../requests/requests.panel';
import { SustainingPanel } from './sustaining.panel';
import { i18n } from '../../i18n/i18n.setup';

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
 * ## There is no "new block" button, and that is not an omission
 *
 * Clicking an empty hour is the only way in, because a button could only ever guess a time. On a day
 * with no gaps that guess overlaps something and the API refuses it, so the operator has to shorten a
 * block first — after which there is an empty hour to click. It could not work in the one case that
 * would have justified keeping it, and everywhere else it is a worse version of pointing at the hour
 * you actually meant.
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
 * Saving a slot takes effect when it next comes round, and the record playing at a boundary
 * finishes, unless the operator has set a limit on how long it may run into the next block
 * (`OverrunPanel`, under the grid). That limit is the only way the schedule itself ends a record early.
 *
 * ## The hours nothing claims are edited here too
 *
 * A gap is an ordinary state rather than a fault, and what plays through one is the sustaining
 * source — a playlist or a chart, or a brief and a period, with no times and no days, which is a slot with the
 * when-half taken off. It is stored as station settings and was drawn on the settings page for as
 * long as that was true of it, which put the answer to "what plays in the white space on this grid"
 * on a card about rotation rules two pages away. `SustainingPanel` is it, on its own tab: it is a
 * whole answer with five fields, and under the grid it competed with the week it applies to.
 *
 * ## A bulletin is not a slot
 *
 * The other half of the station's clock is the format clock, on the Today tab, which anchors what
 * the station SAYS inside an hour — a bulletin at half past, an ident at the top. The grid is
 * what it plays between them. They share a page because they are one question with two answers, and
 * the format clock was a settings box for as long as a band was three tokens somebody could hold in
 * their head.
 */
/**
 * The three questions a programme page answers, in the order they are asked.
 *
 * `label` and `hint` are getters, so the shell's rail and palette, which read this table directly,
 * get the words in the language on screen when they read them rather than at import.
 */
export const PROGRAMME_TABS = [
    programmeTab('today'),
    // Labelled Timetable rather than Week: `WeekView` draws its own Day/Week switch inside the
    // panel, so a tab called Week containing a control called Week read as two of the same switch.
    // The key stays `week` — `?tab=week` links and `attention.destination.ts` depend on it.
    programmeTab('week'),
    programmeTab('sustaining'),
    programmeTab('requests'),
] as const satisfies readonly DestinationTab<string>[];

function programmeTab<TKey extends 'today' | 'week' | 'sustaining' | 'requests'>(key: TKey) {
    return {
        key,
        get label(): string {
            return i18n.t(`schedule:page.tabs.${key}.label`);
        },
        get hint(): string {
            return i18n.t(`schedule:page.tabs.${key}.hint`);
        },
    };
}

export type ProgrammeTab = (typeof PROGRAMME_TABS)[number]['key'];

/** Whether a string off the URL is a tab this destination has. */
export function isProgrammeTab(value: unknown): value is ProgrammeTab {
    return typeof value === 'string' && PROGRAMME_TABS.some(tab => tab.key === value);
}

export interface SchedulePageProps {
    tab: ProgrammeTab;
    onSelect: (tab: ProgrammeTab) => void;
}

export function SchedulePage({ tab, onSelect }: SchedulePageProps) {
    const { t } = useTranslation('schedule');
    const schedule = useSchedule();
    const current = useCurrentSlot();
    // For the host's name on the strip. Cached for half a minute and fetched once on mount, which is
    // the same list the slot editor on this page already reads.
    const personas = usePersonas();
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

    const airingId = current.data?.airingSlotId;

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
        events: toEvents(timetable.data, airingId, t('untitled')),
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
        // Empty rather than omitted: a radio station has no weekend, Saturday and Sunday are not
        // different from Tuesday, and an empty array is what stops the package setting
        // `data-weekend` at all — which is why no CSS override is needed for the red it would
        // otherwise draw (red is reserved for the on-air tally in this console).
        weekendDays: [],
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
            <Stack gap="xxs">
                <Title order={1}>{t('page.title')}</Title>
                <Text c="dimmed" size="sm" maw={760}>
                    {t('page.description')}
                </Text>
            </Stack>

            <DestinationTabs tabs={PROGRAMME_TABS} active={tab} onSelect={onSelect} label={t('page.title')} />

            {schedule.error ? (
                <ErrorAlert title={t('page.scheduleFailedTitle')} error={schedule.error} fallback={t('page.scheduleFailedFallback')} />
            ) : undefined}

            {timetable.error ? (
                <ErrorAlert title={t('page.timetableFailedTitle')} error={timetable.error} fallback={t('page.timetableFailedFallback')} />
            ) : undefined}

            {remove.error ? (
                <ErrorAlert title={t('page.deleteFailedTitle')} error={remove.error} fallback={t('page.deleteFailedFallback')} />
            ) : undefined}

            {update.error ? (
                <ErrorAlert title={t('page.updateFailedTitle')} error={update.error} fallback={t('page.updateFailedFallback')} />
            ) : undefined}

            {/* On Today, because "what is on" is the question somebody arrives with and reading it
                off a week of columns is work. The takeover note lives inside it, on the block it is
                about, rather than as a loose paragraph here. */}
            {tab === 'today' && current.data ? (
                <OnNowStrip current={current.data} slots={slots} personas={personas.data?.personas ?? []} />
            ) : undefined}

            {tab === 'week' && (schedule.isPending || timetable.isPending) ? <PageSkeleton variant="card" /> : undefined}

            {tab === 'week' && schedule.data && slots.length === 0 ? <EmptyState>{t('page.empty')}</EmptyState> : undefined}

            {tab !== 'week' || from === undefined ? undefined : (
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
                        {caption(t, slots.length)} {t('page.caption.gestures')}
                        {airingId === undefined ? '' : ` ${t('page.caption.airing')}`}
                    </Text>

                    {/* A fact about every boundary drawn above, so it sits under the grid. */}
                    <OverrunPanel />
                </Stack>
            )}

            {/* Its own tab rather than a fold under the grid. What plays through an unclaimed hour
                is a whole answer with fields of its own — a playlist or a chart, or a brief and a period —
                and it was competing for attention with the week it applies to. */}
            {tab === 'sustaining' ? <SustainingPanel /> : undefined}

            {/* A request is a record the station will play a few records from now, which is this
                destination's question. See the panel. */}
            {tab === 'requests' ? <RequestsPanel /> : undefined}

            {/* The other half of "what happens when", and the reason Today is a tab rather than the
                day grid: a band is a rule about every hour and has no place on a week. */}
            {tab === 'today' ? <ClockPanel /> : undefined}

            <SlotEditor
                // Keyed, so opening a different slot — or the same hour on a different day — builds
                // a fresh form rather than showing the last one's values. `useForm` reads its
                // `initialValues` once per mount, so without this the editor opens on whatever it
                // was first constructed with, which is an empty new slot. Same reason and same
                // spelling as the persona editor.
                key={keyOf(editing)}
                target={editing}
                airing={editing?.kind === 'edit' && editing.slot.id === airingId}
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
function toEvents(timetable: ScheduleTimetable | undefined, airingSlotId: string | undefined, untitled: string): ScheduleEventData[] {
    return (timetable?.occurrences ?? []).map(block => ({
        id: `${block.slotId}@${block.start}`,
        title: block.label || untitled,
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
function caption(t: TFunction<'schedule'>, slotCount: number): string {
    if (slotCount === 0) return t('page.caption.none');

    return t('page.caption.week');
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
        ...(slot.sourceChartId === undefined ? {} : { sourceChartId: slot.sourceChartId }),
        ...(slot.sourceChartOrder === undefined ? {} : { sourceChartOrder: slot.sourceChartOrder }),
        ...(slot.sourceStationPlaylistId === undefined ? {} : { sourceStationPlaylistId: slot.sourceStationPlaylistId }),
        ...(slot.personaId === undefined ? {} : { personaId: slot.personaId }),
        ...(slot.brief === undefined ? {} : { brief: slot.brief }),
        ...(slot.eraFrom === undefined ? {} : { eraFrom: slot.eraFrom }),
        ...(slot.eraTo === undefined ? {} : { eraTo: slot.eraTo }),
        ...(slot.callins === undefined ? {} : { callins: slot.callins }),
        ...(slot.mixInSimilar === undefined ? {} : { mixInSimilar: slot.mixInSimilar }),
        mode: slot.mode,
        onEnd: slot.onEnd,
    };
}
