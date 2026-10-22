import { sql } from 'kysely';
import type { DateTime } from 'luxon';

/**
 * A `timestamptz` column, in and out, as epoch millis.
 *
 * The generated types call every `timestamptz` a luxon `DateTime` and the pg driver hands back a
 * JS `Date`, which is a mismatch that predates this and is not resolved here. Both directions are
 * written so that it never has to be: a write hands Postgres a number and lets it convert, and a
 * read handles both shapes rather than betting on one, because picking either alone is a crash or a
 * lie and the codegen mapping is a setting somebody may change. Eight repositories carried a copy of
 * one or both.
 */

/** Epoch millis as something a `timestamptz` column will take, converted by Postgres. */
export const instant = (millis: number) => sql<never>`to_timestamp(${millis} / 1000.0)`;

/**
 * A `timestamptz` column as epoch millis, whichever shape the driver handed over. `null` reads as unset.
 *
 * Takes `unknown` because two of the repositories map a `Record<string, unknown>` row rather than a
 * typed one, and anything that is not a `Date` is read as the `DateTime` the types promise.
 */
export function millisOf(value: unknown): number | undefined {
    if (value == null) return undefined;
    return value instanceof Date ? value.getTime() : (value as DateTime).toMillis();
}
