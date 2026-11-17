import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { LineupPriorityReader, NO_PRIORITY } from '#modules/enrichment/lineup.priority.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { ArtistGenreService } from './artist.genre.service.js';
import { ARTIST_GENRES_DEFAULT, MIX_FLOW_KEYS } from './mix.flow.keys.js';

/** Bands named per run at most. Each is a generation and maybe two searches. */
const BATCH_SIZE = 20;

/** Inside the cron interval and the job's `expiresIn`. */
export const ARTIST_GENRE_RUN_BUDGET_MS = 11 * 60 * 1000;

export interface ArtistGenrePayload {
    limit?: number;
}

/**
 * The genre walk: have the model name a main genre for bands their enrichment gives none. Gated on
 * `mixFlow.artistGenres`, which is off, and led by what the station is about to play. `LyricMoodsJob`'s
 * shape exactly.
 */
@Injectable()
export class ArtistGenreJob extends PlainJob<ArtistGenrePayload> {
    constructor(
        private readonly genres: ArtistGenreService,
        private readonly priority: LineupPriorityReader,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: ArtistGenrePayload, signal?: AbortSignal): Promise<void> {
        if (!settingIsOn(this.config, MIX_FLOW_KEYS.artistGenres, ARTIST_GENRES_DEFAULT)) return;

        const priority = await this.priority.read().catch(error => {
            this.logger.warn('artist genres: could not read what the station is about to play', { error: errorText(error) });
            return NO_PRIORITY;
        });

        const { result, outOfTime } = await withRunBudget(ARTIST_GENRE_RUN_BUDGET_MS, signal, async stop =>
            this.genres.namePending(payload?.limit ?? BATCH_SIZE, stop, priority.trackIds),
        );

        if (result.named + result.unplaced + result.failed > 0 || result.yielded) {
            this.logger.info('artist genres pass', { job: this.context.id, ...result, outOfTime });
        }
    }
}
