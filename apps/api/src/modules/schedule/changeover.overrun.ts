/**
 * How long a record from the programme that has just ended may keep a scheduled one waiting.
 *
 * A changeover the clock makes leaves the record on air playing, which is right: changing the
 * programming is not a reason to cut a listener off mid-record, and `Rundown.retract()` already
 * builds "finish the track, then swap" out of that. What it never had was an upper bound. The new
 * block starts when that record ends, however long that is, so a seventeen-minute record on air at
 * the top of the hour is a show that begins at seventeen minutes past. A station whose schedule is
 * a promise to somebody ("the breakfast show starts at seven") has no way to keep it.
 *
 * ## Why the switch is separate from the minutes
 *
 * For {@link DEFAULT_OVERRUN_MINUTES}' reason and `orphan.sweep.ts`'s: zero reads perfectly well here
 * as "cut the record the moment the block starts", which is a real thing to want and the harshest
 * thing this can be told to do, so it cannot also mean "off".
 *
 * Kept beside the tick that reads it rather than in `settings.registry.ts`, as `orphan.sweep.ts` and
 * `track.cache.limit.ts` are: the registry declares the FORM and imports these, so the two share a
 * default and a range and cannot disagree about either.
 */

/** The `deadair.settings` key for the switch. */
export const CAP_OVERRUN_KEY = 'schedule.capOverrun';

/**
 * Off, and an upgrade must not change that.
 *
 * The only way this ends a record early is the operator's own Skip, which is a cut rather than a
 * fade, so turning it on is a station choosing a punctual schedule over a finished record. That is
 * a choice somebody makes, not one an upgrade makes for them.
 */
export const DEFAULT_CAP_OVERRUN = false;

/** The `deadair.settings` key for how long the record may run into the new block. */
export const OVERRUN_MINUTES_KEY = 'schedule.overrunMinutes';

/**
 * Five minutes, which is most of an ordinary record.
 *
 * A record that starts a minute before the boundary finishes on its own well inside this, so only
 * the long ones are ever cut: an extended mix, a live side, a suite.
 */
export const DEFAULT_OVERRUN_MINUTES = 5;

/** The range the setting takes, shared with the registry for the reason every range there is. */
export const OVERRUN_MINUTES_RANGE = { min: 0, max: 60 } as const;

/**
 * The stored minutes, clamped to {@link OVERRUN_MINUTES_RANGE}.
 *
 * Clamped rather than refused, on the registry's rule for a row that is already stored. Unreadable
 * and absent answer the default, because a value nobody can parse is a setting nobody set; a
 * negative clamps to zero, which is the direction the operator was already pointing.
 */
export function resolveOverrunMinutes(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed)) return DEFAULT_OVERRUN_MINUTES;

    return Math.min(OVERRUN_MINUTES_RANGE.max, Math.max(OVERRUN_MINUTES_RANGE.min, Math.floor(parsed)));
}

/**
 * Whether a record from the outgoing programme has run as long into the new block as it may.
 *
 * Measured by the SMALLER of two clocks, and the second one is not decoration. Minutes since the
 * block began is the question a punctual schedule asks, and it is wrong in one case: a hold that
 * expires, or a station that comes back on air, part way through a block. The schedule changes over
 * then, an hour or more after the block began, and by that clock the record on air has already
 * overrun by an hour and would be cut the instant the changeover landed. How long the record itself
 * has been playing is the bound that keeps that case sane: it can never have overrun by longer than
 * it has been on.
 *
 * @param minutesIntoBlock - Whole minutes since the block began, from `minutesIntoSlot`.
 * @param recordStartedAt - Epoch millis the record on air started, as the rundown observed it.
 */
export function hasOverrun(minutesIntoBlock: number, recordStartedAt: number, now: number, capMinutes: number): boolean {
    const onAirMinutes = Math.floor((now - recordStartedAt) / 60_000);

    return Math.min(minutesIntoBlock, onAirMinutes) >= capMinutes;
}
