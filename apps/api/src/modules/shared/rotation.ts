/**
 * Where a list starts, taken from the one thing about a moment that is stable and its own.
 *
 * Not a random and not the clock: a break re-offered after a lost job has to be shown the same
 * record in the same words, or the retry becomes a second opinion. Any cheap spread over the id
 * will do — what matters is only that two breaks about the same artist rarely land on the same
 * number.
 *
 * It lives here rather than beside its first caller because it now has three across two modules: a
 * break's facts and its preoccupation are spread over the segment id, and a production's cast is
 * spread over the production's. None of those is the director's business more than another's.
 */
export function rotationOf(id: string): number {
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 0xffff;
    return hash;
}

/**
 * The entry of `values` this moment gets, or `undefined` when there are none.
 *
 * The pairing of {@link rotationOf} with a list, in one place, because every caller wants the same
 * two lines and one of them is a modulo that is wrong in a way nothing would notice: a negative or
 * an out-of-range index answers `undefined` and reads exactly like an empty list.
 */
export function rotateInto<T>(values: readonly T[], id: string): T | undefined {
    if (values.length === 0) return undefined;

    return values[rotationOf(id) % values.length];
}
