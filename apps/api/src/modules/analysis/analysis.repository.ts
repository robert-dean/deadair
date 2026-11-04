import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { ANALYSIS_FAILURE_CODES, type AnalysisFailureCode, type TrackAnalysis, type TrackCuePoints } from '@deadair/plugin-sdk';
import { DataRepository } from '../data/data.repository.js';
import { toJsonb } from '../data/jsonb.js';

/**
 * How long a track that could not be measured waits before anything tries again.
 *
 * Long, and deliberately much longer than the enrichment tables' TTLs, because
 * the two failures cost different things. A missing enrichment row is one
 * request against a rate-limited upstream; a missing analysis row is a full
 * download and decode, so retrying it on the ordinary walk means paying for the
 * same undecodable file every pass forever.
 *
 * This is the wait for a file that would not DECODE, and for a failure that
 * carries no code at all: most of what lands here is permanent — a track whose
 * provider serves something that is not audio, or a format the analyzer does
 * not know. A fetch that failed waits {@link ANALYSIS_REFETCH_AFTER_MS} instead.
 */
export const ANALYSIS_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * How long a track whose audio could not be FETCHED waits before anything tries
 * again: `unfetchable`, and `truncated`, which is a fetch that happened to
 * deliver some bytes. It is also the first wait for a measurement the analyzer
 * marked incomplete, which is usually the same cut transfer answered as a
 * success (see `listTracksNeedingAnalysis`).
 *
 * That is a fact about the binding or the moment rather than the file (a
 * provider was down, a signed url expired), and a day is longer than that
 * usually lasts. It cannot become a loop on a dead binding, because
 * `TrackAudioService` marks a binding that keeps failing `missing_at` and the
 * walk skips it. An hour is a first figure, not a measured one.
 */
export const ANALYSIS_REFETCH_AFTER_MS = 60 * 60 * 1000;

/** A track the walk picked up, and the binding that can actually serve its audio. */
export interface AnalysableTrack {
    trackId: string;
    title: string;
    artistName: string;
    /**
     * The binding to fetch the audio from: the key of `deadair.track_sources`.
     *
     * A track can have several, and this picks the most recently seen. **The
     * measurement is then treated as a property of the WORK rather than of that
     * copy**, which is an assumption worth stating: two providers serving the
     * same recording are assumed to be serving the same master. Where that fails
     * — a remaster with a different fade, a radio edit bound as if it were the
     * album cut — the cue points describe one copy and get used for another. The
     * catalog's own identity rules are what keep those apart, so this inherits
     * whatever they decide rather than second-guessing them here.
     */
    pluginId: string;
    externalId: string;
    /** The catalog's claim about the length, for the truncation cross-check. */
    durationMs?: number;
}

/** What one track's measurement says, once. Only rows that can be trusted are returned. */
export interface StoredAnalysis {
    trackId: string;
    schemaVersion: number;
    data: TrackCuePoints & Record<string, unknown>;
}

