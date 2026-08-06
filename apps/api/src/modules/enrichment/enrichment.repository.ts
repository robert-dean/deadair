import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '../data/data.repository.js';

/** A canonical track, in the shape the enrichment fan-out needs to ask about it. */
export interface EnrichableTrack {
    id: string;
    title: string;
    artistId: string;
    artistName: string;
    albumId?: string;
    albumName?: string;
    durationMs?: number;
    year?: number;
    isrc?: string;
}

/** What the merged enrichment is allowed to write onto the canonical rows. */
export interface TrackPromotion {
    /** MusicBrainz recording id. Written once and never revised. */
    mbid?: string;
    year?: number;
    genre?: string;
}

const nullable = <T>(value: T | null | undefined): T | undefined => (value == null ? undefined : value);

/** MusicBrainz ids are UUIDs and the columns are `uuid`; anything else is a plugin bug, not a row. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string | undefined): value is string => value !== undefined && UUID.test(value);

/**
 * The enrichment tables, plus the narrow promotion of what they hold onto the
 * canonical catalog rows.
 *
 * Two different kinds of write, deliberately kept in one place because they
 * have to agree. `track_enrichment` is the record: one jsonb payload per
 * provider, with its own fetch time and TTL, holding everything a plugin said
 * including the parts no column exists for. Promotion is the small subset that
 * belongs on a canonical row because something queries it — identity
 * (`tracks.mbid`, `artists.mbid`) and the gaps a provider left behind.
 *
 * Promotion never overwrites. A value already on the row came from the
 * provider that actually serves the track, or from an operator, and enrichment
 * is a second opinion about a recording rather than an authority over the copy
 * of it the station holds.
 */
@Injectable()
export class EnrichmentRepository extends DataRepository {
    /**
     * Tracks that have not heard from every enrichment provider lately.
     *
     * Raw SQL because the shape is a correlated count against a list of
     * providers, which the query builder expresses far less legibly than it
     * reads here. "Lately" is per provider: adding a second enrichment plugin
     * makes every track eligible again for that plugin alone, which is what
     * lets a new source backfill without a migration or a manual sweep.
     *
     * The ISRC comes off whichever binding carries one. It is the strongest key
     * an enrichment plugin can match on, and it is a property of the recording
     * rather than of the provider, so any binding's copy will do.
     *
     * Oldest first, so a backlog drains in the order it arrived rather than
     * starving whatever sorts last.
     */
    async listTracksNeedingEnrichment(providers: string[], limit: number): Promise<EnrichableTrack[]> {
        if (providers.length === 0) return [];

        const rows = await sql<{
            id: string;
            title: string;
            artist_id: string;
            artist_name: string;
            album_id: string | null;
            album_name: string | null;
            duration_ms: number | null;
            year: number | null;
            isrc: string | null;
        }>`
            select t.id,
                   t.title,
                   t.artist_id,
                   ar.name as artist_name,
                   t.album_id,
                   al.name as album_name,
                   t.duration_ms,
                   t.year,
                   (select ts.isrc
                      from deadair.track_sources ts
                     where ts.track_id = t.id and ts.isrc is not null
                     order by ts.created_at asc
                     limit 1) as isrc
              from deadair.tracks t
              join deadair.artists ar on ar.id = t.artist_id
              left join deadair.albums al on al.id = t.album_id
             where t.merged_into_id is null
               and (select count(distinct te.provider)
                      from deadair.track_enrichment te
                     where te.track_id = t.id
                       and te.provider = any(${providers}::text[])
                       and (te.expires_at is null or te.expires_at > now())) < ${providers.length}
             order by t.created_at asc, t.id asc
             limit ${limit}
        `.execute(this.db);

        return rows.rows.map(row => ({
            id: row.id,
            title: row.title,
            artistId: row.artist_id,
            artistName: row.artist_name,
            albumId: nullable(row.album_id),
            albumName: nullable(row.album_name),
            durationMs: nullable(row.duration_ms),
            year: nullable(row.year),
            isrc: nullable(row.isrc),
        }));
    }

