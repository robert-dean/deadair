import type { AppConfig } from '@maroonedsoftware/appconfig';
import { numberOr } from '#modules/shared/setting.numbers.js';

/**
 * Bounding how long a record may be before the station will air it.
 *
 * Two station settings, `rotation.minTrackSeconds` and `rotation.maxTrackSeconds`, applied in three
 * places so the answers agree: the catalog draw's SQL (`CandidatesRepository.sample`), the
 * resolver's judgement of a generated set (`PickResolver.resolve`), and a playlist put on air or a
 * record inserted at a position (`PickResolver.vet`). Nothing here decides WHERE the bound is
 * enforced; this is only the shared reading of the setting and the shared predicate, on
 * {@link withinPeriod}'s precedent: the thing easiest to get wrong is having the draw and the
 * resolver disagree, and the fix is the same one: one expression, used everywhere.
 *
 * **Both default to `0`, which is off, so an upgrade changes nothing** until an operator sets one.
 * That is the same call every other rotation cap makes (`rotation.maxPerArtist`, `rotation.maxPerAlbum`):
 * a station that has never heard of this feature keeps playing whatever it already played.
 *
 * **A record of unknown length passes everywhere.** Silence about a fact is not the same as failing
 * it: the whole reason `deadair.track_sources.duration_ms` is nullable is that not every provider
 * reports one, and refusing an unmeasured record would punish the catalog for a gap in someone
 * else's metadata rather than for actually being the wrong length.
 */

/** The `deadair.settings` keys holding the station's length bounds, in seconds. */
export const TRACK_LENGTH_KEYS = {
    minTrackSeconds: 'rotation.minTrackSeconds',
    maxTrackSeconds: 'rotation.maxTrackSeconds',
} as const;

/** Off. See the module doc for why an upgrade must not start bounding anybody's library. */
export const DEFAULT_MIN_TRACK_SECONDS = 0;

/** Off, for the same reason {@link DEFAULT_MIN_TRACK_SECONDS} is. */
export const DEFAULT_MAX_TRACK_SECONDS = 0;

/** The station's length bounds, resolved to milliseconds. An absent end is unbounded. */
export interface TrackLengthBounds {
    minMs?: number;
    maxMs?: number;
}

/**
 * Read the two settings as one bag, in the unit everything downstream actually compares against.
 *
 * `0` or anything negative reads as "off" for that end, on the same rule `capPerArtist` and
 * `capPerAlbum` already use for their own zeroes. **Not read as an unordered pair**: unlike
 * `stationTargetMs`'s min/max, a minimum accidentally set above the maximum is not sorted into
 * sense here, because doing so would silently rewrite an operator's mistake into a passing test
 * instead of the range that turns everything away, which is the more honest failure to have.
 */
export function trackLengthBounds(config: AppConfig): TrackLengthBounds {
    const minSeconds = numberOr(config, TRACK_LENGTH_KEYS.minTrackSeconds, DEFAULT_MIN_TRACK_SECONDS);
    const maxSeconds = numberOr(config, TRACK_LENGTH_KEYS.maxTrackSeconds, DEFAULT_MAX_TRACK_SECONDS);

    return {
        ...(minSeconds > 0 ? { minMs: minSeconds * 1000 } : {}),
        ...(maxSeconds > 0 ? { maxMs: maxSeconds * 1000 } : {}),
    };
}

/**
 * Whether a record's length is one the station will air.
 *
 * `durationMs === undefined` always answers `true`. See the module doc: a record nothing has
 * measured is not the same fact as a record that is too long, and this predicate must not conflate
 * them.
 */
export function fitsLength(durationMs: number | undefined, bounds: TrackLengthBounds): boolean {
    if (durationMs === undefined) return true;
    if (bounds.minMs !== undefined && durationMs < bounds.minMs) return false;
    if (bounds.maxMs !== undefined && durationMs > bounds.maxMs) return false;
    return true;
}