@Injectable()
export class AnalysisRepository extends DataRepository {
    /**
     * Tracks with no measurement a reader would use, and due another go.
     *
     * Four states are all "needs work" and only one of them is the obvious one:
     * no row at all, a row below `schemaVersion`, a row that failed long enough
     * ago to be worth another go, and a row measured from PART of a file long
     * enough ago. Folding them into one query is what makes reanalysis after a
     * detector upgrade an ordinary pass rather than a migration — bump the
     * version, and every stale row rejoins the queue on its own.
     *
     * **INCOMPLETE. A measurement of part of a file is retried, on a doubling
     * wait capped at a day.** The analyzer reports a short transfer (fewer bytes
     * than `Content-Length` promised, or a decode much shorter than the catalog's
     * duration) as a SUCCESSFUL answer with `complete = false`, not as a failure,
     * so the row carries `analyzed_at` and no `failed_at`. Without this branch
     * that row matched none of the other three, and since
     * {@link trustedAnalysisFor} ignores it, the record aired with no levelling
     * and no cue points for as long as it stayed in the library. A cut transfer
     * is a fact about the moment, so the first retry waits
     * {@link ANALYSIS_REFETCH_AFTER_MS}, the same as `truncated`.
     *
     * The other cause does not go away: a provider whose claimed duration is
     * simply wrong (a preview clip, a different edit) answers incomplete on every
     * attempt. The table keeps no attempt count, so the wait is derived from what
     * it does keep: each retry waits as long as the row has existed
     * (`analyzed_at - created_at`), which doubles it (an hour, an hour, two, four)
     * without a column to count with. It is capped at
     * {@link ANALYSIS_RETRY_AFTER_MS}, for two reasons. A permanently short
     * record then costs exactly what an undecodable one already does, one
     * attempt a day, and by then its bytes are usually local, so that attempt is
     * a decode rather than a provider download. And `created_at` is when the row
     * FIRST appeared, which for a record measured whole months ago and short
     * today is months before this trouble began: uncapped, its first retry would
     * wait months.
     *
     * **A binding is required, not merely preferred**, and it is returned rather
     * than merely tested for. A canonical track no provider still serves has no
     * audio to measure, so including it would mean resolving a URL that cannot
     * exist and recording a failure that says nothing about the track. The
     * `missing_at is null` test is `CandidatesRepository.sample`'s, for the same
     * reason it has it.
     *
     * The binding is chosen by whether its audio is already on this machine
     * FIRST, then by `last_seen_at`, and never by the operator's provider order,
     * which is what the director's `bindingsFor` takes. Nothing supplies that
     * order yet — its only caller passes nothing — so honouring it here would be
     * honouring an empty list. Worth revisiting together if a preference setting
     * ever lands: measuring one copy and airing another is the failure it would
     * prevent.
     *
     * **A track whose bytes are already local is measured first, and the same
     * fact picks its binding.** The batch size is small because measuring costs a
     * full audio download through the credential playout shares (see
     * `BATCH_SIZE`), and that bill is exactly zero for a copy `TrackAudioService`
     * has already kept: `ensure` reads the file before it reaches for the
     * provider. So the cheap half of the library is measured at no cost to
     * playout, and the expensive half is left to the pace. The two orderings are
     * one decision — preferring a local BINDING and then a local TRACK — because
     * choosing the copy the station has already aired is also the copy whose cue
     * points describe what a listener will hear.
     *
     * The `checksum is not null` test is what makes a row a cache hit rather than
     * a remembered failure, matching every other reader of that table. It cannot
     * check the FILE, which `TrackAudioService.readyFor` does, so a row whose file
     * was deleted sorts to the front and then costs an ordinary re-fetch. That is
     * the repair path working rather than a case to defend against here.
     *
     * Oldest-catalogued first within each half, so a run makes predictable
     * progress through a library rather than revisiting whatever Postgres felt
     * like returning.
     *
     * **REMEASURE. A record that already holds a whole measurement goes last, and
     * waits a day after a failed try.** Last, because a schema bump makes the whole
     * library stale, nearly all of it local and older than anything new, and every
     * one of those rows would otherwise sort ahead of a record added today. That
     * record would air with no level for days, to improve records that already have
     * one. The wait is {@link ANALYSIS_RETRY_AFTER_MS} whatever went wrong, because
     * nothing is urgent about improving a row that works, and without it one bad
     * file would sit at the head of the queue on every pass.
     */
    async listTracksNeedingAnalysis(schemaVersion: number, limit: number): Promise<AnalysableTrack[]> {
        const rows = await sql<{
            trackId: string;
            title: string;
            artistName: string;
            pluginId: string;
            externalId: string;
            durationMs: number | null;
        }>`
            select t.id as track_id,
                   t.title,
                   ar.name as artist_name,
                   src.plugin_id,
                   src.external_id,
                   coalesce(src.duration_ms, t.duration_ms) as duration_ms
              from deadair.tracks t
              join deadair.artists ar on ar.id = t.artist_id
              left join deadair.track_analysis a on a.track_id = t.id
              -- The one binding to measure, rather than a row per binding: a lateral
              -- so the choice is made in the same pass as the filter, and so a track
              -- with three copies is one row here rather than three units of work
              -- measuring the same recording.
              join lateral (
                  select s.plugin_id, s.external_id, s.duration_ms, au.source_id is not null as is_local
                    from deadair.track_sources s
                    left join deadair.track_audio au on au.source_id = s.id and au.checksum is not null
                   where s.track_id = t.id
                     and s.playable
                     and s.missing_at is null
                   order by (au.source_id is not null) desc, s.last_seen_at desc nulls last, s.created_at desc
                   limit 1
              ) src on true
             where t.merged_into_id is null
               and (
                   a.track_id is null
                   -- Stale, unless re-measuring it just went wrong: see REMEASURE above.
                   or (a.analyzed_at is not null
                       and a.schema_version < ${schemaVersion}
                       and (a.remeasure_failed_at is null
                            or a.remeasure_failed_at < now() - make_interval(secs => ${ANALYSIS_RETRY_AFTER_MS / 1000}::double precision)))
                   or (a.failed_at is not null
                       and a.failed_at < now() - make_interval(secs => case when a.failure_code in ('unfetchable', 'truncated')
                                                                             then ${ANALYSIS_REFETCH_AFTER_MS / 1000}::double precision
                                                                             else ${ANALYSIS_RETRY_AFTER_MS / 1000}::double precision end))
                   -- A measurement of part of a file: see INCOMPLETE above for the doubling wait and its cap.
                   or (a.analyzed_at is not null
                       and not a.complete
                       and a.analyzed_at < now() - least(greatest(make_interval(secs => ${ANALYSIS_REFETCH_AFTER_MS / 1000}::double precision),
                                                                  a.analyzed_at - a.created_at),
                                                         make_interval(secs => ${ANALYSIS_RETRY_AFTER_MS / 1000}::double precision)))
               )
             order by coalesce(a.analyzed_at is not null and a.complete, false) asc, src.is_local desc, t.created_at asc
             limit ${limit}
        `.execute(this.db);

        return rows.rows.map(row => ({
            trackId: row.trackId,
            title: row.title,
            artistName: row.artistName,
            pluginId: row.pluginId,
            externalId: row.externalId,
            ...(row.durationMs == null ? {} : { durationMs: row.durationMs }),
        }));
    }

