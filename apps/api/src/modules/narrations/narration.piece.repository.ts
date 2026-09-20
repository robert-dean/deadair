import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import type { DateTime } from 'luxon';
import type { NarrationOrder } from '@deadair/plugin-sdk';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { NarrationPieceListing, NarrationPieceRecord } from './narration.piece.js';

/** The largest word count the table keeps: `word_count` is an `integer`, as `duration_ms` is. */
const MAX_WORD_COUNT = 2_147_483_647;

/**
 * The pieces this station knows about, and what it has done with each.
 *
 * ## A refresh describes, and never decides
 *
 * `PodcastEpisodeRepository`'s rule, and the one thing in this file most worth not breaking.
 * {@link record} is an upsert keyed on the series and the plugin's own piece id, and what it may
 * write is only what a PLUGIN says. The columns that say what the STATION did (the production that
 * spoke it, the segment holding the audio, the render bookkeeping, the aired mark) are never in its
 * update set, and {@link NarrationPieceListing} has no field for any of them.
 *
 * It costs more here than it does for a podcast if it is broken. A re-listed episode that lost its
 * fetch mark is a second download; a re-listed piece that lost its render mark is the station's only
 * speech engine spending minutes saying a chapter it has already said, and then airing it twice.
 *
 * ## The next piece is two questions, not one
 *
 * {@link nextFor} is where a series' `order` is finally read, and the two arms are genuinely
 * different queries rather than one with a sort flipped. A `serial` works forward through everything
 * unaired, so it asks for the LOWEST unaired ordinal and is free to reach back through a book the
 * station has been part-way through for weeks. A `latest` asks for the newest dated piece and answers
 * nothing if that one has aired. Never reaching back, because reaching back is what carrying a
 * column means you do not do. `PodcastEpisodeRepository.newest` is the second arm exactly.
 *
 * ## Timestamps cross as epoch milliseconds
 *
 * Through SQL on the way in and read back whichever shape the driver hands over, as
 * `podcast.episode.repository.ts` does and for its reason: the generated types say `DateTime` and
 * the driver does not always agree.
 */
