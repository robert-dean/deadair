import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import { decodeCursor, type FeedRow } from './activity.feed.js';
import type { ActivityModule, ActivitySeverity } from './types/activity.types.js';

/**
 * The feed's read: three tables, one time-ordered answer.
 *
 * ## Why a union rather than a table
 *
 * Two of the three sources already exist and are already correct. `segment_events` has been written
 * since migration 0008, whose own comment says it was written early precisely so that a feed could
 * be "a transport over rows that already exist", and `play_history` is what the rotation rules
 * steer off. Copying either into a fourth table would give those facts a second writer, and a fact
 * with two writers is two things that can disagree — with no way for a reader to tell which one
 * lied. The cost is this query; the cost of the alternative is paid forever.
 *
 * `script_history` is deliberately NOT a fourth source. A break already appears here through its
 * `segment_events` rows, and adding one row per write ATTEMPT would report a single break as four
 * lines. It is the detail behind a segment entry rather than an entry of its own.
 *
 * ## Why the cursor is a keyset
 *
 * Rows arrive at the head continuously, so an offset re-shows a row on every page as the feed grows
 * under the reader. `(created_at, id)` is compared as a row constructor, which is one index-friendly
 * comparison rather than the `or` chain that expression is usually written out as.
 *
 * ## Where the sentences are
 *
 * Not here. This projects raw facts into a common shape and `activity.feed.ts` writes the words, so
 * that changing what a line says is not an edit inside a `union all`.
 */

/** What the console asked for. */
export interface ActivityPageQuery {
    /** Whose feed this is. Applied inside each arm of the union, not over the result. */
    stationKey: string;
    limit: number;
    before?: string;
    module?: ActivityModule;
    minSeverity?: ActivitySeverity;
}

/** `warn` means warnings and faults; the floor, not an exact match. */
const AT_LEAST: Record<ActivitySeverity, readonly ActivitySeverity[]> = {
    info: ['info', 'warn', 'fault'],
    warn: ['warn', 'fault'],
    fault: ['fault'],
};

interface RawRow {
    id: string;
    at: DateTime;
    module: ActivityModule;
    kind: string;
    severity: ActivitySeverity;
    detail: string | null;
    data: Record<string, unknown> | null;
    segment_id: string | null;
    track_id: string | null;
}

@Injectable()
export class ActivityRepository extends DataRepository {
    /**
     * One page, newest first.
     *
     * Answers `limit + 1` rows so the caller can tell a full page from the end of the feed without
     * a second count over three tables.
     */
    async page(query: ActivityPageQuery): Promise<FeedRow[]> {
        const cursor = decodeCursor(query.before);
        const severities = AT_LEAST[query.minSeverity ?? 'info'];

        const rows = await sql<RawRow>`
            select id, at, module, kind, severity, detail, data, segment_id, track_id
            from (
                -- The station's own moments, which arrive with their sentence already written.
                select
                    e.id::text as id,
                    e.created_at as at,
                    e.module as module,
                    e.kind as kind,
                    e.severity as severity,
                    e.detail as detail,
                    e.data as data,
                    null::text as segment_id,
                    null::text as track_id
                from deadair.station_events e
                -- Inside each arm rather than once over the union, which is what lets each of the
                -- three use its own station-leading index. Filtering outside would read every
                -- station's rows and throw most of them away after sorting them.
                where e.station_key = ${query.stationKey}

                union all

                -- A break's journey. Joined to the segments table for the label, because an id is not
                -- something a person can read and the feed is for a person.
                select
                    v.id::text,
                    v.created_at,
                    'render',
                    'segment.' || v.to_state,
                    case when v.to_state = 'failed' then 'fault' else 'info' end,
                    null,
                    jsonb_strip_nulls(
                        jsonb_build_object('label', s.label, 'segmentKind', s.kind, 'fromState', v.from_state, 'reason', v.reason)
                    ),
                    v.segment_id::text,
                    null
                from deadair.segment_events v
                join deadair.segments s on s.id = v.segment_id
                where v.station_key = ${query.stationKey}

                union all

                -- What actually aired, written from the rundown's own onAired rather than from
                -- the hand-over, which is a track ahead of what a listener heard.
                select
                    h.id::text,
                    h.aired_at,
                    'director',
                    'track.aired',
                    'info',
                    null,
                    jsonb_build_object('title', h.title, 'artists', h.artists, 'source', h.source),
                    null,
                    h.track_id::text
                from deadair.play_history h
                where h.station_key = ${query.stationKey}
            ) feed
            where ${query.module === undefined ? sql`true` : sql`module = ${query.module}`}
              and severity = any(${sql.val(severities)}::text[])
              and ${cursor === undefined ? sql`true` : sql`(at, id) < (${cursor.at.toISO()}::timestamptz, ${cursor.id})`}
            order by at desc, id desc
            limit ${query.limit + 1}
        `.execute(this.db);

        return rows.rows.map(row => ({
            id: row.id,
            at: row.at,
            module: row.module,
            kind: row.kind,
            severity: row.severity,
            detail: row.detail,
            data: row.data,
            segmentId: row.segment_id,
            trackId: row.track_id,
        }));
    }
}
