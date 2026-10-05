import { refinesGenre } from './genre.match.js';

/**
 * A genre steer: the station leans toward some genres for a while, and still plays anything else.
 *
 * The positive half Ideas #22 refused to make a rule. A rule is a veto, absolute, and an "only these
 * genres" rule could leave the station nothing it may play; a steer is a weight in the draw, so the
 * most it can do is make the chosen genres come up more often. Nothing here ever removes a record.
 */

/**
 * How much more likely a record in a steered genre is to be drawn than one outside it.
 *
 * Four, so an hour of a steered station is mostly the genres asked for without being only them: the
 * draw also gets an extra sample of steered records (`CatalogSetGenerator`), and between the two a
 * steer toward a well-stocked genre fills most of a refill, while one toward a genre the library
 * barely holds plays what it has and fills the rest as usual.
 */
export const STEER_LEAN = 4;

/** Whether a record's tags put it in any steered genre, on a genre rule's own matching. */
export function steered(tags: readonly string[], genres: readonly string[]): boolean {
    return genres.some(genre => tags.some(tag => refinesGenre(tag, genre)));
}
