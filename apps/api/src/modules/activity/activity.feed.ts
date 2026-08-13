import { DateTime } from 'luxon';
import type { ActivityEntry, ActivityModule, ActivitySeverity } from './types/activity.types.js';

/**
 * The half of the feed that is not SQL.
 *
 * Pure, and separated from the query for the reason `silence.diagnosis.ts` is separated from the
 * service that gathers its facts: the ordering and the sentences are what a person actually reads,
 * and both should be testable without a database.
 *
 * ## Why the sentences are written here rather than in the union
 *
 * `station_events` rows arrive with their sentence already written, by whichever producer already
 * had to phrase the thing. The other two sources hold rows that were never written for a reader:
 * `segment_events` is a state and a segment id, `play_history` is a title and an artist. Composing
 * those in SQL would put station copy inside a `union all` in a repository, where nobody would ever
 * find it to change a word.
 */

/** One row as the union hands it over, before it is anything a person would read. */
export interface FeedRow {
    id: string;
    at: DateTime;
    module: ActivityModule;
    kind: string;
    severity: ActivitySeverity;
    /** Written by the producer, for `station_events`. Null for the two sources that hold facts rather than sentences. */
    detail: string | null;
    data: Record<string, unknown> | null;
    segmentId: string | null;
    trackId: string | null;
}

/** How a segment's arrival at each state reads. Present tense from the station's point of view. */
const SEGMENT_WORDS: Record<string, string> = {
    planned: 'was planted in the running order',
    writing: 'is being written',
    written: 'was written',
    rendering: 'is being spoken',
    ready: 'is ready to air',
    failed: 'could not be made',
};

/**
 * The cursor: a moment and a row, because a moment alone is not unique.
 *
 * Two events written in the same millisecond are ordinary — a stand-down writes one and the poll
 * behind it writes another — and a cursor holding only the timestamp would either skip the second
 * or serve it twice, depending on which way the comparison fell.
 */
export const encodeCursor = (row: { at: DateTime; id: string }): string => `${row.at.toISO()}|${row.id}`;

/** Answers `undefined` for anything that is not a cursor this file wrote, which is treated as no cursor at all. */
export function decodeCursor(cursor: string | undefined): { at: DateTime; id: string } | undefined {
    if (cursor === undefined) return undefined;

    // The FIRST separator, because an ISO timestamp cannot contain one and an id is not promised to
    // be uuid-shaped: splitting on the last would cut a `station_events` id in half if one ever
    // carried a pipe, and the resulting timestamp would fail to parse rather than fail loudly.
    const separator = cursor.indexOf('|');
    if (separator <= 0) return undefined;

    const at = DateTime.fromISO(cursor.slice(0, separator));
    const id = cursor.slice(separator + 1);
    if (!at.isValid || id === '') return undefined;

    return { at, id };
}

/** Turn one union row into the entry the console renders. */
export function toEntry(row: FeedRow): ActivityEntry {
    const data = row.data ?? undefined;

    return {
        id: row.id,
        at: row.at,
        module: row.module,
        kind: row.kind,
        severity: row.severity,
        detail: row.detail ?? describe(row),
        ...(data === undefined || Object.keys(data).length === 0 ? {} : { data }),
        ...(row.segmentId == null ? {} : { segmentId: row.segmentId }),
        ...(row.trackId == null ? {} : { trackId: row.trackId }),
    };
}

/** What a row that was never written for a reader says. */
function describe(row: FeedRow): string {
    const data = row.data ?? {};

    if (row.module === 'render') {
        const label = text(data.label) ?? 'A segment';
        const state = row.kind.slice(row.kind.indexOf('.') + 1);
        const words = SEGMENT_WORDS[state] ?? `moved to ${state}`;
        const reason = text(data.reason);

        return reason === undefined ? `${label} ${words}.` : `${label} ${words}: ${reason}`;
    }

    const title = text(data.title);
    const artists = text(data.artists);
    if (title === undefined) return 'A record aired.';

    return artists === undefined ? `${title} aired.` : `${title} by ${artists} aired.`;
}

/** A jsonb value read back as a non-empty string, or nothing. */
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
