import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '#modules/data/data.repository.js';

export interface GenreCandidate {
    artistId: string;
    artist: string;
    titles: string[];
}

/** How many of a band's record titles go into its prompt. */
const TITLES_PER_ARTIST = 3;

/**
 * The station's own main genre for a band its enrichment gives none: `deadair.artist_genre_judgements`.
 *
 * Read by `CandidatesRepository.mainGenresFor` as the fallback beneath a provider's genre, and written by
 * `ArtistGenreService`.
 */
@Injectable()
export class ArtistGenreRepository extends DataRepository {
    /**
     * Bands with no genre from any provider and no judgement under these instructions that is not
     * waiting out a failure. The bands of `priority` records first (what the station is about to play),
     * then the most aired.
     */
    async listArtistsNeedingGenre(version: string, limit: number, priority: readonly string[] = []): Promise<GenreCandidate[]> {
        if (limit <= 0) return [];
        const rows = await sql<{ artistId: string; artist: string; titles: string[] | null }>`
            select ar.id as artist_id,
                   ar.name as artist,
                   array(select t.title from deadair.tracks t where t.artist_id = ar.id and t.merged_into_id is null order by t.title limit ${TITLES_PER_ARTIST}) as titles
              from deadair.artists ar
              left join deadair.artist_genre_judgements j on j.artist_id = ar.id
             where exists (select 1 from deadair.tracks t where t.artist_id = ar.id and t.merged_into_id is null)
               and not exists (
                   select 1 from deadair.artist_enrichment e
                    where e.artist_id = ar.id
                      and jsonb_typeof(e.data -> 'genres') = 'array'
                      and coalesce(e.data -> 'genres' ->> 0, '') <> ''
               )
               and (j.artist_id is null or ((j.version <> ${version} or j.judged_at is null) and (j.retry_after is null or j.retry_after <= now())))
             order by exists (select 1 from deadair.tracks t where t.artist_id = ar.id and t.id = any(${sql.val([...priority])}::uuid[])) desc,
                      (select count(*) from deadair.play_history ph join deadair.tracks t on t.id = ph.track_id where t.artist_id = ar.id) desc,
                      ar.name
             limit ${Math.floor(limit)}
        `.execute(this.db);
        return rows.rows.map(row => ({ artistId: row.artistId, artist: row.artist, titles: row.titles ?? [] }));
    }

    /** Keep a band's genre, or that the model could not place it (`undefined`), under these instructions. */
    async save(artistId: string, genre: string | undefined, version: string): Promise<void> {
        await this.db
            .insertInto('deadair.artistGenreJudgements')
            .values({ artistId, genre: genre ?? null, version, judgedAt: sql`now()`, failures: 0, lastError: null, retryAfter: null })
            .onConflict(conflict =>
                conflict.column('artistId').doUpdateSet({
                    genre: genre ?? null,
                    version,
                    judgedAt: sql`now()`,
                    failures: 0,
                    lastError: null,
                    retryAfter: null,
                    updatedAt: sql`now()`,
                }),
            )
            .execute();
    }

    /** A judgement that failed, retried after a backoff that doubles from `baseRetryMs` up to `maxRetryMs`. */
    async recordFailure(artistId: string, error: string, version: string, baseRetryMs: number, maxRetryMs: number): Promise<void> {
        await sql`
            insert into deadair.artist_genre_judgements as j (artist_id, version, failures, last_error, retry_after)
            values (${artistId}, ${version}, 1, ${error}, now() + make_interval(secs => ${baseRetryMs / 1000}))
            on conflict (artist_id) do update set
                failures = j.failures + 1,
                last_error = excluded.last_error,
                retry_after = now() + make_interval(secs => least(${maxRetryMs / 1000}, ${baseRetryMs / 1000} * power(2, j.failures))),
                updated_at = now()
        `.execute(this.db);
    }
}
