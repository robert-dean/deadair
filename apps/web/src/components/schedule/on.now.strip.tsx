import { Box, Card, Group, Progress, SimpleGrid, Stack, Text } from '@mantine/core';
import type { Persona, ScheduleNow, ScheduleOccurrence, ScheduleSlot } from '@deadair/sdk';

import { Eyebrow } from '../shared/eyebrow';
import { colorOf, DAY_LABELS, formatSpan, minutesBetween, weekdayOf } from './schedule.day';

/**
 * What is on, what is next, and what is after that.
 *
 * ## Why a grid needs this above it
 *
 * A timetable answers "what does this station do on a Wednesday" and answers "what is it doing right
 * now" only if you can find today's column and read the clock off the side. The one question an
 * operator arrives with is the second one, so it is answered in words at the top and the grid stays
 * what it is good at.
 *
 * ## Every fact here comes from the station
 *
 * The blocks and the clock are both `GET /schedule/current`: the browser does not know
 * `station.timezone` and must not derive station-local dates, which is the same rule the page below
 * follows. What is left for the console is one subtraction between two readings taken in the same
 * frame, which is why `now` rides along beside them.
 *
 * There is deliberately no local timer. The reading moves when the poll moves, so a strip that
 * counted down between polls would be showing a second clock nobody asked about, and it would be
 * wrong in exactly the way this page exists to prevent.
 *
 * ## The block on now is not always the one airing
 *
 * An operator's own choice holds until the next slot BEGINS, so the schedule can want something the
 * station is not doing. That is said here, on the block it is about, rather than as a note somewhere
 * else on the page: the alternative is badging a block "on air" while the station plays something
 * else.
 */
export function OnNowStrip({ current, slots, personas }: Props) {
    const blocks = current.upcoming;

    // Covering `now` is what makes the first block the one ON now rather than the next one. Comparing
    // the stamps is the whole test: both are fixed-width readings of one clock, so there is nothing
    // to parse and nothing to get wrong.
    const live = blocks[0] !== undefined && blocks[0].start <= current.now ? blocks[0] : undefined;
    const ahead = live === undefined ? blocks.slice(0, 2) : blocks.slice(1, 3);

    // Absent counts, and is in fact the commonest form of it: a station put on by hand before there
    // was a schedule belongs to no slot at all.
    const takenOver = current.slotId !== undefined && current.slotId !== current.airingSlotId;

    return (
        <Card withBorder padding="md">
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
                {live === undefined ? (
                    <Sustaining next={blocks[0]} now={current.now} />
                ) : (
                    <Live block={live} now={current.now} slot={slotOf(slots, live)} personas={personas} takenOver={takenOver} />
                )}

                {ahead.map((block, index) => (
                    <Ahead
                        key={`${block.slotId}@${block.start}`}
                        block={block}
                        now={current.now}
                        slot={slotOf(slots, block)}
                        personas={personas}
                        eyebrow={index === 0 ? 'Up next' : 'After that'}
                    />
                ))}
            </SimpleGrid>
        </Card>
    );
}

/** The block the clock says is on, with how much of it is left. */
function Live({
    block,
    now,
    slot,
    personas,
    takenOver,
}: {
    block: ScheduleOccurrence;
    now: string;
    slot?: ScheduleSlot;
    personas: readonly Persona[];
    takenOver: boolean;
}) {
    const total = minutesBetween(block.start, block.end);
    const gone = minutesBetween(block.start, now);
    const left = total - gone;

    return (
        <Stack gap="xxs">
            <Group justify="space-between" wrap="nowrap" gap="xs">
                {/* "Due now" rather than "On air" when the station is doing something else. The word
                    is the whole correction: this is what the schedule wants, and the line underneath
                    says why it is not what you are hearing. */}
                <Eyebrow>{takenOver ? 'Due now' : 'On air'}</Eyebrow>
                <Text size="xs" c="dimmed" className="da-num">
                    {formatSpan(left)} left
                </Text>
            </Group>

            <BlockName block={block} slot={slot} personas={personas} />

            <Progress value={total <= 0 ? 0 : Math.min(100, Math.max(0, (gone / total) * 100))} size="xs" color={colorOf(block.slotId)} />

            {takenOver ? (
                <Text size="xs" c="dimmed">
                    The station is airing something else, which is what happens when it was put on by hand. It moves back to the schedule when the
                    next block begins.
                </Text>
            ) : undefined}
        </Stack>
    );
}

