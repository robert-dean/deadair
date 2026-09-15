import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { PodcastEpisodeListing, PodcastEpisodeRecord } from './podcast.episode.js';

/**
 * The largest size claim the table keeps. `audio_bytes` is an `integer`, as `track_audio.byte_size`
 * is, and a publisher claiming more than that for one episode is claiming something that is not an
 * episode; the claim is dropped rather than refused, because the rest of the listing is still true.
 */
const MAX_CLAIMED_BYTES = 2_147_483_647;

/**
 * The episodes this station knows about, and what it has done with each.
 *
 * ## A refresh describes, and never decides
 *
 * {@link record} is an upsert keyed on the show and the plugin's own episode id, and what it may
 * write is only what a FEED says: titles, summary, the audio's address, the publisher's length. The
 * columns that say what the STATION did — the segment holding its copy, the fetch bookkeeping, the
 * aired mark — are never in its update set, so the same episode listed every half hour for a month
 * is one row whose history survives every re-read. {@link PodcastEpisodeListing} has no field for
 * any of them, which is what keeps it that way.
 *
 * ## Timestamps cross as epoch milliseconds
 *
 * Through SQL on the way in and read back whichever shape the driver hands over, as
 * `production.repository.ts` does and for its reason: the generated types say `DateTime` and the
 * driver does not always agree, and neither half of the app should have to care.
 */
@Injectable()
export class PodcastEpisodeRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * Write what a feed listed, and answer how many of the episodes were new to the station.
     *
     * New is counted from the database's own answer rather than a read beforehand, so two refreshes
     * racing each other cannot both call one episode new.
     */
    async record(listings: readonly PodcastEpisodeListing[]): Promise<number> {
        if (listings.length === 0) return 0;

        const rows = listings.map(listing => ({ stationKey: this.station.stationKey, ...describedBy(listing) }));

        const written = await this.db
            .insertInto('deadair.podcastEpisodes')
            .values(rows)
            .onConflict(conflict =>
                conflict.columns(['stationKey', 'showId', 'episodeId']).doUpdateSet(update => ({
                    showTitle: update.ref('excluded.showTitle'),
                    title: update.ref('excluded.title'),
                    summary: update.ref('excluded.summary'),
                    url: update.ref('excluded.url'),
                    publishedAt: update.ref('excluded.publishedAt'),
                    durationMs: update.ref('excluded.durationMs'),
                    audioUrl: update.ref('excluded.audioUrl'),
                    audioMime: update.ref('excluded.audioMime'),
                    audioBytes: update.ref('excluded.audioBytes'),
                    artworkUrl: update.ref('excluded.artworkUrl'),
                    explicit: update.ref('excluded.explicit'),
                    seenAt: sql<never>`now()`,
                })),
            )
            // `xmax` is zero on a row this statement inserted and the updating transaction's id on
            // one it updated, which is the one reliable way to tell the two apart in a single upsert.
            .returning(sql<boolean>`(xmax = 0)`.as('inserted'))
            .execute();

        return written.filter(row => row.inserted).length;
    }

    /**
     * Episodes, newest first: one show's, or every show's.
     *
     * Undated episodes after the dated ones, and the id as the last tiebreaker, for
     * `TopicRepository.list`'s reason: a list that reshuffles between reads is a page nobody can use.
     */
    async list(options: { showId?: string; limit: number }): Promise<PodcastEpisodeRecord[]> {
        let query = this.db.selectFrom('deadair.podcastEpisodes').selectAll().where('stationKey', '=', this.station.stationKey);
        if (options.showId !== undefined) query = query.where('showId', '=', options.showId);

        const rows = await query
            .orderBy(sql`published_at desc nulls last`)
            .orderBy('id', 'asc')
            .limit(options.limit)
            .execute();

        return rows.map(toRecord);
    }

    /** One episode of this station's, or `undefined` for an id that is not one. */
    async get(id: string): Promise<PodcastEpisodeRecord | undefined> {
        const row = await this.db
            .selectFrom('deadair.podcastEpisodes')
            .selectAll()
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return row === undefined ? undefined : toRecord(row);
    }

    /**
     * Claim the right to ask for this episode's audio, or learn that somebody already has.
     *
     * The idempotence of every fetch lives here, in one conditional UPDATE: it moves
     * `fetch_requested_at` forward only for an episode the station does not hold yet and has not asked
     * for within `retryAfterMs`. So a scheduler running every few seconds, an operator pressing the
     * button twice, and a restart in the middle of a fetch all come down to one row saying whether a
     * request is already out, rather than to memory that a restart would lose. A fetch that died
     * without a word simply ages past the window and is asked for again.
     *
     * `scheduledFor` records the slot the audio is wanted for, where there is one.
     */
    async claimFetch(id: string, now: number, retryAfterMs: number, scheduledFor?: number): Promise<boolean> {
        const claimed = await this.db
            .updateTable('deadair.podcastEpisodes')
            .set({
                fetchRequestedAt: instant(now),
                ...(scheduledFor === undefined ? {} : { scheduledFor: instant(scheduledFor) }),
            })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .where('segmentId', 'is', null)
            .where(where => where.or([where('fetchRequestedAt', 'is', null), where('fetchRequestedAt', '<', instant(now - retryAfterMs))]))
            .returning('id')
            .executeTakeFirst();

        return claimed !== undefined;
    }

    /** The station holds this episode now, in that segment. Clears the failures that came before. */
    async markFetched(id: string, segmentId: string): Promise<void> {
        await this.db
            .updateTable('deadair.podcastEpisodes')
            .set({ segmentId, fetchAttempts: 0, fetchError: null })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .execute();
    }

    /**
     * The episode a band for this show would carry: the show's NEWEST, or nothing if the station has
     * aired it already. With no show, the newest across every show, on the same terms.
     *
     * Newest and never back through the catalogue, which is what carrying a programme means on
     * radio: a band at nine is where tonight's episode goes, and on a night the show has not published
     * one the station does not reach into last month instead. An episode that failed to fetch is still
     * the newest, so the band declines rather than quietly airing an older one; the console says why.
     *
     * Undated episodes never count as newest, since there is nothing to say they are.
     */
    async newest(showId: string | undefined): Promise<PodcastEpisodeRecord | undefined> {
        let query = this.db
            .selectFrom('deadair.podcastEpisodes')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .where('publishedAt', 'is not', null);
        if (showId !== undefined) query = query.where('showId', '=', showId);

        const row = await query.orderBy('publishedAt', 'desc').orderBy('id', 'asc').limit(1).executeTakeFirst();
        if (row === undefined) return undefined;

        const newest = toRecord(row);
        return newest.airedAt === undefined ? newest : undefined;
    }

    /**
     * The segment holding an episode has aired. Kept as the FIRST time, since an episode airs once and
     * a second hand-over of the same segment (an operator re-adding it) is not a new first airing.
     */
    async markAired(segmentId: string, at: number): Promise<void> {
        await this.db
            .updateTable('deadair.podcastEpisodes')
            .set({ airedAt: sql<never>`coalesce(aired_at, ${instant(at)})` })
            .where('segmentId', '=', segmentId)
            .where('stationKey', '=', this.station.stationKey)
            .execute();
    }

    /** A fetch failed, and why. Counted, so a scheduler can stop asking for an episode that never arrives. */
    async markFetchFailed(id: string, error: string): Promise<void> {
        await this.db
            .updateTable('deadair.podcastEpisodes')
            .set(update => ({ fetchAttempts: sql<number>`${update.ref('fetchAttempts')} + 1`, fetchError: error.slice(0, 2_000) }))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .execute();
    }
}

