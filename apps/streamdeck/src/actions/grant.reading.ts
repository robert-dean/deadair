import { describe } from '../station/connection.failure.js';
import type { WaitingReading } from '../station/waiting.requests.js';

/** The Grant action's id, as the manifest names it. Fixed the day it is published. */
export const GRANT = 'radio.deadair.streamdeck.grant';

/**
 * What a Grant key shows, and what pressing it would let through.
 *
 * No title: the key is the icon, with a badge counting what is waiting, and what it would say about a
 * press it refuses goes to the log when it is pressed. A title the operator types in the Stream Deck
 * app is theirs and is never replaced.
 */
export type GrantView =
    /** The request a press grants is the one that has waited longest. */
    | { dim: false; count: number; press: { id: string; title: string } }
    /** Nothing a press could let through: drawn faint, and `refusal` is the log's sentence for a press. */
    | { dim: true; refusal: string };

/**
 * What a Grant key shows for a reading of the line.
 *
 * The count, and the record a press would let through, which is the one that has waited longest, so
 * a key pressed without looking takes the line in order. A failure refuses the press, and a stale
 * reading refuses it too, by the rule every key follows: the request on the key may already have
 * been decided from the console.
 */
export function grantView(reading: WaitingReading): GrantView {
    if (reading.failure !== undefined) return { dim: true, refusal: describe(reading.failure).sentence };
    // Not read yet: the key cannot know that nothing is waiting, only that it has not been told.
    if (reading.waiting === undefined) return { dim: true, refusal: 'The station has not said yet what is waiting. Try again in a moment.' };
    const next = reading.waiting[0];
    if (next === undefined) return { dim: true, refusal: 'No request is waiting for approval.' };
    return { dim: false, count: reading.waiting.length, press: { id: next.id, title: next.title } };
}
