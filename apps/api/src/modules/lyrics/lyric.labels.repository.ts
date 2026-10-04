import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '#modules/data/data.repository.js';
import { failureBackoff } from '#modules/data/failure.backoff.js';
import { toJsonb } from '#modules/data/jsonb.js';
import { LYRIC_MOODS, type MoodDistribution } from './lyric.moods.js';

/** A record the mood walk will judge, with what it has to judge it by. */
export interface MoodCandidate {
    trackId: string;
    title: string;
    artist: string;
    album?: string;
    year?: number;
    /** The lyric's words, from whichever source holds them. For the prompt, and nowhere else. */
    lyric?: string;
    instrumental: boolean;
}

const nullable = <T>(value: T | null | undefined): T | undefined => (value == null ? undefined : value);

/** A stored distribution, or `undefined` for anything that is not one (a hand-edited row, a future shape). */
function readDistribution(raw: unknown): MoodDistribution | undefined {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const values = LYRIC_MOODS.map(mood => (raw as Record<string, unknown>)[mood]);
    if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) return undefined;
    return Object.fromEntries(LYRIC_MOODS.map((mood, index) => [mood, values[index] as number])) as MoodDistribution;
}

/**
 * `deadair.track_lyric_labels`: what the station derived about a record. See the migration for why the
 * labels are the durable thing and the lyric is not.
 *
 * **"Labelled" means a row with a distribution in it, and nothing else does.** A row that was judged
 * and could not be placed, or has only ever failed, holds no moods, and every count, read and lean
 * asks for a distribution that is there (`hasMoods` in the catalog's counts, {@link moodsForTracks} here)
 * so none of them can count one by accident.
 */
@Injectable()
export class LyricLabelsRepository extends DataRepository {
    /**
     * Records with no judgement under the current instructions, most worth judging first.
     *
     * A record qualifies when it has words from some lyrics source, or, with `searchable`, when it
     * has none at all, since then the web is what it is judged by. Without search a record with no
     * words is left alone rather than marked: it qualifies the day an operator configures a search.
     * A failure waits out its backoff. The order is the lyrics walk's (`listTracksNeedingLyrics`), by
     * value and never by id.
     */
    async listTracksNeedingMoods(version: string, limit: number, searchable: boolean, priority: readonly string[] = []): Promise<MoodCandidate[]> {
        return await this.listNeeding('moods', version, limit, searchable, priority);
    }

    /** {@link listTracksNeedingMoods} for the subject, on its own version and its own backoff. */
    async listTracksNeedingSubjects(version: string, limit: number, searchable: boolean, priority: readonly string[] = []): Promise<MoodCandidate[]> {
        return await this.listNeeding('subject', version, limit, searchable, priority);
    }

    private async listNeeding(
        label: 'moods' | 'subject',
        version: string,
        limit: number,
        searchable: boolean,
        priority: readonly string[],
    ): Promise<MoodCandidate[]> {
        const versionColumn = sql.ref(`l.${label}_version`);
        const retryColumn = sql.ref(`l.${label}_retry_at`);
        const rows = await sql<{
            trackId: string;
            title: string;
            artist: string;
            album: string | null;
            year: number | null;
            lyric: string | null;
            instrumental: boolean | null;
        }>`
            with aired as (
                select ph.track_id, count(*) as plays
                  from deadair.play_history ph
                 where ph.track_id is not null
                 group by ph.track_id
            )
            select t.id as track_id,
                   t.title,
                   ar.name as artist,
                   al.name as album,
                   t.year,
                   words.lyric,
                   (select bool_or(tl.instrumental) from deadair.track_lyrics tl where tl.track_id = t.id) as instrumental
              from deadair.tracks t
              join deadair.artists ar on ar.id = t.artist_id
              left join deadair.albums al on al.id = t.album_id
              left join aired on aired.track_id = t.id
              left join deadair.track_lyric_labels l on l.track_id = t.id
              left join lateral (
                  select coalesce(tl.plain,
                                  (select string_agg(line->>'text', E'\\n') from jsonb_array_elements(tl.synced) as line)) as lyric
                    from deadair.track_lyrics tl
                   where tl.track_id = t.id and (tl.plain is not null or tl.synced is not null)
                   order by (tl.plain is not null) desc, tl.fetched_at asc
                   limit 1
              ) words on true
             where t.merged_into_id is null
               and (l.track_id is null or ${versionColumn} is distinct from ${version})
               and (${retryColumn} is null or ${retryColumn} <= now())
               and (words.lyric is not null or ${searchable})
             order by coalesce(array_position(${priority}::uuid[], t.id), 2147483647),
                      t.rating desc,
                      coalesce(aired.plays, 0) desc,
                      random()
             limit ${limit}
        `.execute(this.db);

        return rows.rows.map(row => ({
            trackId: row.trackId,
            title: row.title,
            artist: row.artist,
            album: nullable(row.album),
            year: nullable(row.year),
            lyric: nullable(row.lyric),
            instrumental: row.instrumental === true,
        }));
    }

