/**
 * How many of something a caller may be handed, held to a ceiling.
 *
 * Two readings, side by side because they look alike and disagree on purpose about a number below
 * one. A SERVICE was asked by station code, which meant a count, so a count below one is held up to
 * one. A TOOL was asked by a model, and a model that sends `0` or `-1` for a limit has not chosen a
 * count at all; it gets the ceiling, which is what it gets for leaving the field out. In both, the
 * ceiling is enforced rather than honoured: these numbers reach somebody else's API or fill a
 * model's context, and a caller asking for a thousand is asking for a thousand.
 */

/** A count station code asked for, held between one and `max`. Not a number at all takes `max`. */
export function clampLimit(value: number, max: number): number {
    if (!Number.isFinite(value)) return max;
    return Math.min(Math.max(Math.floor(value), 1), max);
}

/** The `limit` a model passed to a tool: a whole number up to `max`, or `max` for anything that is not a count. */
export function limitArgument(value: unknown, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return max;
    return Math.min(max, Math.floor(value));
}
