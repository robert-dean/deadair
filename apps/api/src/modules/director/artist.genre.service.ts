import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { LlmService } from '#modules/llm/llm.service.js';
import { modelList } from '#modules/llm/model.list.js';
import { SEARCH_WEB_TOOL } from '#modules/llm/websearch.tool.js';
import { SearchService } from '#modules/search/search.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { ARTIST_GENRE_VERSION, artistGenrePrompt, readArtistGenre } from './artist.genre.judge.js';
import { ArtistGenreRepository } from './artist.genre.repository.js';
import { MIX_FLOW_KEYS } from './mix.flow.keys.js';

/** Lowest, so a break or a refill always gets the model first. The mood walk's posture. */
const PRIORITY = 'background' as const;
const WAIT_MS = 5_000;
const BUDGET_MS = 90_000;
const MAX_SEARCHES = 2;
const FAILURE_RETRY_MS = 60 * 60 * 1000;
const FAILURE_MAX_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export interface GenrePassSummary {
    named: number;
    unplaced: number;
    failed: number;
    yielded: boolean;
}

/**
 * Has the station's model name a main genre for each band its enrichment gives none, so a show's mix
 * flow can split and count those bands' records by genre. `LyricMoodsService`'s shape: one band at a
 * time at background priority, a pass that stops when the model is wanted elsewhere, a band whose
 * judgement failed retried after a backoff, and the web search the only tool on offer.
 */
@Injectable()
export class ArtistGenreService {
    constructor(
        private readonly judgements: ArtistGenreRepository,
        private readonly llm: LlmService,
        private readonly search: SearchService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    async namePending(limit: number, signal?: AbortSignal, priority: readonly string[] = []): Promise<GenrePassSummary> {
        const summary: GenrePassSummary = { named: 0, unplaced: 0, failed: 0, yielded: false };
        const searchable = this.search.hasSearch();
        const models = modelList(this.config, MIX_FLOW_KEYS.genreModel);
        const model = models[0] ?? '';

        for (const candidate of await this.judgements.listArtistsNeedingGenre(ARTIST_GENRE_VERSION, limit, priority)) {
            if (signal?.aborted) break;

            let answer;
            try {
                answer = await this.llm.converse(
                    { messages: artistGenrePrompt(candidate, searchable), ...(model.length === 0 ? {} : { model }), reasoningEffort: 'low' },
                    {
                        models,
                        budgetMs: BUDGET_MS,
                        maxWaitMs: WAIT_MS,
                        priority: PRIORITY,
                        ...(searchable ? { onlyTools: [SEARCH_WEB_TOOL], maxToolSteps: MAX_SEARCHES } : { tools: false }),
                    },
                );
            } catch (error) {
                // The model was busy or unreachable, which says nothing about the band: stop the pass.
                this.logger.info('artist genres: the model was not available, so the pass stopped', { error: errorText(error) });
                summary.yielded = true;
                break;
            }
            if (answer.finishReason === 'preempted') {
                summary.yielded = true;
                break;
            }

            const genre = answer.finishReason === 'budget' ? undefined : readArtistGenre(answer.text);
            try {
                if (genre === undefined) {
                    summary.failed++;
                    const why = answer.finishReason === 'budget' ? 'the model ran out of time' : 'the answer was not a genre';
                    await this.judgements.recordFailure(candidate.artistId, why, ARTIST_GENRE_VERSION, FAILURE_RETRY_MS, FAILURE_MAX_RETRY_MS);
                } else if (genre === 'unknown') {
                    summary.unplaced++;
                    await this.judgements.save(candidate.artistId, undefined, ARTIST_GENRE_VERSION);
                } else {
                    summary.named++;
                    await this.judgements.save(candidate.artistId, genre, ARTIST_GENRE_VERSION);
                }
            } catch (error) {
                this.logger.warn('artist genres: could not store a judgement', { artistId: candidate.artistId, error: errorText(error) });
            }
        }
        return summary;
    }
}
