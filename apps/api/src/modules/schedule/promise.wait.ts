/**
 * How long a changeover may wait for a break on air to keep its promise.
 *
 * A bulletin that ends "here is X" and is still being read when the clock changes the station over
 * goes on to finish in front of the next programme's first record, because `putOnAir` retracts the
 * record it named and lets only the break itself finish. The tick holds instead (see
 * `ScheduleTickJob.holdForPromise`), and the next tick after the named record starts changes over
 * as usual, which lets that record finish the way any record on air at a changeover does.
 *
 * ## Why there is a bound at all
 *
 * The hold costs nothing the station was not already paying: the break on air finishes either way,
 * and the record after it is what the existing "finish the track, then swap" lets run. What the
 * bound answers is a transport that goes on calling a break "on air" long after it ended, which
 * would otherwise keep the last programme on for as long as the reading stayed wrong. So it is
 * stateless and read off the break itself: its start, plus its length, plus {@link PROMISE_GRACE_MS}
 * for the minute's tick to come round. A break whose length the transport never learned is believed
 * for {@link PROMISE_UNKNOWN_LENGTH_MS}, after which the changeover lands as it always did.
 */

/** Time after a break's end for the next tick to come round and find its record on air. */
export const PROMISE_GRACE_MS = 90_000;

/**
 * How long a break of unknown length is believed to be on air.
 *
 * Longer than any bulletin or link, shorter than `OPENING_WAIT_MS` plus a record, so a promise held
 * on a reading that never ends costs a few minutes and not a programme.
 */
export const PROMISE_UNKNOWN_LENGTH_MS = 5 * 60_000;

/**
 * Whether a break on air is still recent enough that its promise is worth holding a changeover for.
 *
 * @param startedAt - When the transport saw the break go on air, epoch millis.
 * @param durationMs - The break's length, when the transport knows it.
 * @param now - The instant asked about, a parameter so the answer is a pure function of it.
 */
export function promiseStillHeld(startedAt: number, durationMs: number | undefined, now: number): boolean {
    return now < startedAt + (durationMs ?? PROMISE_UNKNOWN_LENGTH_MS) + PROMISE_GRACE_MS;
}
