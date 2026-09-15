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
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { bindsAnything, type EraWindow } from './candidates.repository.js';
import { DirectorService } from './director.service.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY, PickResolver } from './pick.resolver.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { artistKeysOf, songKeysOf } from './plan.records.js';
import { songKey } from './rotation.keys.js';
import { resolveRules, stationRules } from './rotation.rules.js';
import type { TrackPick } from './set.generator.js';
import { SimilarPicker, type NeighbourWalk } from './similar.picker.js';
import { freshnessOf, historyDaysFor, resolveSmartShuffle } from './smart.shuffle.js';
import { isTrackItem, type Interleaved, type StationLineupItem, type StationLineupTrackItem } from './station.lineup.js';
import { StationLineupRepository } from './station.lineup.repository.js';

export interface MixInSimilarPayload {
    /**
     * The broadcast that asked. Checked before anything upstream is called, as a refill checks it.
     *
     * Optional only because the job registry types every payload as one that may be absent. Unlike
     * a refill's, an absent id is not taken on trust: a mix is only ever asked for by one broadcast,
     * so a run that cannot say which is skipped.
     */
    broadcastId?: string;
}

/**
 * How many records one mix may find, however long the playlist.
 *
 * Each costs a similarity walk and, for anything the library does not hold, a provider lookup and a
 * download. Twenty is an hour and a half of a playlist at the default spacing, and a playlist longer
 * than that is topped up by refills whose similar share already reaches outward.
 */
export const MAX_MIX_INS = 20;

/**
 * Mix records that sound like a playlist's own in among them: what a smart shuffle is on Spotify.
 *
 * ## Seeded from the playlist, never from what aired
 *
 * `SimilarSetGenerator` seeds from recent play history, which is right for a station programming
 * itself and wrong here. At the moment a playlist goes on air the history is entirely the PREVIOUS
 * programme, and extrapolating from it is exactly the failure that generator records for a brief
 * that changed: a station asked for synthwave opening on thirteen thrash records. So each record here
 * is found from ONE of the playlist's own records, its anchor, and lands after it.
 *
 * ## A job that posts, never a writer
 *
 * The walk and the lookups are the slow half and happen here. What reaches the director is one
 * `interleaveTracks` command carrying the finished records, each naming its anchor, and the director
 * splices them in synchronously. `StationLineup.interleave` is what keeps every break's words true.
 *
 * ## It names records and decides nothing
 *
 * Every pick goes through `PickResolver.resolve` with the broadcast's own rules, so a dislike, the
 * repeat window, the artist cooldown, the period and the advisory policy hold for a mixed-in record
 * exactly as they do for anything a generator named.
 */
