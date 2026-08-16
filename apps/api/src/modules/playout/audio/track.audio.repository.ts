import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import { failureBackoff } from '#modules/data/failure.backoff.js';
import { TrackExtension, isTrackExtension } from './track.store.js';

/**
 * The station's copy of one binding's audio, cached or merely attempted.
 *
 * `checksum` and `ext` travel together the way `ArtAsset`'s and `Segment`'s do: either a fetch
 * produced bytes and both are set, or it did not and neither is. The repository narrows that pair on
 * the way out, so a caller never has to re-check one against the other before reaching the store.
 *
 * `sourceId` is `track_sources.id`, and it is also the public handle: it is what the served URL
 * carries, because the binding is what the transport resolved and what the next play will resolve
 * again.
 */
export interface TrackAudio {
    sourceId: string;
    /** Absent while no fetch has produced bytes: a row never tried, one that failed, or a station keeping nothing. */
    checksum?: string;
    ext?: TrackExtension;
    contentType?: string;
    byteSize?: number;
    /**
     * CONSECUTIVE failed fetches. Zero on a row that has never failed and on one whose last fetch
     * worked, because {@link TrackAudioRepository.recordSuccess} resets it — see the note there.
     */
    attempts: number;
    /**
     * When these bytes were last handed to something that wanted them.
     *
     * Optional here although the column is not null, because every read of it comes through a LEFT
     * join from `track_sources`: a binding nobody has ever fetched has no row at all and reads as a
     * row of nulls, which is the ordinary state of a fresh catalog.
     */
    lastServedAt?: DateTime;
    /** When a failed binding is worth trying again. Absent means now. */
    nextAttemptAt?: DateTime;
    /** Why the last fetch failed, when one did. */
    lastError?: string;
}

/** One binding's audio plus the provider coordinates needed to fetch it. */
export interface SourceAudio extends TrackAudio {
    pluginId: string;
    externalId: string;
}

/**
 * One provider's copy of a record, with whatever the station holds of it.
 *
 * The union of `track_sources` and `track_audio` as a console needs to see it, which is a different
 * shape from {@link SourceAudio}: that one is what a FETCH needs, and this is what an operator needs
 * to work out why nothing is playing. Failures are part of it rather than filtered out of it.
 */
export interface TrackBindingState {
    sourceId: string;
    pluginId: string;
    externalId: string;
    playable: boolean;
    missingAt?: DateTime;
    origin: string;
    bitrate?: number;
    format?: string;
    lastSeenAt?: DateTime;
    byteSize?: number;
    fetchedAt?: DateTime;
    lastServedAt?: DateTime;
    attempts: number;
    lastError?: string;
    nextAttemptAt?: DateTime;
}

/**
 * One row that currently holds a file, as an eviction sweep needs it.
 *
 * Everything required to stop claiming the bytes and to find them on disk, and nothing else: the
 * sweep does not care what record this is, only what it costs and when it was last wanted.
 */
export interface CachedFile {
    sourceId: string;
    checksum: string;
    ext: TrackExtension;
    byteSize: number;
}

/** What the caller hands back after a successful download that is being kept. */
export interface TrackAudioBytes {
    checksum: string;
    ext: TrackExtension;
    contentType: string;
    byteSize: number;
}

interface TrackAudioRow {
    checksum: string | null;
    ext: string | null;
    contentType: string | null;
    byteSize: number | null;
    attempts: number | null;
    lastServedAt: DateTime | null;
    nextAttemptAt: DateTime | null;
    lastError: string | null;
}

/**
 * Rows read back as `undefined` rather than `null` (see the note in CLAUDE.md), so every optional
 * column is compared with `== null` and dropped rather than passed through. `ext` is validated
 * rather than cast: it is the second half of a filesystem path, and a row edited by hand should read
 * as "no audio" instead of reaching {@link TrackStore.pathFor} as a surprise.
 *
 * Every column may be null here and not only because the table allows it: these all arrive through a
 * LEFT join from `track_sources`, so a binding nobody has ever fetched reads as a row of nulls rather
 * than as no row at all. That is the ordinary state of a fresh catalog.
 */
