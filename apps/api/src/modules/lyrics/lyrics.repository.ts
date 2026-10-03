import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { LyricLine } from '@deadair/plugin-sdk';
import { DataRepository } from '#modules/data/data.repository.js';
import { failureBackoff } from '#modules/data/failure.backoff.js';
import { toJsonb } from '#modules/data/jsonb.js';
import type { EnrichableTrack } from '#modules/enrichment/enrichment.repository.js';

/** What an answer clears. The same rule, and the same reason, as the enrichment tables' `ANSWERED`. */
const ANSWERED = { attempts: 0, lastError: null } as const;

/** A track the lyrics walk picked up, plus the providers it is still waiting on. Never empty. */
export interface PendingLyricsTrack extends EnrichableTrack {
    outstanding: string[];
}

/** One provider's words for one record, as stored. */
export interface StoredWords {
    plain?: string;
    synced?: LyricLine[];
    language?: string;
    providerRef?: string;
}

/** One source's timing evidence for one record: the timed lines and the instrumental flag, and nothing else. */
export interface StoredTiming {
    trackId: string;
    provider: string;
    instrumental: boolean;
    synced?: LyricLine[];
}

/** An operator's correction: the record is instrumental, or its singing starts at `onsetMs` (and stops at `endMs`). */
export type VocalOverride = { instrumental: true } | { instrumental: false; onsetMs: number; endMs?: number };

const nullable = <T>(value: T | null | undefined): T | undefined => (value == null ? undefined : value);

/**
 * `deadair.track_lyrics`: the words of a record, which the station reads and never says.
 *
 * **Nothing here returns lyric text to a caller that could put it on the wire.** The walk writes it,
 * and the only reads of the text itself are the derivations, which reach it through methods named
 * for that so every caller is greppable. A count, a flag and a timing are what everything else gets.
 */
