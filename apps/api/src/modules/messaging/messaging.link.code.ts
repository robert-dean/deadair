import { createHash, randomInt } from 'node:crypto';

/**
 * The one-time codes that link a chat account to a station account.
 *
 * Eight characters from an alphabet with nothing easy to misread (no 0/O, 1/I/L), which is about
 * forty bits: plenty for a code that lives ten minutes, is used once, and is only accepted in a
 * direct message to the station's own bot.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const LINK_CODE_LENGTH = 8;

/** How long a code works for. Long enough to switch apps and type it; short enough not to linger. */
export const LINK_CODE_TTL_MS = 10 * 60_000;

/** A fresh code, from the platform's CSPRNG. */
export function newLinkCode(): string {
    let code = '';
    for (let index = 0; index < LINK_CODE_LENGTH; index += 1) code += ALPHABET[randomInt(ALPHABET.length)];
    return code;
}

/** What is stored for a code: its SHA-256, over the code as typed, upper-cased and without spaces or dashes. */
export function hashLinkCode(code: string): string {
    return createHash('sha256').update(normaliseLinkCode(code)).digest('hex');
}

/** A code as somebody typed it, in the one form it is compared in. */
export function normaliseLinkCode(code: string): string {
    return code.replace(/[\s-]/g, '').toUpperCase();
}
