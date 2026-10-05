import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { LineupPriorityReader, NO_PRIORITY } from '#modules/enrichment/lineup.priority.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { LYRIC_SUBJECT_KEYS, LYRIC_SUBJECTS_DEFAULT } from './lyrics.keys.js';
import { LyricSubjectsService } from './lyric.subjects.service.js';

/** Records written per run at most, as for the moods. */
const BATCH_SIZE = 20;

export const RUN_BUDGET_MS = 11 * 60 * 1000;

export interface LyricSubjectsPayload {
    limit?: number;
}

/** The subject walk, gated on `lyrics.subjects`, which is off. `LyricMoodsJob`'s shape exactly. */
@Injectable()
export class LyricSubjectsJob extends PlainJob<LyricSubjectsPayload> {
    constructor(
        private readonly subjects: LyricSubjectsService,
        private readonly priority: LineupPriorityReader,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: LyricSubjectsPayload, signal?: AbortSignal): Promise<void> {
        if (!settingIsOn(this.config, LYRIC_SUBJECT_KEYS.enabled, LYRIC_SUBJECTS_DEFAULT)) return;

        const priority = await this.priority.read().catch(error => {
            this.logger.warn('lyric subjects: could not read what the station is about to play', { error: errorText(error) });
            return NO_PRIORITY;
        });

        const { result, outOfTime } = await withRunBudget(RUN_BUDGET_MS, signal, async stop =>
            this.subjects.writePending(payload?.limit ?? BATCH_SIZE, stop, priority.trackIds),
        );

        if (result.written + result.unplaced + result.refused > 0 || result.yielded) {
            this.logger.info('lyric subjects pass', { job: this.context.id, ...result, outOfTime });
        }
    }
}