    /**
     * Store a measurement, replacing whatever was there.
     *
     * `failedAt` and `failureReason` are cleared explicitly rather than left
     * alone, because the table's outcome constraint permits a row to be a
     * measurement or a failure and never both. A track that failed last week and
     * succeeds today would otherwise violate it on write, which is the
     * constraint doing its job — the point of clearing them here is that the
     * success is what the row now says.
     *
     * **An incomplete answer does not replace a whole measurement.** Part of a file
     * is confident and wrong, and no reader uses it, so writing it would swap
     * figures that are in use for figures that are not.
     */
    async recordAnalysis(trackId: string, analyzerPluginId: string, result: TrackAnalysis): Promise<void> {
        if (!result.complete && (await this.noteFailedRemeasure(trackId))) return;

        const row = {
            trackId,
            analyzerPluginId,
            analyzer: result.analyzer ?? null,
            data: toJsonb(result.data),
            schemaVersion: result.schemaVersion,
            complete: result.complete,
            analyzedAt: sql<never>`now()`,
            failedAt: null,
            failureReason: null,
            failureCode: null,
            remeasureFailedAt: null,
        };

        await this.db
            .insertInto('deadair.trackAnalysis')
            .values(row)
            .onConflict(oc => oc.column('trackId').doUpdateSet(row))
            .execute();
    }

    /**
     * Keep a whole measurement through a re-measure that went wrong, noting when it did. Answers
     * whether there was one, since a record with none has nothing to keep and records its failure.
     */
    private async noteFailedRemeasure(trackId: string): Promise<boolean> {
        const updated = await this.db
            .updateTable('deadair.trackAnalysis')
            .set({ remeasureFailedAt: sql<never>`now()` })
            .where('trackId', '=', trackId)
            .where('analyzedAt', 'is not', null)
            .where('complete', '=', true)
            .executeTakeFirst();

        return Number(updated.numUpdatedRows ?? 0n) > 0;
    }

    /**
     * Remember that this track could not be measured, and why.
     *
     * **A record that already holds a whole measurement keeps it**, since the only
     * way the walk reaches one is a re-measure, and the figures are still true
     * whatever went wrong this time. Most failures are a moment's fetch problem, and
     * dropping the figures would cost a record its level until the walk came back.
     * An operator who wants the figures gone clears them ({@link clearFor}).
     *
     * Otherwise there is no measurement to keep, and this is what the row says.
     *
     * `code` is the analyzer's own name for the failure, which decides how soon
     * the walk tries again (see {@link ANALYSIS_REFETCH_AFTER_MS}); absent, the
     * failure waits the long way.
     */
    async recordFailure(trackId: string, analyzerPluginId: string, reason: string, code?: AnalysisFailureCode): Promise<void> {
        if (await this.noteFailedRemeasure(trackId)) return;

        const row = {
            trackId,
            analyzerPluginId,
            analyzer: null,
            // No measurement to carry, or the guard above would have kept it. `{}` also
            // cannot be mistaken for cue points by a reader that skipped the `complete` check.
            data: toJsonb({}),
            schemaVersion: 0,
            complete: false,
            analyzedAt: null,
            failedAt: sql<never>`now()`,
            // Bounded, because this is an upstream's error text and ends up on a console.
            failureReason: reason.slice(0, 500),
            failureCode: code ?? null,
            remeasureFailedAt: null,
        };

        await this.db
            .insertInto('deadair.trackAnalysis')
            .values(row)
            .onConflict(oc => oc.column('trackId').doUpdateSet(row))
            .execute();
    }

