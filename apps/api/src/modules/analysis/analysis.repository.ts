import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { TrackAnalysis, TrackCuePoints } from '@deadair/plugin-sdk';
import { DataRepository } from '../data/data.repository.js';

/**
 * How long a track that could not be measured waits before anything tries again.
 *
 * Long, and deliberately much longer than the enrichment tables' TTLs, because
 * the two failures cost different things. A missing enrichment row is one
 * request against a rate-limited upstream; a missing analysis row is a full
 * download and decode, so retrying it on the ordinary walk means paying for the
 * same undecodable file every pass forever.
 *
 * Most of what lands here is permanent — a track whose provider serves something
 * that is not audio, or a format the analyzer does not know — so the retry
 * exists for the minority case where the cause was transient (the analyzer was
 * down, the URL had expired) and a day is soon enough for that.
 */
export const ANALYSIS_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

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
     * Tracks that have never been measured, or were measured by something older.
     *
     * Three states are all "needs work" and only one of them is the obvious one:
     * no row at all, a row below `schemaVersion`, and a row that failed long
     * enough ago to be worth another go. Folding them into one query is what
     * makes reanalysis after a detector upgrade an ordinary pass rather than a
     * migration — bump the version, and every stale row rejoins the queue on its
     * own.
     *
     * **A binding is required, not merely preferred**, and it is returned rather
     * than merely tested for. A canonical track no provider still serves has no
     * audio to measure, so including it would mean resolving a URL that cannot
     * exist and recording a failure that says nothing about the track. The
     * `missing_at is null` test is `CandidatesRepository.sample`'s, for the same
     * reason it has it.
     *
     * The binding is chosen by `last_seen_at` rather than by the operator's
     * provider order, which is what the director's `bindingsFor` takes. Nothing
     * supplies that order yet — its only caller passes nothing — so honouring it
     * here would be honouring an empty list, and the most recently seen copy is
     * at least deterministic. Worth revisiting together if a preference setting
     * ever lands: measuring one copy and airing another is the failure it would
     * prevent.
     *
     * Ordered oldest-catalogued first so a run makes predictable progress through
     * a library rather than revisiting whatever Postgres felt like returning.
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
                  select s.plugin_id, s.external_id, s.duration_ms
                    from deadair.track_sources s
                   where s.track_id = t.id
                     and s.playable
                     and s.missing_at is null
                   order by s.last_seen_at desc nulls last, s.created_at desc
                   limit 1
              ) src on true
             where t.merged_into_id is null
               and (
                   a.track_id is null
                   or (a.analyzed_at is not null and a.schema_version < ${schemaVersion})
                   or (a.failed_at is not null and a.failed_at < now() - make_interval(secs => ${ANALYSIS_RETRY_AFTER_MS / 1000}))
               )
             order by t.created_at asc
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
     */
    async recordAnalysis(trackId: string, analyzerPluginId: string, result: TrackAnalysis): Promise<void> {
        const row = {
            trackId,
            analyzerPluginId,
            analyzer: result.analyzer ?? null,
            data: JSON.stringify(result.data) as unknown as never,
            schemaVersion: result.schemaVersion,
            complete: result.complete,
            analyzedAt: sql<never>`now()`,
            failedAt: null,
            failureReason: null,
        };

        await this.db
            .insertInto('deadair.trackAnalysis')
            .values(row)
            .onConflict(oc => oc.column('trackId').doUpdateSet(row))
            .execute();
    }

    /**
     * Remember that this track could not be measured, and why.
     *
     * The measurement is dropped rather than kept alongside the failure, for the
     * same reason the constraint forbids holding both: a row that carries stale
     * numbers AND a failure has to be interpreted by every reader, and one of
     * them eventually reads the numbers. A track that once measured and now
     * fails is a track whose audio changed, which makes the old figures wrong
     * rather than merely old.
     */
    async recordFailure(trackId: string, analyzerPluginId: string, reason: string): Promise<void> {
        const row = {
            trackId,
            analyzerPluginId,
            analyzer: null,
            // Not the previous measurement: see above. `{}` also cannot be mistaken
            // for cue points by a reader that skipped the `complete` check.
            data: JSON.stringify({}) as unknown as never,
            schemaVersion: 0,
            complete: false,
            analyzedAt: null,
            failedAt: sql<never>`now()`,
            // Bounded, because this is an upstream's error text and ends up on a console.
            failureReason: reason.slice(0, 500),
        };

        await this.db
            .insertInto('deadair.trackAnalysis')
            .values(row)
            .onConflict(oc => oc.column('trackId').doUpdateSet(row))
            .execute();
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
     * - a row below `schemaVersion`, whose fields may have changed meaning.
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
