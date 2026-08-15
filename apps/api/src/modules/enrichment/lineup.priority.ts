import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationLineupRepository } from '#modules/director/station.lineup.repository.js';

/**
 * What the station is about to play, at the three levels the enrichment walk asks about.
 *
 * Three lists rather than one, because the walk is three passes over three tables and each needs its
 * own subjects. They are all in the same order — nearest slot first — so a pass that can only get
 * through half of them gets through the half that matters.
 */
export interface EnrichmentPriority {
    trackIds: string[];
    artistIds: string[];
    albumIds: string[];
}

/** An off-air station, or one whose order holds nothing the catalog knows. Not a failure. */
export const NO_PRIORITY: EnrichmentPriority = { trackIds: [], artistIds: [], albumIds: [] };

/**
 * The running order, as the enrichment walk needs to see it.
 *
 * The walk's ordinary queue is the catalog in arrival order, which is the right answer to "what does
 * this station still know nothing about" and the wrong answer to "what is it about to say something
 * about". This is the second question, and it exists because the two disagree in exactly the case
 * that costs something: a record `PickResolver` discovered at a provider mid-refill is the NEWEST row
 * in the catalog, so it sorts last on arrival order, and its break is written within minutes.
 *
 * **It never picks the work, it only orders it.** Every list here is fed to a query that was already
 * going to run, as a leading sort term. A record that has heard from every provider does not appear
 * in that query at all, so priority can never re-cost one that is already described, and an empty
 * answer leaves the walk sorting exactly as it did before this existed.
 *
 * Its own two reads are one small query each and it runs once per run of the walk, which is why
 * nothing here is cached: a cache would be per-scope, the walk gets one scope, and the saving would
 * be zero reads against a class that could then be wrong about a running order that had moved.
 */
@Injectable()
export class LineupPriorityReader extends DataRepository {
    /**
     * Injected rather than reading `station_lineup` here, because the shape of that row belongs to
     * the director. What crosses is a list of ids.
     *
     * The edge is enrichment -> director, which is the way `modules.ts` already runs, and it lands in
     * this file rather than in `EnrichmentService` deliberately: that class is constructed by hand in
     * its unit tests, and a walk's sort order is not worth making every one of them build a lineup.
     */
    constructor(
        db: Kysely<DB>,
        private readonly lineup: StationLineupRepository,
    ) {
        super(db);
    }

    /**
     * Read the running order and resolve its records to the artists and records behind them.
     *
     * All three levels, because a break is shown what is known about the recording, then its record,
     * then whoever made it — and a track discovered at a provider usually arrives with an artist the
     * catalog has never enriched either, which is where most of the sayable facts live.
     *
     * The artist and album lists are derived here rather than joined inside the walk's own queries so
     * that each of those pays one indexed `array_position` on a primary key, instead of a lateral
     * over the whole table before its limit applies.
     */
    async read(): Promise<EnrichmentPriority> {
        const trackIds = await this.lineup.lineupTrackIds();
        if (trackIds.length === 0) return NO_PRIORITY;

        const rows = await sql<{ id: string; artistId: string; albumId: string | null }>`
            select id, artist_id, album_id
              from deadair.tracks
             where id = any(${trackIds}::uuid[])
               and merged_into_id is null
        `.execute(this.db);

        // Walked in SLOT order rather than in the query's, which is what keeps the derived lists
        // ranked the same way the track list is: a record two boundaries away should have its artist
        // looked up before one at the end of the hour.
        const byTrack = new Map(rows.rows.map(row => [row.id, row]));
        const artistIds = new Set<string>();
        const albumIds = new Set<string>();

        for (const trackId of trackIds) {
            const row = byTrack.get(trackId);
            // Absent means the order names a track the catalog no longer holds — merged away, or
            // deleted under a broadcast that is still running. Ordinary, and nothing to enrich.
            if (row === undefined) continue;
            artistIds.add(row.artistId);
            if (row.albumId != null) albumIds.add(row.albumId);
        }

        return { trackIds, artistIds: [...artistIds], albumIds: [...albumIds] };
    }
}
