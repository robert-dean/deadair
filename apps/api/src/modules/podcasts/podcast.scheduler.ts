import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { isAnchored, nextOccurrence } from '#modules/director/clock.bands.js';
import { ClockBandRepository } from '#modules/director/clock.band.repository.js';
import { stationZone } from '#modules/director/clock.words.js';
import { errorText } from '#modules/shared/error.text.js';
import { FETCH_RETRY_AFTER_MS } from './podcast.fetch.service.js';
import { PodcastEpisodeRepository } from './podcast.episode.repository.js';
import { isSyndicatedKind } from './syndicated.kind.js';
import { SyndicatedSource } from './syndicated.source.js';

/**
 * How far ahead of its slot an episode's audio is fetched.
 *
 * `COMMISSION_AHEAD_MS`'s number, and the asymmetry it argues holds here too: too early costs a file
 * that sits on disk a while, too late costs a slot with nothing in it. A fetch is minutes at most,
 * so three hours is several tries' worth of slack for a publisher having a bad evening.
 */
export const FETCH_AHEAD_MS = 3 * 60 * 60_000;

/**
 * How many failed fetches of one episode the scheduler makes before it stops asking.
 *
 * Every attempt is written on the episode, so a fourth would be the same failure for the same
 * reason. An operator can still ask from the console, which is how a fixed publisher is tried again.
 */
export const MAX_AUTOMATIC_FETCH_ATTEMPTS = 3;

/**
 * Fetch the audio the format clock will want, ahead of its slot.
 *
 * `ProductionScheduler`'s job for a band the station does not write: a `syndicated` band is read
 * {@link FETCH_AHEAD_MS} ahead, the episode it will carry is decided by {@link SyndicatedSource} (the
 * same question the planner asks at the boundary), and its fetch is asked for once. By the time the
 * boundary comes round the audio is a `ready` segment and the planner only has to place it.
 *
 * ## Idempotent by the row, not by memory
 *
 * Run on every commit pass, so it must be safe to run constantly. It is, because the ask is a claim on
 * the episode's own row (`PodcastEpisodeRepository.claimFetch`), which a restart cannot forget and a
 * second pass cannot win twice.
 */
@Injectable()
export class PodcastScheduler {
    constructor(
        private readonly bands: ClockBandRepository,
        private readonly source: SyndicatedSource,
        private readonly episodes: PodcastEpisodeRepository,
        private readonly jobs: PgBossJobBroker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Ask for the audio of every episode the clock will want soon and the station does not hold.
     *
     * Answers how many fetches it asked for. Everything is swallowed: a scheduler that threw would take
     * the commit pass with it, and an episode nobody fetched costs one slot of ordinary programming.
     */
    async ripen(now = Date.now()): Promise<number> {
        try {
            return await this.fetchAhead(now);
        } catch (error) {
            this.logger.warn(`podcasts: could not fetch what the clock will want (${errorText(error)})`);
            return 0;
        }
    }

    private async fetchAhead(now: number): Promise<number> {
        const bands = (await this.bands.active()).filter(isAnchored).filter(band => isSyndicatedKind(band.kind));
        if (bands.length === 0) return 0;

        const zone = stationZone(this.config);
        let asked = 0;

        for (const band of bands) {
            const at = nextOccurrence(band, now, zone);
            if (at - now > FETCH_AHEAD_MS) continue;

            const found = await this.source.episodeFor(band.topic);
            if ('declined' in found) continue;

            const { episode } = found;
            if (episode.segmentId !== undefined || episode.fetchAttempts >= MAX_AUTOMATIC_FETCH_ATTEMPTS) continue;
            if (!(await this.episodes.claimFetch(episode.id, now, FETCH_RETRY_AFTER_MS, at))) continue;

            await this.jobs.send('podcasts.fetch', { episodeId: episode.id });
            asked += 1;

            this.logger.info('podcasts: the station clock will carry an episode, so its audio is being fetched', {
                episode: episode.id,
                show: episode.showId,
                at: new Date(at).toISOString(),
            });
        }

        return asked;
    }
}
