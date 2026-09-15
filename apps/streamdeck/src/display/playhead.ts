import type { PlayoutNowPlaying } from '@deadair/sdk';

/** How often the local clock moves between readings, the console's own tick. */
export const TICK_MS = 500;

export interface Playhead {
    elapsedMs: number;
    remainingMs: number;
    durationMs: number;
    /** 0 to 1. */
    fraction: number;
}

/**
 * The playhead of the item on air, carried forward from the last reading.
 *
 * The console's `usePlayhead` without React. The station answers with the DECODER's own countdown at
 * the moment it was read; projecting from it makes a bar that moves between two-second readings, and
 * re-anchoring on each one keeps it from drifting. `undefined` without a duration or a countdown,
 * because a clock extrapolated from `startedAt` measures when the station started the record, which
 * leads what anybody hears by the encoder and the buffers: a moving, confident lie.
 */
export function projectPlayhead(nowPlaying: PlayoutNowPlaying | undefined, carriedMs: number): Playhead | undefined {
    const durationMs = nowPlaying?.item.durationMs;
    const reportedMs = nowPlaying?.remainingMs;
    if (durationMs === undefined || reportedMs === undefined || durationMs <= 0) return undefined;

    const remainingMs = Math.min(durationMs, Math.max(0, reportedMs - carriedMs));
    const elapsedMs = durationMs - remainingMs;
    return { elapsedMs, remainingMs, durationMs, fraction: elapsedMs / durationMs };
}

/**
 * How far the clock has been carried past the last reading, counted in ticks.
 *
 * Ticks rather than a wall clock, as in the console: a plugin process the system suspends under-counts
 * and the bar stalls until the next reading re-anchors it, where a wall clock would jump. A new
 * reading is a new item or a new countdown, and resets the count.
 */
export class PlayheadClock {
    private reading = '';
    private carried = 0;

    /** The carried time for this reading, starting over when the reading is a new one. */
    carriedFor(nowPlaying: PlayoutNowPlaying | undefined): number {
        const reading = `${nowPlaying?.item.id ?? ''}:${nowPlaying?.remainingMs ?? ''}`;
        if (reading !== this.reading) {
            this.reading = reading;
            this.carried = 0;
        }
        return this.carried;
    }

    tick(): void {
        this.carried += TICK_MS;
    }
}
