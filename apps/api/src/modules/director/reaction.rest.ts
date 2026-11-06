import { cuesIn } from '@deadair/plugin-sdk';

/**
 * How many of a presenter's own breaks a reaction rests for once it has been used.
 *
 * Two, so a laugh or a sigh is in at most one break in three. The prompt already asks for restraint
 * ("at most one in a break ... most breaks want none at all"), and models ignore it: over the week
 * to 2026-11-06, nine of the twelve presenters with ten or more model talk breaks used a reaction in
 * more than half of them, most of them back to back (one in 41 of 43, 38 of those straight after
 * another). A listener hears that as a tic inside a quarter of an hour, which is the failure the
 * rule in the prompt was written for. Withholding the offer is the only version a model cannot
 * talk its way past.
 */
export const REACTION_REST_BREAKS = 2;

/**
 * Whether this presenter's reactions are resting, given what they said lately, newest first.
 *
 * `own` is `BreakWriteRequest.own`: the character's own scripts of this kind of break, newest first,
 * as written, so a cue is still in them as `[sigh]`. Any reaction counts, not only the one about to
 * be offered, because the habit a listener hears is the noise between the words rather than which
 * noise it was.
 */
export function reactionsResting(own: readonly string[] | undefined): boolean {
    return (own ?? []).slice(0, REACTION_REST_BREAKS).some(script => cuesIn(script).length > 0);
}