    /**
     * One provider's payload for one track, replacing whatever it said last
     * time.
     *
     * Per provider rather than merged, which is what the unique constraint on
     * `(track_id, provider)` is for: two sources never overwrite each other,
     * each carries its own TTL, and the merge stays a read-time decision that
     * can be changed without a backfill.
     */
    async saveTrackEnrichment(trackId: string, provider: string, providerRef: string | undefined, data: unknown, ttlMs: number): Promise<void> {
        const row = {
            trackId,
            provider,
            providerRef: providerRef ?? null,
            data: JSON.stringify(data) as unknown as never,
            fetchedAt: sql<never>`now()`,
            expiresAt: sql<never>`now() + make_interval(secs => ${ttlMs / 1000})`,
        };

        await this.db
            .insertInto('deadair.trackEnrichment')
            .values(row)
            .onConflict(oc => oc.columns(['trackId', 'provider']).doUpdateSet(row))
            .execute();
    }

    /**
     * Identity and gap-filling onto `deadair.tracks`.
     *
     * `mbid` is guarded by both a null check and a "nobody else has it" check.
     * The column is unique, and two catalog rows that resolve to the same
     * recording are a real outcome (the same song ingested from two providers,
     * not yet merged), so an unguarded update would turn a duplicate into a
     * constraint violation that fails the whole enrichment pass.
     *
     * @returns the fields that actually changed, for the job's log line.
     */
    async promoteTrack(trackId: string, promotion: TrackPromotion): Promise<string[]> {
        const promoted: string[] = [];

        if (isUuid(promotion.mbid)) {
            const result = await sql`
                update deadair.tracks
                   set mbid = ${promotion.mbid}::uuid
                 where id = ${trackId}::uuid
                   and mbid is null
                   and not exists (select 1 from deadair.tracks other where other.mbid = ${promotion.mbid}::uuid)
            `.execute(this.db);
            if ((result.numAffectedRows ?? 0n) > 0n) promoted.push('mbid');
        }

        if (promotion.year !== undefined) {
            const result = await this.db
                .updateTable('deadair.tracks')
                .set({ year: promotion.year })
                .where('id', '=', trackId)
                .where('year', 'is', null)
                .executeTakeFirst();
            if ((result.numUpdatedRows ?? 0n) > 0n) promoted.push('year');
        }

        if (promotion.genre !== undefined) {
            const result = await this.db
                .updateTable('deadair.tracks')
                .set({ genre: promotion.genre })
                .where('id', '=', trackId)
                .where('genre', 'is', null)
                .executeTakeFirst();
            if ((result.numUpdatedRows ?? 0n) > 0n) promoted.push('genre');
        }

        return promoted;
    }

    /** The artist's MusicBrainz id, under the same unique-column guard as {@link promoteTrack}. */
    async promoteArtistMbid(artistId: string, mbid: string | undefined): Promise<boolean> {
        if (!isUuid(mbid)) return false;

        const result = await sql`
            update deadair.artists
               set mbid = ${mbid}::uuid
             where id = ${artistId}::uuid
               and mbid is null
               and not exists (select 1 from deadair.artists other where other.mbid = ${mbid}::uuid)
        `.execute(this.db);

        return (result.numAffectedRows ?? 0n) > 0n;
    }

    /** Cover art for an album that has none. The same "fill the gap, never overwrite" rule. */
    async promoteAlbumArtwork(albumId: string, imageUrl: string | undefined): Promise<boolean> {
        if (imageUrl === undefined) return false;

        const result = await this.db
            .updateTable('deadair.albums')
            .set({ imageUrl })
            .where('id', '=', albumId)
            .where('imageUrl', 'is', null)
            .executeTakeFirst();

        return (result.numUpdatedRows ?? 0n) > 0n;
    }
}
