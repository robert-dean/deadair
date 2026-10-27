import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';
import { isAnchored, nextOccurrence, type AnchoredBand } from '#modules/director/clock.bands.js';
import { ClockBandRepository } from '#modules/director/clock.band.repository.js';
import { stationZone } from '#modules/director/clock.words.js';
import { COMMISSION_AHEAD_MS, isProductionKind } from '#modules/productions/production.scheduler.js';
import { ProductionRepository } from '#modules/productions/production.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import { OwnShowsService } from './own.shows.service.js';
import { namesOwnShow, OWN_SHOW_BAND_KIND } from './own.show.topic.kind.js';

/**
 * How long a slot whose show refused an episode waits before it is asked again.
 *
 * A refusal is a news show with nothing on its feeds yet, which can change in minutes, so the slot is
 * not given up on. But the commit pass runs every few seconds and every ask reads the feeds, so it is
 * not asked on every one either.
 */
export const REFUSED_RETRY_MS = 10 * 60_000;

/**
 * When each refused slot may be asked again, keyed by show and slot.
 *
 * Module state rather than a field, because the scheduler is scoped and built afresh on every pass. Memory
 * is enough here where the commission itself is not: forgetting a refusal across a restart costs one more
 * ask, while forgetting a commission would cost a second episode, which is why that one is read off the
 * table.
 */
const refusedUntil = new Map<string, number>();

/**
 * Make the episode of the station's own show the format clock will want, ahead of its slot.
 *
 * `ProductionScheduler`'s job for a band that names a show: a `podcast` band whose topic is one of the
 * station's own shows is read {@link COMMISSION_AHEAD_MS} ahead and its episode asked for through
 * `OwnShowsService.requestEpisode`, the path the Podcasts page takes, so the show's presenter, length,
 * writing mode, feeds and research all apply and the episode is filed under the show. `ProductionScheduler`
 * passes over these bands (`namesOwnShow`), or the slot would be made twice: once as the show and once as
 * a programme about whatever the broadcast is about.
 *
 * Here rather than in `ProductionScheduler` because the show is this module's and the import would run
 * the wrong way: `OwnShowsService` already reaches `ProductionsService`, which reaches the scheduler.
 *
 * ## Idempotent by the table, as every other commission is
 *
 * A production filed under this show for this instant means it is being made, so a restart in the middle of
 * the read-ahead commissions nothing twice.
 */
@Injectable()
export class OwnShowScheduler {
    constructor(
        private readonly bands: ClockBandRepository,
        private readonly topics: TopicRepository,
        private readonly shows: OwnShowsService,
        private readonly productions: ProductionRepository,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Commission every own show's episode the clock wants soon and nothing is being made for yet.
     *
     * Answers how many it started. Everything is swallowed: a scheduler that threw would take the commit
     * pass with it, and an episode nobody commissioned costs a slot of ordinary programming.
     */
    async ripen(now = Date.now()): Promise<number> {
        try {
            return await this.commissionAhead(now);
        } catch (error) {
            this.logger.warn(`podcasts: could not make the shows the clock will want (${errorText(error)})`);
            return 0;
        }
    }

    private async commissionAhead(now: number): Promise<number> {
        if (!isProductionKind(OWN_SHOW_BAND_KIND, this.config)) return 0;
        const bands = (await this.bands.active()).filter(isAnchored).filter(namesOwnShow);
        if (bands.length === 0) return 0;

        const zone = stationZone(this.config);
        const due = bands.map(band => ({ band, at: nextOccurrence(band, now, zone) })).filter(({ at }) => at - now <= COMMISSION_AHEAD_MS);
        if (due.length === 0) return 0;

        const topics = await this.topics.list(OWN_SHOW_BAND_KIND);
        const scheduled = await this.productions.scheduledAfter(now);
        let started = 0;

        for (const { band, at } of due) {
            const showId = this.showOf(band, topics);
            if (showId === undefined) continue;
            if (scheduled.some(existing => existing.showId === showId && existing.scheduledFor === at)) continue;

            const key = `${showId}@${at}`;
            if ((refusedUntil.get(key) ?? 0) > now) continue;

            try {
                const episode = await this.shows.requestEpisode(showId, { airAt: DateTime.fromMillis(at) });
                refusedUntil.delete(key);
                started += 1;
                this.logger.info('podcasts: the station clock asked for an episode of one of its own shows', {
                    production: episode.id,
                    show: showId,
                    at: new Date(at).toISOString(),
                });
            } catch (error) {
                // Logged once per slot rather than once per pass: the retry below is quiet.
                if (!refusedUntil.has(key)) {
                    this.logger.warn(`podcasts: "${band.topic?.label}" could not have an episode made for ${new Date(at).toISOString()} (${errorText(error)})`);
                }
                refusedUntil.set(key, now + REFUSED_RETRY_MS);
            }
        }

        for (const [key, until] of refusedUntil) if (until <= now - COMMISSION_AHEAD_MS) refusedUntil.delete(key);
        return started;
    }

    /** The show a band's topic names, or `undefined` when the topic is gone or names none. */
    private showOf(band: AnchoredBand, topics: readonly { id: string; config: Record<string, unknown> }[]): string | undefined {
        const topic = topics.find(candidate => candidate.id === band.topic?.id);
        const named = typeof topic?.config.show === 'string' ? topic.config.show.trim() : '';
        return named.length === 0 ? undefined : named;
    }
}

/** For tests: forget every refusal. */
export function forgetRefusals(): void {
    refusedUntil.clear();
}
