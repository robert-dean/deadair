import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { DirectorService } from './director.service.js';
import { StationLineupRepository } from './station.lineup.repository.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { RefillPreemption } from './refill.preemption.js';
import { PickResolver } from './pick.resolver.js';
import { DEFAULT_COUNT, planRecords, songKeysOf } from './plan.records.js';
import { resolveRules, stationRules } from './rotation.rules.js';
import { SetGenerator } from './set.generator.js';

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
        private readonly personas: PersonaRepository,
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
        if (!rules.autoExtend) {
            // A setlist or a feature. Nothing generates into those, so replacing their tail would
            // leave an order this cannot refill — which is worse here than for a refill, because
            // this one takes something away first.
            this.logger.warn('director: refusing to replan a running order that is not a rotation', {
                job: this.context.id,
                mode: lineup.mode,
            });
            return;
        }

        const persona = await this.personas.presenting(lineup.personaId);
        const count = Math.max(1, payload?.count ?? DEFAULT_COUNT);
        const planned = await planRecords(
            this.generator,
            this.resolver,
            {
                count,
                rules,
                // Read off the order, exactly as a refill does: a replan may have just changed it, and
                // whatever it says now is what this hour is programmed against.
                ...(lineup.brief ? { brief: lineup.brief } : {}),
                ...(persona === undefined ? {} : { persona }),
                // **The whole difference between this and a shuffle.** The keys cover the tail that is
                // about to be discarded, so the generator cannot hand most of it straight back:
                // `play_history` only knows what actually aired, and none of these records has.
                avoidSongKeys: songKeysOf(lineup.all()),
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
