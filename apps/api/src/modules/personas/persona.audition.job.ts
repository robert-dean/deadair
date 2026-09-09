import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { BreakWriterRegistry } from '#modules/director/break.writer.registry.js';
import { stationZone } from '#modules/director/clock.words.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { errorText } from '#modules/shared/error.text.js';
import { transitionAt, type Audition, type AuditionAttempt } from './persona.audition.js';
import { auditionRequest } from './persona.audition.request.js';
import { PersonaAuditionRepository } from './persona.audition.repository.js';
import { PersonaRepository } from './persona.repository.js';
import { PersonaNotesRepository } from './persona.notes.repository.js';
import { PersonaStoriesRepository } from './persona.stories.repository.js';

/** Which run, and which transition of it. */
export interface AuditionPayload {
    /**
     * Which run to write a transition of.
     *
     * Optional in the type and required in practice, like every other job payload here: a
     * registration is typed against a payload the broker may deliver as `{}`. The run guards on it.
     */
    auditionId?: string;
    /** Which transition, from 0. Absent means the first, which is what the opening send means. */
    ordinal?: number;
}

/**
 * One transition of an audition: write the break, record it, and send the next.
 *
 * ## One job per transition rather than one per run
 *
 * A run of twenty transitions is twenty model calls at `preview`, each of which queues behind
 * everything the station does for itself and is preempted the moment a real break wants the model.
 * That is minutes to hours of wall clock, and this station redeploys on any push to main. A single
 * job for the whole run would need an `expiresIn` large enough that a wedged one could not be
 * reclaimed, and a restart in the middle would have nothing to resume from.
 *
 * So the run is a chain: each job claims one transition, writes one break, and sends the job for the
 * next. The row says which transition is next, so a restart resumes exactly where it stopped and the
 * station's one model slot is free between transitions rather than held for the whole run.
 *
 * ## It cannot air, and holds nothing that could put it on air
 *
 * No `SegmentRepository`, no `ScriptHistoryRepository`, no `BreakRequestRepository`: the only tables
 * reachable from here are the two migration 0024 added, and neither is in the render path. That is
 * the rehearsal's guarantee — a property of what the job can REACH rather than a rule somebody has
 * to keep — extended over a run.
 *
 * ## It spends nothing the next real break is owed
 *
 * The notebook is read through `forPrompt` and never rested, and the stories the same, which is what
 * those repositories split the two calls for. A run of twenty transitions that stamped would hand
 * the next real break this character's twenty-first-best lines and report tellings nobody heard.
 * `recent` comes from the run's OWN breaks rather than from `script_history`, for the same reason
 * read the other way: an audition must not be shown what the station said, and the station must not
 * be shown what an audition said.
 */
@Injectable()
export class PersonaAuditionJob extends PlainJob<AuditionPayload> {
    constructor(
        private readonly auditions: PersonaAuditionRepository,
        private readonly personas: PersonaRepository,
        // Both read through their reading halves only. See the class note.
        private readonly notes: PersonaNotesRepository,
        private readonly stories: PersonaStoriesRepository,
        private readonly writers: BreakWriterRegistry,
        private readonly jobs: PgBossJobBroker,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: AuditionPayload): Promise<void> {
        if (!payload?.auditionId) {
            this.logger.warn('personas: an audition job was sent with nothing to audition', { job: this.context.id });
            return;
        }

        const { auditionId } = payload;
        const ordinal = payload.ordinal ?? 0;

        // The claim is the whole of the concurrency story: it moves nothing unless this job's
        // transition is still the one the run is waiting for, and it refuses a settled row. A
        // duplicate delivery, a job for a transition somebody else already wrote, and a run that was
        // cancelled all land here and stop before the model.
        const audition = await this.auditions.claim(auditionId, ordinal);
        if (audition === undefined) {
            this.logger.debug('personas: this audition transition was already taken, so nothing was written', { audition: auditionId, ordinal });
            return;
        }

        try {
            const wrote = await this.writeTransition(audition, ordinal);
            if (!wrote) return;

            if (ordinal + 1 < audition.transitions) {
                await this.jobs.send('personas.audition', { auditionId, ordinal: ordinal + 1 });
                return;
            }

            await this.auditions.finish(auditionId);
            this.logger.info('personas: an audition finished', {
                audition: auditionId,
                persona: audition.personaKey,
                transitions: audition.transitions,
            });
        } catch (error) {
            // Recorded rather than thrown, for the reason every job in this tree does it: an
            // unhandled throw is a retry against a row that has already moved, and the reason is
            // what an operator actually needs.
            const reason = errorText(error);
            this.logger.warn(`personas: could not write a transition of an audition (${reason})`, { audition: auditionId, ordinal });
            await this.auditions.fail(auditionId, reason);
        }
    }

    /**
     * Write one transition and record it. Answers whether there was anything to write.
     *
     * A run whose records no longer reach this ordinal, or whose character has been deleted since it
     * started, is FAILED rather than carried on: both are states the console has to be able to
     * explain, and a run that quietly stopped at transition four of twenty is one nobody can read.
     */
    private async writeTransition(audition: Audition, ordinal: number): Promise<boolean> {
        const transition = transitionAt(audition.records, ordinal);
        if (transition === undefined) {
            await this.auditions.fail(audition.id, `this audition has no records for transition ${ordinal}`);
            return false;
        }

        const persona = await this.personas.find(audition.personaId);
        if (persona === undefined) {
            // The row cascades when a character is deleted, so this is the narrow window where the
            // delete lands between two transitions.
            await this.auditions.fail(audition.id, 'the character this was auditioning no longer exists');
            return false;
        }

        // Read and NOT rested, which is the whole reason the repositories split the two. See the
        // class note.
        const { notes } = await this.notes.forPrompt(persona.key);
        const story = await this.stories.forPrompt(persona.key);

        const recent = await this.auditions.recentScripts(audition.id);

        const result = await this.writers.write(
            auditionRequest({
                persona,
                notebook: notes,
                ...(story === undefined ? {} : { story: story.story }),
                previous: transition.previous,
                next: transition.next,
                recent,
                // Stable and unique per transition, so re-reading a run reports the break it
                // actually wrote rather than one spread over a different subject.
                turn: `${audition.id}:${ordinal}`,
                station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
                zone: stationZone(this.config),
                now: Date.now(),
            }),
        );

        await this.auditions.recordBreak(audition.id, ordinal, {
            previous: transition.previous,
            next: transition.next,
            attempts: result.attempts.map(toAttempt),
            ...(result.written === undefined ? {} : { script: result.written.script }),
            ...(result.writer === undefined ? {} : { writer: result.writer }),
            ...(result.reason === undefined ? {} : { reason: result.reason }),
        });

        return true;
    }
}

/**
 * One writer's turn, as the row keeps it.
 *
 * Every attempt is kept and not only the winner, on the registry's own argument: a model that
 * declined and a floor that covered for it are two facts, and the second alone reads as a station
 * that never had a model. Over a run those attempts are the measurement — the decline RATE is what
 * `break.declines.ts` reports after the fact, and this is the same thing before it.
 */
function toAttempt(attempt: { writer: string; outcome: string; written?: { script: string }; reason?: string; durationMs: number }): AuditionAttempt {
    return {
        writer: attempt.writer,
        outcome: attempt.outcome,
        durationMs: attempt.durationMs,
        ...(attempt.written === undefined ? {} : { script: attempt.written.script }),
        ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
    };
}