    /**
     * The measurement row as it stands, trustworthy or not.
     *
     * The opposite of {@link trustedAnalysisFor}, deliberately: that one collapses "no row", "failed"
     * and "measured at an older schema" into one answer because every CONSUMER of a measurement
     * wants exactly that. A page explaining why a record behaves as it does needs them apart — a
     * record nothing has tried and a record whose decode failed at 03:12 are different problems with
     * different fixes.
     *
     * **`complete` is not `analyzedAt`** and both come back. A measurement of a truncated download is
     * confident and wrong (`0005_music.sql` says so at length), so a row can carry a date and still
     * be something no reader will use.
     */
    async stateFor(trackId: string) {
        const row = await this.db
            .selectFrom('deadair.trackAnalysis')
            .select(['schemaVersion', 'complete', 'analyzer', 'analyzerPluginId', 'analyzedAt', 'failedAt', 'failureReason', 'failureCode'])
            .where('trackId', '=', trackId)
            .executeTakeFirst();
        if (row === undefined) return undefined;

        const { failureCode, ...rest } = row;
        // A failure written before 0086 has no code and is retried as `undecodable` is, so it is
        // reported as one. A row that did not fail carries none at all.
        if (row.failedAt == null) return rest;
        return { ...rest, failureCode: isFailureCode(failureCode) ? failureCode : 'undecodable' };
    }

    /**
     * Forget a record's measurement, so the walk takes it again.
     *
     * A delete rather than a flag, because the absence of a row is the one state the walk takes on
     * its very next pass, with no wait: the same state every track starts in. A row that failed or
     * measured only part of a file is in the queue too, but each waits its retry interval first (see
     * {@link listTracksNeedingAnalysis}), and the point of clearing is not to wait. Nothing else has
     * to know this happened.
     *
     * The cheapest of the clears to get right and the most useful: a detector that turns out to have
     * been wrong about a class of records is what `analyzer_plugin_id` exists to attribute, and this
     * is what does something about it.
     */
    async clearFor(trackId: string): Promise<number> {
        const result = await this.db.deleteFrom('deadair.trackAnalysis').where('trackId', '=', trackId).executeTakeFirst();

        return Number(result.numDeletedRows ?? 0n);
    }

    /**
     * The measurements for a batch of tracks, for the callers that act on them.
     *
     * **Filters to rows that can be trusted, rather than returning everything and
     * leaving the checks to the caller.** Three states are excluded and each one
     * would otherwise become a subtly wrong decision somewhere downstream:
     *
     * - a failure, which carries no measurements at all;
     * - `complete = false`, where the analyzer saw part of a file and its outro
     *   is a description of where the download stopped;
     * - a row below `schemaVersion`, whose fields may have changed meaning. Callers pass
     *   `ANALYSIS_READABLE_SINCE_VERSION` here, and not the current version, which is the walk's question.
     *
     * The absence of a row and the presence of an untrustworthy one are the same
     * answer to every consumer — no opinion, degrade to the defined behaviour —
     * so collapsing them here is what stops each caller from re-deriving the
     * rule and one of them getting it wrong.
     */
    async trustedAnalysisFor(trackIds: readonly string[], schemaVersion: number): Promise<Map<string, StoredAnalysis>> {
        const found = new Map<string, StoredAnalysis>();
        if (trackIds.length === 0) return found;

        const rows = await this.db
            .selectFrom('deadair.trackAnalysis')
            .select(['trackId', 'schemaVersion', 'data'])
            .where('trackId', 'in', [...trackIds])
            .where('analyzedAt', 'is not', null)
            .where('complete', '=', true)
            .where('schemaVersion', '>=', schemaVersion)
            .execute();

        for (const row of rows) {
            found.set(row.trackId, {
                trackId: row.trackId,
                schemaVersion: row.schemaVersion,
                data: row.data as unknown as TrackCuePoints & Record<string, unknown>,
            });
        }
        return found;
    }
}

/** Whether a stored code is one the SDK still names. The column is free text, so a read checks. */
const isFailureCode = (code: string | null | undefined): code is AnalysisFailureCode =>
    typeof code === 'string' && (ANALYSIS_FAILURE_CODES as readonly string[]).includes(code);
