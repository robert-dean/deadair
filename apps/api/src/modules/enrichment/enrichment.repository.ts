import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { DataRepository } from '../data/data.repository.js';
import { toJsonb } from '../data/jsonb.js';

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
    /** MusicBrainz RECORDING id, once a pass has promoted one onto `tracks.mbid`. */
    mbid?: string;
}

/**
 * A track the walk picked up, plus the providers it is actually waiting on.
 *
 * The list is per track rather than per pass because provider freshness is per
 * track: one source expiring is not a reason to re-ask the two that answered
 * last week, and at a request per second each that difference is the whole cost
 * of a run.
 */
export interface PendingTrack extends EnrichableTrack {
    /** Providers that could match this track and have no live row for it. Never empty. */
    outstanding: string[];
}

/** A canonical artist, in the shape the enrichment fan-out needs to ask about them. */
export interface EnrichableArtist {
    id: string;
    name: string;
    /** MusicBrainz artist id, once the track pass has promoted one. */
    mbid?: string;
}

/**
 * An artist the walk picked up: who it is waiting on, and what each of those
 * providers called this artist last time.
 *
 * `refs` is read off rows that may well have expired, which is the point. An
 * expired payload is stale; the id it was fetched under is not, and handing it
 * back turns a re-ask into a lookup instead of another search.
 */
export interface PendingArtist extends EnrichableArtist {
    outstanding: string[];
    /** Provider id to the id that provider last fetched this artist under. */
    refs: Record<string, string>;
}

/** A canonical album, in the shape the enrichment fan-out needs to ask about it. */
export interface EnrichableAlbum {
    id: string;
    name: string;
    /** The album's artist. A title alone does not identify a record. */
    artistName: string;
    /** MusicBrainz release-group id, once something has promoted one. */
    mbid?: string;
}

/** {@link PendingArtist} for a record. */
export interface PendingAlbum extends EnrichableAlbum {
    outstanding: string[];
    refs: Record<string, string>;
}

/** What an album's merged enrichment is allowed to write onto `deadair.albums`. */
export interface AlbumPromotion {
    /** MusicBrainz release-group id. Written once and never revised. */
    mbid?: string;
    year?: number;
    imageUrl?: string;
}

/**
 * One stored payload, as the read side hands it back.
 *
 * `data` is deliberately `unknown`. It is jsonb, so what comes out is whatever
 * went in, and the only thing that has ever validated it is the sanitizer the
 * write path ran — which the read path runs again rather than trusting.
 */
export interface StoredProviderPayload {
    provider: string;
    providerRef?: string;
    data: unknown;
    fetchedAt: DateTime;
    expiresAt?: DateTime;
}

/** One provider's payload, as the fact read hands it over: everything else about the row is noise. */
export interface FactPayload {
    provider: string;
    data: unknown;
}

/**
 * Everything stored that could hold a fact about one track, kept at the level it was stored at.
 *
 * Three levels rather than one merged list, because they are not equally interesting: what is known
 * about the recording beats what is known about the record it came on, which beats what is known
 * about whoever made it. Collapsing them here would throw that ordering away before the caller
 * could use it.
 */
