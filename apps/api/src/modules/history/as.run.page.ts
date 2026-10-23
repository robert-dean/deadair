import type { DateTime } from 'luxon';
import type { AsRunEntry, AsRunKind } from './types/history.types.js';

/**
 * The half of the as-run log that is not SQL: one row of the union, as the contract carries it.
 *
 * Pure, for `history.page.ts`'s reason. Optional fields are dropped rather than sent as null, and
 * `== null` is the test, on `db.ts`'s own rule that a SQL NULL reads back as `undefined`.
 */

/** One row of `HistoryRepository.asRunPage`'s union, as the driver hands it over. */
export interface AsRunRow {
    id: string;
    kind: AsRunKind;
    at: DateTime;
    endedAt: DateTime | null;
    title: string | null;
    artists: string | null;
    trackId: string | null;
    segmentId: string | null;
    passedOver: number | null;
    detail: string | null;
}

/** One line as the contract carries it. A zero `passedOver` is left off, since it is the ordinary case. */
export function toAsRunEntry(row: AsRunRow): AsRunEntry {
    return {
        id: row.id,
        kind: row.kind,
        at: row.at,
        ...(row.endedAt == null ? {} : { endedAt: row.endedAt }),
        ...(row.title == null ? {} : { title: row.title }),
        ...(row.artists == null || row.artists === '' ? {} : { artists: row.artists }),
        ...(row.trackId == null ? {} : { trackId: row.trackId }),
        ...(row.segmentId == null ? {} : { segmentId: row.segmentId }),
        ...(row.passedOver == null || Number(row.passedOver) === 0 ? {} : { passedOver: Number(row.passedOver) }),
        ...(row.detail == null ? {} : { detail: row.detail }),
    };
}
