import type { AppConfig } from '@maroonedsoftware/appconfig';
import { numberOr } from '#modules/shared/setting.numbers.js';

/** How long a character waits before returning to the same thread. See {@link resolveThreadGapMs}. */
export const THREAD_GAP_KEY = 'personas.threadGapMinutes';

/**
 * The default wait between two tellings of one arc or bit, in minutes.
 *
 * Forty is roughly ten records, which is long enough that a listener hears the character return to
 * something rather than dwell on it, and it comfortably clears the planner's write-ahead window —
 * which is the part that is not taste. See {@link MIN_THREAD_GAP_MINUTES}.
 */
export const DEFAULT_THREAD_GAP_MINUTES = 40;

/**
 * The floor, and it is a correctness bound rather than a preference.
 *
 * `BreakPlanner.WRITE_AHEAD` is 8, so up to eight breaks can be WRITTEN before the first of them
 * airs. A gap shorter than the time those eight take to play would let two breaks both be handed
 * part two of the same arc, and the listener would hear one part twice and never hear the next.
 *
 * Ten minutes is the conservative reading of eight items: a station of three-minute records would
 * clear them in twenty-four, and one running short idents rather faster. It is a floor rather than
 * the default for that reason — it is the point below which the guard stops guarding, not a setting
 * anybody should want.
 */
export const MIN_THREAD_GAP_MINUTES = 10;

/**
 * The ceiling. A day, past which a thread is not a thread — a character that returns to something
 * less often than that is telling unrelated anecdotes, which is what an anecdote is for.
 */
export const MAX_THREAD_GAP_MINUTES = 1_440;

/**
 * How long a thread waits, in milliseconds.
 *
 * Clamps rather than refuses, on the rule `apps/api/CLAUDE.md` states for every number here: this is
 * reading a row that is already stored, and a setting that refuses to load stops the walk behind it.
 * `serializeSetting` is where a figure somebody TYPES is refused.
 */
export const resolveThreadGapMs = (config: AppConfig): number =>
    Math.min(MAX_THREAD_GAP_MINUTES, Math.max(MIN_THREAD_GAP_MINUTES, Math.round(numberOr(config, THREAD_GAP_KEY, DEFAULT_THREAD_GAP_MINUTES)))) *
    60_000;
