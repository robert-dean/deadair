import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { overrideJobActor } from '#modules/jobs/job.authorization.js';
import { LineupRepository } from './lineup.repository.js';
import { PickResolver } from './pick.resolver.js';
import { songKey } from './rotation.keys.js';
import { resolveRules } from './rotation.rules.js';
import { SetGenerator } from './set.generator.js';

/** How many tracks a refill adds when nobody says. Roughly an hour of programming. */
const DEFAULT_COUNT = 15;

/**
 * Ask for more names than the lineup needs.
 *
 * Between the repeat window, the artist cooldown, the per-artist cap and picks
 * that resolve to nothing, a meaningful share of any batch is discarded. Without
 * the headroom the lineup comes back short, runs dry sooner, and the director
 * simply asks again — which costs another sample and another pass over the
 * history for the same reason it did the first time.
 */
const OVERSAMPLE = 1.6;

export interface ExtendLineupPayload {
    /**
     * Which lineup to top up.
     *
     * Optional in the type and required in practice, the way `CatalogSyncPayload`
     * is: a job registration is typed against a payload the broker may deliver as
     * `{}`, so this cannot be declared required without the mapping refusing it.
     * The run guards on it instead.
     */
    lineupId?: string;
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
 * run, and the only write at the end is one row. Because it is not
 * transactional, the actor has to be installed here.
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
export class ExtendLineupJob implements Job<ExtendLineupPayload> {
    constructor(
        private readonly lineups: LineupRepository,
        private readonly generator: SetGenerator,
        private readonly resolver: PickResolver,
        private readonly context: JobContext,
        // `Container` resolves to the container doing the resolving, which for a job
        // is the runner's per-execution scope. `ScopedContainer` is a type alias, not
        // a token, so it can only be the cast — same as CatalogSyncJob.
        private readonly container: Container,
        private readonly logger: Logger,
    ) {}

    async run(payload?: ExtendLineupPayload, signal?: AbortSignal): Promise<void> {
        overrideJobActor(this.container as ScopedContainer, this.context);

        if (!payload?.lineupId) {
            // Nothing to do rather than an error: this job is only ever sent, never
            // scheduled, so a payload-less run is a caller's bug and not a station fault.
            this.logger.warn('director: an extend was sent with no lineup to extend', { job: this.context.id });
            return;
        }

        const lineup = await this.lineups.load(payload.lineupId);
        if (!lineup) {
            // Deleted between the send and the run. An ordinary race, not a failure.
            this.logger.info('director: the lineup to extend is gone', { job: this.context.id, lineup: payload.lineupId });
            return;
        }

        const rules = resolveRules(lineup.mode, lineup.rules);
        if (!rules.autoExtend) {
            // A setlist or a feature. Nothing generates into those, and a caller that
            // asked is telling us something is wrong upstream rather than asking politely.
            this.logger.warn('director: refusing to extend a lineup that is not a rotation', {
                job: this.context.id,
                lineup: lineup.id,
                mode: lineup.mode,
            });
            return;
        }

        const count = Math.max(1, payload.count ?? DEFAULT_COUNT);
        const picks = await this.generator.generate({
            count: Math.ceil(count * OVERSAMPLE),
            rules,
            // The songs the lineup ALREADY holds, which history knows nothing about: a
            // track queued ten minutes ago has not aired, so nothing else would stop the
            // generator choosing it again and putting it in twice.
            //
            // Songs only, deliberately. Excluding every artist already in the list would
            // starve a long rotation of its own library — a hundred tracks is sixty
            // artists, and after two refills there would be nobody left to choose. An
            // artist is spaced within a batch and cooled down once they actually air,
            // which are the two places it can be judged against something real.
            avoidSongKeys: songKeysOf(lineup.all()),
        });
        if (signal?.aborted) return;

        const resolved = await this.resolver.resolve(picks);
        // Back down to what was asked for. The oversample is headroom against what the
        // rules and the resolver discard, not a licence to hand back half an hour more
        // programming than the station wanted.
        const added = await lineup.append(resolved.slice(0, count));

        this.logger.info('director: extended a lineup', {
            job: this.context.id,
            lineup: lineup.id,
            asked: count,
            named: picks.length,
            resolved: resolved.length,
            added: added.length,
        });
    }

}

/** The songs a lineup already holds, as keys the generator can avoid choosing again. */
const songKeysOf = (items: readonly { track: { title: string; artists: string[] } }[]): Set<string> =>
    new Set(items.map(item => songKey(item.track.title, item.track.artists)));
