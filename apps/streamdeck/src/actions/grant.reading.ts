import { fitLine } from '../display/key.title.js';
import { describe } from '../station/connection.failure.js';
import type { WaitingReading } from '../station/waiting.requests.js';

/** The Grant action's id, as the manifest names it. Fixed the day it is published. */
export const GRANT = 'radio.deadair.streamdeck.grant';

/** What a Grant key shows, and what pressing it would let through. */
export interface GrantView {
    /** How many are waiting and the one a press lets through, or the failure's word. */
    title: string;
    /** Nothing a press could let through: nothing waiting, or a reading that is not current. */
    dim: boolean;
    /** The request a press grants, the one that has waited longest. Absent on a key that refuses the press. */
    press?: { id: string; title: string };
}

/**
 * What a Grant key shows for a reading of the line.
 *
 * The count and the record a press would let through, which is the one that has waited longest, so
 * a key pressed without looking takes the line in order. A failure says its word and refuses the press, and a
 * stale reading refuses it too, by the rule every key follows: the request on the key may already
 * have been decided from the console.
 */
export function grantView(reading: WaitingReading): GrantView {
    if (reading.failure !== undefined) return { title: describe(reading.failure).title, dim: true };
    // Not read yet: say nothing rather than "None waiting", which is not known.
    if (reading.waiting === undefined) return { title: '', dim: true };
    const waiting = reading.waiting;
    const next = waiting[0];
    if (next === undefined) return { title: 'None\nwaiting', dim: true };
    return { title: `${waiting.length} waiting\n${fitLine(next.title)}`, dim: false, press: { id: next.id, title: next.title } };
}