export interface TrackFactPayloads {
    trackId: string;
    track: FactPayload[];
    album: FactPayload[];
    artist: FactPayload[];
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

/** One row of a canonical entity left-joined to its enrichment, before the nulls are read. */
interface JoinedEnrichmentRow {
    provider: string | null;
    providerRef: string | null;
    data: unknown;
    fetchedAt: DateTime | null;
    expiresAt: DateTime | null;
}

/**
 * The left join's rows as payloads: no rows at all is `undefined` (no such
 * entity), and rows that carry no provider are the join's own null row for an
 * entity nothing has stored anything about yet.
 */
function storedPayloads(rows: JoinedEnrichmentRow[]): StoredProviderPayload[] | undefined {
    if (rows.length === 0) return undefined;

    const payloads: StoredProviderPayload[] = [];
    for (const row of rows) {
        if (row.provider == null || row.fetchedAt == null) continue;
        payloads.push({
            provider: row.provider,
            providerRef: nullable(row.providerRef),
            data: row.data,
            fetchedAt: row.fetchedAt,
            expiresAt: nullable(row.expiresAt),
        });
    }

    return payloads;
}

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
     * Tracks that have not heard from every enrichment provider that could
     * answer about them, each carrying the list of providers it is waiting on.
     *
     * Raw SQL because the shape is a set difference against a list of
     * providers, which the query builder expresses far less legibly than it
     * reads here. "Lately" is per provider: adding a second enrichment plugin
     * makes every track eligible again for that plugin alone, which is what
     * lets a new source backfill without a migration or a manual sweep.
     *
     * `isrcOnly` is what stops that being a trap. A plugin that can only match
     * on ISRC is never asked about a track that has none, so it never writes a
     * row for one, so a bar that counted it would be a bar that track could
     * never clear — leaving it outstanding forever and re-costing every *other*
     * provider on every pass. Such a provider is dropped from the bar for the
     * tracks it could not have answered about, rather than being counted as
     * owing an answer it was never asked for.
     *
     * The ISRC comes off whichever binding carries one. It is the strongest key
     * an enrichment plugin can match on, and it is a property of the recording
     * rather than of the provider, so any binding's copy will do.
     *
     * Clustered by album, then oldest first, so a backlog still drains in the
     * order it arrived rather than starving whatever sorts last. The clustering
     * is what makes a batch worth asking in bulk: a source that can identify a
     * whole record in one request only gets to do so if the record's tracks
     * arrive together, and interleaving them by creation date would scatter a
     * twelve track album across five passes. Tracks with no album sort last,
     * where they cost a batch-capable source nothing.
     *
     * `priority` is what the station is about to PLAY, nearest slot first, and it
     * leads all of that (`LineupPriorityReader`). Arrival order is the right
     * answer to "what does this station still know nothing about" and the wrong
     * one to "what is it about to talk over", and the two disagree in exactly the
     * expensive case: a record discovered at a provider mid-refill is the newest
     * row there is, so it sorts last, and its break is written within minutes.
     *
     * **It costs the album clustering for those rows, deliberately.** A handful of
     * lineup members at the head of a batch of seventy-five scatters those few and
     * leaves the rest clustered as before. The bill is a couple of extra upstream
     * requests; the alternative is a record airing with nothing to say about it.
     *
     * It cannot cost anything else, because it only ORDERS work this query was
     * already going to return: a track that has heard from every provider fails
     * the `pending.providers` test above and is not here to be promoted. An empty
     * array — an off-air station, the ordinary case — sorts exactly as it always did.
     */
    async listTracksNeedingEnrichment(
        providers: string[],
        isrcOnly: string[],
        limit: number,
        priority: readonly string[] = [],
    ): Promise<PendingTrack[]> {
        if (providers.length === 0) return [];

        // Keys are camelCase even here: `CamelCasePlugin` is in
        // `KyselyDefaultPlugins` and rewrites result keys for raw SQL too, so
        // `artist_name` never arrives under the name the query gave it.
        const rows = await sql<{
            id: string;
            title: string;
            artistId: string;
            artistName: string;
            albumId: string | null;
            albumName: string | null;
            durationMs: number | null;
            year: number | null;
            isrc: string | null;
            mbid: string | null;
            outstanding: string[];
        }>`
            select t.id,
                   t.title,
                   t.artist_id,
                   ar.name as artist_name,
                   t.album_id,
                   al.name as album_name,
                   t.duration_ms,
                   t.year,
                   src.isrc,
                   t.mbid,
                   pending.providers as outstanding
              from deadair.tracks t
              join deadair.artists ar on ar.id = t.artist_id
              left join deadair.albums al on al.id = t.album_id
              left join lateral (select ts.isrc
                                   from deadair.track_sources ts
                                  where ts.track_id = t.id and ts.isrc is not null
                                  order by ts.created_at asc
                                  limit 1) src on true
              cross join lateral (
                  select array(
                      select candidate.provider
                        from unnest(${providers}::text[]) as candidate(provider)
                       where (src.isrc is not null or candidate.provider <> all(${isrcOnly}::text[]))
                         and not exists (select 1
                                           from deadair.track_enrichment te
                                          where te.track_id = t.id
                                            and te.provider = candidate.provider
                                            and (te.expires_at is null or te.expires_at > now()))
                  ) as providers
              ) pending
             where t.merged_into_id is null
               and cardinality(pending.providers) > 0
             -- array_position rather than a boolean, so the running order's own sequence survives
             -- into the batch: the record two boundaries away is asked about before the one at the
             -- end of the hour. Absent from the list is null, which sorts last under the coalesce,
             -- and an empty list makes every row tie there and fall through to the clustering below.
             order by coalesce(array_position(${priority}::uuid[], t.id), 2147483647),
                      t.album_id asc nulls last, t.created_at asc, t.id asc
             limit ${limit}
        `.execute(this.db);

        return rows.rows.map(row => ({
            id: row.id,
            title: row.title,
            artistId: row.artistId,
            artistName: row.artistName,
            albumId: nullable(row.albumId),
            albumName: nullable(row.albumName),
            durationMs: nullable(row.durationMs),
            year: nullable(row.year),
            isrc: nullable(row.isrc),
            mbid: nullable(row.mbid),
            outstanding: row.outstanding,
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
            data: toJsonb(data),
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
     * Remembers that a provider was asked about this track and had nothing.
     *
     * An empty payload under a short TTL, which is what takes the provider out
     * of the track's outstanding list until it lapses. Without it a track
     * nothing can identify has no row for anybody, so it is outstanding on
     * every pass forever and re-costs every source each time.
     *
     * **On conflict the existing payload is left alone and only the expiry
     * moves.** A provider that answered last month and answers nothing today
     * has not retracted what it said: an upstream hiccup, a temporary 404 or a
     * changed id all look like this. Keep believing what we had, and ask again
     * sooner than the full TTL would have.
     */
    async recordTrackEnrichmentMiss(trackId: string, provider: string, ttlMs: number): Promise<void> {
        const expiresAt = sql<never>`now() + make_interval(secs => ${ttlMs / 1000})`;

        await this.db
            .insertInto('deadair.trackEnrichment')
            .values({ trackId, provider, providerRef: null, data: toJsonb({}), fetchedAt: sql<never>`now()`, expiresAt })
            .onConflict(oc => oc.columns(['trackId', 'provider']).doUpdateSet({ expiresAt }))
            .execute();
    }

    /** {@link recordTrackEnrichmentMiss} for an artist. */
    async recordArtistEnrichmentMiss(artistId: string, provider: string, ttlMs: number): Promise<void> {
        const expiresAt = sql<never>`now() + make_interval(secs => ${ttlMs / 1000})`;

        await this.db
            .insertInto('deadair.artistEnrichment')
            .values({ artistId, provider, providerRef: null, data: toJsonb({}), fetchedAt: sql<never>`now()`, expiresAt })
            .onConflict(oc => oc.columns(['artistId', 'provider']).doUpdateSet({ expiresAt }))
            .execute();
    }

    /** {@link recordTrackEnrichmentMiss} for an album. */
    async recordAlbumEnrichmentMiss(albumId: string, provider: string, ttlMs: number): Promise<void> {
        const expiresAt = sql<never>`now() + make_interval(secs => ${ttlMs / 1000})`;

        await this.db
            .insertInto('deadair.albumEnrichment')
            .values({ albumId, provider, providerRef: null, data: toJsonb({}), fetchedAt: sql<never>`now()`, expiresAt })
            .onConflict(oc => oc.columns(['albumId', 'provider']).doUpdateSet({ expiresAt }))
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

    /**
     * Artists that have not heard from every enrichment provider lately.
     *
     * The sibling of {@link listTracksNeedingEnrichment}, and simpler in one
     * way: an artist always has a name, so there is no equivalent of the
     * ISRC-only provider that could not have answered. Every artist provider is
     * applicable to every artist.
     *
     * `priority` is the artists behind the records the station is about to play,
     * on the same argument {@link listTracksNeedingEnrichment} makes at length —
     * and it matters more here than there, because what is known about an artist
     * is where most of what a break can say actually lives, and a record
     * discovered at a provider tends to arrive with an artist the catalog has
     * never enriched either.
     */
    async listArtistsNeedingEnrichment(providers: string[], limit: number, priority: readonly string[] = []): Promise<PendingArtist[]> {
        if (providers.length === 0) return [];

        const rows = await sql<{
            id: string;
            name: string;
            mbid: string | null;
            outstanding: string[];
            refs: Record<string, string | null> | null;
        }>`
            select a.id,
                   a.name,
                   a.mbid,
                   pending.providers as outstanding,
                   refs.map as refs
              from deadair.artists a
              cross join lateral (
                  select array(
                      select candidate.provider
                        from unnest(${providers}::text[]) as candidate(provider)
                       where not exists (select 1
                                           from deadair.artist_enrichment ae
                                          where ae.artist_id = a.id
                                            and ae.provider = candidate.provider
                                            and (ae.expires_at is null or ae.expires_at > now()))
                  ) as providers
              ) pending
              left join lateral (
                  select jsonb_object_agg(ae.provider, ae.provider_ref) as map
                    from deadair.artist_enrichment ae
                   where ae.artist_id = a.id and ae.provider_ref is not null
              ) refs on true
             where a.merged_into_id is null
               and cardinality(pending.providers) > 0
             order by coalesce(array_position(${priority}::uuid[], a.id), 2147483647),
                      a.created_at asc, a.id asc
             limit ${limit}
        `.execute(this.db);

        return rows.rows.map(row => ({
            id: row.id,
            name: row.name,
            mbid: nullable(row.mbid),
            outstanding: row.outstanding,
            refs: Object.fromEntries(Object.entries(row.refs ?? {}).filter((entry): entry is [string, string] => entry[1] !== null)),
        }));
    }

    /** One provider's payload for one artist. The {@link saveTrackEnrichment} rule, per artist. */
    async saveArtistEnrichment(artistId: string, provider: string, providerRef: string | undefined, data: unknown, ttlMs: number): Promise<void> {
        const row = {
            artistId,
            provider,
            providerRef: providerRef ?? null,
            data: toJsonb(data),
            fetchedAt: sql<never>`now()`,
            expiresAt: sql<never>`now() + make_interval(secs => ${ttlMs / 1000})`,
        };

        await this.db
            .insertInto('deadair.artistEnrichment')
            .values(row)
            .onConflict(oc => oc.columns(['artistId', 'provider']).doUpdateSet(row))
            .execute();
    }

    /**
     * Gap-filling onto `deadair.artists`.
     *
     * `name` is deliberately not promotable. The column is not null and always
     * populated by the catalog, so there is no gap for a source to fill, and
     * "MusicBrainz spells it differently" is a merge decision rather than a
     * licence to rewrite the row every provider's bindings point at.
     */
    async promoteArtist(artistId: string, promotion: { imageUrl?: string }): Promise<string[]> {
        if (promotion.imageUrl === undefined) return [];

        const result = await this.db
            .updateTable('deadair.artists')
            .set({ imageUrl: promotion.imageUrl })
            .where('id', '=', artistId)
            .where('imageUrl', 'is', null)
            .executeTakeFirst();

        return (result.numUpdatedRows ?? 0n) > 0n ? ['artist.imageUrl'] : [];
    }

    /**
     * Albums that have not heard from every album provider lately.
     * {@link listArtistsNeedingEnrichment}, one table over, `priority` and all.
     */
    async listAlbumsNeedingEnrichment(providers: string[], limit: number, priority: readonly string[] = []): Promise<PendingAlbum[]> {
        if (providers.length === 0) return [];

        const rows = await sql<{
            id: string;
            name: string;
            artistName: string;
            mbid: string | null;
            outstanding: string[];
            refs: Record<string, string | null> | null;
        }>`
            select al.id,
                   al.name,
                   ar.name as artist_name,
                   al.mbid,
                   pending.providers as outstanding,
                   refs.map as refs
              from deadair.albums al
              join deadair.artists ar on ar.id = al.artist_id
              cross join lateral (
                  select array(
                      select candidate.provider
                        from unnest(${providers}::text[]) as candidate(provider)
                       where not exists (select 1
                                           from deadair.album_enrichment ae
                                          where ae.album_id = al.id
                                            and ae.provider = candidate.provider
                                            and (ae.expires_at is null or ae.expires_at > now()))
                  ) as providers
              ) pending
              left join lateral (
                  select jsonb_object_agg(ae.provider, ae.provider_ref) as map
                    from deadair.album_enrichment ae
                   where ae.album_id = al.id and ae.provider_ref is not null
              ) refs on true
             where al.merged_into_id is null
               and cardinality(pending.providers) > 0
             order by coalesce(array_position(${priority}::uuid[], al.id), 2147483647),
                      al.created_at asc, al.id asc
             limit ${limit}
        `.execute(this.db);

        return rows.rows.map(row => ({
            id: row.id,
            name: row.name,
            artistName: row.artistName,
            mbid: nullable(row.mbid),
            outstanding: row.outstanding,
            refs: Object.fromEntries(Object.entries(row.refs ?? {}).filter((entry): entry is [string, string] => entry[1] !== null)),
        }));
    }

    /** One provider's payload for one album. The {@link saveTrackEnrichment} rule, per album. */
    async saveAlbumEnrichment(albumId: string, provider: string, providerRef: string | undefined, data: unknown, ttlMs: number): Promise<void> {
        const row = {
            albumId,
            provider,
            providerRef: providerRef ?? null,
            data: toJsonb(data),
            fetchedAt: sql<never>`now()`,
            expiresAt: sql<never>`now() + make_interval(secs => ${ttlMs / 1000})`,
        };

        await this.db
            .insertInto('deadair.albumEnrichment')
            .values(row)
            .onConflict(oc => oc.columns(['albumId', 'provider']).doUpdateSet(row))
            .execute();
    }

    /**
     * Gap-filling onto `deadair.albums`, plus the release-group id.
     *
     * `mbid` here is a release-group rather than a release: a record is the
     * work, and the pressing an operator happens to hold a copy of is one of
     * many. Same unique-column guard as {@link promoteTrack}, for the same
     * reason — two catalog albums resolving to one release group is a real
     * outcome, not a constraint violation worth failing a pass over.
     */
    async promoteAlbum(albumId: string, promotion: AlbumPromotion): Promise<string[]> {
        const promoted: string[] = [];

        if (isUuid(promotion.mbid)) {
            const result = await sql`
                update deadair.albums
                   set mbid = ${promotion.mbid}::uuid
                 where id = ${albumId}::uuid
                   and mbid is null
                   and not exists (select 1 from deadair.albums other where other.mbid = ${promotion.mbid}::uuid)
            `.execute(this.db);
            if ((result.numAffectedRows ?? 0n) > 0n) promoted.push('album.mbid');
        }

        if (promotion.year !== undefined) {
            const result = await this.db
                .updateTable('deadair.albums')
                .set({ year: promotion.year })
                .where('id', '=', albumId)
                .where('year', 'is', null)
                .executeTakeFirst();
            if ((result.numUpdatedRows ?? 0n) > 0n) promoted.push('album.year');
        }

        if (promotion.imageUrl !== undefined && (await this.promoteAlbumArtwork(albumId, promotion.imageUrl))) {
            promoted.push('album.imageUrl');
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

    /**
     * Every provider's stored payload for one track, newest fetch first.
     *
     * A left join off `deadair.tracks` rather than a select on the enrichment
     * table alone, so one query answers two different questions. No rows at all
     * means there is no such track (or it was merged away, which reads never
     * return), and the caller owes a 404. Rows with no `provider` mean the track
     * exists and the walk has simply not reached it yet, which is a 200 holding
     * nothing.
     *
     * Miss rows come back like any other. They are payloads that happen to be
     * empty, and telling a caller "asked, nothing found" apart from "never
     * asked" is exactly what they are for.
     */
    async findTrackEnrichment(trackId: string): Promise<StoredProviderPayload[] | undefined> {
        const rows = await this.db
            .selectFrom('deadair.tracks as t')
            .leftJoin('deadair.trackEnrichment as te', 'te.trackId', 't.id')
            .where('t.id', '=', trackId)
            .where('t.mergedIntoId', 'is', null)
            .select(['te.provider', 'te.providerRef', 'te.data', 'te.fetchedAt', 'te.expiresAt'])
            .orderBy('te.fetchedAt', 'desc')
            .execute();

        return storedPayloads(rows);
    }

    /** {@link findTrackEnrichment} for an artist. */
    async findArtistEnrichment(artistId: string): Promise<StoredProviderPayload[] | undefined> {
        const rows = await this.db
            .selectFrom('deadair.artists as a')
            .leftJoin('deadair.artistEnrichment as ae', 'ae.artistId', 'a.id')
            .where('a.id', '=', artistId)
            .where('a.mergedIntoId', 'is', null)
            .select(['ae.provider', 'ae.providerRef', 'ae.data', 'ae.fetchedAt', 'ae.expiresAt'])
            .orderBy('ae.fetchedAt', 'desc')
            .execute();

        return storedPayloads(rows);
    }

    /** {@link findTrackEnrichment} for a record. */
    async findAlbumEnrichment(albumId: string): Promise<StoredProviderPayload[] | undefined> {
        const rows = await this.db
            .selectFrom('deadair.albums as al')
            .leftJoin('deadair.albumEnrichment as ale', 'ale.albumId', 'al.id')
            .where('al.id', '=', albumId)
            .where('al.mergedIntoId', 'is', null)
            .select(['ale.provider', 'ale.providerRef', 'ale.data', 'ale.fetchedAt', 'ale.expiresAt'])
            .orderBy('ale.fetchedAt', 'desc')
            .execute();

        return storedPayloads(rows);
    }

    /**
     * Every payload stored about a handful of tracks, their records and their artists, for the one
     * field a talk break wants out of them.
     *
     * Inner joins throughout, which is the whole difference from {@link findTrackEnrichment} above:
     * that one owes its caller a 404 and so has to tell "no such track" apart from "nothing stored
     * yet", while this one is asked by a writer that treats both as the same thing — nothing to say.
     * A track with no album, an album nothing was fetched for, an artist the walk has not reached:
     * all of them are simply absent from the answer.
     *
     * `provider` and `data` only. A fact about 1985 does not go stale, so the TTL, the fetch time
     * and the provider's own ref are all noise here; the provider comes back because it is what the
     * caller ranks the payloads by.
     */
    async findFactPayloadsForTracks(trackIds: readonly string[]): Promise<TrackFactPayloads[]> {
        if (trackIds.length === 0) return [];
        const ids = [...trackIds];

        const [track, album, artist] = await Promise.all([
            this.db
                .selectFrom('deadair.tracks as t')
                .innerJoin('deadair.trackEnrichment as te', 'te.trackId', 't.id')
                .where('t.id', 'in', ids)
                .where('t.mergedIntoId', 'is', null)
                .select(['t.id as trackId', 'te.provider', 'te.data'])
                .execute(),
            this.db
                .selectFrom('deadair.tracks as t')
                .innerJoin('deadair.albums as al', 'al.id', 't.albumId')
                .innerJoin('deadair.albumEnrichment as ale', 'ale.albumId', 'al.id')
                .where('t.id', 'in', ids)
                .where('t.mergedIntoId', 'is', null)
                .where('al.mergedIntoId', 'is', null)
                .select(['t.id as trackId', 'ale.provider', 'ale.data'])
                .execute(),
            this.db
                .selectFrom('deadair.tracks as t')
                .innerJoin('deadair.artists as a', 'a.id', 't.artistId')
                .innerJoin('deadair.artistEnrichment as ae', 'ae.artistId', 'a.id')
                .where('t.id', 'in', ids)
                .where('t.mergedIntoId', 'is', null)
                .where('a.mergedIntoId', 'is', null)
                .select(['t.id as trackId', 'ae.provider', 'ae.data'])
                .execute(),
        ]);

        const byTrack = new Map<string, TrackFactPayloads>();
        const at = (trackId: string): TrackFactPayloads => {
            const existing = byTrack.get(trackId);
            if (existing) return existing;

            const fresh: TrackFactPayloads = { trackId, track: [], album: [], artist: [] };
            byTrack.set(trackId, fresh);
            return fresh;
        };

        for (const row of track) at(row.trackId).track.push({ provider: row.provider, data: row.data });
        for (const row of album) at(row.trackId).album.push({ provider: row.provider, data: row.data });
        for (const row of artist) at(row.trackId).artist.push({ provider: row.provider, data: row.data });

        return [...byTrack.values()];
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
