import { Injectable } from 'injectkit';
import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import { httpError } from '@maroonedsoftware/errors';
import { AnalysisRepository } from '#modules/analysis/analysis.repository.js';
import { PlayHistoryRepository } from '#modules/director/play.history.repository.js';
import { TrackAudioRepository } from '#modules/playout/audio/track.audio.repository.js';
import { RateInput, Track, TrackDetail, TrackPage, TrackQueryInput, TrackRow } from './types/catalog.types.js';
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
        const { page, pageSize, sort, search, state } = query;
        // The version the station still trusts, passed in rather than read in the repository: what
        // counts as a good measurement is the analysis module's rule, not the catalog's.
        const listQuery = { limit: pageSize, offset: page * pageSize, sort, search, state, schemaVersion: ANALYSIS_SCHEMA_VERSION };

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
