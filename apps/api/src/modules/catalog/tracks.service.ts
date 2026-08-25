import { Injectable } from 'injectkit';
import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import { httpError } from '@maroonedsoftware/errors';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { AnalysisRepository } from '#modules/analysis/analysis.repository.js';
import { EnrichmentRepository } from '#modules/enrichment/enrichment.repository.js';
import { PlayHistoryRepository } from '#modules/director/play.history.repository.js';
import { TrackAudioRepository } from '#modules/playout/audio/track.audio.repository.js';
import { TrackAudioService } from '#modules/playout/audio/track.audio.service.js';
import {
    ClearEnrichmentQuery,
    RateInput,
    Track,
    TrackClearResult,
    TrackDetail,
    TrackPage,
    TrackQueryInput,
    TrackRow,
} from './types/catalog.types.js';
import { TracksRepository } from './tracks.repository.js';
import { ratingToColumn, withRating } from './rating.js';
import { parseAndValidate, parseAndValidateArray } from '@maroonedsoftware/zod';

/**
 * How many airings the detail read carries.
 *
 * A handful, with the true total beside them. This is "has this been on lately and how often", not a
 * log: `GET /activity` is the log, and a page that tried to be one would page through years of
 * `play_history` for a record that has aired four hundred times.
 */
const RECENT_PLAYS = 10;

@Injectable()
export class TracksService {
    constructor(
        private readonly tracksRepository: TracksRepository,
        private readonly audio: TrackAudioRepository,
        private readonly analysis: AnalysisRepository,
        private readonly history: PlayHistoryRepository,
        private readonly enrichment: EnrichmentRepository,
        // The singleton behind the files, not the rows: the in-flight map and the committable window
        // it protects are in memory there, and a clear that only knew about rows could take a file
        // out from under a record about to air.
        private readonly audioService: TrackAudioService,
        // Who is asking. The one thing that tells a person's decision from the station's, which is
        // what `station_events.actor_id` is for.
        private readonly context: AuthorizationContext,
        private readonly activity: ActivityRecorder,
    ) {}

    async listTracks(query: TrackQueryInput): Promise<TrackPage> {
        return this.page(query);
    }

