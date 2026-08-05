import { useEffect, useState } from 'react';
import type { PlayoutNowPlaying } from '@deadair/sdk';

/** How often the local clock moves between readings. Fast enough to look continuous, slow enough to be free. */
const TICK_MS = 500;

export interface Playhead {
    /** Milliseconds into the item on air. */
    elapsedMs: number;
    /** Milliseconds left of it. */
    remainingMs: number;
    /** Its full length, which is what makes the other two meaningful. */
    durationMs: number;
    /** 0–100, for a progress bar. */
    percent: number;
}

/**
 * The playhead of the item on air, projected between readings.
 *
 * The API answers with the DECODER's own countdown, taken at the moment it was
 * read, and the console polls every couple of seconds. Showing that number raw
 * gives a clock that jumps two seconds at a time; projecting from it gives one
 * that moves, and re-anchors on every reading rather than drifting away from the
 * station. It is the same projection the API's own rundown does when it answers,
 * for the same reason.
 *
 * Returns `undefined` when there is nothing to measure — no item, no reported
 * duration, or a decoder that could not say how much is left. A clock
 * extrapolated from a start time would be a moving, confident lie, and that is
 * exactly the thing the transport is not allowed to be.
 */
export function usePlayhead(nowPlaying: PlayoutNowPlaying | undefined): Playhead | undefined {
    const itemId = nowPlaying?.item.id;
    const durationMs = nowPlaying?.item.durationMs;
    const reportedMs = nowPlaying?.remainingMs;
    const measured = durationMs !== undefined && reportedMs !== undefined && durationMs > 0;

    // How far the clock has been carried past the last reading. Reset during render
    // rather than from an effect, because it is derived from the props: an effect
    // would render one frame of the previous track's clock first.
    //
    // Counted in ticks rather than measured against a wall clock, which keeps this
    // a pure render. It also fails in the safer direction: a throttled background
    // tab under-counts, so the clock stalls until the next reading re-anchors it,
    // where a wall clock would jump.
    const reading = `${itemId ?? ''}:${reportedMs ?? ''}`;
    const [carried, setCarried] = useState({ reading, ms: 0 });
    if (carried.reading !== reading) setCarried({ reading, ms: 0 });

    useEffect(() => {
        if (!measured) return;

        // `reading` is a dependency so the interval restarts with each one, and a
        // tick always measures a full interval since the station last spoke.
        const timer = setInterval(() => {
            setCarried(current => ({ ...current, ms: current.ms + TICK_MS }));
        }, TICK_MS);
        return () => {
            clearInterval(timer);
        };
    }, [measured, reading]);

    if (!measured) return undefined;

    const remainingMs = Math.min(durationMs, Math.max(0, reportedMs - carried.ms));
    const elapsedMs = durationMs - remainingMs;
    return { elapsedMs, remainingMs, durationMs, percent: (elapsedMs / durationMs) * 100 };
}
