import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '#modules/data/data.repository.js';
import { effectiveRating } from '#modules/catalog/effective.rating.js';
import { suspendedNow } from '#modules/catalog/suspension.js';
import { songKey } from '#modules/director/rotation.keys.js';
import { combineCounts, weekBefore, type SongCount, type SongStanding, type WeekTally } from './station.chart.js';

/** What the repository reads for a run of chart weeks. */
export interface StationChartHistory {
    tallies: WeekTally[];
    /** By song key. A record whose catalog rows are all gone has none, and is neither liked nor barred. */
    standings: Map<string, SongStanding>;
}

/**
 * The counts the station's chart is ranked from, read week by week in the station's own zone.
 *
 * A chart week starts at Monday 00:00 where the station is, which is Postgres's own
 * `date_trunc('week', …)` once a timestamp is read in that zone, so the boundary never has to be
 * worked out in Node and a week that crosses a clock change is still seven calendar days.
 *
 * Three sources, each counted where it is written down:
 *
 * - **Plays**: `play_history`, which is written when the player says a record STARTED, so a record
 *   handed over and retracted never counts.
 * - **Requests**: `listener_requests` by when they were made, whatever became of them, save those
 *   the operator declined. A request the station never got round to airing was still somebody asking.
 * - **Skips**: `track_skips`.
 *
 * Every read is bounded by `stationKey` first, since every index on these tables leads with it.
 */
@Injectable()
export class StationChartRepository extends DataRepository {
    /**
     * The week an edition covers, as the Monday it starts on.
     *
     * Absent `date` is the last COMPLETE week, so a show on Saturday and its repeat on Sunday air the
     * same chart, and a countdown is never of a week still being played. A `date` names the edition
     * of the week it falls in, and a date in the current week answers last week's, for the same reason.
     */
    async editionWeek(zone: string, date?: string): Promise<string> {
        const result = await sql<{ week: string }>`
            with now_week as (select date_trunc('week', now() at time zone ${zone}) - interval '7 days' as latest)
            select to_char(
                ${date === undefined ? sql`latest` : sql`least(date_trunc('week', ${date}::date::timestamp), latest)`},
                'YYYY-MM-DD'
            ) as week
            from now_week
        `.execute(this.db);
        return result.rows[0]!.week;
    }

