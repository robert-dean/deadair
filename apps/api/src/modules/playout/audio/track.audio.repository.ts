import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '#modules/data/data.repository.js';
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
    id: string;
    sourceId: string;
    /** Absent while no fetch has produced bytes: a row never tried, or one whose attempts failed. */
    checksum?: string;
    ext?: TrackExtension;
    contentType?: string;
    byteSize?: number;
    /** How many fetches have been tried and failed. Zero on a row that has never been claimed. */
    attempts: number;
}

/** What the caller hands back after a successful download. */
export interface TrackAudioBytes {
    checksum: string;
    ext: TrackExtension;
    contentType: string;
    byteSize: number;
}

interface TrackAudioRow {
    id: string;
    sourceId: string;
    checksum: string | null;
    ext: string | null;
    contentType: string | null;
    byteSize: number | null;
    attempts: number;
}

const AUDIO_COLUMNS = ['id', 'sourceId', 'checksum', 'ext', 'contentType', 'byteSize', 'attempts'] as const;

/**
 * Rows read back as `undefined` rather than `null` (see the note in CLAUDE.md), so every optional
 * column is compared with `== null` and dropped rather than passed through. `ext` is validated
 * rather than cast: it is the second half of a filesystem path, and a row edited by hand should read
 * as "no audio" instead of reaching {@link TrackStore.pathFor} as a surprise.
 */
function toTrackAudio(row: TrackAudioRow): TrackAudio {
    const ext = row.ext == null ? undefined : row.ext;
    const usable = row.checksum != null && isTrackExtension(ext);

    return {
        id: row.id,
        sourceId: row.sourceId,
        ...(usable ? { checksum: row.checksum as string, ext: ext as TrackExtension } : {}),
        ...(row.contentType == null ? {} : { contentType: row.contentType }),
        ...(row.byteSize == null ? {} : { byteSize: row.byteSize }),
        attempts: row.attempts,
    };
}

/** What the resolver learns about a binding in one read: which source row it is, and what it holds. */
export interface BindingAudio extends TrackAudio {
    /** Whether a fetch is worth queueing now: no bytes, and any backoff has expired. */
    dueForFetch: boolean;
}

@Injectable()
export class TrackAudioRepository extends DataRepository {
    /**
     * The station's copy of a binding, by the plugin and external id the running order carries.
     *
     * One statement, because the transport asks this per hand-over: the binding is looked up and its
     * cache row left-joined in the same query, so a binding with no row yet answers `sourceId` and
     * `dueForFetch: true` rather than costing a second round trip to find out there is nothing there.
     *
     * `undefined` means the CATALOG does not know this binding, which is not the same as having no
     * copy of it — a lineup item whose provider row has since been deleted resolves through the
     * provider or not at all, and there is nothing here to cache it against.
     */
    async findByBinding(pluginId: string, externalId: string): Promise<BindingAudio | undefined> {
        const row = await this.db
            .selectFrom('deadair.trackSources as source')
            .leftJoin('deadair.trackAudio as audio', 'audio.sourceId', 'source.id')
            .select([
                'source.id as sourceId',
                'audio.id as id',
                'audio.checksum as checksum',
                'audio.ext as ext',
                'audio.contentType as contentType',
                'audio.byteSize as byteSize',
                'audio.attempts as attempts',
                sql<boolean>`audio.checksum is null and (audio.next_attempt_at is null or audio.next_attempt_at <= now())`.as('dueForFetch'),
            ])
            .where('source.pluginId', '=', pluginId)
            .where('source.externalId', '=', externalId)
            .executeTakeFirst();

        if (row === undefined) return undefined;

        // `id` and `attempts` are null when the left join found nothing, which is the ordinary state
        // of a binding nobody has played yet. The id of a row that does not exist is not something a
        // caller can use, so it reports the source id and an empty attempt count.
        return {
            ...toTrackAudio({ ...row, id: row.id ?? '', attempts: row.attempts ?? 0 }),
            dueForFetch: row.dueForFetch,
        };
    }

    /** The copy behind a served URL, by the binding it belongs to. */
    async findBySourceId(sourceId: string): Promise<TrackAudio | undefined> {
        const row = await this.db.selectFrom('deadair.trackAudio').select(AUDIO_COLUMNS).where('sourceId', '=', sourceId).executeTakeFirst();

        return row === undefined ? undefined : toTrackAudio(row);
    }

