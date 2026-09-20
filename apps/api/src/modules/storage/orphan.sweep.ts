/**
 * When a file no row claims stops being a write that has not finished, and becomes rubbish.
 *
 * [track-cache-eviction](https://github.com/robert-dean/deadair/discussions/46) left this as its one
 * open item and named the rule it needed: *"Doing something about them needs a rule about what a
 * file with no row means when a write was interrupted a second ago rather than a week ago."* This is
 * that rule, and it is an AGE because nothing else can tell the two apart. A file with no row is
 * either the far side of a crash between writing bytes and writing the row, or the near side of a
 * write still in progress, and the bytes are identical in both cases.
 *
 * ## Why this is not the thing #46 refuses
 *
 * That discussion refuses evicting on AGE, and it is right to: dropping a week-old record from a
 * station with terabytes free is worse than doing nothing. The difference is what age decides here.
 * There it would be the TRIGGER, picking which valid file to destroy. Here it is a GUARD, and what
 * triggers is unreachability — a file whose row is gone cannot be found by anything, because every
 * read of a content store starts from a row holding the checksum that is the path. Age only holds
 * the sweep back from a file too young to be sure about. An old file with a row is never touched by
 * this, however old it gets.
 *
 * ## Why the switch is separate from the period
 *
 * One number with zero for "off" is the shape {@link DEFAULT_TRACK_CACHE_MAX_BYTES} takes, and it
 * works there because "cap of zero bytes" has no sensible reading other than "no cap". It reads the
 * wrong way round here: a grace period of zero hours reads perfectly well as "sweep immediately",
 * which is the single most destructive thing this can be told to do and the last thing a blank field
 * should mean. So the switch is its own flag, off by default, and the period is a number that is
 * only consulted once something is already turned on.
 *
 * Kept beside the sweep that reads it rather than in `settings.registry.ts`, as `track.cache.limit.ts`
 * and `gain.ts` are: the registry declares the FORM, the typed resolver lives with the code that
 * reads the value, and the two therefore share a default and cannot disagree about it.
 */

/** The `deadair.settings` key for the switch. Dot-keyed, like every other setting. */
export const SWEEP_ORPHANS_KEY = 'storage.sweepOrphans';

/**
 * Off, and an upgrade must not change that.
 *
 * The station has counted orphans since `GET /storage` shipped and deleted none of them, so every
 * install that takes this version has a pile of them waiting. A default of on would turn one
 * upgrade into a mass delete nobody asked for, on a machine whose operator has not yet read a word
 * about what an orphan is. Turning it on is a deliberate act, exactly as setting a cache cap is.
 */
export const DEFAULT_SWEEP_ORPHANS = false;

/** The `deadair.settings` key for how long an unclaimed file is left alone. */
export const ORPHAN_GRACE_HOURS_KEY = 'storage.orphanGraceHours';

/**
 * A day, which is far longer than any write this station makes.
 *
 * The longest thing that can sit between bytes landing and a row claiming them is a render: speech
 * arrives, the file is written, the row is updated. That is seconds. A day is three orders of
 * magnitude of headroom, and the cost of being generous is a few megabytes kept a little longer,
 * against the cost of being tight, which is deleting audio out from under the row about to claim it.
 */
export const DEFAULT_ORPHAN_GRACE_HOURS = 24;

/**
 * The floor, below which a stored value is ignored rather than obeyed.
 *
 * An hour, and it is not advice. The two orderings `scripts/media.sweep.ts` documents and cannot
 * enforce — scan the segment inbox first, and do not sweep while something is fetching — both stop
 * being the operator's problem once nothing young can be taken, and both come back the moment the
 * period is short enough to catch live work. A typed zero must therefore not be reachable, so this
 * clamps rather than trusting.
 */
export const MINIMUM_ORPHAN_GRACE_HOURS = 1;

/**
 * The stored grace period, in hours, never below {@link MINIMUM_ORPHAN_GRACE_HOURS}.
 *
 * Tolerant in the way `resolveTrackCacheMaxBytes` is, and for a sharper reason: a settings row
 * nobody can parse must not be able to start deleting audio. Unreadable, absent, negative and zero
 * all answer the default rather than throwing, because every one of them is a value nobody
 * meaningfully set, and the safe direction for all four is the one that keeps MORE.
 */
export function resolveOrphanGraceHours(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ORPHAN_GRACE_HOURS;

    return Math.max(MINIMUM_ORPHAN_GRACE_HOURS, Math.floor(parsed));
}

/**
 * What one sweep did.
 *
 * `ran` is false for the switch being off, which is not the same fact as a run that found nothing:
 * a caller reporting on this has to be able to say nothing for the first and something for the
 * second, or every station with the sweep turned off grows a log line every quarter of an hour.
 *
 * `heldBack` is the files that WERE unclaimed and were too young to take. It is the number that says
 * whether the grace period is doing anything, and a run that holds back the same count forever is an
 * operator's clue that something is writing files nothing ever claims.
 */
export interface StorageSweep {
    ran: boolean;
    removed: number;
    freedBytes: number;
    heldBack: number;
}
