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

/** The manifest's two states for a vote key, in its order. */
export const UNLIT = 0;
export const LIT = 1;

/** What one vote key shows, and what pressing it would do. */
export interface VoteView {
    /** The station's opinion of the record on air is this key's own: draw it lit. */
    lit: boolean;
    /** The failure's word, or nothing. Two words is all the key has room for; the log has the sentence. */
    title: string;
    /** The record a press would rate and what it would write. Absent on a key that refuses the press. */
    press?: { trackId: string; rating: Rating };
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
 * A stale reading draws both keys unlit however well the last opinion is known, by the rule the rest
 * of this plugin follows: the record the opinion is about may no longer be the record on air, and a
 * lit key would be saying something about the wrong one.
 */
export function voteView(reading: Reading, known: { rating: Rating | undefined } | undefined, vote: Vote): VoteView {
    const title = reading.failure === undefined ? '' : describe(reading.failure).title;
    const trackId = reading.failure === undefined && !reading.stale ? reading.status?.nowPlaying?.item.trackId : undefined;
    if (trackId === undefined) return { lit: false, title };
    const lit = known?.rating === vote;
    return { lit, title, press: { trackId, rating: lit ? 'neutral' : vote } };
}
