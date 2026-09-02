import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { DirectorService } from './director.service.js';
import { StationLineupRepository } from './station.lineup.repository.js';
import { RefillPreemption } from './refill.preemption.js';
import { PickResolver } from './pick.resolver.js';
import { DEFAULT_COUNT, artistKeysOf, planRecords, songKeysOf } from './plan.records.js';
import { artistKey } from './rotation.keys.js';
import { resolveRules, stationRules } from './rotation.rules.js';
import { SetGenerator } from './set.generator.js';
import { isTrackItem } from './station.lineup.js';

export interface ReplanLineupPayload {
    /** How many tracks to programme. Absent means {@link DEFAULT_COUNT}. */
    count?: number;
}

/**
 * Throw away everything the running order still has planned, and programme it again.
 *
 * The third thing an operator can do to an hour they do not like. `shuffleRemaining` reorders the
 * same records, which is the same hour in a different sequence; `putOnAir` genuinely starts again
 * but ENDS the broadcast, mints a new `broadcast_id` and files the rest of the night under a
 * different programme. This keeps the broadcast and changes the records.
 *
 * ## Why it generates before anything is dropped
 *
 * The obvious shape — empty the tail, then ask for a new one — takes the station off air. With
 * `COMMIT_LEAD` at 1 the order is left holding one record; when it ends `Rundown.hasProgramme()`
 * goes false, `PlayoutPusher` stops renewing the mount lease, and the station is out of service
 * within `CONTROL_TTL_S`. A model generating a set can take minutes, and a fresh tail is cold on
 * top of that, so `withLocalAudio` would hold the commit pass while `TrackCachePlanner` fetched
 * bytes for records that were not chosen yet.
 *
 * So the old tail keeps playing for the whole of this job, and the swap is one command at the end.
 * The price, taken deliberately, is that an operator's press lands seconds later rather than at
 * once, which the console shows as pending.
 *
 * Safe to retry. Everything is re-read at run time, and the worst a second attempt can do is
 * programme a fresh hour over a fresh hour.
 */
@Injectable()
export class ReplanLineupJob extends PlainJob<ReplanLineupPayload> {
    constructor(
        private readonly order: StationLineupRepository,
        private readonly generator: SetGenerator,
        private readonly resolver: PickResolver,
        // Read after planning, not before: it says whether a break took the model off this refill,
        // which is the one failure worth asking again about. See `RefillPreemption`.
        private readonly preemption: RefillPreemption,
        // The reactor, which is a singleton: this job runs in its own scope and still has to reach
        // the one object that is actually airing the order it is replacing the tail of.
        private readonly director: DirectorService,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: ReplanLineupPayload, signal?: AbortSignal): Promise<void> {
        // Read for its rules, its brief and what it holds, never to write it: the swap at the end
        // goes through the director, which is the one thing that may.
        const lineup = await this.order.load();
        if (!lineup) {
            // The station has never been given anything to play. An ordinary race with a
            // stand-down, not a failure.
            this.logger.info('director: there is no running order to replan', { job: this.context.id });
            return;
        }

        const rules = resolveRules(lineup.mode, lineup.rules, stationRules(this.config));
        if (!rules.mayGenerate) {
            // A setlist or a feature. Nothing generates into those, so replacing their tail would
            // leave an order this cannot refill — which is worse here than for a refill, because
            // this one takes something away first.
            this.logger.warn('director: refusing to replan a running order that is not a rotation', {
                job: this.context.id,
                mode: lineup.mode,
            });
            return;
        }

        const count = Math.max(1, payload?.count ?? DEFAULT_COUNT);

        // Every artist within `maxPerArtist + 1` of the end of what SURVIVES this replan — the same
        // window a refill uses, and for the same reason: it is the handful of artists the new tail
        // must not reopen with or push over the cap, not the whole rotation the starvation argument
        // below is about.
        //
        // Not `upcoming()`, which is what a refill reads and is the wrong list here. `replacePlanned`
        // keeps exactly the items that are not `planned` and appends the new batch after them, so
        // `upcoming()`'s tail is the planned records this job is about to THROW AWAY: seeding off
        // them spaces the new batch against records that will never air, while the item it really
        // lands beside — the last handed or airing record — is not compared against at all. That put
        // the same artist on both sides of the join, which is the adjacency this window exists to
        // prevent.
        const surviving = lineup.all().filter(item => item.state !== 'planned');
        const tail = surviving.slice(-(rules.maxPerArtist + 1));
        const tailTracks = tail.filter(isTrackItem);
        // The last track in that window, if there is one — a window that ends on a scheduled break
        // has nothing to seed with, and an unseeded batch is simply not compared against anything,
        // same as before this existed.
        const seed = tailTracks.at(-1);

        const planned = await planRecords(
            this.generator,
            this.resolver,
            {
                count,
                rules,
                // Read off the order, exactly as a refill does: a replan may have just changed it, and
                // whatever it says now is what this hour is programmed against.
                ...(lineup.brief ? { brief: lineup.brief } : {}),
                // Beside the brief and read the same way, because it is the brief's exact half: the
                // period holds for the whole broadcast rather than for one batch, and it is the one
                // part of the instruction the deterministic floor can honour on its own.
                ...(lineup.era === undefined ? {} : { era: lineup.era }),
                // **The whole difference between this and a shuffle.** The keys cover the tail that is
                // about to be discarded, so the generator cannot hand most of it straight back:
                // `play_history` only knows what actually aired, and none of these records has.
                //
                // Songs only, deliberately, for the whole order. Excluding every artist already in
                // the list would starve a long rotation of its own library — a hundred tracks is
                // sixty artists, and after two refills there would be nobody left to choose. That
                // argument is about the WHOLE order and does not reach `avoidArtistKeys` below: its
                // window is `maxPerArtist + 1` items, a handful of artists rather than the library.
                avoidSongKeys: songKeysOf(lineup.all()),
                // Off entirely when the cap is off: an operator who has said "no limit on one
                // artist" has said nothing about spacing, which `seedArtistKey` below still handles.
                ...(rules.maxPerArtist > 0 ? { avoidArtistKeys: artistKeysOf(tail) } : {}),
                // Always, whatever the cap says: seeding is about adjacency, not about the per-artist
                // limit, so it applies even when that limit is switched off.
                ...(seed ? { seedArtistKey: artistKey([seed.track.artist]) } : {}),
            },
            {
                took: () => this.preemption.took(),
                // Logged rather than silent, because from the outside a retried replan and an ordinary one
                // look identical and the interesting question afterwards is always "why did this hour
                // take two goes at the model".
                onRetry: attempt =>
                    this.logger.info('director: a break took the model off this replan; asking again', {
                        job: this.context.id,
                        attempt,
                    }),
            },
        );
        if (signal?.aborted) return;

        if (planned.tracks.length === 0) {
            // Nothing to swap in, so nothing is thrown out. Posting an empty replacement would
            // empty the running order and take the station off air, which is the one outcome this
            // job's whole shape exists to avoid.
            this.logger.warn('director: replanning the running order found no records, so it was left alone', {
                job: this.context.id,
                named: planned.named,
            });
            return;
        }

        // Synchronously and immediately before the post, like every other writer that changes what
        // is on air: a commit pass may already have gathered its material and be suspended in a
        // database read, and only the epoch can reach it. See `DirectorService.invalidate`.
        this.director.invalidate();
        await this.director.post({ kind: 'replaceTail', tracks: planned.tracks });

        this.logger.info('director: replanned the running order', {
            job: this.context.id,
            asked: count,
            named: planned.named,
            resolved: planned.resolved,
            planted: planned.tracks.length,
        });
    }
}
