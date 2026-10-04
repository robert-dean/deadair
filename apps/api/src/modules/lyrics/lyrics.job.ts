import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { LineupPriorityReader, NO_PRIORITY } from '#modules/enrichment/lineup.priority.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { LYRICS_FETCH_DEFAULT, LYRICS_KEYS } from './lyrics.keys.js';
import { LyricsService } from './lyrics.service.js';

/** Records examined per run: a ceiling, with {@link RUN_BUDGET_MS} as what actually stops the walk. */
const BATCH_SIZE = 75;

/** Inside the cron interval and the job's `expiresIn`, so a slow source cannot make two runs overlap. */
export const RUN_BUDGET_MS = 11 * 60 * 1000;

export interface LyricsPayload {
    /** Overrides {@link BATCH_SIZE} for one run. Absent from cron. */
    limit?: number;
}

/**
 * The lyrics walk: ask every lyrics plugin about the records it has not answered for.
 *
 * Gated on `lyrics.fetch`, which is off, so an installed lyrics plugin does nothing until the
 * operator says so. A `PlainJob` for `EnrichmentJob`'s reason: a long walk with paced network in the
 * middle must not pin a connection or hold one snapshot open, and each record settles on its own.
 */
@Injectable()
export class LyricsJob extends PlainJob<LyricsPayload> {
    constructor(
        private readonly lyrics: LyricsService,
        private readonly priority: LineupPriorityReader,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: LyricsPayload, signal?: AbortSignal): Promise<void> {
        if (!settingIsOn(this.config, LYRICS_KEYS.fetch, LYRICS_FETCH_DEFAULT)) return;

        // Read once per run, and a failure to read it degrades to the walk without a priority rather
        // than to no walk, on `EnrichmentJob`'s rule.
        const priority = await this.priority.read().catch(error => {
            this.logger.warn('lyrics: could not read what the station is about to play', { error: errorText(error) });
            return NO_PRIORITY;
        });

        const { result, outOfTime } = await withRunBudget(RUN_BUDGET_MS, signal, async stop =>
            this.lyrics.fetchPending(payload?.limit ?? BATCH_SIZE, stop, priority.trackIds),
        );

        // Quiet when there was nothing to do, so an idle station does not log every quarter hour.
        if (result.scanned > 0) this.logger.info('lyrics pass', { job: this.context.id, ...result, ahead: priority.trackIds.length, outOfTime });
    }
}
