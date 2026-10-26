import { useEffect, useState } from 'react';
import type { PlayoutLive } from '@deadair/sdk';

/** How often the clock is redrawn between readings. Fine enough that a second never visibly stalls. */
const TICK_MS = 100;

/** The live input's two clocks as of now, both in milliseconds. */
export interface LiveClock {
    /** While counting in: how long until the presenter is on the air, never below zero. */
    inMs?: number;
    /** While on air: how long they have been on. */
    forMs?: number;
}

/**
 * The countdown and the time on air, moving smoothly between readings.
 *
 * The station reports both as of the reading it took, and the console polls every half second while
 * counting in and every two once on air, so drawing the reading's own figure would make the digits
 * jump in steps. Each reading is anchored to the moment it arrived here and the clock runs on from
 * that, so a new reading re-anchors rather than adding to an error, and a change of state starts
 * afresh because it is a new reading with different figures.
 */
export function useLiveClock(live: PlayoutLive): LiveClock {
    const [anchor, setAnchor] = useState(() => ({ live, at: Date.now() }));
    const [now, setNow] = useState(() => Date.now());

    // A new reading is a new object even when its figures are the same, which is exactly when a
    // re-anchor is wanted: the station took it later than the last one.
    if (anchor.live !== live) setAnchor({ live, at: Date.now() });

    const ticking = live.state === 'preroll' || live.state === 'onair';
    useEffect(() => {
        if (!ticking) return;
        const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
        return () => window.clearInterval(timer);
    }, [ticking]);

    const since = Math.max(0, now - anchor.at);
    if (live.state === 'preroll' && live.inMs !== undefined) return { inMs: Math.max(0, live.inMs - since) };
    if (live.state === 'onair' && live.forMs !== undefined) return { forMs: live.forMs + since };
    return {};
}