@Injectable()
export class MixInSimilarJob extends PlainJob<MixInSimilarPayload> {
    constructor(
        private readonly order: StationLineupRepository,
        private readonly similarity: SimilarityService,
        private readonly picker: SimilarPicker,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly resolver: PickResolver,
        // The reactor, a singleton: this job runs in its own scope and still has to reach the one
        // object airing the order it is mixing into.
        private readonly director: DirectorService,
        private readonly activity: ActivityRecorder,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: MixInSimilarPayload, signal?: AbortSignal): Promise<void> {
        const lineup = await this.order.load();
        if (!lineup || payload?.broadcastId !== lineup.broadcastId) {
            // A changeover landed between the send and this run, or the station stood down. The
            // walk would be paid for a playlist nobody is airing any more.
            this.logger.info('director: the broadcast that asked for a mix has ended; skipping', {
                job: this.context.id,
                expected: payload?.broadcastId,
                current: lineup?.broadcastId,
            });
            return;
        }

        const rules = resolveRules(lineup.mode, lineup.rules, stationRules(this.config));
        if (!rules.mixInSimilar) {
            // A setlist, a feature, or a rotation that never asked. The director only sends this
            // when it did, so this is the setting having been changed in between.
            this.logger.info('director: this broadcast does not mix anything in; skipping', { job: this.context.id, mode: lineup.mode });
            return;
        }

        const anchors = anchorsOf(lineup.all().filter(isTrackItem), rules.mixInEvery);
        if (anchors.length === 0) return;

        if (!this.similarity.hasSimilarity() || !(this.similarity.canNameSimilarTracks() || this.similarity.canNameTracks())) {
            // The operator asked for something the station cannot do, and the only other trace of
            // that would be a playlist playing exactly as it always did.
            void this.activity.record({
                module: 'director',
                kind: 'order.mixInEmpty',
                severity: 'warn',
                detail: 'The station was asked to mix similar records into this playlist, but no similarity plugin that can name records is installed.',
                data: { anchors: anchors.length, reason: 'no-similarity' },
            });
            return;
        }
        if (!settingIsOn(this.config, DISCOVER_KEY, DISCOVER_DEFAULT)) {
            this.logger.warn(
                'director: records are being mixed into a playlist but "rotation.discover" is off, so neighbours the library does not already hold cannot air',
            );
        }

        const walk = await this.walkFor(lineup.all(), lineup.upcoming(), lineup.era);
        const chosen: { pick: TrackPick; anchorId: string }[] = [];

        for (const anchor of anchors) {
            if (signal?.aborted) return;

            const found: TrackPick[] = [];
            try {
                // From the record itself where a plugin can say, and from its artist otherwise.
                await this.picker.pickLike(anchor.track, walk, found);
            } catch (error) {
                // One anchor's upstream failing is not a reason to give up on the rest.
                this.logger.debug(`director: could not find a neighbour of "${anchor.track.artist}" (${errorText(error)})`);
            }
            const pick = found[0];
            if (pick !== undefined) chosen.push({ pick, anchorId: anchor.id });
        }

        // One resolve for the lot, with the broadcast's own rules, so a mixed-in record is judged
        // exactly as a refill's would be. In the order given, because the order means nothing here:
        // each record is matched back to its anchor by name below, not by position.
        const resolved = await this.resolver.resolve(
            chosen.map(entry => entry.pick),
            rules,
            {
                ...(lineup.era === undefined ? {} : { era: lineup.era }),
                keepOrder: true,
                discoveries: chosen.length,
            },
        );
        if (signal?.aborted) return;

        // Back to the anchor each was found for. The resolver fills `artist` from the row it
        // matched, and its lookup is strict about normalized title and lead artist, so the keys a
        // pick went looking with are the keys it comes back under. Anything that does not match is
        // dropped rather than guessed at.
        const anchorBySong = new Map(chosen.map(entry => [songKey(entry.pick.title, [entry.pick.artist]), entry.anchorId]));
        const inserts: Interleaved[] = [];
        for (const track of resolved) {
            const afterItemId = anchorBySong.get(songKey(track.title, [track.artist]));
            if (afterItemId !== undefined) inserts.push({ afterItemId, track });
        }

        if (inserts.length > 0) await this.director.post({ kind: 'interleaveTracks', inserts, broadcastId: lineup.broadcastId });

        this.logger.info('director: found records to mix into the running order', {
            job: this.context.id,
            anchors: anchors.length,
            named: chosen.length,
            resolved: resolved.length,
            sent: inserts.length,
        });

        void this.activity.record(
            inserts.length > 0
                ? {
                      module: 'director',
                      kind: 'order.mixedIn',
                      detail: `The station found ${inserts.length} ${inserts.length === 1 ? 'record' : 'records'} that sound like this playlist's to mix in among them.`,
                      data: { anchors: anchors.length, named: chosen.length, resolved: resolved.length, sent: inserts.length },
                  }
                : {
                      module: 'director',
                      kind: 'order.mixInEmpty',
                      severity: 'warn',
                      detail:
                          `The station looked for records like ${anchors.length} of this playlist's and found none it could play: ` +
                          `${chosen.length} were named and ${resolved.length} survived the station's rules.`,
                      data: { anchors: anchors.length, named: chosen.length, resolved: resolved.length, reason: 'none-survived' },
                  },
        );
    }

    /**
     * What the walk must not choose, and how fresh everything is.
     *
     * Songs the order already holds, anywhere in it, because a record on the playlist is not a
     * record to add to it; artists still to come, because a neighbour who is already on the
     * playlist is a wasted insert. Freshness as the similar binding reads it, so the smart shuffle
     * leans this walk the same way: a history that cannot be read walks level rather than failing.
     */
    private async walkFor(
        all: readonly StationLineupItem[],
        upcoming: readonly StationLineupItem[],
        era: EraWindow | undefined,
    ): Promise<NeighbourWalk> {
        const smartShuffle = resolveSmartShuffle(this.config);
        const lastAired = await this.history.lastAiredSince(historyDaysFor(smartShuffle), this.identity.stationKey).catch((error: unknown) => {
            this.logger.debug(`director: the mix could not read what aired lately, so it walks level (${errorText(error)})`);
            return new Map<string, DateTime>();
        });
        const now = DateTime.utc();

        return {
            takenSongs: songKeysOf(all),
            takenArtists: artistKeysOf(upcoming),
            ...(bindsAnything(era) ? { era } : {}),
            freshness: song => freshnessOf(lastAired.get(song), now, smartShuffle.horizonDays),
        };
    }
}

/**
 * The records to mix in after: every `every`-th planned record, so the first comes after `every` of
 * the playlist's own rather than straight after the first. Capped at {@link MAX_MIX_INS}.
 *
 * Planned only, because an anchor the player already holds cannot have anything put after it.
 */
export const anchorsOf = (tracks: readonly StationLineupTrackItem[], every: number): StationLineupTrackItem[] => {
    if (every < 1) return [];

    const planned = tracks.filter(track => track.state === 'planned' && track.mixedIn !== true);
    const anchors: StationLineupTrackItem[] = [];
    for (let index = every - 1; index < planned.length && anchors.length < MAX_MIX_INS; index += every) {
        anchors.push(planned[index]!);
    }
    return anchors;
};
