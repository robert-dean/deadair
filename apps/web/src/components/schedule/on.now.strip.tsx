import { ActionIcon, Box, Card, Group, Progress, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import type { Persona, ScheduleNow, ScheduleOccurrence, ScheduleSlot } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { Eyebrow } from '../shared/eyebrow';
import { colorOf, formatSpan, minutesBetween, weekdayOf } from './schedule.day';
import { weekdayShort } from '../../i18n/format.locale';

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
 *
 * ## Each block opens its editor from here
 *
 * The same editor the grid opens, because "what is on" is the question somebody arrives with and
 * the change they want next is usually to the answer. Finding the block again on the Timetable
 * means switching tab and reading a column, and a block the grid failed to draw could not be found
 * there at all.
 */
export function OnNowStrip({ current, slots, personas, onEdit }: Props) {
    const { t } = useTranslation('schedule');
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
                    <Live block={live} now={current.now} slot={slotOf(slots, live)} personas={personas} takenOver={takenOver} onEdit={onEdit} />
                )}

                {ahead.map((block, index) => (
                    <Ahead
                        key={`${block.slotId}@${block.start}`}
                        block={block}
                        now={current.now}
                        slot={slotOf(slots, block)}
                        personas={personas}
                        eyebrow={index === 0 ? t('onNow.upNext') : t('onNow.afterThat')}
                        onEdit={onEdit}
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
    onEdit,
}: {
    block: ScheduleOccurrence;
    now: string;
    slot?: ScheduleSlot;
    personas: readonly Persona[];
    takenOver: boolean;
    onEdit?: (slot: ScheduleSlot) => void;
}) {
    const { t } = useTranslation('schedule');
    const total = minutesBetween(block.start, block.end);
    const gone = minutesBetween(block.start, now);
    const left = total - gone;

    return (
        <Stack gap="xxs">
            <Group justify="space-between" wrap="nowrap" gap="xs">
                {/* "Due now" rather than "On air" when the station is doing something else. The word
                    is the whole correction: this is what the schedule wants, and the line underneath
                    says why it is not what you are hearing. */}
                <Eyebrow>{takenOver ? t('onNow.dueNow') : t('onNow.onAir')}</Eyebrow>
                <Text size="xs" c="dimmed" className="da-num">
                    {t('onNow.left', { span: formatSpan(left) })}
                </Text>
            </Group>

            <BlockName block={block} slot={slot} personas={personas} onEdit={onEdit} />

            <Progress value={total <= 0 ? 0 : Math.min(100, Math.max(0, (gone / total) * 100))} size="xs" color={colorOf(block.slotId)} />

            {takenOver ? (
                <Text size="xs" c="dimmed">
                    {t('onNow.takenOver')}
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
    onEdit,
}: {
    block: ScheduleOccurrence;
    now: string;
    slot?: ScheduleSlot;
    personas: readonly Persona[];
    eyebrow: string;
    onEdit?: (slot: ScheduleSlot) => void;
}) {
    const { t } = useTranslation('schedule');
    return (
        <Stack gap="xxs">
            <Group justify="space-between" wrap="nowrap" gap="xs">
                <Eyebrow>{eyebrow}</Eyebrow>
                <Text size="xs" c="dimmed" className="da-num">
                    {t('onNow.in', { span: formatSpan(minutesBetween(now, block.start)) })}
                </Text>
            </Group>

            <BlockName block={block} slot={slot} personas={personas} onEdit={onEdit} />
        </Stack>
    );
}

/**
 * The hours no block claims.
 *
 * Its own cell rather than an empty one, because a gap is an ordinary state and the station is not
 * silent through it — it plays the sustaining source, which is not a block and so has nothing on the
 * grid to point at. What it IS set to is the panel under the grid, which is near enough to this to
 * need no link.
 */
function Sustaining({ next, now }: { next?: ScheduleOccurrence; now: string }) {
    const { t } = useTranslation('schedule');
    return (
        <Stack gap="xxs">
            <Eyebrow>{t('onNow.betweenBlocks')}</Eyebrow>
            <Text fw={600}>{t('onNow.nothingScheduled')}</Text>
            <Text size="xs" c="dimmed">
                {next === undefined ? t('onNow.noBlockDue') : t('onNow.sustainingFor', { span: formatSpan(minutesBetween(now, next.start)) })}
            </Text>
        </Stack>
    );
}

/** A block's name, its hours, who is on it, and the way into its editor. */
function BlockName({
    block,
    slot,
    personas,
    onEdit,
}: {
    block: ScheduleOccurrence;
    slot?: ScheduleSlot;
    personas: readonly Persona[];
    onEdit?: (slot: ScheduleSlot) => void;
}) {
    const { t } = useTranslation('schedule');
    const host = personas.find(persona => persona.id === slot?.personaId);

    return (
        <>
            <Group gap="xs" wrap="nowrap">
                {/* An identity, not a state, which is why it is a bare dot and not a `StatusLamp`:
                    the colours here say which show this is and match the grid below, and the one
                    vocabulary in `status.ts` is about whether a thing is working. */}
                <Box w={8} h={8} bg={`${colorOf(block.slotId)}.5`} style={{ borderRadius: '50%', flexShrink: 0 }} />
                <Text fw={600} truncate style={{ flex: 1 }}>
                    {block.label || t('untitled')}
                </Text>
                {/* Only with the stored slot in hand, since that is what the editor opens on. The
                    schedule and the strip are two polls, so for a moment after a delete the strip can
                    name a block the list no longer has. */}
                {onEdit && slot ? (
                    <Tooltip label={t('onNow.editHint')}>
                        <ActionIcon
                            variant="subtle"
                            size="sm"
                            aria-label={t('onNow.edit', { name: block.label || t('untitled') })}
                            onClick={() => onEdit(slot)}
                        >
                            <IconPencil size={14} />
                        </ActionIcon>
                    </Tooltip>
                ) : undefined}
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
    return `${weekdayShort(weekdayOf(block.start.slice(0, 10)))} ${block.start.slice(11, 16)}–${block.end.slice(11, 16)}`;
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
    /** Open a block's slot in the editor. Without it the strip is read-only. */
    onEdit?: (slot: ScheduleSlot) => void;
}
