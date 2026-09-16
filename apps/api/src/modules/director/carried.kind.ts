import { isNarrationKind } from '#modules/narrations/narration.kind.js';
import { isSyndicatedKind } from '#modules/podcasts/syndicated.kind.js';

/**
 * Whether a band, or a segment in the running order, is a PROGRAMME rather than the station talking.
 *
 * Two kinds answer yes and they arrive completely differently. `syndicated` is an episode somebody
 * else recorded and the host fetched; `narration` is somebody else's writing the station read out
 * itself. Every rule that asks this question is indifferent to which:
 *
 * - a programme is planted BEFORE everything else, because its length moves every boundary behind it
 * - a programme is not a break, so the rules that keep two breaks out of one gap do not apply on
 *   either side of it: a presenter talking beside a programme is a presenter introducing it, and the
 *   news at the top of the hour a programme ends on is exactly where the news goes
 * - a programme is what a talk break planted in front of it is ABOUT
 *
 * One predicate rather than two checks at each of those sites, on `isSyndicatedKind`'s own argument:
 * a reader that learned about one kind and not the other is the failure, and it would show up as a
 * bulletin landing in the middle of a chapter.
 *
 * What is NOT this question is which SOURCE fills the band, which is the one place the two genuinely
 * differ: `BreakPlanner.fillBand` dispatches on the kind itself, and the podcast scheduler and the
 * narration scheduler each read their own.
 */
export const isCarriedKind = (kind: string): boolean => isSyndicatedKind(kind) || isNarrationKind(kind);
