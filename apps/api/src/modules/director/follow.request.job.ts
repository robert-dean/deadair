import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { DateTime } from 'luxon';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { SimilarityService } from '#modules/similarity/similarity.service.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { errorText } from '#modules/shared/error.text.js';
import { bindsAnything } from './candidates.repository.js';
import { DirectorService } from './director.service.js';
import { PickResolver } from './pick.resolver.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { artistKeysOf, songKeysOf } from './plan.records.js';
import { artistKey } from './rotation.keys.js';
import { resolveRules, stationRules } from './rotation.rules.js';
import { followOnFor } from './request.show.js';
import type { TrackPick } from './set.generator.js';
import { SimilarPicker, type NeighbourWalk } from './similar.picker.js';
import { freshnessOf, historyDaysFor, resolveSmartShuffle } from './smart.shuffle.js';
import { isTrackItem, type StationLineup } from './station.lineup.js';
import { StationLineupRepository } from './station.lineup.repository.js';

export interface FollowRequestPayload {
    /** The broadcast the request was placed in. Checked before anything upstream is called, as a mix checks it. */
    broadcastId?: string;
    /** The request just placed, which names its line in the order. */
    requestId?: string;
}

/**
 * Follow a listener's request with records that sound like it: what a request show is.
 *
 * ## Found before anything is dropped
 *
 * `ReplanLineupJob`'s rule, for its reason: the order behind the request keeps playing for as long
 * as the walk takes, and the swap is one `followRequest` command at the end. A walk that finds
 * nothing posts nothing, and the station goes on with the catalog it had planned.
 *
 * ## Seeded from the request, never from what aired
 *
 * `MixInSimilarJob`'s argument: play history is whatever came before the request, and the whole
 * point is that the listener has just changed the subject. So the one seed is the requested record,
 * asked at the record level where a plugin can answer and walked from its artist where it cannot.
 *
 * ## It names records and decides nothing
 *
 * Every pick goes through `PickResolver.resolve` with the broadcast's own rules, so a dislike, the
 * repeat window, the artist cooldown, the period and the advisory policy hold for a follow-on
 * record exactly as they do for a refill's.
 */
@Injectable()
export class FollowRequestJob extends PlainJob<FollowRequestPayload> {
    constructor(
        private readonly order: StationLineupRepository,
        private readonly similarity: SimilarityService,
        private readonly picker: SimilarPicker,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly resolver: PickResolver,
        // The reactor, a singleton, for `MixInSimilarJob`'s reason.
        private readonly director: DirectorService,
        private readonly activity: ActivityRecorder,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: FollowRequestPayload, signal?: AbortSignal): Promise<void> {
        const lineup = await this.order.load();
        if (!lineup || payload?.broadcastId !== lineup.broadcastId || payload.requestId === undefined) {
            this.logger.info('director: the broadcast a request was followed for has ended; skipping', {
                job: this.context.id,
                expected: payload?.broadcastId,
                current: lineup?.broadcastId,
            });
            return;
        }
        const requestId = payload.requestId;

        const want = followOnFor(lineup.rules);
        if (want === 0) return;

        const request = this.stillLast(lineup, requestId);
        if (request === undefined) {
            this.logger.info('director: a request is no longer the last one coming, so nothing is found to follow it', {
                job: this.context.id,
                requestId,
            });
            return;
        }

        if (!this.similarity.hasSimilarity() || !(this.similarity.canNameSimilarTracks() || this.similarity.canNameTracks())) {
            // Without this, the only trace of a request show that cannot work is a request show
            // that sounds exactly like the catalog.
            void this.activity.record({
                module: 'director',
                kind: 'order.followRequestEmpty',
                severity: 'warn',
                detail: 'This is a request show, but no similarity plugin that can name records is installed, so nothing was found to follow the request.',
                data: { requestId, reason: 'no-similarity' },
            });
            return;
        }

        const walk = await this.walkFor(lineup, request.index);
        const picks: TrackPick[] = [];
        try {
            await this.picker.pickSeveralLike(request.track, want, walk, picks);
        } catch (error) {
            // Whatever was gathered before the throw is still a run worth airing.
            this.logger.debug(`director: could not finish finding records like "${request.track.title}" (${errorText(error)})`);
        }
        if (signal?.aborted) return;

        const rules = resolveRules(lineup.mode, lineup.rules, stationRules(this.config));
        const tracks =
            picks.length === 0
                ? []
                : await this.resolver.resolve(picks, rules, {
                      ...(lineup.era === undefined ? {} : { era: lineup.era }),
                      broadcast: { mode: lineup.mode, ...(lineup.slotId === undefined ? {} : { slotId: lineup.slotId }) },
                      keepOrder: true,
                      discoveries: picks.length,
                  });
        if (signal?.aborted) return;

        if (tracks.length > 0) await this.director.post({ kind: 'followRequest', requestId, tracks, broadcastId: lineup.broadcastId });

        this.logger.info('director: found records to follow a request', {
            job: this.context.id,
            requestId,
            want,
            named: picks.length,
            sent: tracks.length,
        });

        void this.activity.record(
            tracks.length > 0
                ? {
                      module: 'director',
                      kind: 'order.followedRequest',
                      detail: `The station followed a request for ${request.track.title} by ${request.track.artist} with ${tracks.length} ${tracks.length === 1 ? 'record' : 'records'} like it.`,
                      data: { requestId, want, named: picks.length, sent: tracks.length },
                  }
                : {
                      module: 'director',
                      kind: 'order.followRequestEmpty',
                      severity: 'warn',
                      detail:
                          `The station looked for records like ${request.track.title} by ${request.track.artist} and found none it could play: ` +
                          `${picks.length} were named and none survived the station's rules.`,
                      data: { requestId, want, named: picks.length, reason: 'none-survived' },
                  },
        );
    }

