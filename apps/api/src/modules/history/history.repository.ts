import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import { artUrl } from '#modules/catalog/catalog.art.js';
import { stationCover } from '#modules/art/art.source.token.js';
import { decodeCursor } from '#modules/activity/activity.feed.js';
import type { HistoryRow } from './history.page.js';
import type { AsRunRow } from './as.run.page.js';

/** What a client asked of the as-run log. */
export interface AsRunPageQuery {
    stationKey: string;
    limit: number;
    before?: string;
    /** Read from this moment back. Ignored when `before` is a cursor. */
    until?: DateTime;
}

/** What the client asked for. */
export interface HistoryPageQuery {
    /** Whose history this is. Every read is scoped to it, and the index leads with it. */
    stationKey: string;
    limit: number;
    before?: string;
}

const ALBUM_IMAGE_COLUMN = 'deadair.albums.image_url';

/**
 * What the station has played: `deadair.play_history`, read for a listener rather than for a rule.
 *
 * ## Why this is not the activity feed
 *
 * The feed already carries these rows, and carries them well enough for a console: it is a union
 * over three tables and `track.aired` is one arm of it. It is the wrong read for a list of records,
 * for two reasons that are both about shape rather than taste. It has no filter on `kind`, so
 * asking it for fifty aired tracks means asking for fifty EVENTS and keeping whichever happen to be
 * tracks — a page of three, unpredictably, with a cursor that has already moved past the rest. And
 * its `data` column carries the title and the credit but no cover, because the other two arms have
 * nothing to hang one off. A screen of records without covers is a list of strings.
 *
 * ## Why the catalog is joined rather than copied
 *
 * `play_history` holds the credit as it was aired, which is the right thing for it to hold: it is
 * the memory the rotation rules steer off, and a title corrected in the catalog next week must not
 * rewrite what a listener heard last night. The cover and the running time are the catalog's and
 * are joined at read time for that reason — they are facts about the record, not about the airing,
 * and the fresher answer is the better one.
 *
 * LEFT joins, both of them. `track_id` is null for anything aired straight from a provider and is
 * set null when the catalog forgets the row, and an inner join would silently drop exactly the
 * records whose provenance is least tidy. `album_id` is nullable in the catalog too.
 *
 * ## Why the cursor is a keyset
 *
 * Rows arrive at the head while somebody reads, so an offset re-shows a row on every page as the
 * station keeps playing. `(aired_at, id)` is compared as a row constructor, which is one
 * index-friendly comparison rather than the `or` chain it is usually written out as, and
 * `play_history_aired_at_idx (station_key, aired_at desc)` serves it. The cursor's two halves and
 * its encoding are `activity.feed.ts`'s, reused rather than re-derived: it is the same problem, and
 * two encoders that agree today are two that can disagree later.
 */
