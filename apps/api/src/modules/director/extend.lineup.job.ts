import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { DirectorService } from './director.service.js';
import { StationLineupRepository } from './station.lineup.repository.js';
import { RefillPreemption } from './refill.preemption.js';
import { PickResolver } from './pick.resolver.js';
import { DEFAULT_COUNT, artistKeysOf, planRecords, songKeysOf } from './plan.records.js';
import { artistKey } from './rotation.keys.js';
import { resolveRules, stationRules } from './rotation.rules.js';
import { SetGenerator } from './set.generator.js';
import { isTrackItem } from './station.lineup.js';

export interface ExtendLineupPayload {
    /** How many tracks to add. Absent means {@link DEFAULT_COUNT}. */
    count?: number;
}

/**
 * Top a lineup up with more tracks.
 *
 * A job rather than something the director does inline, because this is the slow
 * half of the station: a sample, two history reads, and — once the resolver
 * grows its search rung — network calls to rate-limited providers. The director
 * reacts to a track boundary in milliseconds and must never be waiting on any of
 * that. Nobody is waiting on this either: the lineup is topped up long before it
 * runs out, so a refill that takes ten seconds is invisible.
 *
 * A plain `Job` and not a `TransactionalJob`, following `CatalogSyncJob` and
 * `EnrichmentJob`: wrapping it would pin a runtime-pool connection for the whole
 * run, and the only write at the end is one row.
 *
 * Safe to retry. Appending is additive, and every rule is re-read at run time, so
 * a second attempt filters against the history as it stands rather than as it
 * stood when the first attempt started.
 *
 * This is also the shape break rendering takes later: a job that fills something
 * into a lineup, with the director carrying on regardless of whether it
 * succeeded.
 */
@Injectable()
export class ExtendLineupJob extends PlainJob<ExtendLineupPayload> {
    constructor(
        private readonly order: StationLineupRepository,
        private readonly generator: SetGenerator,
        private readonly resolver: PickResolver,
        // Read after planning, not before: it says whether a break took the model off this refill,
        // which is the one failure worth asking again about. See `RefillPreemption`.
        private readonly preemption: RefillPreemption,
        // The reactor, which is a singleton: this job runs in its own scope and still has to reach
        // the one object that is actually airing the lineup it just extended.
        private readonly director: DirectorService,
        // A singleton, like the director above it: a refill that came back empty is a fact about the
        // station rather than about this run, and the feed is where an operator meets it.
        private readonly activity: ActivityRecorder,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: ExtendLineupPayload, signal?: AbortSignal): Promise<void> {
        // Read for its RULES and for what it already holds, never to write it: the append at the
        // end goes through the director, which is the one thing that may. A copy read here going
        // stale while the generator runs is exactly why this cannot be the writer.
        const lineup = await this.order.load();
        if (!lineup) {
            // The station has never been given anything to play. An ordinary race with a
            // stand-down, not a failure.
            this.logger.info('director: there is no running order to extend', { job: this.context.id });
            return;
        }

        const rules = resolveRules(lineup.mode, lineup.rules, stationRules(this.config));
        if (!rules.autoExtend) {
            // A setlist or a feature. Nothing generates into those, and a caller that
            // asked is telling us something is wrong upstream rather than asking politely.
            this.logger.warn('director: refusing to extend a running order that is not a rotation', {
                job: this.context.id,
                mode: lineup.mode,
            });
            return;
        }

        const count = Math.max(1, payload?.count ?? DEFAULT_COUNT);

        // Every artist within `maxPerArtist + 1` of the end, which is the window a NEW batch has
        // to be spaced against: opening with any of them risks either an adjacency `spaceArtists`
        // was never told to avoid, or another instance of an artist the cap already let through its
        // limit for the tail. `0` still reads as a window of one, which is exactly the seed's window.
        const tail = lineup.upcoming().slice(-(rules.maxPerArtist + 1));
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
                // Read off the order on every refill rather than carried in the payload, for the same
                // reason the rules are: this job runs again in an hour, and what the operator asked for
                // has to still be steering it then. An empty brief reads as absent.
                ...(lineup.brief ? { brief: lineup.brief } : {}),
                // Beside the brief and read the same way, because it is the brief's exact half: the
                // period holds for the whole broadcast rather than for one batch, and it is the one
                // part of the instruction the deterministic floor can honour on its own.
                ...(lineup.era === undefined ? {} : { era: lineup.era }),
                // The songs the lineup ALREADY holds, which history knows nothing about: a
                // track queued ten minutes ago has not aired, so nothing else would stop the
                // generator choosing it again and putting it in twice.
                //
                // Songs only, deliberately, for the whole order. Excluding every artist already in
                // the list would starve a long rotation of its own library — a hundred tracks is
                // sixty artists, and after two refills there would be nobody left to choose. That
                // argument is about the WHOLE order and does not reach `avoidArtistKeys` below: its
                // window is `maxPerArtist + 1` items, a handful of artists rather than the library,
                // and it exists only so this batch does not reopen with whoever the tail just closed
                // on or push a capped artist over their limit the moment they air.
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
                // Logged rather than silent, because from the outside a retried refill and an ordinary one
                // look identical and the interesting question afterwards is always "why did this hour
                // take two goes at the model".
                onRetry: attempt =>
                    this.logger.info('director: a break took the model off this refill; asking again', {
                        job: this.context.id,
                        attempt,
                    }),
            },
        );
        if (signal?.aborted) return;

        const added = planned.tracks;

        // **This job no longer writes the lineup, and that is the point of it.** It used to load
        // its own `Lineup`, spend the seconds above generating, and then append through a store
        // guarded on the revision moving. The break planner writes through the same guard from the
        // director's pass, so whichever of the two landed second was discarded in silence and this
        // very log line reported fifteen tracks that were never stored. Handing the finished
        // records to the one owner leaves nothing to race.
        //
        // Awaited, so a failure to append is this job's failure and its retry is a real one.
        // Everything slow is already behind us, so the command itself is an array push.
        //
        // Breaks are not planted from here either. The director's own pass walks the whole tail and
        // plants every slot it finds in one write, so doing it now would buy a boundary's latency
        // and cost the single writer this job just stopped being.
        await this.director.post({ kind: 'appendTracks', tracks: added });

        this.logger.info('director: extended the running order', {
            job: this.context.id,
            asked: count,
            named: planned.named,
            resolved: planned.resolved,
            added: added.length,
        });

        // A refill that added NOTHING, which is the state that used to stop the station for good and
        // is now merely a wasted job — see `EXTEND_GUARD_MS`. Worth its own row rather than left to
        // `SetGeneratorChain.announce`, which speaks for the CHAIN: it reports a chain that named
        // too few, and says nothing about the case that is arguably worse, where generators named
        // plenty and the resolver dropped every one of them against the rules, the period or a
        // binding it could not find. `named` and `resolved` beside `added` are what tell those two
        // apart at a glance. Bounded by the guard window, so this cannot become a poll.
        if (added.length === 0) {
            void this.activity.record({
                module: 'director',
                kind: 'order.refillEmpty',
                severity: 'warn',
                detail:
                    `The station asked for ${count} more records and got none, so the running order is still running down. ` +
                    `${planned.named} were named and ${planned.resolved} survived the station's rules.`,
                data: { asked: count, named: planned.named, resolved: planned.resolved },
            });
        }
    }
}
