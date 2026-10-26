/**
 * What the station's own programme does while a presenter is on the air through the live input.
 *
 * - `standDown` — the director stands the station down when the presenter takes the air, so no
 *   records, no breaks and no news go on underneath them, and nothing is written down as played that
 *   nobody heard. On the hand-back it picks the same running order up again at its next record, not
 *   in the middle of the one that was playing. What a presenter taking over the station means.
 * - `continue` — the programme carries on underneath, unheard, and is wherever it has got to when the
 *   presenter hands back. For a station that wants its running order to keep moving through a show,
 *   at the cost of a history that records records nobody heard.
 *
 * A setting rather than a choice made at each arm, because it is a decision about the station rather
 * than about one show. The live input itself is the same either way: it outranks the lease whatever
 * this says (`stream/radio.liq`, "Live input").
 */

/** The `deadair.settings` key. */
export const LIVE_AUTOMATION_KEY = 'playout.liveAutomation';

export type LiveAutomation = 'standDown' | 'continue';

/** What an install with nothing stored gets: the clean hand-off, which is what going live is for. */
export const DEFAULT_LIVE_AUTOMATION: LiveAutomation = 'standDown';

export const LIVE_AUTOMATIONS: readonly LiveAutomation[] = ['standDown', 'continue'];

/**
 * Read a stored value. Unset and unrecognised both answer {@link DEFAULT_LIVE_AUTOMATION}, on
 * `parseAirMode`'s argument: this is read on the edge a presenter takes the air, and refusing to
 * act there over a mistyped row is worse than acting on the default.
 */
export function parseLiveAutomation(raw: string | undefined): LiveAutomation {
    return LIVE_AUTOMATIONS.includes(raw as LiveAutomation) ? (raw as LiveAutomation) : DEFAULT_LIVE_AUTOMATION;
}
