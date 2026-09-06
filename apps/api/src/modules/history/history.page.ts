import type { DateTime } from 'luxon';
import type { HistoryEntry } from './types/history.types.js';

/**
 * The half of the history that is not SQL.
 *
 * Pure, and separated from the query for the same reason `activity.feed.ts` is: what a page holds
 * and what it leaves out is the part a person sees, and it should be testable without a database.
 * There are no sentences to write here — a record's title and credit are already the words — so
 * this file is thinner than that one by exactly the amount the feed spends on phrasing.
 */

/** One row as the join hands it over, in the shape Kysely reads it back in. */
export interface HistoryRow {
    id: string;
    airedAt: DateTime;
    title: string;
    artists: string;
    album: string | null;
    artworkUrl: string | null;
    durationMs: number | null;
    trackId: string | null;
}

/**
 * One row as the contract carries it.
 *
 * The four optional fields are dropped rather than sent as null, which is the repo's rule for
 * "not set" and is also the honest report: a record aired straight from a provider has no catalog
 * row behind it, so it has no cover and no running time, and saying so with an absent field costs
 * a client one `=== undefined` instead of two checks.
 *
 * `== null` rather than `=== undefined`: a SQL NULL reads back as `undefined` at runtime, but
 * Kysely's generated type still says `T | null`, on `db.ts`'s own rule.
 */
export function toEntry(row: HistoryRow): HistoryEntry {
    return {
        id: row.id,
        airedAt: row.airedAt,
        title: row.title,
        artists: row.artists,
        ...(row.album == null ? {} : { album: row.album }),
        ...(row.artworkUrl == null ? {} : { artworkUrl: row.artworkUrl }),
        ...(row.durationMs == null ? {} : { durationMs: row.durationMs }),
        ...(row.trackId == null ? {} : { trackId: row.trackId }),
    };
}