@Injectable()
export class HistoryRepository extends DataRepository {
    /**
     * One page, newest first.
     *
     * Answers `limit + 1` rows so the caller can tell a full page from the end of the history
     * without a second count over a table that grows all day.
     */
    async page(query: HistoryPageQuery): Promise<HistoryRow[]> {
        const cursor = decodeCursor(query.before);

        let scoped = this.db
            .selectFrom('deadair.playHistory')
            .leftJoin('deadair.tracks', 'deadair.tracks.id', 'deadair.playHistory.trackId')
            .leftJoin('deadair.albums', 'deadair.albums.id', 'deadair.tracks.albumId')
            .where('deadair.playHistory.stationKey', '=', query.stationKey);

        if (cursor !== undefined) {
            // A row constructor, so the comparison is the index's own ordering rather than a
            // disjunction the planner has to take apart. Two records aired in the same millisecond
            // is ordinary on a changeover, and a cursor holding only the timestamp would either
            // skip the second or serve it twice depending on which way the comparison fell.
            scoped = scoped.where(
                sql<boolean>`(deadair.play_history.aired_at, deadair.play_history.id) < (${cursor.at.toISO()}::timestamptz, ${cursor.id}::uuid)`,
            );
        }

        const rows = await scoped
            .select([
                sql<string>`deadair.play_history.id::text`.as('id'),
                'deadair.playHistory.airedAt as airedAt',
                'deadair.playHistory.title as title',
                // The credit line as it aired, not the catalog's current spelling of it.
                'deadair.playHistory.artists as artists',
                'deadair.albums.name as album',
                'deadair.tracks.durationMs as durationMs',
                sql<string | null>`deadair.play_history.track_id::text`.as('trackId'),
            ])
            // The record's cover, off the join that is already there, so a page of fifty rows is
            // still one query. A recording has no art of its own; nothing hangs a cover off one.
            .select(artUrl(ALBUM_IMAGE_COLUMN, 'artworkUrl'))
            .orderBy('deadair.playHistory.airedAt', 'desc')
            .orderBy('deadair.playHistory.id', 'desc')
            .limit(query.limit + 1)
            .execute();

        // Named back out one field at a time. `artUrl` takes its alias as a plain `string`, so
        // Kysely infers an index signature for that column rather than a property — which reads
        // back as possibly ABSENT as well as possibly null, and `?? null` is what says the two mean
        // the same thing here: no cover. Widening the helper's signature to keep the literal would
        // touch every catalog read for one caller's benefit.
        return rows.map(row => ({
            id: row.id,
            airedAt: row.airedAt,
            title: row.title,
            artists: row.artists,
            album: row.album,
            // The station's own path, or its proxy for one it has not cached; never the provider's URL.
            artworkUrl: stationCover(row.artworkUrl) ?? null,
            durationMs: row.durationMs,
            trackId: row.trackId,
        }));
    }

    /**
     * One page of the as-run log, newest first: the items, and the gaps and air changes between them.
     *
     * A `union all` over two tables rather than a copy of the events into the log, on the activity
     * feed's one-writer rule: the transport already writes `gap`, `air.on` and `air.off` to
     * `station_events`, and a second copy would be a second thing to disagree. A gap is recorded when it
     * CLOSES, with its length, so its start is worked out here from the two, which is what places it
     * between the items it fell between rather than after the one that ended it.
     *
     * Raw SQL, for `taggedWith`'s reason in the tracks repository: a keyset over a union is one
     * subquery with the cursor outside it, and the builder has no shape for that. Answers `limit + 1`
     * rows for `page`'s reason.
     */
    async asRunPage(query: AsRunPageQuery): Promise<AsRunRow[]> {
        const cursor = decodeCursor(query.before);
        const bound =
            cursor !== undefined
                ? sql`where (u.at, u.id) < (${cursor.at.toISO()}::timestamptz, ${cursor.id})`
                : query.until !== undefined
                  ? sql`where u.at <= ${query.until.toISO()}::timestamptz`
                  : sql``;

        const result = await sql<AsRunRow>`
            select * from (
                select
                    r.id::text as id,
                    r.kind as kind,
                    r.aired_at as at,
                    r.ended_at as "endedAt",
                    r.title as title,
                    r.artists as artists,
                    r.track_id::text as "trackId",
                    r.segment_id::text as "segmentId",
                    r.passed_over as "passedOver",
                    null::text as detail
                from deadair.as_run r
                where r.station_key = ${query.stationKey}
                union all
                select
                    e.id::text,
                    case e.kind when 'gap' then 'gap' when 'air.on' then 'onAir' else 'offAir' end,
                    case
                        when e.kind = 'gap' then e.created_at - make_interval(secs => coalesce((e.data ->> 'gapMs')::numeric, 0) / 1000.0)
                        else e.created_at
                    end,
                    case when e.kind = 'gap' then e.created_at end,
                    null, null, null, null, 0,
                    e.detail
                from deadair.station_events e
                where e.station_key = ${query.stationKey} and e.kind in ('gap', 'air.on', 'air.off')
            ) u
            ${bound}
            order by u.at desc, u.id desc
            limit ${query.limit + 1}
        `.execute(this.db);

        return result.rows;
    }
}
