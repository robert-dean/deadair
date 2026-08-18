import { useEffect, useState } from 'react';
import { Text } from '@mantine/core';

/** Seconds, because the thing an operator counts against a skip or a break is seconds. */
function readClock(): string {
    return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

/**
 * The studio clock: local wall time, in the corner, always.
 *
 * Every desk has one, for the reason this one is here — a station is a thing that happens at
 * times, and the console is full of durations ("21 still to come", "5s behind") that only mean
 * something against a now. It reads the BROWSER's clock rather than the station's, deliberately:
 * the operator is comparing what they see against the wall behind them, and a clock that
 * disagreed with the room would be worse than no clock.
 */
export function StationClock() {
    const [now, setNow] = useState(readClock);

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

    return (
        <Text size="sm" c="dimmed" aria-label="Station clock" className="da-num">
            {now}
        </Text>
    );
}
