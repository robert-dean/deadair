import { Badge, Button, Card, Group, Stack, Table, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import type { ScheduleSlot } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { Eyebrow } from '../shared/eyebrow';
import { minutesToClock } from './schedule.day';
import { formatDates, inOrder, isSpecial, nextRun, stateOf, type Special, type SpecialState } from './schedule.specials';

/**
 * The station's specials: the shows that run on dates rather than every week.
 *
 * ## A list, not a grid
 *
 * The timetable already draws a special where it lands, cut into the weekly blocks around it, and
 * that is the place to see what a night looks like. What it cannot show is the year: Halloween is
 * three weeks of paging away, and a special that ended last month is not on it at all. So this is
 * the list of every special, in the order an operator asks about them: what is on today, what is
 * coming soonest, and the one-offs that are over, most recent first, so last year's Christmas is
 * still there to copy from.
 *
 * ## Edited in the same editor as a weekly slot
 *
 * A special is a slot with dates, so everything below the sentence (what it plays, who hosts it) is
 * the form every slot has. The editor adds the dates and the yearly switch when it is opened on one.
 */
export function SpecialsPanel({ slots, today, airingId, onEdit, onNew }: Props) {
    const { t } = useTranslation('schedule');
    const specials = inOrder(slots.filter(isSpecial), today);

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                    <Stack gap={2}>
                        <Eyebrow>{t('specials.title')}</Eyebrow>
                        <Text size="sm" c="dimmed" maw={620}>
                            {t('specials.description')}
                        </Text>
                    </Stack>
                    <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={onNew}>
                        {t('specials.add')}
                    </Button>
                </Group>

                {specials.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('specials.empty')}
                    </Text>
                ) : (
                    <Table.ScrollContainer minWidth={520}>
                        <Table verticalSpacing="xs" highlightOnHover>
                            <Table.Tbody>
                                {specials.map(special => (
                                    <SpecialRow
                                        key={special.id}
                                        special={special}
                                        today={today}
                                        airing={special.id === airingId}
                                        onEdit={() => onEdit(special)}
                                    />
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                )}
            </Stack>
        </Card>
    );
}

function SpecialRow({ special, today, airing, onEdit }: { special: Special; today: string; airing: boolean; onEdit: () => void }) {
    const { t } = useTranslation('schedule');
    const state = stateOf(special, today);
    // The run an operator is asking about: this year's for a yearly special, and the special's own
    // dates for a one-off, over or not.
    const run = nextRun(special, today) ?? { from: special.startsOn, to: special.endsOn };
    const name = special.label || t('untitled');

    return (
        <Table.Tr style={{ cursor: 'pointer' }} onClick={onEdit} aria-label={t('specials.edit', { name })}>
            <Table.Td w={150} className="da-num">
                <Text size="sm" c={state === 'over' ? 'dimmed' : undefined}>
                    {formatDates(run.from, run.to, !special.yearly)}
                </Text>
            </Table.Td>
            <Table.Td w={130} className="da-num">
                <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                    {t('specials.hours', { from: minutesToClock(special.startsAtMinutes), until: minutesToClock(special.endsAtMinutes) })}
                </Text>
            </Table.Td>
            <Table.Td>
                <Text size="sm" fw={500} c={state === 'over' ? 'dimmed' : undefined}>
                    {name}
                </Text>
            </Table.Td>
            <Table.Td w={200}>
                <Group gap={4} justify="flex-end" wrap="nowrap">
                    {special.yearly ? (
                        <Badge size="xs" variant="light" color="gray">
                            {t('specials.everyYear')}
                        </Badge>
                    ) : undefined}
                    <Badge size="xs" variant={airing ? 'filled' : 'light'} color={STATE_COLOR[state]}>
                        {t(`specials.state.${state}`)}
                    </Badge>
                </Group>
            </Table.Td>
        </Table.Tr>
    );
}

/**
 * Teal for today, which is phosphor and so live without claiming ON AIR (red is the on-air tally in
 * this console); blue for coming up; grey for over.
 */
const STATE_COLOR: Record<SpecialState, string> = { now: 'teal', upcoming: 'blue', over: 'gray' };

interface Props {
    slots: readonly ScheduleSlot[];
    /** The station's today as `YYYY-MM-DD`, from `GET /schedule/current`. */
    today: string;
    airingId?: string;
    onEdit: (slot: ScheduleSlot) => void;
    onNew: () => void;
}