/** A block that has not started yet. */
function Ahead({
    block,
    now,
    slot,
    personas,
    eyebrow,
}: {
    block: ScheduleOccurrence;
    now: string;
    slot?: ScheduleSlot;
    personas: readonly Persona[];
    eyebrow: string;
}) {
    return (
        <Stack gap="xxs">
            <Group justify="space-between" wrap="nowrap" gap="xs">
                <Eyebrow>{eyebrow}</Eyebrow>
                <Text size="xs" c="dimmed" className="da-num">
                    in {formatSpan(minutesBetween(now, block.start))}
                </Text>
            </Group>

            <BlockName block={block} slot={slot} personas={personas} />
        </Stack>
    );
}

/**
 * The hours no block claims.
 *
 * Its own cell rather than an empty one, because a gap is an ordinary state and the station is not
 * silent through it — it plays the sustaining source, which is a setting rather than a block and so
 * has nothing on the grid to point at.
 */
function Sustaining({ next, now }: { next?: ScheduleOccurrence; now: string }) {
    return (
        <Stack gap="xxs">
            <Eyebrow>Sustaining</Eyebrow>
            <Text fw={600}>Nothing scheduled</Text>
            <Text size="xs" c="dimmed">
                {next === undefined
                    ? 'No block is due from here on, so the station stays on whatever it is set to sustain on.'
                    : `The station is on its sustaining source for the next ${formatSpan(minutesBetween(now, next.start))}.`}
            </Text>
        </Stack>
    );
}

/** A block's name, its hours, and who is on it. */
function BlockName({ block, slot, personas }: { block: ScheduleOccurrence; slot?: ScheduleSlot; personas: readonly Persona[] }) {
    const host = personas.find(persona => persona.id === slot?.personaId);

    return (
        <>
            <Group gap="xs" wrap="nowrap">
                {/* An identity, not a state, which is why it is a bare dot and not a `StatusLamp`:
                    the colours here say which show this is and match the grid below, and the one
                    vocabulary in `status.ts` is about whether a thing is working. */}
                <Box w={8} h={8} bg={`${colorOf(block.slotId)}.5`} style={{ borderRadius: '50%', flexShrink: 0 }} />
                <Text fw={600} truncate>
                    {block.label || 'Untitled'}
                </Text>
            </Group>

            <Text size="xs" c="dimmed" className="da-num">
                {when(block)}
                {host ? <Text component="span" c="dimmed">{` · ${host.label}`}</Text> : undefined}
            </Text>

            {slot?.brief ? (
                <Text size="xs" c="dimmed" lineClamp={1}>
                    {slot.brief}
                </Text>
            ) : undefined}
        </>
    );
}

/**
 * A block's hours, with the weekday when it is not today's.
 *
 * The date is dropped rather than shown in full: three of these sit side by side and the useful
 * difference between them is the hour, not the year. A block that started yesterday and is still
 * running keeps its own start time, which is what "since 22:00" means on a late show.
 */
function when(block: ScheduleOccurrence): string {
    return `${DAY_LABELS[weekdayOf(block.start.slice(0, 10))]} ${block.start.slice(11, 16)}–${block.end.slice(11, 16)}`;
}

/** The stored slot a drawn block came from, for the facts an occurrence does not carry. */
function slotOf(slots: readonly ScheduleSlot[], block: ScheduleOccurrence): ScheduleSlot | undefined {
    return slots.find(slot => slot.id === block.slotId);
}

interface Props {
    current: ScheduleNow;
    /** The stored slots, for the host and the brief an occurrence deliberately does not carry. */
    slots: readonly ScheduleSlot[];
    personas: readonly Persona[];
}