function toTrackAudio(sourceId: string, row: TrackAudioRow): TrackAudio {
    const ext = row.ext == null ? undefined : row.ext;
    const usable = row.checksum != null && isTrackExtension(ext);

    return {
        sourceId,
        ...(usable ? { checksum: row.checksum as string, ext: ext as TrackExtension } : {}),
        ...(row.contentType == null ? {} : { contentType: row.contentType }),
        ...(row.byteSize == null ? {} : { byteSize: row.byteSize }),
        attempts: row.attempts ?? 0,
        ...(row.lastServedAt == null ? {} : { lastServedAt: row.lastServedAt }),
        ...(row.nextAttemptAt == null ? {} : { nextAttemptAt: row.nextAttemptAt }),
        ...(row.lastError == null ? {} : { lastError: row.lastError }),
    };
}

const AUDIO_SELECTION = [
    'audio.checksum as checksum',
    'audio.ext as ext',
    'audio.contentType as contentType',
    'audio.byteSize as byteSize',
    'audio.attempts as attempts',
    'audio.lastServedAt as lastServedAt',
    'audio.nextAttemptAt as nextAttemptAt',
    'audio.lastError as lastError',
] as const;

@Injectable()
export class TrackAudioRepository extends DataRepository {
    /**
     * Everything needed to serve one binding, by the id its URL carries.
     *
     * One statement, and it starts from `track_sources` rather than from `track_audio`: the row that
     * says a binding EXISTS is the source, and the cache row is an optional fact about it. A binding
     * nobody has fetched therefore answers with `attempts: 0` and no checksum rather than
     * `undefined` — which is what lets {@link TrackAudioService.ensure} tell "never fetched" from
     * "not a binding at all" without a second read.
     *
     * `undefined` means the catalog has no such source row: a stale URL, or a binding deleted since
     * the running order was built. The route answers 404 for it.
     */
    async findForSource(sourceId: string): Promise<SourceAudio | undefined> {
        const row = await this.db
            .selectFrom('deadair.trackSources as source')
            .leftJoin('deadair.trackAudio as audio', 'audio.sourceId', 'source.id')
            .select(['source.pluginId as pluginId', 'source.externalId as externalId', ...AUDIO_SELECTION])
            .where('source.id', '=', sourceId)
            .executeTakeFirst();

        if (row === undefined) return undefined;

        return { ...toTrackAudio(sourceId, row), pluginId: row.pluginId, externalId: row.externalId };
    }

    /**
     * The id of a binding the station may serve, or `undefined`.
     *
     * What the resolver asks on every hand-over, and deliberately the whole of what it asks: whether
     * the bytes are on disk yet is no longer the resolver's business, because the route it hands back
     * fetches them if they are not there. So this is an existence check and nothing more.
     *
     * `playable and missing_at is null` is the predicate `track_sources_playable_idx` already
     * encodes, and the same one `CandidatesRepository` picks records by. Reading it here as well is
     * what stops the transport handing over a URL for a copy the catalog has already written off —
     * see the note on `missing_at` in `CandidatesRepository.bindingsFor`.
     */
    async findPlayableSourceId(pluginId: string, externalId: string): Promise<string | undefined> {
        const row = await this.db
            .selectFrom('deadair.trackSources')
            .select('id')
            .where('pluginId', '=', pluginId)
            .where('externalId', '=', externalId)
            .where('playable', '=', true)
            .where('missingAt', 'is', null)
            .executeTakeFirst();

        return row?.id;
    }