@Injectable()
export class NarrationPieceRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * Write what a plugin listed, and answer how many of the pieces were new to the station.
     *
     * New is counted from the database's own answer rather than a read beforehand, so two refreshes
     * racing each other cannot both call one piece new.
     */
    async record(listings: readonly NarrationPieceListing[]): Promise<number> {
        if (listings.length === 0) return 0;

        const rows = listings.map(listing => ({ stationKey: this.station.stationKey, ...describedBy(listing) }));

        const written = await this.db
            .insertInto('deadair.narrationPieces')
            .values(rows)
            .onConflict(conflict =>
                conflict.columns(['stationKey', 'seriesId', 'pieceId']).doUpdateSet(update => ({
                    seriesTitle: update.ref('excluded.seriesTitle'),
                    title: update.ref('excluded.title'),
                    seriesOrder: update.ref('excluded.seriesOrder'),
                    author: update.ref('excluded.author'),
                    summary: update.ref('excluded.summary'),
                    artworkUrl: update.ref('excluded.artworkUrl'),
                    language: update.ref('excluded.language'),
                    url: update.ref('excluded.url'),
                    ordinal: update.ref('excluded.ordinal'),
                    publishedAt: update.ref('excluded.publishedAt'),
                    wordCount: update.ref('excluded.wordCount'),
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
     * A series' pieces in its own order, or every series' newest first.
     *
     * The console's read. A serial is listed from its beginning, because that is the order somebody
     * reading the page is thinking in; with no series named there is no single right order, so the
     * newest across everything is the answer, with the id as the last tiebreaker for
     * `TopicRepository.list`'s reason: a list that reshuffles between reads is a page nobody can use.
     */
    async list(options: { seriesId?: string; limit: number }): Promise<NarrationPieceRecord[]> {
        let query = this.db.selectFrom('deadair.narrationPieces').selectAll().where('stationKey', '=', this.station.stationKey);
        if (options.seriesId !== undefined) query = query.where('seriesId', '=', options.seriesId);

        const rows =
            options.seriesId === undefined
                ? await query
                      .orderBy(sql`published_at desc nulls last`)
                      .orderBy('id', 'asc')
                      .limit(options.limit)
                      .execute()
                : await query
                      .orderBy(sql`ordinal asc nulls last`)
                      .orderBy(sql`published_at desc nulls last`)
                      .orderBy('id', 'asc')
                      .limit(options.limit)
                      .execute();

        return rows.map(toRecord);
    }

    /** One piece of this station's, or `undefined` for an id that is not one. */
    async get(id: string): Promise<NarrationPieceRecord | undefined> {
        const row = await this.db
            .selectFrom('deadair.narrationPieces')
            .selectAll()
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return row === undefined ? undefined : toRecord(row);
    }

    /** The piece holding a segment, for the aired edge marking one from the segment it just played. */
    async bySegment(segmentId: string): Promise<NarrationPieceRecord | undefined> {
        const row = await this.db
            .selectFrom('deadair.narrationPieces')
            .selectAll()
            .where('segmentId', '=', segmentId)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return row === undefined ? undefined : toRecord(row);
    }

    /**
     * The piece a band for this series would read next, or nothing.
     *
     * Which question that is depends on how the series is carried, and the two do not fold together:
     *
     * - `serial`: the lowest `ordinal` not yet aired. A book is worked through in order and the
     *   station keeps its place in this column, so this deliberately DOES reach back: a chapter
     *   published years ago is next if the station has not read it.
     * - `latest`: the newest dated piece, and nothing at all if it has aired. Never back through the
     *   archive, which is what carrying a column means: a band at ten is where tonight's issue goes,
     *   and on a night nothing was published the station does not read last week's instead.
     *
     * The order is read off the pieces themselves rather than passed in, since every refresh copies
     * it onto them, so a series an operator switches from `latest` to `serial` changes behaviour at
     * the next refresh with nothing else to keep in step.
     *
     * Undated pieces never count as newest in a `latest` series, on `PodcastEpisodeRepository.newest`'s
     * rule: there is nothing to say they are.
     */
    async nextFor(seriesId: string): Promise<NarrationPieceRecord | undefined> {
        const order = await this.orderOf(seriesId);
        if (order === undefined) return undefined;

        if (order === 'serial') {
            const row = await this.db
                .selectFrom('deadair.narrationPieces')
                .selectAll()
                .where('stationKey', '=', this.station.stationKey)
                .where('seriesId', '=', seriesId)
                .where('airedAt', 'is', null)
                .where('ordinal', 'is not', null)
                .orderBy('ordinal', 'asc')
                .orderBy('id', 'asc')
                .limit(1)
                .executeTakeFirst();

            return row === undefined ? undefined : toRecord(row);
        }

        const row = await this.db
            .selectFrom('deadair.narrationPieces')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .where('seriesId', '=', seriesId)
            .where('publishedAt', 'is not', null)
            .orderBy('publishedAt', 'desc')
            .orderBy('id', 'asc')
            .limit(1)
            .executeTakeFirst();

        if (row === undefined) return undefined;
        const newest = toRecord(row);
        return newest.airedAt === undefined ? newest : undefined;
    }

    /**
     * How this series is carried, as its own pieces record it.
     *
     * `undefined` for a series the station holds nothing for, which is an ordinary state: an operator
     * can name a series on a band before the first refresh has read it.
     */
    private async orderOf(seriesId: string): Promise<NarrationOrder | undefined> {
        const row = await this.db
            .selectFrom('deadair.narrationPieces')
            .select('seriesOrder')
            .where('stationKey', '=', this.station.stationKey)
            .where('seriesId', '=', seriesId)
            .limit(1)
            .executeTakeFirst();

        return row === undefined ? undefined : readOrder(row.seriesOrder);
    }

    /**
     * Claim the right to have this piece spoken, or learn that somebody already has.
     *
     * `PodcastEpisodeRepository.claimFetch`'s conditional UPDATE, and the idempotence of every render
     * lives in it: it moves `render_requested_at` forward only for a piece the station has neither
     * spoken nor started speaking, and has not asked for within `retryAfterMs`. So a scheduler running
     * every commit pass, an operator pressing the button twice and a restart mid-render all come down
     * to one row saying whether a request is already out.
     *
     * The `production_id is null` half is what a podcast has no equivalent of and what matters most:
     * without it, a claim taken while a production was already being written would open a second one
     * and the station would speak the chapter twice.
     */
    async claimRender(id: string, now: number, retryAfterMs: number, scheduledFor?: number): Promise<boolean> {
        const claimed = await this.db
            .updateTable('deadair.narrationPieces')
            .set({
                renderRequestedAt: instant(now),
                ...(scheduledFor === undefined ? {} : { scheduledFor: instant(scheduledFor) }),
            })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .where('segmentId', 'is', null)
            .where('productionId', 'is', null)
            .where(where => where.or([where('renderRequestedAt', 'is', null), where('renderRequestedAt', '<', instant(now - retryAfterMs))]))
            .returning('id')
            .executeTakeFirst();

        return claimed !== undefined;
    }

    /**
     * This piece is being spoken by that production.
     *
     * Guarded on `production_id is null`, so two renders that both got past {@link claimRender} still
     * end with one production on the row and the other's caller learning it lost. Answers whether this
     * caller's production is the one the row now names.
     */
    async markProduction(id: string, productionId: string): Promise<boolean> {
        const marked = await this.db
            .updateTable('deadair.narrationPieces')
            .set({ productionId })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .where('productionId', 'is', null)
            .where('segmentId', 'is', null)
            .returning('id')
            .executeTakeFirst();

        return marked !== undefined;
    }

    /** The station has the audio now, in that segment. Clears the failures that came before. */
    async markRendered(id: string, segmentId: string): Promise<void> {
        await this.db
            .updateTable('deadair.narrationPieces')
            .set({ segmentId, renderAttempts: 0, renderError: null })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .execute();
    }

    /**
     * This piece could not be spoken, and why.
     *
     * Clears `production_id` as well as counting the attempt, which is what lets the next pass claim
     * it again: a production that failed or was cancelled is not one the row should keep pointing at,
     * and leaving it there would wedge the piece forever behind a `claimRender` that can never win.
     */
    async markRenderFailed(id: string, error: string): Promise<void> {
        await this.db
            .updateTable('deadair.narrationPieces')
            .set(eb => ({ renderAttempts: eb('renderAttempts', '+', 1), renderError: error, productionId: null }))
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .execute();
    }

    /**
     * A listener could have heard this piece, from the segment that played.
     *
     * Keyed on the segment, as `PodcastEpisodeRepository.markAired` is, because that is what the aired
     * edge holds. `coalesce` keeps the FIRST airing: a piece re-aired by hand has not stopped having
     * been read, and for a serial this column is also the station's place in the book.
     */
    async markAired(segmentId: string, at: number): Promise<void> {
        await this.db
            .updateTable('deadair.narrationPieces')
            .set({ airedAt: sql<never>`coalesce(aired_at, ${instant(at)})` })
            .where('segmentId', '=', segmentId)
            .where('stationKey', '=', this.station.stationKey)
            .execute();
    }
}

/** A listing as the columns a plugin is allowed to write. */
function describedBy(listing: NarrationPieceListing) {
    return {
        seriesId: listing.seriesId,
        pieceId: listing.pieceId,
        seriesTitle: listing.seriesTitle,
        title: listing.title,
        seriesOrder: listing.seriesOrder,
        author: listing.author ?? null,
        summary: listing.summary ?? null,
        artworkUrl: listing.artworkUrl ?? null,
        language: listing.language ?? null,
        url: listing.url ?? null,
        ordinal: wholeAtLeastZero(listing.ordinal) ?? null,
        publishedAt: listing.publishedAt === undefined ? null : instant(listing.publishedAt),
        wordCount: positiveWhole(listing.wordCount, MAX_WORD_COUNT) ?? null,
    };
}

/** An ordinal the table's constraint will take, or nothing. */
function wholeAtLeastZero(value: number | undefined): number | undefined {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    const whole = Math.round(value);
    return whole >= 0 ? whole : undefined;
}

/** A claim the table's constraints will take, or nothing: a positive whole number no larger than the column holds. */
function positiveWhole(value: number | undefined, max: number): number | undefined {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    const whole = Math.round(value);
    return whole > 0 && whole <= max ? whole : undefined;
}

/**
 * A stored order, read leniently.
 *
 * The column is free text on `segments.kind`'s rule, so anything could be in it; anything that is not
 * `latest` is read as `serial`, which is the safer of the two to be wrong about: a serial reads
 * something the station has not read, where a `latest` could decline forever on a series with no
 * dates at all.
 */
const readOrder = (value: unknown): NarrationOrder =>
    String(value ?? '')
        .trim()
        .toLowerCase() === 'latest'
        ? 'latest'
        : 'serial';

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
function toRecord(row: Record<string, unknown>): NarrationPieceRecord {
    const text = (value: unknown): string | undefined => (value == null ? undefined : String(value));
    const number = (value: unknown): number | undefined => (value == null ? undefined : Number(value));

    const author = text(row.author);
    const summary = text(row.summary);
    const artworkUrl = text(row.artworkUrl);
    const language = text(row.language);
    const url = text(row.url);
    const ordinal = number(row.ordinal);
    const publishedAt = millisOf(row.publishedAt);
    const wordCount = number(row.wordCount);
    const productionId = text(row.productionId);
    const segmentId = text(row.segmentId);
    const renderRequestedAt = millisOf(row.renderRequestedAt);
    const renderError = text(row.renderError);
    const scheduledFor = millisOf(row.scheduledFor);
    const airedAt = millisOf(row.airedAt);

    return {
        id: String(row.id),
        seriesId: String(row.seriesId),
        pieceId: String(row.pieceId),
        seriesTitle: String(row.seriesTitle),
        title: String(row.title),
        seriesOrder: readOrder(row.seriesOrder),
        renderAttempts: Number(row.renderAttempts ?? 0),
        seenAt: millisOf(row.seenAt) ?? Date.now(),
        ...(author === undefined ? {} : { author }),
        ...(summary === undefined ? {} : { summary }),
        ...(artworkUrl === undefined ? {} : { artworkUrl }),
        ...(language === undefined ? {} : { language }),
        ...(url === undefined ? {} : { url }),
        ...(ordinal === undefined ? {} : { ordinal }),
        ...(publishedAt === undefined ? {} : { publishedAt }),
        ...(wordCount === undefined ? {} : { wordCount }),
        ...(productionId === undefined ? {} : { productionId }),
        ...(segmentId === undefined ? {} : { segmentId }),
        ...(renderRequestedAt === undefined ? {} : { renderRequestedAt }),
        ...(renderError === undefined ? {} : { renderError }),
        ...(scheduledFor === undefined ? {} : { scheduledFor }),
        ...(airedAt === undefined ? {} : { airedAt }),
    };
}
