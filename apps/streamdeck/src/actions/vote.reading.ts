import type { Rating } from '@deadair/sdk';

import { describe } from '../station/connection.failure.js';
import type { Reading } from '../station/status.poller.js';

/**
 * Which way a key votes: two of the contract's three ratings.
 *
 * `neutral` has no key of its own. It is what a press on a lit key writes, which is how withdrawing
 * an opinion stays reachable from two keys — see `apps/streamdeck/CLAUDE.md` for why that differs
 * from the console, where `neutral` is a segment somebody can see themselves starting from.
 */
export type Vote = 'liked' | 'disliked';

/**
 * The ids the manifest names the two actions by, beside the rules they are drawn from rather than in
 * the file that imports Elgato's SDK, so the manifest's test can read them without it.
 *
 * An action's id is fixed the day the plugin is published and is never edited after.
 */
export const LIKE = 'radio.deadair.streamdeck.like';
export const DISLIKE = 'radio.deadair.streamdeck.dislike';

/** What one vote key shows, and what pressing it would do. */
export interface VoteView {
    /** The station's opinion of the record on air is this key's own: flood the key with its colour. */
    lit: boolean;
    /** There is nothing for this key to have an opinion about, so nothing on it may look live. */
    dim: boolean;
    /** The failure's word, or nothing. Two words is all the key has room for; the log has the sentence. */
    title: string;
    /** The record a press would rate and what it would write. Absent on a key that refuses the press. */
    press?: { trackId: string; rating: Rating };
}

/**
 * The record a reading offers to be rated, if it offers one.
 *
 * The one place the rules live, so what a key draws and what it asks the station about can never
 * fall out of step: {@link voteView} reads it, and so does whatever decides when to go and look the
 * rating up.
 */
export function rateableTrack(reading: Reading): string | undefined {
    if (reading.failure !== undefined || reading.stale) return undefined;
    return reading.status?.nowPlaying?.item.trackId;
}

/**
 * What a vote key shows for a reading.
 *
 * A key is lit when the station already thinks what the key says, and pressing a lit key writes
 * `neutral`: the opinion the operator is looking at is the one they are withdrawing. A key whose
 * rating is not known yet draws unlit and writes its own value, so the first press of a record is
 * never a withdrawal.
 *
 * The press is refused — and nothing is asked of the station — when there is nothing this key could
 * rate: no station yet, a reading that failed or is stale, nothing on air, or an item with no
 * `trackId`. That last is a break (the station's own words have no row in the catalog to hold an
 * opinion) or a record the station is airing without ever having ingested it. The console disables
 * its rating control in the same places; a key cannot be disabled, so it refuses instead.
 *
 * A key with nothing to rate is DIM rather than merely unlit, which is a distinction the drawn face
 * can make and a pair of flat state images could not: unlit is the station having no such opinion,
 * dim is the key having nothing to have an opinion about. A stale reading is dim however well the
 * last opinion is known, by the rule the rest of this plugin follows — the record the opinion is
 * about may no longer be the record on air, and a lit key would be saying something about the wrong
 * one.
 */
export function voteView(reading: Reading, known: { rating: Rating | undefined } | undefined, vote: Vote): VoteView {
    const title = reading.failure === undefined ? '' : describe(reading.failure).title;
    const trackId = rateableTrack(reading);
    if (trackId === undefined) return { lit: false, dim: true, title };
    const lit = known?.rating === vote;
    return { lit, dim: false, title, press: { trackId, rating: lit ? 'neutral' : vote } };
}