    /**
     * The fetch state of several bindings at once, for the ripener.
     *
     * Keyed by the BINDING rather than by source id, because that is what a running order carries: an
     * item holds `pluginId` + `externalId`, which is deliberately the key of `track_sources`, and the
     * source id it maps to is one of the things this answers.
     *
     * Batched for the reason `SegmentRepository.findByIds` is: this runs on the commit pass, and one
     * query for a window of records beats one per item on a path that already does a read per
     * boundary. Written as `unnest` over two arrays rather than an `in` over pairs, because the key is
     * two columns and Postgres has no tidy `in ((a, b), (c, d))` through Kysely.
     *
     * Filtered to bindings the catalog still offers, the same predicate the resolver reads: a copy
     * written off with `missing_at` is not worth a provider's quota, and the transport will not hand it
     * over either.
     *
     * A binding with no `track_audio` row at all still comes back, with `attempts: 0` and no checksum.
     * That is the state of everything on a fresh station and it is exactly what the ripener is looking
     * for.
     */
    async findForBindings(bindings: readonly { pluginId: string; externalId: string }[]): Promise<SourceAudio[]> {
        if (bindings.length === 0) return [];

        // Keys are camelCase even here: `CamelCasePlugin` is in `KyselyDefaultPlugins` and rewrites
        // result keys for raw SQL too — the same note `EnrichmentRepository` carries.
        const rows = await sql<{ sourceId: string; pluginId: string; externalId: string } & TrackAudioRow>`
            select source.id as source_id,
                   source.plugin_id,
                   source.external_id,
                   audio.checksum,
                   audio.ext,
                   audio.content_type,
                   audio.byte_size,
                   audio.attempts,
                   audio.last_served_at,
                   audio.next_attempt_at,
                   audio.last_error
              from unnest(${sql.val(bindings.map(binding => binding.pluginId))}::text[],
                          ${sql.val(bindings.map(binding => binding.externalId))}::text[])
                     as wanted (plugin_id, external_id)
              join deadair.track_sources source
                on source.plugin_id = wanted.plugin_id
               and source.external_id = wanted.external_id
              left join deadair.track_audio audio
                on audio.source_id = source.id
             where source.playable
               and source.missing_at is null
        `.execute(this.db);

        return rows.rows.map(row => ({ ...toTrackAudio(row.sourceId, row), pluginId: row.pluginId, externalId: row.externalId }));
    }

    /**
     * Records that a fetch worked, and what it produced.
     *
     * **Resets `attempts` to zero**, which is what makes that column mean CONSECUTIVE failures: a
     * count that only climbed would have whatever reads it eventually decide a working binding is
     * dead. Clears `last_error` and the backoff for the same reason — a binding that failed twice and
     * then worked is simply working, and a table left reading as broken is one nobody can diagnose
     * from.
     *
     * `bytes` is required, which it was not while a station could be told to keep nothing. It is not
     * optional any more because a fetch that produced no file is not a success anything may act on:
     * the director reads this row's checksum to decide a record may be committed.
     */
    async recordSuccess(sourceId: string, bytes: TrackAudioBytes): Promise<void> {
        const values = {
            attempts: 0,
            lastError: null,
            nextAttemptAt: null,
            fetchedAt: sql<never>`now()`,
            checksum: bytes.checksum,
            ext: bytes.ext,
            contentType: bytes.contentType,
            byteSize: bytes.byteSize,
        };

        await this.db
            .insertInto('deadair.trackAudio')
            .values({ sourceId, ...values })
            .onConflict(oc => oc.column('sourceId').doUpdateSet(values))
            .execute();
    }

