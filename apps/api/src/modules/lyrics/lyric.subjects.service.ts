import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { LlmService } from '#modules/llm/llm.service.js';
import { SearchService } from '#modules/search/search.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { LYRIC_SUBJECT_KEYS } from './lyrics.keys.js';
import { LyricLabelsRepository } from './lyric.labels.repository.js';
import {
    MOODS_BUDGET_MS,
    MOODS_FAILURE_MAX_RETRY_MS,
    MOODS_FAILURE_RETRY_MS,
    MOODS_MAX_SEARCHES,
    MOODS_PRIORITY,
    MOODS_WAIT_MS,
} from './lyric.moods.service.js';
import { readSubject, subjectPrompt, SUBJECT_VERSION } from './lyric.subject.js';

export interface SubjectsPassSummary {
    written: number;
    unplaced: number;
    /** Refused for quoting the lyric, running long, answering nothing readable or running out of time. Retried later. */
    refused: number;
    yielded: boolean;
}

/**
 * Has the station's model say what each record is about, on the mood walk's terms exactly: background
 * priority, the web search the only tool and only where the station can search, a pass that stops
 * when the model is busy, and no capture of a prompt that carries a lyric.
 *
 * The difference is what comes back. A mood is numbers; a subject is words a presenter will be shown,
 * so it is checked against the lyric before it is stored (`readSubject`), and one that shares a run of
 * words with it is refused and asked for again later rather than kept.
 */
@Injectable()
export class LyricSubjectsService {
    constructor(
        private readonly labels: LyricLabelsRepository,
        private readonly llm: LlmService,
        private readonly search: SearchService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    async writePending(limit: number, signal?: AbortSignal, priority: readonly string[] = []): Promise<SubjectsPassSummary> {
        const summary: SubjectsPassSummary = { written: 0, unplaced: 0, refused: 0, yielded: false };
        const searchable = this.search.hasSearch();
        const model = this.config.get(LYRIC_SUBJECT_KEYS.model, '').trim();

        for (const candidate of await this.labels.listTracksNeedingSubjects(SUBJECT_VERSION, limit, searchable, priority)) {
            if (signal?.aborted) break;

            let answer;
            try {
                answer = await this.llm.converse(
                    { messages: subjectPrompt(candidate, searchable), ...(model.length === 0 ? {} : { model }), reasoningEffort: 'low' },
                    {
                        budgetMs: MOODS_BUDGET_MS,
                        maxWaitMs: MOODS_WAIT_MS,
                        priority: MOODS_PRIORITY,
                        ...(searchable ? { onlyTools: ['search_web'], maxToolSteps: MOODS_MAX_SEARCHES } : { tools: false }),
                    },
                );
            } catch (error) {
                this.logger.info('lyric subjects: the model was not available, so the pass stopped', { error: errorText(error) });
                summary.yielded = true;
                break;
            }
            if (answer.finishReason === 'preempted') {
                summary.yielded = true;
                break;
            }

            // Too slow for this record, on the mood walk's reasoning: retried later, and the pass
            // carries on rather than stopping as it does for a preemption.
            if (answer.finishReason === 'budget') {
                summary.refused++;
                try {
                    await this.labels.recordSubjectFailure(
                        candidate.trackId,
                        'the model ran out of time',
                        MOODS_FAILURE_RETRY_MS,
                        MOODS_FAILURE_MAX_RETRY_MS,
                    );
                } catch (error) {
                    this.logger.warn('lyric subjects: could not record an answer that ran out of time', {
                        trackId: candidate.trackId,
                        error: errorText(error),
                    });
                }
                continue;
            }

            const read = readSubject(answer.text, candidate.lyric);
            try {
                if (read === 'unknown') {
                    summary.unplaced++;
                    await this.labels.saveSubject(candidate.trackId, undefined, SUBJECT_VERSION, candidate.lyric !== undefined);
                } else if ('refused' in read) {
                    summary.refused++;
                    // Logged by reason only: the refused words may BE the lyric.
                    this.logger.info('lyric subjects: refused an answer', { trackId: candidate.trackId, reason: read.refused });
                    await this.labels.recordSubjectFailure(candidate.trackId, read.refused, MOODS_FAILURE_RETRY_MS, MOODS_FAILURE_MAX_RETRY_MS);
                } else {
                    summary.written++;
                    await this.labels.saveSubject(candidate.trackId, read.about, SUBJECT_VERSION, candidate.lyric !== undefined);
                }
            } catch (error) {
                this.logger.warn('lyric subjects: could not store an answer', { trackId: candidate.trackId, error: errorText(error) });
            }
        }

        return summary;
    }
}