    /** A judgement: the distribution, or `undefined` for "could not tell", under these instructions. */
    async saveMoods(trackId: string, moods: MoodDistribution | undefined, version: string): Promise<void> {
        const row = {
            trackId,
            moods: moods === undefined ? null : toJsonb(moods),
            moodsVersion: version,
            moodsAt: sql<never>`now()`,
            moodsAttempts: 0,
            moodsRetryAt: null,
            moodsError: null,
        };

        await this.db
            .insertInto('deadair.trackLyricLabels')
            .values(row)
            .onConflict(oc => oc.column('trackId').doUpdateSet(row))
            .execute();
    }

    /** The model could not be asked, or answered nothing readable. Whatever was judged before is kept. */
    async recordMoodFailure(trackId: string, error: string, baseRetryMs: number, maxRetryMs: number): Promise<void> {
        const retry = failureBackoff('deadair.track_lyric_labels.moods_attempts', baseRetryMs, maxRetryMs);

        await this.db
            .insertInto('deadair.trackLyricLabels')
            .values({ trackId, moodsAttempts: 1, moodsRetryAt: retry.first, moodsError: error.slice(0, 500) })
            .onConflict(oc =>
                oc.column('trackId').doUpdateSet(eb => ({
                    moodsAttempts: eb('deadair.trackLyricLabels.moodsAttempts', '+', 1),
                    moodsRetryAt: retry.again,
                    moodsError: error.slice(0, 500),
                })),
            )
            .execute();
    }

    /**
     * The distributions held for these records. A record with none is absent, which every reader treats
     * as "nothing to lean on". Any version counts: a judgement under older instructions is still a
     * judgement until the walk replaces it.
     */
    async moodsForTracks(trackIds: readonly string[]): Promise<Map<string, MoodDistribution>> {
        if (trackIds.length === 0) return new Map();

        const rows = await this.db
            .selectFrom('deadair.trackLyricLabels')
            .select(['trackId', 'moods'])
            .where('trackId', 'in', [...trackIds])
            .where('moods', 'is not', null)
            .execute();

        return new Map(
            rows.flatMap(row => {
                const moods = readDistribution(row.moods);
                return moods === undefined ? [] : [[row.trackId, moods] as const];
            }),
        );
    }

    /** A subject, or `undefined` for "could not tell", under these instructions. Already checked against the lyric. */
    async saveSubject(trackId: string, subject: string | undefined, version: string): Promise<void> {
        const row = {
            trackId,
            subject: subject ?? null,
            subjectVersion: version,
            subjectAt: sql<never>`now()`,
            subjectAttempts: 0,
            subjectRetryAt: null,
            subjectError: null,
        };

        await this.db
            .insertInto('deadair.trackLyricLabels')
            .values(row)
            .onConflict(oc => oc.column('trackId').doUpdateSet(row))
            .execute();
    }

    /** A subject that could not be had, or was refused for quoting the lyric. Whatever was stored before is kept. */
    async recordSubjectFailure(trackId: string, error: string, baseRetryMs: number, maxRetryMs: number): Promise<void> {
        const retry = failureBackoff('deadair.track_lyric_labels.subject_attempts', baseRetryMs, maxRetryMs);

        await this.db
            .insertInto('deadair.trackLyricLabels')
            .values({ trackId, subjectAttempts: 1, subjectRetryAt: retry.first, subjectError: error.slice(0, 500) })
            .onConflict(oc =>
                oc.column('trackId').doUpdateSet(eb => ({
                    subjectAttempts: eb('deadair.trackLyricLabels.subjectAttempts', '+', 1),
                    subjectRetryAt: retry.again,
                    subjectError: error.slice(0, 500),
                })),
            )
            .execute();
    }

    /** What each of these records is about, where a subject is stored. Any version counts, as for the moods. */
    async subjectsForTracks(trackIds: readonly string[]): Promise<Map<string, string>> {
        if (trackIds.length === 0) return new Map();

        const rows = await this.db
            .selectFrom('deadair.trackLyricLabels')
            .select(['trackId', 'subject'])
            .where('trackId', 'in', [...trackIds])
            .where('subject', 'is not', null)
            .execute();

        return new Map(rows.flatMap(row => (row.subject == null ? [] : [[row.trackId, row.subject] as const])));
    }
}