    /**
     * Every copy of one record, with whatever the station holds of each.
     *
     * The read behind "why will this record not air", and it starts from `track_sources` for the
     * reason {@link findForSource} does: the row that says a copy EXISTS is the source, and the
     * cache row is an optional fact about it. So a copy nobody has ever fetched comes back with
     * `attempts: 0` and no bytes rather than being absent.
     *
     * Unlike every other read in this file it does NOT exclude `missing_at` or `playable`. Those
     * exclusions are right where the question is "what may air"; here the question is why nothing
     * can, and a page that hid the benched copies would hide the answer.
     */
    async bindingsForTrack(trackId: string): Promise<TrackBindingState[]> {
        const rows = await this.db
            .selectFrom('deadair.trackSources as source')
            .leftJoin('deadair.trackAudio as audio', 'audio.sourceId', 'source.id')
            .select([
                'source.id as sourceId',
                'source.pluginId as pluginId',
                'source.externalId as externalId',
                'source.playable as playable',
                'source.missingAt as missingAt',
                'source.origin as origin',
                'source.bitrate as bitrate',
                'source.format as format',
                'source.lastSeenAt as lastSeenAt',
                'audio.byteSize as byteSize',
                'audio.fetchedAt as fetchedAt',
                'audio.lastServedAt as lastServedAt',
                'audio.attempts as attempts',
                'audio.lastError as lastError',
                'audio.nextAttemptAt as nextAttemptAt',
            ])
            .where('source.trackId', '=', trackId)
            // The copy the station is most likely to use first, then a stable order so two reads of
            // an unchanged record do not shuffle under somebody looking at it.
            // Nulls FIRST, which is the whole point of spelling the direction out: a copy the station
            // still offers sorts above one it has written off, and Postgres puts nulls last on `asc`.
            .orderBy('source.missingAt', ob => ob.asc().nullsFirst())
            .orderBy('source.pluginId', 'asc')
            .orderBy('source.externalId', 'asc')
            .execute();

        return rows.map(row => ({
            sourceId: row.sourceId,
            pluginId: row.pluginId,
            externalId: row.externalId,
            playable: row.playable,
            ...(row.missingAt == null ? {} : { missingAt: row.missingAt }),
            origin: row.origin,
            ...(row.bitrate == null ? {} : { bitrate: row.bitrate }),
            ...(row.format == null ? {} : { format: row.format }),
            ...(row.lastSeenAt == null ? {} : { lastSeenAt: row.lastSeenAt }),
            ...(row.byteSize == null ? {} : { byteSize: Number(row.byteSize) }),
            ...(row.fetchedAt == null ? {} : { fetchedAt: row.fetchedAt }),
            ...(row.lastServedAt == null ? {} : { lastServedAt: row.lastServedAt }),
            attempts: row.attempts ?? 0,
            ...(row.lastError == null ? {} : { lastError: row.lastError }),
            ...(row.nextAttemptAt == null ? {} : { nextAttemptAt: row.nextAttemptAt }),
        }));
    }

    /**
     * How many bytes of records the station is holding, by its own account.
     *
     * The rows' sum rather than the disk's, deliberately: this is the number the cap is compared
     * against, and the cap is about what the station has decided to keep. A file on disk that no row
     * claims is a different question with a different answer (see `GET /storage`), and folding the
     * two together would have a sweep evicting real records to make room for orphans.
     */
    async totalCachedBytes(): Promise<number> {
        const row = await this.db
            .selectFrom('deadair.trackAudio')
            .select(eb => eb.fn.coalesce(eb.fn.sum<number>('byteSize'), sql<number>`0`).as('total'))
            .where('checksum', 'is not', null)
            .executeTakeFirstOrThrow();

        return Number(row.total);
    }

    /**
     * The coldest records the station holds, oldest serve first.
     *
     * What the sweep evicts from, straight off `track_audio_lru_idx`. It answers a BATCH rather than
     * everything, because a station a long way over its cap should free what it needs and stop: the
     * sweep asks again if the first batch was not enough, and a query that returned ten thousand
     * rows to use forty of them would be paying for the whole library on every pass.
     *
     * `exclude` is what must not be touched — the committable window and anything being fetched —
     * and it is applied in SQL rather than by the caller so a protected record cannot use up a slot
     * in the batch and leave the sweep with nothing to evict.
     */
    async leastRecentlyServed(limit: number, exclude: readonly string[]): Promise<CachedFile[]> {
        let query = this.db
            .selectFrom('deadair.trackAudio')
            .select(['sourceId', 'checksum', 'ext', 'byteSize'])
            .where('checksum', 'is not', null)
            .orderBy('lastServedAt', 'asc')
            .limit(limit);

        if (exclude.length > 0) query = query.where('sourceId', 'not in', [...exclude]);

        const rows = await query.execute();

        // A row whose `ext` is not one the store holds cannot name a file, so it is not something to
        // evict — it is something for the storage report to notice. Filtered rather than trusted,
        // for the reason `toTrackAudio` validates the same column.
        return rows.flatMap(row =>
            row.checksum == null || !isTrackExtension(row.ext ?? undefined)
                ? []
                : [{ sourceId: row.sourceId, checksum: row.checksum, ext: row.ext as TrackExtension, byteSize: Number(row.byteSize ?? 0) }],
        );
    }

