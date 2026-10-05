import type { VocalMarkers } from './vocal.ranges.js';

/**
 * How long the presenter may talk over the start of a record, on the timeline it will actually AIR on.
 *
 * The one place this is worked out, and nothing else may work it out again. A comparable station
 * learned that the hard way: three call sites each moved the onset onto the played timeline in their
 * own spelling, so the prompt was told one runway while the timing believed another, and the two
 * disagreed about the same clip. Here the talk-up decision and the writer's word budget both read
 * through {@link runwayFor}.
 *
 * **The onset is measured from the start of the FILE and the record airs from its cue-in**, because
 * the station trims the silence off the head of every measured record. An 8s first line on a record
 * with 6s of leading silence is 2s of runway on air, not 8.
 */

/**
 * Below this a runway does not bind: no clip is short enough to finish inside it, and a record whose
 * singing starts this soon is one to back-announce rather than talk up. Shared by the talk-up and the
 * writer's budget so they cannot disagree about where "too early to talk" begins.
 */
export const RUNWAY_FLOOR_MS = 2_500;

/**
 * At or above this a runway is not a constraint: any link the station writes fits. The talk-up uses
 * it to start a short link near the top of a long intro rather than hanging silent until the post.
 */
export const RUNWAY_CEILING_MS = 18_000;

/**
 * The runway, passed through as the same tri-state the markers are.
 *
 * - `ms`: milliseconds of intro on air before the first sung line.
 * - `instrumental`: nothing to talk over.
 * - `unknown`: nothing can be said. Every reader does what it did before lyrics existed.
 */
export type Runway = { kind: 'ms'; ms: number } | { kind: 'instrumental' } | { kind: 'unknown' };

/**
 * The runway for a record whose markers are known, shifted onto the played timeline.
 *
 * `cueInMs` is the measured start of the record as it airs, when there is one; an unmeasured record
 * airs from the top of the file, so no shift. An onset at or before the cue-in is a vocal on the first
 * beat, which is a runway of zero rather than a negative number.
 */
export function runwayFor(markers: VocalMarkers, cueInMs?: number): Runway {
    if (markers.kind === 'instrumental') return { kind: 'instrumental' };
    if (markers.kind === 'unknown') return { kind: 'unknown' };

    const shift = cueInMs !== undefined && Number.isFinite(cueInMs) && cueInMs > 0 ? cueInMs : 0;
    return { kind: 'ms', ms: Math.max(0, markers.onsetMs - shift) };
}
