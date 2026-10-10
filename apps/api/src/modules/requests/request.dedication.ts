import { tidyListenerText } from './listener.text.js';
import type { Dedication } from './requests.repository.js';

/**
 * A listener's dedication, tidied into something safe to store and to hand a writer.
 *
 * Tidied, not judged: format and control characters and runs of whitespace go, and each part is held
 * to the length the contract allows, so a chat (which has no contract in front of it) cannot hand over
 * more. Whether any of it is fit to say is the writer's question, asked where the words are made, and
 * whether the name is one the station will say is `screenName`'s, asked where the words are planned.
 */

export const MAX_DEDICATE_TO = 60;
export const MAX_MESSAGE = 200;

/** A dedication out of its two parts, or nothing when both are empty. */
export function dedicationOf(to: string | undefined, message: string | undefined): Dedication | undefined {
    const who = tidyListenerText(to, MAX_DEDICATE_TO);
    const words = tidyListenerText(message, MAX_MESSAGE);
    if (who === undefined && words === undefined) return undefined;
    return { ...(who === undefined ? {} : { to: who }), ...(words === undefined ? {} : { message: words }) };
}