    /**
     * Takes the fetch for one binding, or answers `false` because somebody else has it.
     *
     * The same conditional-update trick `SegmentRepository.claimForRender` uses, and here for the
     * same reason: the resolver fires a job off a boundary without waiting for it, so a record that
     * comes round twice in the seconds a download takes sends the job twice, and a duplicate send has
     * to be FREE. The claim is what makes it free — the second job finds the row already claimed and
     * does nothing.
     *
     * Claiming means bumping `attempts` and pushing `next_attempt_at` out, so an interrupted job (a
     * deploy, a kill) leaves a row that is retried later rather than one that is claimed forever.
     * Which is also why the gate is the same one a failure sets: a claim IS a pessimistic failure
     * that {@link recordSuccess} clears.
     *
     * @param holdMs - How long the claim is good for. Comfortably longer than a download and short
     *   enough that a lost job is retried the same evening.
     */
    async claim(sourceId: string, holdMs: number): Promise<boolean> {
        const holdSecs = sql<number>`${holdMs / 1000}::double precision`;
        const held = sql<never>`now() + make_interval(secs => ${holdSecs})`;

        const row = await this.db
            .insertInto('deadair.trackAudio')
            .values({ sourceId, attempts: 1, nextAttemptAt: held })
            .onConflict(oc =>
                oc
                    .column('sourceId')
                    .doUpdateSet(eb => ({ attempts: eb('deadair.trackAudio.attempts', '+', 1), nextAttemptAt: held }))
                    // Only a row with no bytes and no live gate is claimable. Kysely puts this on the
                    // DO UPDATE, so a conflicting row that fails it updates nothing and returns
                    // nothing, which is exactly "somebody else has this".
                    //
                    // The gate is read exactly as `findByBinding` reads it, null included: the two
                    // have to agree about what is due, or the resolver would queue a fetch the claim
                    // then refuses and the binding would never be cached while looking like it was
                    // about to be.
                    .where(eb =>
                        eb.and([
                            eb('deadair.trackAudio.checksum', 'is', null),
                            eb.or([
                                eb(sql`deadair.track_audio.next_attempt_at`, 'is', null),
                                eb(sql`deadair.track_audio.next_attempt_at`, '<=', sql`now()`),
                            ]),
                        ]),
                    ),
            )
            .returning('id')
            .executeTakeFirst();

        return row !== undefined;
    }

    /**
     * Records bytes against a binding.
     *
     * Clears the failure state on the way through: a binding that failed twice and then worked is
     * simply cached, and leaving `last_error` and a future `next_attempt_at` behind would leave the
     * table reading as broken and the row un-reclaimable if the file is ever lost.
     */
    async recordSuccess(sourceId: string, bytes: TrackAudioBytes): Promise<TrackAudio> {
        const cached = {
            checksum: bytes.checksum,
            ext: bytes.ext,
            contentType: bytes.contentType,
            byteSize: bytes.byteSize,
            fetchedAt: sql<never>`now()`,
            lastError: null,
            nextAttemptAt: null,
        };

        const row = await this.db
            .insertInto('deadair.trackAudio')
            .values({ sourceId, ...cached })
            .onConflict(oc => oc.column('sourceId').doUpdateSet(cached))
            .returning(AUDIO_COLUMNS)
            .executeTakeFirstOrThrow();

        return toTrackAudio(row);
    }

    /**
     * Records that a fetch did not produce bytes, and when it is worth trying again.
     *
     * The row is kept rather than deleted: without it nothing can tell a binding never tried from one
     * the provider refuses every time, and a dead binding would be re-fetched on every boundary it
     * came round on forever. The station still plays it through the provider in the meantime, so this
     * costs nothing audible.
     *
     * The backoff doubles per attempt up to `maxRetryMs`, computed in SQL off the row's own
     * `attempts` — the same shape `ArtRepository.recordFailure` uses, and for the same reason: it
     * needs no read first and two failures cannot both write the same delay from the same stale
     * count. The claim has already bumped `attempts`, so the first failure is already spaced.
     */
    async recordFailure(sourceId: string, error: string, baseRetryMs: number, maxRetryMs: number): Promise<void> {
        // Cast both bounds: `least()` over two untyped bind parameters resolves to text, and
        // `make_interval(secs => text)` is not a function that exists.
        const baseSecs = sql<number>`${baseRetryMs / 1000}::double precision`;
        const maxSecs = sql<number>`${maxRetryMs / 1000}::double precision`;

        await this.db
            .insertInto('deadair.trackAudio')
            .values({
                sourceId,
                attempts: 1,
                lastError: error,
                nextAttemptAt: sql<never>`now() + make_interval(secs => least(${baseSecs}, ${maxSecs}))`,
            })
            .onConflict(oc =>
                oc.column('sourceId').doUpdateSet({
                    lastError: error,
                    nextAttemptAt: sql<never>`now() + make_interval(
                        secs => least(${baseSecs} * power(2, greatest(deadair.track_audio.attempts - 1, 0)), ${maxSecs})
                    )`,
                }),
            )
            .execute();
    }
}
