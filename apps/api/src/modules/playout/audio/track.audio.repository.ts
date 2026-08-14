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