    /**
     * Everything that happened in `weeks` chart weeks, the last of which starts on `lastWeek`.
     *
     * @param lastWeek - A Monday, `YYYY-MM-DD`, as {@link editionWeek} answers.
     */
    async history(stationKey: string, zone: string, lastWeek: string, weeks: number): Promise<StationChartHistory> {
        let firstWeek = lastWeek;
        for (let index = 1; index < weeks; index += 1) firstWeek = weekBefore(firstWeek);

        // Local midnights read as instants in the station's zone: `timestamp at time zone` turns a
        // wall-clock reading into the moment it was that time there.
        const from = sql`(${firstWeek}::date::timestamp at time zone ${zone})`;
        const to = sql`((${lastWeek}::date + 7)::timestamp at time zone ${zone})`;
        const weekOf = (column: string) => sql<string>`to_char(date_trunc('week', ${sql.ref(column)} at time zone ${zone}), 'YYYY-MM-DD')`;

        const [plays, requests, skips] = await Promise.all([
            sql<{ week: string; songKey: string; title: string; artist: string; plays: string; lastAiredAt: string; trackIds: (string | null)[] }>`
                select ${weekOf('ph.aired_at')} as week,
                       ph.song_key as "songKey",
                       (array_agg(ph.title order by ph.aired_at desc))[1] as title,
                       (array_agg(coalesce(nullif(ph.artist, ''), split_part(ph.artists, ', ', 1)) order by ph.aired_at desc))[1] as artist,
                       count(*) as plays,
                       to_char(max(ph.aired_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "lastAiredAt",
                       array_agg(distinct ph.track_id) as "trackIds"
                from deadair.play_history ph
                where ph.station_key = ${stationKey} and ph.aired_at >= ${from} and ph.aired_at < ${to}
                group by 1, 2
            `.execute(this.db),
            sql<{ week: string; trackId: string; title: string; artist: string; requests: string }>`
                select ${weekOf('lr.created_at')} as week, t.id as "trackId", t.title, a.name as artist, count(*) as requests
                from deadair.listener_requests lr
                inner join deadair.tracks t on t.id = lr.track_id
                inner join deadair.artists a on a.id = t.artist_id
                where lr.station_key = ${stationKey} and lr.status <> 'declined' and lr.created_at >= ${from} and lr.created_at < ${to}
                group by 1, 2, 3, 4
            `.execute(this.db),
            sql<{ week: string; songKey: string; skips: string; trackIds: (string | null)[] }>`
                select ${weekOf('ts.skipped_at')} as week, ts.song_key as "songKey", count(*) as skips, array_agg(distinct ts.track_id) as "trackIds"
                from deadair.track_skips ts
                where ts.station_key = ${stationKey} and ts.skipped_at >= ${from} and ts.skipped_at < ${to}
                group by 1, 2
            `.execute(this.db),
        ]);

        // Which catalog rows stand behind each song, so its standing can be read once per track.
        const tracksBySong = new Map<string, Set<string>>();
        const note = (key: string, trackId: string | null | undefined) => {
            if (!trackId) return;
            const tracks = tracksBySong.get(key) ?? new Set<string>();
            tracks.add(trackId);
            tracksBySong.set(key, tracks);
        };

        const playCounts: SongCount[] = plays.rows.map(row => {
            for (const trackId of row.trackIds ?? []) note(row.songKey, trackId);
            return {
                week: row.week,
                songKey: row.songKey,
                title: row.title,
                artist: row.artist,
                count: Number(row.plays),
                lastAiredAt: row.lastAiredAt,
            };
        });
        // A request names a catalog row, so its key is made the way every history row's is: the
        // title and the LEAD artist, `songKey(title, [artist])`.
        const requestCounts: SongCount[] = requests.rows.map(row => {
            const key = songKey(row.title, [row.artist]);
            note(key, row.trackId);
            return { week: row.week, songKey: key, title: row.title, artist: row.artist, count: Number(row.requests) };
        });
        // A skip carries no name of its own, and a record that was only skipped can never chart, so
        // it is left nameless: whatever else counted it supplies the title and artist.
        const skipCounts: SongCount[] = skips.rows.map(row => {
            for (const trackId of row.trackIds ?? []) note(row.songKey, trackId);
            return { week: row.week, songKey: row.songKey, title: '', artist: '', count: Number(row.skips) };
        });

        return {
            tallies: combineCounts(playCounts, requestCounts, skipCounts),
            standings: await this.standings(tracksBySong),
        };
    }

    /**
     * What the station thinks of each song: barred when any row behind it is disliked or suspended,
     * liked when any is liked and none is barred.
     *
     * Any rather than all, because one song is several catalog rows when a provider renumbered it or
     * the same recording arrived on two releases, and the station's dislike of one copy is a dislike
     * of the song.
     */
    private async standings(tracksBySong: ReadonlyMap<string, ReadonlySet<string>>): Promise<Map<string, SongStanding>> {
        const trackIds = [...new Set([...tracksBySong.values()].flatMap(tracks => [...tracks]))];
        const standings = new Map<string, SongStanding>();
        if (trackIds.length === 0) return standings;

        const rows = await this.db
            .selectFrom('deadair.tracks')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
            .leftJoin('deadair.albums', 'deadair.albums.id', 'deadair.tracks.albumId')
            .select('deadair.tracks.id as trackId')
            .select(effectiveRating().as('rating'))
            .select(suspendedNow(sql.ref('deadair.tracks.id')).as('suspended'))
            .where('deadair.tracks.id', 'in', trackIds)
            .execute();
        const byTrack = new Map(rows.map(row => [row.trackId, { rating: Number(row.rating), suspended: row.suspended === true }]));

        for (const [key, tracks] of tracksBySong) {
            const known = [...tracks].map(trackId => byTrack.get(trackId)).filter(standing => standing !== undefined);
            if (known.length === 0) continue;
            const barred = known.some(standing => standing.rating < 0 || standing.suspended);
            standings.set(key, { barred, liked: !barred && known.some(standing => standing.rating > 0) });
        }
        return standings;
    }
}