    /**
     * Which of these checksums some OTHER row still claims.
     *
     * The check a content-addressed store cannot make for itself. Two bindings that resolved to
     * identical audio are one file on disk, so deleting it for one of them would silently unmake the
     * other — the second row would go on saying it holds bytes that are gone, and the record would
     * fail at the moment it was wanted rather than at the moment it was evicted.
     */
    async checksumsReferenced(checksums: readonly string[], excludingSourceIds: readonly string[]): Promise<Set<string>> {
        if (checksums.length === 0) return new Set();

        let query = this.db.selectFrom('deadair.trackAudio').select('checksum').distinct().where('checksum', 'in', [...checksums]);

        if (excludingSourceIds.length > 0) query = query.where('sourceId', 'not in', [...excludingSourceIds]);

        const rows = await query.execute();

        return new Set(rows.flatMap(row => (row.checksum == null ? [] : [row.checksum])));
    }

    /**
     * Forgets the FILE half of these rows, keeping the rows.
     *
     * The same shape {@link recordFailure} leaves behind, and for the same reason: the row is the
     * record of a BINDING, not of a file. Keeping it is what lets the station tell a record it has
     * never fetched from one it fetched and later dropped, and it is what `attempts` and
     * `last_error` hang off.
     *
     * `last_served_at` is deliberately left where it is. It says when this record was last wanted,
     * which is still true after the bytes go, and it is what stops a record evicted and re-fetched
     * from immediately looking like the coldest thing the station holds.
     */
    async clearBytes(sourceIds: readonly string[]): Promise<number> {
        if (sourceIds.length === 0) return 0;

        const result = await this.db
            .updateTable('deadair.trackAudio')
            .set({ checksum: null, ext: null, contentType: null, byteSize: null, fetchedAt: null })
            .where('sourceId', 'in', [...sourceIds])
            .executeTakeFirst();

        return Number(result.numUpdatedRows ?? 0n);
    }

    /**
     * Notes that these bytes were just handed to something that wanted them.
     *
     * The only writer of `last_served_at`, and the whole of what an eviction sweep orders by. It is
     * a bare timestamp rather than a counter because the question a cache asks is "when, last" and
     * not "how often": a record played twice last January is colder than one played once this
     * morning, and a count says the opposite.
     *
     * Deliberately not part of {@link recordSuccess}. A fetch is not a serve, and a freshly fetched
     * row already reads as new through the column's default.
     */
    async markServed(sourceId: string): Promise<void> {
        await this.db
            .updateTable('deadair.trackAudio')
            .set({ lastServedAt: sql<never>`now()` })
            .where('sourceId', '=', sourceId)
            .execute();
    }

    /**
     * Records that a fetch did not produce bytes, and when it is worth trying again.
     *
     * The row is kept rather than deleted: without it nothing can tell a binding never tried from one
     * the provider refuses every time, and a dead binding would be re-fetched on every boundary it
     * came round on forever.
     *
     * Bumps `attempts` ITSELF and computes the backoff from the bumped value, in one statement, so the
     * count is a true tally of consecutive failures however many fetches raced. It used to be bumped
     * by a separate `claim`, which is gone: de-duplication moved in-process, and a counter maintained
     * by a lock nobody takes any more would only ever be wrong.
     */
    async recordFailure(sourceId: string, error: string, baseRetryMs: number, maxRetryMs: number): Promise<void> {
        const retry = failureBackoff('deadair.track_audio.attempts', baseRetryMs, maxRetryMs);

        await this.db
            .insertInto('deadair.trackAudio')
            .values({
                sourceId,
                attempts: 1,
                lastError: error,
                nextAttemptAt: retry.first,
            })
            .onConflict(oc =>
                oc.column('sourceId').doUpdateSet(eb => ({
                    attempts: eb('deadair.trackAudio.attempts', '+', 1),
                    lastError: error,
                    nextAttemptAt: retry.again,
                })),
            )
            .execute();
    }
}
