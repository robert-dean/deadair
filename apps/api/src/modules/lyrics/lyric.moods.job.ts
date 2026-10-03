import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { LineupPriorityReader, NO_PRIORITY } from '#modules/enrichment/lineup.priority.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { LYRIC_MOODS_DEFAULT, LYRIC_MOODS_KEYS } from './lyrics.keys.js';
import { LyricMoodsService } from './lyric.moods.service.js';

/** Records judged per run at most. Each is a generation and maybe two searches, so this is small. */
const BATCH_SIZE = 20;

/** Inside the cron interval and the job's `expiresIn`. */
export const RUN_BUDGET_MS = 11 * 60 * 1000;

export interface LyricMoodsPayload {
    limit?: number;
}

/**
 * The mood walk: have the model judge the records with no judgement under the current instructions.
 *
 * Gated on `lyrics.moods`, which is off. A `PlainJob` for the lyrics walk's reason, and led by what
 * the station is about to play for the same one.
 */
@Injectable()
export class LyricMoodsJob extends PlainJob<LyricMoodsPayload> {
    constructor(
        private readonly moods: LyricMoodsService,
        private readonly priority: LineupPriorityReader,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: LyricMoodsPayload, signal?: AbortSignal): Promise<void> {
        if (!settingIsOn(this.config, LYRIC_MOODS_KEYS.enabled, LYRIC_MOODS_DEFAULT)) return;

        const priority = await this.priority.read().catch(error => {
            this.logger.warn('lyric moods: could not read what the station is about to play', { error: errorText(error) });
            return NO_PRIORITY;
        });

        const { result, outOfTime } = await withRunBudget(RUN_BUDGET_MS, signal, async stop =>
            this.moods.labelPending(payload?.limit ?? BATCH_SIZE, stop, priority.trackIds),
        );

        if (result.judged + result.unplaced + result.failed > 0 || result.yielded) {
            this.logger.info('lyric moods pass', { job: this.context.id, ...result, outOfTime });
        }
    }
}