/** A listing as the columns a feed is allowed to write. */
function describedBy(listing: PodcastEpisodeListing) {
    return {
        showId: listing.showId,
        episodeId: listing.episodeId,
        showTitle: listing.showTitle,
        title: listing.title,
        summary: listing.summary ?? null,
        url: listing.url ?? null,
        publishedAt: listing.publishedAt === undefined ? null : instant(listing.publishedAt),
        durationMs: positiveWhole(listing.durationMs, 2_147_483_647) ?? null,
        audioUrl: listing.audioUrl,
        audioMime: listing.audioMime ?? null,
        audioBytes: positiveWhole(listing.audioBytes, MAX_CLAIMED_BYTES) ?? null,
        artworkUrl: listing.artworkUrl ?? null,
        explicit: listing.explicit ?? null,
    };
}

/** A claim the table's constraints will take, or nothing: a positive whole number no larger than the column holds. */
function positiveWhole(value: number | undefined, max: number): number | undefined {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    const whole = Math.round(value);
    return whole > 0 && whole <= max ? whole : undefined;
}

/** Epoch millis as something a `timestamptz` column will take, converted by Postgres. */
const instant = (millis: number) => sql<never>`to_timestamp(${millis} / 1000.0)`;

/** A timestamp column as epoch millis, whichever shape the driver handed over. */
function millisOf(value: unknown): number | undefined {
    if (value == null) return undefined;
    if (value instanceof Date) return value.getTime();
    return (value as DateTime).toMillis();
}

/**
 * One row as the rest of the app reads it.
 *
 * Optional columns are compared with `== null`, the rule `apps/api/CLAUDE.md` records: the driver
 * hands back `undefined` for a null where the generated types say `null`.
 */
function toRecord(row: Record<string, unknown>): PodcastEpisodeRecord {
    const text = (value: unknown): string | undefined => (value == null ? undefined : String(value));
    const number = (value: unknown): number | undefined => (value == null ? undefined : Number(value));

    const summary = text(row.summary);
    const url = text(row.url);
    const publishedAt = millisOf(row.publishedAt);
    const durationMs = number(row.durationMs);
    const audioMime = text(row.audioMime);
    const audioBytes = number(row.audioBytes);
    const artworkUrl = text(row.artworkUrl);
    const segmentId = text(row.segmentId);
    const fetchRequestedAt = millisOf(row.fetchRequestedAt);
    const fetchError = text(row.fetchError);
    const scheduledFor = millisOf(row.scheduledFor);
    const airedAt = millisOf(row.airedAt);

    return {
        id: String(row.id),
        showId: String(row.showId),
        episodeId: String(row.episodeId),
        showTitle: String(row.showTitle),
        title: String(row.title),
        audioUrl: String(row.audioUrl),
        seenAt: millisOf(row.seenAt) ?? 0,
        fetchAttempts: number(row.fetchAttempts) ?? 0,
        ...(summary === undefined ? {} : { summary }),
        ...(url === undefined ? {} : { url }),
        ...(publishedAt === undefined ? {} : { publishedAt }),
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(audioMime === undefined ? {} : { audioMime }),
        ...(audioBytes === undefined ? {} : { audioBytes }),
        ...(artworkUrl === undefined ? {} : { artworkUrl }),
        ...(row.explicit == null ? {} : { explicit: Boolean(row.explicit) }),
        ...(segmentId === undefined ? {} : { segmentId }),
        ...(fetchRequestedAt === undefined ? {} : { fetchRequestedAt }),
        ...(fetchError === undefined ? {} : { fetchError }),
        ...(scheduledFor === undefined ? {} : { scheduledFor }),
        ...(airedAt === undefined ? {} : { airedAt }),
    };
}
