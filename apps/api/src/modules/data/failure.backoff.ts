import { sql, type RawBuilder } from 'kysely';

/**
 * When to try a failed fetch again, doubling per attempt up to a ceiling.
 *
 * Two caches keep this shape — cover art and track audio — and both keep the
 * FAILED row rather than deleting it, because without it a sweeper cannot tell a
 * URL it has never seen from one that 404s every time, and a dead record would
 * be re-fetched on every pass forever.
 *
 * ## Why it is computed in SQL
 *
 * The delay doubles off the row's OWN `attempts` rather than off a value read a
 * moment earlier. That needs no read before the write, and it means two failures
 * racing cannot both write the same delay from the same stale count. Inside the
 * conflict expression `attempts` is the PRE-bump value, which is why the
 * exponent has no `- 1`.
 *
 * ## Why the bounds are cast
 *
 * `least()` over two untyped bind parameters resolves to `text`, and
 * `make_interval(secs => text)` is not a function that exists. Both bounds
 * therefore carry an explicit `::double precision`.
 *
 * @param attemptsColumn - The qualified `attempts` column in the SQL spelling of
 *   the table, e.g. `deadair.art_assets.attempts`. Interpolated raw, so it must
 *   be a literal from this codebase and never anything an operator supplies.
 * @param baseRetryMs - The first delay, doubled from there.
 * @param maxRetryMs - The ceiling the doubling stops at.
 */
export function failureBackoff(
    attemptsColumn: string,
    baseRetryMs: number,
    maxRetryMs: number,
): { first: RawBuilder<never>; again: RawBuilder<never> } {
    const baseSecs = sql<number>`${baseRetryMs / 1000}::double precision`;
    const maxSecs = sql<number>`${maxRetryMs / 1000}::double precision`;

    return {
        /** The row's first failure: one base delay, still clamped in case base exceeds max. */
        first: sql<never>`now() + make_interval(secs => least(${baseSecs}, ${maxSecs}))`,
        /** A repeat: the base doubled by however many times this row has already failed. */
        again: sql<never>`now() + make_interval(
                        secs => least(${baseSecs} * power(2, ${sql.raw(attemptsColumn)}), ${maxSecs})
                    )`,
    };
}
