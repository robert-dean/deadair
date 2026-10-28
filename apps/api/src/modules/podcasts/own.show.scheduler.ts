import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';
import { isAnchored, nextOccurrence, type AnchoredBand } from '#modules/director/clock.bands.js';
import { ClockBandRepository } from '#modules/director/clock.band.repository.js';
import { stationZone } from '#modules/director/clock.words.js';
import { COMMISSION_AHEAD_MS, isProductionKind } from '#modules/productions/production.scheduler.js';
import { stationTargetMs } from '#modules/productions/production.settings.js';
import { ProductionRepository } from '#modules/productions/production.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import type { OwnShowRecord } from './own.show.js';
import { OwnShowRepository } from './own.show.repository.js';
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
 * How many minutes of making an edition of a news show is given per minute it runs.
 *
 * A news show reads its stories when the episode is asked for, so every minute of read-ahead is a minute
 * older the news is when it airs: three hours ahead, a six o'clock edition was the three o'clock news. So a
 * news show is asked for no earlier than it needs to be. Measured on the live station on 2026-10-27, the
 * nearest thing to an edition it had made (a banter, one voice-pair writing to a length) took 5.9 minutes of
 * making per minute of programme at the 90th percentile; no `podcast` production had yet been made there.
 */
export const NEWS_MAKE_RATIO = 6;

/** The least read-ahead a news edition gets, however short: a model having a slow hour still has room. */
export const NEWS_MIN_AHEAD_MS = 60 * 60_000;

/**
 * How far ahead of its slot a show's episode is asked for.
 *
 * A show that reads the news gets {@link NEWS_MAKE_RATIO} times its length, between
 * {@link NEWS_MIN_AHEAD_MS} and {@link COMMISSION_AHEAD_MS}; everything else gets the full read-ahead every
 * production does, since nothing it is about goes stale. A show with no length of its own is reckoned at the
 * longest the station's range allows, so a long one is never starved.
 */
export function aheadFor(show: Pick<OwnShowRecord, 'newsFeedIds' | 'targetMs'>, config: AppConfig): number {
    if ((show.newsFeedIds?.length ?? 0) === 0) return COMMISSION_AHEAD_MS;
    const length = show.targetMs ?? stationTargetMs(config, OWN_SHOW_BAND_KIND, () => 1);
    return Math.min(COMMISSION_AHEAD_MS, Math.max(NEWS_MIN_AHEAD_MS, length * NEWS_MAKE_RATIO));
}

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
 * station's own shows is read ahead ({@link aheadFor}) and its episode asked for through
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
        private readonly records: OwnShowRepository,
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

        const topics = await this.topics.list(OWN_SHOW_BAND_KIND);
        const shows = new Map((await this.records.list()).map(show => [show.id, show]));
        const zone = stationZone(this.config);
        let scheduled: Awaited<ReturnType<ProductionRepository['scheduledAfter']>> | undefined;
        let started = 0;

        for (const band of bands) {
            const show = shows.get(this.showOf(band, topics) ?? '');
            if (show === undefined) continue;

            const at = nextOccurrence(band, now, zone);
            if (at - now > aheadFor(show, this.config)) continue;

            // Read once, and only once some band is due: most passes have none.
            scheduled ??= await this.productions.scheduledAfter(now);
            if (scheduled.some(existing => existing.showId === show.id && existing.scheduledFor === at)) continue;

            const showId = show.id;
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
                    this.logger.warn(
                        `podcasts: "${band.topic?.label}" could not have an episode made for ${new Date(at).toISOString()} (${errorText(error)})`,
                    );
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