@Injectable()
export class LyricsRepository extends DataRepository {
    /**
     * Tracks that have not heard from every lyrics provider, each with the providers it is waiting on.
     *
     * The set difference is `listTracksNeedingEnrichment`'s, with one difference that comes from the
     * table: a row holding words or an instrumental has no `expires_at`, so a found lyric is never
     * outstanding again. Only a miss and a failure carry a date.
     *
     * **The ORDER is by value, never by id.** A walk over a library bigger than one run reaches
     * whatever sorts first, and an order with nothing to do with the station (an id, an arrival date)
     * hands the same tail to every run and starves it for good. So, in turn:
     *
     * - what the station is about to play (`priority`, nearest slot first), because a talk-up is
     *   written within minutes of a record being committed;
     * - liked records before neutral ones, and disliked ones last, since a dislike may never air;
     * - records that air often, counted from the history in one grouped scan rather than once per row;
     * - and `random()` for everything still tied, so nothing is starved by the order it sorts in.
     */
    async listTracksNeedingLyrics(providers: string[], limit: number, priority: readonly string[] = []): Promise<PendingLyricsTrack[]> {
        if (providers.length === 0) return [];

        // camelCase keys even for raw SQL: `CamelCasePlugin` rewrites result keys.
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
            with aired as (
                select ph.track_id, count(*) as plays
                  from deadair.play_history ph
                 where ph.track_id is not null
                 group by ph.track_id
            )
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
              left join aired on aired.track_id = t.id
              left join lateral (select ts.isrc
                                   from deadair.track_sources ts
                                  where ts.track_id = t.id and ts.isrc is not null
                                  order by ts.created_at asc
                                  limit 1) src on true
              cross join lateral (
                  select array(
                      select candidate.provider
                        from unnest(${providers}::text[]) as candidate(provider)
                       where not exists (select 1
                                           from deadair.track_lyrics tl
                                          where tl.track_id = t.id
                                            and tl.provider = candidate.provider
                                            and (tl.expires_at is null or tl.expires_at > now()))
                  ) as providers
              ) pending
             where t.merged_into_id is null
               and cardinality(pending.providers) > 0
             order by coalesce(array_position(${priority}::uuid[], t.id), 2147483647),
                      t.rating desc,
                      coalesce(aired.plays, 0) desc,
                      random()
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
     * The words of each of these records, from whichever source holds them, plain preferred.
     *
     * For a DERIVATION or a GUARD and nothing else: the break writer's guard compares a script against
     * these lines, and nothing that reads them may put them on the wire or in a prompt.
     */
    async textForDerivation(trackIds: readonly string[]): Promise<Map<string, string>> {
        if (trackIds.length === 0) return new Map();

        const rows = await this.db
            .selectFrom('deadair.trackLyrics')
            .select(['trackId', 'plain', 'synced'])
            .where('trackId', 'in', [...trackIds])
            .where(eb => eb.or([eb('plain', 'is not', null), eb('synced', 'is not', null)]))
            .orderBy('fetchedAt', 'asc')
            .execute();

        const words = new Map<string, string>();
        for (const row of rows) {
            const text = row.plain ?? ((row.synced ?? []) as unknown as LyricLine[]).map(line => line.text).join('\n');
            // Plain beats synced, and the first source stored keeps its place.
            if (row.plain != null || !words.has(row.trackId)) words.set(row.trackId, text);
        }
        return words;
    }

    /**
     * The timing evidence for a set of records: every row that has timed lines or says instrumental.
     *
     * The timed lines carry their text because the only way to tell a sung line from the blank one
     * that marks where singing stops is to look. The caller is `VocalMarkersReader`, which turns them
     * into markers and hands on nothing else.
     */
    async timingsForTracks(trackIds: readonly string[]): Promise<StoredTiming[]> {
        if (trackIds.length === 0) return [];

        const rows = await this.db
            .selectFrom('deadair.trackLyrics')
            .select(['trackId', 'provider', 'instrumental', 'synced'])
            .where('trackId', 'in', [...trackIds])
            .where(eb => eb.or([eb('synced', 'is not', null), eb('instrumental', '=', true)]))
            .execute();

        return rows.map(row => ({
            trackId: row.trackId,
            provider: row.provider,
            instrumental: row.instrumental,
            ...(row.synced == null ? {} : { synced: row.synced as unknown as LyricLine[] }),
        }));
    }

    /** An operator's correction of where the singing is on each of these records, by track id. */
    async overridesForTracks(trackIds: readonly string[]): Promise<Map<string, VocalOverride>> {
        if (trackIds.length === 0) return new Map();

        const rows = await this.db
            .selectFrom('deadair.trackVocalOverrides')
            .select(['trackId', 'instrumental', 'onsetMs', 'endMs'])
            .where('trackId', 'in', [...trackIds])
            .execute();

        return new Map(
            rows.map(row => [
                row.trackId,
                row.instrumental
                    ? { instrumental: true }
                    : { instrumental: false, onsetMs: row.onsetMs ?? 0, ...(row.endMs == null ? {} : { endMs: row.endMs }) },
            ]),
        );
    }

    /** Sets an operator's correction, replacing any before it. */
    async saveOverride(trackId: string, override: VocalOverride): Promise<void> {
        const row = {
            trackId,
            instrumental: override.instrumental,
            onsetMs: override.instrumental ? null : override.onsetMs,
            endMs: override.instrumental ? null : (override.endMs ?? null),
        };

        await this.db
            .insertInto('deadair.trackVocalOverrides')
            .values(row)
            .onConflict(oc => oc.column('trackId').doUpdateSet(row))
            .execute();
    }

    /** Drops an operator's correction. Answers how many rows went, which is zero or one. */
    async clearOverride(trackId: string): Promise<number> {
        const result = await this.db.deleteFrom('deadair.trackVocalOverrides').where('trackId', '=', trackId).executeTakeFirst();
        return Number(result.numDeletedRows);
    }

    /**
     * One provider's words for one record, replacing whatever it said before.
     *
     * No expiry: a lyric, once matched, does not go stale. What is re-run over it is the derivation.
     */
    async saveWords(trackId: string, provider: string, words: StoredWords): Promise<void> {
        const row = {
            trackId,
            provider,
            providerRef: words.providerRef ?? null,
            plain: words.plain ?? null,
            synced: words.synced ? toJsonb(words.synced) : null,
            instrumental: false,
            language: words.language ?? null,
            fetchedAt: sql<never>`now()`,
            expiresAt: null,
            ...ANSWERED,
        };

        await this.db
            .insertInto('deadair.trackLyrics')
            .values(row)
            .onConflict(oc => oc.columns(['trackId', 'provider']).doUpdateSet(row))
            .execute();
    }

    /** The provider says nobody sings on this record. An answer, so it carries no expiry either. */
    async saveInstrumental(trackId: string, provider: string, providerRef: string | undefined): Promise<void> {
        const row = {
            trackId,
            provider,
            providerRef: providerRef ?? null,
            plain: null,
            synced: null,
            instrumental: true,
            language: null,
            fetchedAt: sql<never>`now()`,
            expiresAt: null,
            ...ANSWERED,
        };

        await this.db
            .insertInto('deadair.trackLyrics')
            .values(row)
            .onConflict(oc => oc.columns(['trackId', 'provider']).doUpdateSet(row))
            .execute();
    }

    /**
     * The provider was asked and had nothing it was sure of.
     *
     * A short-lived row, which is what takes the provider out of the record's outstanding list until
     * it lapses: without it a record nothing can match is asked about on every pass forever. On
     * conflict only the clock moves, on `recordTrackEnrichmentMiss`'s rule.
     */
    async recordMiss(trackId: string, provider: string, ttlMs: number): Promise<void> {
        const expiresAt = sql<never>`now() + make_interval(secs => ${ttlMs / 1000})`;

        await this.db
            .insertInto('deadair.trackLyrics')
            .values({ trackId, provider, fetchedAt: sql<never>`now()`, expiresAt, ...ANSWERED })
            .onConflict(oc => oc.columns(['trackId', 'provider']).doUpdateSet({ expiresAt, ...ANSWERED }))
            .execute();
    }

    /**
     * The provider could not be ASKED, which is the opposite fact from one that had nothing.
     *
     * Backed off by `failureBackoff`, for `recordTrackEnrichmentFailure`'s reason: a failure that
     * wrote nothing would be outstanding again on the very next pass, at a request each, forever.
     * Whatever the row held is left alone.
     */
    async recordFailure(trackId: string, provider: string, error: string, baseRetryMs: number, maxRetryMs: number): Promise<void> {
        const retry = failureBackoff('deadair.track_lyrics.attempts', baseRetryMs, maxRetryMs);

        await this.db
            .insertInto('deadair.trackLyrics')
            .values({ trackId, provider, fetchedAt: sql<never>`now()`, expiresAt: retry.first, attempts: 1, lastError: error.slice(0, 500) })
            .onConflict(oc =>
                oc.columns(['trackId', 'provider']).doUpdateSet(eb => ({
                    attempts: eb('deadair.trackLyrics.attempts', '+', 1),
                    lastError: error.slice(0, 500),
                    expiresAt: retry.again,
                })),
            )
            .execute();
    }
}