    /**
     * One record and everything it has accumulated.
     *
     * Four reads rather than one join, and that is the honest shape: the copies, the measurement and
     * the airings are three tables with three cardinalities, and joining them would multiply rows
     * and then have to be unpicked in code anyway. They are independent, so they go together.
     *
     * **Enrichment is deliberately not here.** `GET /catalog/tracks/{id}/enrichment` already answers
     * every provider's payload and the station's own sourced claims, and the console draws both
     * through the same panel the list uses. A second enrichment shape on this read would be a second
     * thing to keep in step with the first.
     *
     * @throws 404 when no such track exists, and equally when it was merged into another.
     */
    async getTrack(id: string): Promise<TrackDetail> {
        const row = await this.tracksRepository.findTrack(id);
        if (row === undefined) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });

        const [bindings, analysis, history] = await Promise.all([
            this.audio.bindingsForTrack(id),
            this.analysis.stateFor(id),
            this.history.forTrack(id, RECENT_PLAYS),
        ]);

        return parseAndValidate(
            {
                ...withRating(row),
                bindings,
                // `complete` and `analyzedAt` travel separately all the way to the wire; see the
                // contract's note and `0005_music.sql`.
                ...(analysis === undefined ? {} : { analysis }),
                plays: history.plays,
                playCount: history.total,
            },
            TrackDetail,
        );
    }

    /** An album with no tracks is an empty page; the album's own endpoint is what says whether the id exists. */
    async listTracksByAlbum(albumId: string, query: TrackQueryInput): Promise<TrackPage> {
        return this.page(query, albumId);
    }

    /**
     * Throw away the station's own copies of a record.
     *
     * **Refused inside the committable window**, with a 409 and a sentence. The director commits a
     * record on its audio being present, so taking the file out from under a committed item produces
     * exactly the silence the commit gate exists to prevent — and the operator is standing there,
     * so they can be told rather than surprised. What they do about it (skip it, take it out of the
     * running order) is a decision only they can make, and both are one page away.
     *
     * @throws 404 for a record the catalog does not hold.
     * @throws 409 for a record about to air or being fetched right now.
     */
    async clearAudio(id: string): Promise<TrackClearResult> {
        const bindings = await this.bindingsOf(id);
        const outcome = await this.audioService.clearForTrack(bindings.map(binding => binding.sourceId));

        if (outcome === undefined) {
            throw httpError(409).withDetails({
                message:
                    'this record is about to air or is being fetched right now, so its audio was left alone; skip it or take it out of the running order first',
            });
        }

        return this.cleared(id, outcome.cleared, {
            kind: 'track.audioCleared',
            detail:
                outcome.cleared === 0
                    ? 'An operator cleared the audio of a record the station was not holding any copies of.'
                    : `An operator threw away ${outcome.cleared} local ${outcome.cleared === 1 ? 'copy' : 'copies'} of a record; it will be fetched again when it next comes round.`,
            answer:
                outcome.cleared === 0
                    ? 'The station was not holding any copies of this record.'
                    : `Dropped ${outcome.cleared} ${outcome.cleared === 1 ? 'copy' : 'copies'}. The station fetches it again when it next comes round.`,
        });
    }

    /**
     * Forget a record's measurement, so the walk takes it again.
     *
     * @throws 404 for a record the catalog does not hold.
     */
    async clearAnalysis(id: string): Promise<TrackClearResult> {
        await this.mustExist(id);
        const cleared = await this.analysis.clearFor(id);

        return this.cleared(id, cleared, {
            kind: 'track.analysisCleared',
            detail:
                cleared === 0
                    ? 'An operator cleared the measurement of a record that had none.'
                    : 'An operator threw away a record’s measurement; the walk will measure it again.',
            answer: cleared === 0 ? 'This record had no measurement to clear.' : 'Cleared. The measurement walk will pick it up again.',
        });
    }

    /**
     * Forget what the providers said about a record, so the enrichment pass asks again.
     *
     * The station's own sourced claims are deliberately left alone; see
     * `EnrichmentRepository.clearTrackEnrichment` for why, and for what else survives.
     *
     * @throws 404 for a record the catalog does not hold.
     */
    async clearEnrichment(id: string, query: ClearEnrichmentQuery): Promise<TrackClearResult> {
        await this.mustExist(id);
        const cleared = await this.enrichment.clearTrackEnrichment(id, query.provider);
        const scope = query.provider === undefined ? 'every provider’s answer' : `${query.provider}’s answer`;

        return this.cleared(id, cleared, {
            kind: 'track.enrichmentCleared',
            detail:
                cleared === 0
                    ? `An operator cleared ${scope} about a record that had none stored.`
                    : `An operator threw away ${scope} about a record; the enrichment pass will ask again.`,
            answer:
                cleared === 0
                    ? 'Nothing was stored about this record to clear.'
                    : `Cleared ${cleared} stored ${cleared === 1 ? 'answer' : 'answers'}. The enrichment pass will ask again. The station’s own facts are untouched.`,
            ...(query.provider === undefined ? {} : { data: { provider: query.provider } }),
        });
    }

    /**
     * Let every copy of a record be tried again now.
     *
     * Its own verb rather than part of clearing the audio, because it is a different instruction:
     * this says "the upstream is fixed, stop waiting", and it is what an operator wants after they
     * have gone and done something about a 502. Today the only other thing that clears a bench is
     * the hourly sync happening to re-sight the copy.
     *
     * @throws 404 for a record the catalog does not hold.
     */
    async retryAudio(id: string): Promise<TrackClearResult> {
        await this.mustExist(id);
        const reopened = await this.audio.retryForTrack(id);

        return this.cleared(id, reopened, {
            kind: 'track.retryReset',
            detail:
                reopened === 0
                    ? 'An operator asked the station to try a record again, but no provider holds a copy of it.'
                    : `An operator reopened ${reopened} ${reopened === 1 ? 'copy' : 'copies'} of a record for another attempt.`,
            answer:
                reopened === 0
                    ? 'No provider holds a copy of this record, so there is nothing to try.'
                    : `${reopened} ${reopened === 1 ? 'copy is' : 'copies are'} available to try again straight away.`,
        });
    }

    /** The bindings of a record, or a 404 if the catalog does not hold it. */
    private async bindingsOf(id: string) {
        await this.mustExist(id);
        return await this.audio.bindingsForTrack(id);
    }

    /** A record has to exist before anything can be thrown away about it. */
    private async mustExist(id: string): Promise<void> {
        const row = await this.tracksRepository.findTrack(id);
        if (row === undefined) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });
    }

    /**
     * The answer, plus the operator event that explains what follows.
     *
     * Every clear is written to the feed with the actor who asked, like `plugin.*` and
     * `airMode.set`: a re-fetch or a re-measure that appeared from nowhere reads as the station
     * churning for no reason. `void`ed and never thrown, because nothing reads these rows to decide
     * anything and a failed insert must not cost the operator the thing they just did.
     */
    private cleared(
        trackId: string,
        count: number,
        event: { kind: string; detail: string; answer: string; data?: Record<string, unknown> },
    ): TrackClearResult {
        void this.activity.record({
            module: 'catalog',
            kind: event.kind,
            severity: 'info',
            detail: event.detail,
            // The record is in `data` rather than as a column: `station_events` holds the station's
            // own moments and has never had a track reference, and the feed's track arm comes from
            // `play_history`. A clear is a thing an operator did, not a thing that aired.
            data: { trackId, cleared: count, ...(event.data ?? {}) },
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
        });

        return { trackId, cleared: count, detail: event.answer };
    }

    /**
     * The actor to stamp on an event, when there is one.
     *
     * A user id or nothing. Every clear is behind `platform.manage`, so in practice there is always
     * a user; the `undefined` arm is what a job would look like if one ever reached these.
     */
    private actor(): string | undefined {
        return this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;
    }

    /**
     * What the station thinks of this song, which is the narrowest an opinion can be: it says
     * nothing about the record it is on or the artist who made it.
     *
     * Re-read rather than echoed, for the reason `ArtistsService.rateArtist` is.
     *
     * @throws 404 when no such track exists, and equally when it was merged into another.
     */
    async rateTrack(id: string, input: RateInput): Promise<Track> {
        const rated = await this.tracksRepository.setRating(id, ratingToColumn(input.rating));
        if (!rated) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });

        // Unreachable in practice: the update just matched a row this same request is about to read
        // back, on a table nothing else deletes from.
        const row = await this.tracksRepository.findTrack(id);
        if (row === undefined) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });
        return parseAndValidate(withRating(row), Track);
    }

    /**
     * One page of tracks, plus what the station has of the whole set.
     *
     * The counts run beside the page rather than being derived from it, and they ignore the state
     * filter while the page honours it: the counts are what an operator CHOOSES a filter from, so
     * narrowing them by the current choice would answer "of the benched records, how many are
     * benched". Both go through the same search and album narrowing, so the denominator is the set
     * the operator is looking at.
     */
    private async page(query: TrackQueryInput, albumId?: string): Promise<TrackPage> {
        const { page, pageSize, sort, search, state, sortBy } = query;
        // The version the station still trusts, passed in rather than read in the repository: what
        // counts as a good measurement is the analysis module's rule, not the catalog's.
        const listQuery = { limit: pageSize, offset: page * pageSize, sort, search, state, sortBy, schemaVersion: ANALYSIS_SCHEMA_VERSION };

        const [{ total, data }, states] = await Promise.all([
            this.tracksRepository.listTracks(listQuery, albumId),
            this.tracksRepository.trackStateCounts(listQuery, albumId),
        ]);

        return {
            meta: { total, page, pageSize, sort },
            data: await parseAndValidateArray(data.map(withRating), TrackRow),
            states,
        };
    }
}
