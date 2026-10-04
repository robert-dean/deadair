import { useEffect, useState } from 'react';
import { Group, Text, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useCurrentSlot } from '../../api/schedule.queries';
import { formatClock, formatClockIn } from '../../i18n/format.locale';

/** Seconds, because the thing an operator counts against a skip or a break is seconds. */
function readClock(): Date {
    return new Date();
}

/**
 * The studio clock: local wall time, in the corner, always.
 *
 * Every desk has one, for the reason this one is here — a station is a thing that happens at
 * times, and the console is full of durations ("21 still to come", "5s behind") that only mean
 * something against a now. It reads the BROWSER's clock rather than the station's, deliberately:
 * the operator is comparing what they see against the wall behind them, and a clock that
 * disagreed with the room would be worse than no clock.
 *
 * The station's own time rides beside it only when the two disagree, which is an operator running a
 * station in another zone: the schedule, the hour a presenter names and every "tonight" are on the
 * station's clock, and working that out in your head is the mistake. Compared as the minutes each
 * clock SHOWS rather than as zone names, so London and Dublin, the same time under two names, show
 * one clock.
 */
export function StationClock() {
    const { t } = useTranslation('shell');
    const [now, setNow] = useState(readClock);
    const zone = useCurrentSlot().data?.timezone;

    useEffect(() => {
        // Every second rather than aligned to the tick: a clock that is up to a second stale is
        // fine, and the alternative is a timer that reschedules itself forever.
        const timer = setInterval(() => {
            setNow(readClock());
        }, 1_000);
        return () => {
            clearInterval(timer);
        };
    }, []);

    const local = formatClock(now, { seconds: true });
    const station = zone === undefined ? undefined : formatClockIn(now, zone);
    const differs = zone !== undefined && station !== undefined && station !== formatClock(now);

    return (
        <Group gap="xs" wrap="nowrap">
            <Text size="sm" c="dimmed" aria-label={t('clock.label')} className="da-num">
                {local}
            </Text>
            {differs && zone !== undefined ? (
                <Tooltip label={t('clock.stationZone', { zone })}>
                    <Text size="xs" c="dimmed" aria-label={t('clock.stationLabel')} className="da-num">
                        {t('clock.station', { time: station })}
                    </Text>
                </Tooltip>
            ) : undefined}
        </Group>
    );
}
