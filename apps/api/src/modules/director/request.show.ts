import type { StationLineupRules } from './station.lineup.js';

/**
 * Records that follow a request on a request show when nobody said how many: about a quarter of an
 * hour, which is long enough to hear where the request took the station and short enough that the
 * next request does not wait long behind it.
 */
export const REQUEST_FOLLOW_ON_DEFAULT = 4;

/**
 * The most records one request may have follow it. Past this a run stops being about the request,
 * and the next listener in line waits behind somebody else's hour.
 */
export const REQUEST_FOLLOW_ON_MAX = 10;

/**
 * How many records follow a request on this broadcast: none unless it is a request show.
 *
 * Clamped rather than refused, on the resolver rule for a value that is already stored: a running
 * order that will not load stops the station, where a run one record shorter than asked does not.
 */
export const followOnFor = (rules: StationLineupRules | undefined): number => {
    if (rules?.requestShow !== true) return 0;
    const asked = rules.requestFollowOn ?? REQUEST_FOLLOW_ON_DEFAULT;
    return Number.isFinite(asked) ? Math.min(REQUEST_FOLLOW_ON_MAX, Math.max(0, Math.trunc(asked))) : REQUEST_FOLLOW_ON_DEFAULT;
};