    /**
     * The request's line, when it will still be heard and no newer request sits behind it.
     *
     * Checked here as well as by the director, so a request that has been overtaken costs no
     * upstream calls. The director's check is the one that counts, since the order moves on while
     * this walks.
     */
    private stillLast(lineup: StationLineup, requestId: string): { index: number; track: { title: string; artist: string } } | undefined {
        const items = lineup.all();
        const index = items.findIndex(item => isTrackItem(item) && item.requestId === requestId);
        const item = items[index];
        if (item === undefined || !isTrackItem(item) || item.state === 'removed' || item.state === 'skipped' || item.state === 'unavailable')
            return undefined;
        if (items.slice(index + 1).some(line => isTrackItem(line) && line.requestId !== undefined)) return undefined;
        return { index, track: { title: item.track.title, artist: item.track.artist } };
    }

    /**
     * What the walk must not choose, and how fresh everything is.
     *
     * `MixInSimilarJob.walkFor`, with one difference that follows from the swap: the records still
     * to come that will SURVIVE it are the ones up to the request, so only their artists, and the
     * request's own, are taken. What is planned behind it is about to go.
     */
    private async walkFor(lineup: StationLineup, requestIndex: number): Promise<NeighbourWalk> {
        const smartShuffle = resolveSmartShuffle(this.config);
        const lastAired = await this.history.lastAiredSince(historyDaysFor(smartShuffle), this.identity.stationKey).catch((error: unknown) => {
            this.logger.debug(`director: following a request could not read what aired lately, so it walks level (${errorText(error)})`);
            return new Map<string, DateTime>();
        });
        const now = DateTime.utc();
        const upTo = lineup.all().slice(0, requestIndex + 1);
        const takenArtists = artistKeysOf(upTo.filter(item => item.state === 'handed' || item.state === 'planned'));
        const request = upTo[requestIndex];
        if (request !== undefined && isTrackItem(request)) takenArtists.add(artistKey([request.track.artist]));

        return {
            takenSongs: songKeysOf(lineup.all()),
            takenArtists,
            ...(bindsAnything(lineup.era) ? { era: lineup.era } : {}),
            freshness: song => freshnessOf(lastAired.get(song), now, smartShuffle.horizonDays),
        };
    }
}
