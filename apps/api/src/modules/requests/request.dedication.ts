import type { Dedication } from './requests.repository.js';

/**
 * A listener's dedication, tidied into something safe to store and to hand a writer.
 *
 * Tidied, not judged: control characters and runs of whitespace go, and each part is held to the
 * length the contract allows, so a chat (which has no contract in front of it) cannot hand over more.
 * Whether any of it is fit to say is the writer's question, asked where the words are made.
 */

export const MAX_DEDICATE_TO = 60;
export const MAX_MESSAGE = 200;

/** One part: printable, single-spaced, trimmed and clamped, or nothing when nothing is left. */
function tidy(text: string | undefined, max: number): string | undefined {
    if (text === undefined) return undefined;
    // Control characters, and format characters: zero-width joiners and the bidi overrides that make a
    // name read one way on screen and another in a log.
    const cleaned = text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned === '') return undefined;
    return cleaned.length > max ? cleaned.slice(0, max).trimEnd() : cleaned;
}

/** A dedication out of its two parts, or nothing when both are empty. */
export function dedicationOf(to: string | undefined, message: string | undefined): Dedication | undefined {
    const who = tidy(to, MAX_DEDICATE_TO);
    const words = tidy(message, MAX_MESSAGE);
    if (who === undefined && words === undefined) return undefined;
    return { ...(who === undefined ? {} : { to: who }), ...(words === undefined ? {} : { message: words }) };
}
