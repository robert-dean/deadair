import { Box, Group, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import type { ScheduleOccurrence, ScheduleSlot } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useTimetable } from '../../api/schedule.queries';
import { formatClock } from '../../i18n/format.locale';
import { Eyebrow } from '../shared/eyebrow';
import { colorOf } from './schedule.day';
import { minutesOf } from './schedule.edits';

const DAY = 24 * 60;

/** One stretch of the day: a block of the schedule, or the hours nothing claims, which the station sustains through. */
export type DayStretch =
    { kind: 'block'; slotId: string; label: string; live: boolean; from: number; to: number } | { kind: 'gap'; from: number; to: number };

/**
 * Today's blocks as stretches across the whole day, gaps included, in minutes after midnight.
 *
 * Read off the timetable rather than the slots, because only the station knows which slots land on
 * its today (a special's dates, a rule, the weekday in its own zone). Each block stays inside one day
 * on the wire, so one that ends at midnight ends on the next day's date and is the day's last minute
 * here. A gap is everything between, which is ordinary: the station plays its sustaining source.
 */
export function dayStretchesOf(occurrences: readonly ScheduleOccurrence[], date: string): DayStretch[] {
    const blocks = occurrences
        .filter(block => block.start.slice(0, 10) === date)
        .map(block => ({
            kind: 'block' as const,
            slotId: block.slotId,
            label: block.label,
            live: block.live === true,
            from: minutesOf(block.start),
            to: block.end.slice(0, 10) > date ? DAY : minutesOf(block.end),
        }))
        .filter(block => block.to > block.from)
        .sort((a, b) => a.from - b.from);

    const stretches: DayStretch[] = [];
    let at = 0;
    for (const block of blocks) {
        if (block.from > at) stretches.push({ kind: 'gap', from: at, to: block.from });
        stretches.push(block);
        at = Math.max(at, block.to);
    }
    if (at < DAY) stretches.push({ kind: 'gap', from: at, to: DAY });
    return stretches;
}

/** Where a stretch sits along the strip, as a share of the day. */
function placed(from: number, to: number) {
    return { position: 'absolute', top: 0, bottom: 0, left: `${(from / DAY) * 100}%`, width: `${((to - from) / DAY) * 100}%` } as const;
}

/** A minute of the day on the operator's own clock. */
const clockAt = (minutes: number): string => formatClock(new Date(2000, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60));

export interface DayStripProps {
    /** The station's clock, `YYYY-MM-DD HH:mm:ss`, which says both which day this is and where the now line goes. */
    now: string;
    slots: readonly ScheduleSlot[];
    airingSlotId: string | undefined;
    onEdit: (slot: ScheduleSlot) => void;
}

/**
 * The station's whole day on one line, above what is on now.
 *
 * The strip below it answers "what is on, and what comes next"; this answers the question that
 * follows, which is how the day is laid out: where the shows are, how long each runs, and where
 * nothing is scheduled. Each block opens its show. A gap is drawn quietly rather than as a fault,
 * since the station sustains through it on purpose.
 */
export function DayStrip({ now, slots, airingSlotId, onEdit }: DayStripProps) {
    const { t } = useTranslation('schedule');
    const timetable = useTimetable(undefined, 1);
    const date = timetable.data?.from ?? now.slice(0, 10);
    const stretches = dayStretchesOf(timetable.data?.occurrences ?? [], date);
    const nowAt = now.slice(0, 10) === date ? minutesOf(now) : undefined;
    const percent = (minutes: number) => `${(minutes / DAY) * 100}%`;

    return (
        <Stack gap={6} component="section" aria-label={t('dayStrip.label')}>
            <Eyebrow>{t('dayStrip.label')}</Eyebrow>
            <Box pos="relative" h={44} style={{ borderRadius: 'var(--mantine-radius-sm)', overflow: 'hidden', border: '1px solid var(--da-border)' }}>
                {stretches.map(stretch => {
                    const style = placed(stretch.from, stretch.to);
                    const span = t('dayStrip.span', { from: clockAt(stretch.from), to: clockAt(stretch.to) });

                    if (stretch.kind === 'gap') {
                        return (
                            <Tooltip key={`gap-${stretch.from}`} label={`${t('dayStrip.sustaining')} · ${span}`}>
                                <Box
                                    style={{ ...style, background: 'repeating-linear-gradient(135deg, transparent 0 6px, var(--da-border) 6px 7px)' }}
                                    aria-hidden
                                />
                            </Tooltip>
                        );
                    }

                    const slot = slots.find(candidate => candidate.id === stretch.slotId);
                    const color = colorOf(stretch.slotId);
                    const airing = stretch.slotId === airingSlotId;
                    const name = stretch.live
                        ? t('specials.liveOnTimetable', { name: stretch.label || t('untitled') })
                        : stretch.label || t('untitled');

                    return (
                        <Tooltip key={`${stretch.slotId}-${stretch.from}`} label={`${name} · ${span}`}>
                            <UnstyledButton
                                aria-label={t('dayStrip.open', { name, span })}
                                disabled={slot === undefined}
                                onClick={() => slot && onEdit(slot)}
                                px={6}
                                style={{
                                    ...style,
                                    background: `var(--mantine-color-${color}-${airing ? 'filled' : 'light'})`,
                                    color: airing ? 'var(--mantine-color-white)' : `var(--mantine-color-${color}-light-color)`,
                                    borderRight: '1px solid var(--da-bg)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    overflow: 'hidden',
                                }}
                            >
                                <Text size="xs" fw={600} truncate>
                                    {name}
                                </Text>
                            </UnstyledButton>
                        </Tooltip>
                    );
                })}
                {nowAt === undefined ? undefined : (
                    <Box
                        aria-hidden
                        style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: percent(nowAt),
                            width: 2,
                            background: 'var(--mantine-color-red-filled)',
                        }}
                    />
                )}
            </Box>
            <Group justify="space-between" gap={0} aria-hidden>
                {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(hour => (
                    <Text key={hour} size="xs" c="dimmed" className="da-num">
                        {clockAt(hour === 24 ? 0 : hour * 60)}
                    </Text>
                ))}
            </Group>
        </Stack>
    );
}
