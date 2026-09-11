import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Duration } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { BreakWriterRegistry } from '#modules/director/break.writer.registry.js';
import { stationZone } from '#modules/director/clock.words.js';
import { EnrichmentReadService } from '#modules/enrichment/enrichment.read.service.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { errorText } from '#modules/shared/error.text.js';
import { rotationOf } from '#modules/shared/rotation.js';
import { transitionAt, type Audition, type AuditionAttempt } from './persona.audition.js';
import { auditionRequest } from './persona.audition.request.js';
import { storytellingOf } from './persona.sheet.js';
import { PersonaAuditionRepository } from './persona.audition.repository.js';
import { PersonaRepository } from './persona.repository.js';
import { PersonaNotesRepository } from './persona.notes.repository.js';
import { PersonaStoriesRepository } from './persona.stories.repository.js';
import type { Persona } from './persona.js';
import type { PersonaStoryForPrompt } from './persona.story.js';

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
    /**
     * How many times this transition has already been put off because the station wanted the model.
     *
     * In the payload rather than on the row, because it is a fact about this attempt at one
     * transition and not about the run: a transition that eventually writes leaves nothing behind,
     * and a row carrying a counter would need clearing every time the cursor moved. Absent is the
     * first go.
     */
    waited?: number;
}

/**
 * How long to leave the model alone before trying a transition again.
 *
 * Longer than the gate's own patience (`patienceFor`'s 30-second default), because what this is
 * waiting out is not a queue but a busy STATION: a refill, a break being written, a production pass.
 * Trying again the moment the queue clears would just lose the race again.
 */
const WAIT_FOR_THE_MODEL = Duration.fromObject({ seconds: 45 });

/**
 * How many times a transition may be put off before its answer is taken as it stands.
 *
 * A bound rather than a rule about the station's state, because there is no state that means "and
 * it will be free eventually". A station busy for three quarters of an hour is one an operator
 * should be reading the floor's lines from, with the run saying plainly that is what happened.
 */
const MOST_WAITS = 3;

/**
 * The failures that are facts about the minute rather than about the sheet.
 *
 * `timeout` is the gate's queue running out of patience; `unavailable` is the station taking the
 * model back mid-generation, which is `preview` being preempted and is the ordinary outcome of
 * auditioning while the station is working. Neither says anything about the character.
 */
const BUSY: ReadonlySet<string> = new Set(['timeout', 'unavailable']);

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
        // What the station knows about the records, read without spending the claims' cooldown.
        private readonly enrichment: EnrichmentReadService,
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
        const waited = payload.waited ?? 0;

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
            const wrote = await this.writeTransition(audition, ordinal, waited);
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
    private async writeTransition(audition: Audition, ordinal: number, waited: number): Promise<boolean> {
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

        // Before the story, because the rung that decides whether there is one is keyed on whether
        // the station knows anything about these records.
        const facts = await this.factsFor(audition.id, ordinal, transition);
        const story = await this.storyFor(persona, ordinal, facts);

        const recent = await this.auditions.recentScripts(audition.id);

        const result = await this.writers.write(
            auditionRequest({
                persona,
                notebook: notes,
                ...(story === undefined ? {} : { story }),
                previous: transition.previous,
                next: transition.next,
                ...(facts === undefined ? {} : { facts }),
                recent,
                // Stable and unique per transition, so re-reading a run reports the break it
                // actually wrote rather than one spread over a different subject.
                turn: `${audition.id}:${ordinal}`,
                station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
                zone: stationZone(this.config),
                now: Date.now(),
            }),
        );

        // The station wanted the model back, or never let it go. Nothing is recorded and the cursor
        // does not move: the same transition is sent again in a minute, and the run simply takes
        // longer. See {@link busyModel}.
        if (waited < MOST_WAITS && busyModel(result.attempts)) {
            await this.jobs.send('personas.audition', { auditionId: audition.id, ordinal, waited: waited + 1 }, { startAfter: WAIT_FOR_THE_MODEL });
            this.logger.info('personas: the station wanted the model, so this transition waits', {
                audition: audition.id,
                ordinal,
                waited: waited + 1,
            });
            return false;
        }

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

    /**
     * The short true things the station knows about this transition's two records.
     *
     * Unstamped, which is the whole reason `factsForTracks` takes the option: a claim is on a
     * week-long cooldown once it is handed over, and a run of twenty transitions that stamped would
     * put a week of the station's best claims out of reach of the breaks that were going to say
     * them. The audition is a measurement; the cooldown belongs to the broadcast.
     *
     * Rotated over the transition rather than a segment id, which is `rotationOf`'s own rule read
     * one caller further out: the rotation has to be STABLE for a given break, so re-reading a run
     * reports the facts the host was actually shown.
     *
     * Best-effort, like every other substrate read here: facts that could not be read cost the
     * transition its facts and never its break.
     */
    private async factsFor(
        auditionId: string,
        ordinal: number,
        transition: { previous: { trackId?: string }; next: { trackId?: string } },
    ): Promise<{ previous?: readonly string[]; next?: readonly string[] } | undefined> {
        const ids = [transition.previous.trackId, transition.next.trackId].filter((id): id is string => id !== undefined);
        if (ids.length === 0) return undefined;

        try {
            const found = await this.enrichment.factsForTracks(ids, rotationOf(`${auditionId}:${ordinal}`), { stamp: false });
            const previous = transition.previous.trackId === undefined ? undefined : found.get(transition.previous.trackId);
            const next = transition.next.trackId === undefined ? undefined : found.get(transition.next.trackId);

            if (previous === undefined && next === undefined) return undefined;

            return { ...(previous === undefined ? {} : { previous }), ...(next === undefined ? {} : { next }) };
        } catch (error) {
            this.logger.warn(`personas: could not read what the station knows about these records (${errorText(error)})`, { audition: auditionId });
            return undefined;
        }
    }

    /**
     * The one story this transition may draw on, or nothing.
     *
     * The rung is `storytellingOf`, applied exactly where `WriteBreakJob` applies it and keyed on
     * the same fact: `occasionally` fires when the station knows nothing about the records, because
     * that is the moment the prompt hands a model a prohibition and nothing else — and what filled
     * that silence when it was measured was invented pressing plants.
     *
     * Which story is picked spreads over the ORDINAL rather than being the least-recently-told one
     * every time. `forPrompt` would answer the same story at every transition, since nothing here
     * stamps: a shelf of six read twenty times unstamped is one anecdote told twenty times, which
     * would be a fact about the audition rather than about the character.
     *
     * Best-effort, like the facts and the notebook.
     */
    private async storyFor(
        persona: Persona,
        ordinal: number,
        facts: { previous?: readonly string[]; next?: readonly string[] } | undefined,
    ): Promise<PersonaStoryForPrompt | undefined> {
        const rung = storytellingOf(persona);
        if (rung === 'never') return undefined;

        // Every record this break was shown carries something to say, so there is no silence for a
        // story to fill.
        const knownAbout = (facts?.previous?.length ?? 0) > 0 || (facts?.next?.length ?? 0) > 0;
        if (rung === 'occasionally' && knownAbout) return undefined;

        try {
            const shelf = await this.stories.tellable(persona.key);
            if (shelf.length === 0) return undefined;

            return shelf[ordinal % shelf.length];
        } catch (error) {
            this.logger.warn(`personas: could not read this character's own stories (${errorText(error)})`, { persona: persona.key });
            return undefined;
        }
    }
}

/**
 * Whether the model was lost to the station rather than having nothing to say.
 *
 * **This is what stops an audition measuring the wrong thing.** A run at the `preview` tier gives the
 * model up to every refill, every real break and every production pass, and when it does the registry
 * falls through to the floor and produces a perfectly good line in the character's voice. On air that
 * is the arrangement working. In a MEASUREMENT it is a lie: an operator reading "the floor covered
 * eight of ten" would take a fact about a busy Tuesday for a fact about their character sheet, and
 * would go and rewrite a sheet that was never asked.
 *
 * So a transition whose model attempt failed on `timeout` or `unavailable` is not recorded at all —
 * it is put off and asked again. Any other failure IS about the writer and is recorded as it stands.
 *
 * Only the attempts that FAILED are examined: a model that declined had the slot and made a
 * decision, which is exactly the reading an audition exists to collect.
 */
const busyModel = (attempts: readonly { outcome: string; code?: string }[]): boolean =>
    attempts.some(attempt => attempt.outcome === 'failed' && attempt.code !== undefined && BUSY.has(attempt.code));

/**
 * One writer's turn, as the row keeps it.
 *
 * Every attempt is kept and not only the winner, on the registry's own argument: a model that
 * declined and a floor that covered for it are two facts, and the second alone reads as a station
 * that never had a model. Over a run those attempts are the measurement — the decline RATE is what
 * `break.declines.ts` reports after the fact, and this is the same thing before it.
 *
 * `WriteAttempt.code` is deliberately not kept. It exists so {@link busyModel} can tell a lost model
 * slot from a broken writer, which is a decision made before anything is recorded; by the time a row
 * is written the reason already says what happened in words, and a code on the row would be a second
 * spelling of it for nobody.
 */
function toAttempt(attempt: {
    writer: string;
    outcome: string;
    written?: { script: string };
    reason?: string;
    durationMs: number;
    detail?: { refused?: string };
}): AuditionAttempt {
    return {
        writer: attempt.writer,
        outcome: attempt.outcome,
        durationMs: attempt.durationMs,
        ...(attempt.written === undefined ? {} : { script: attempt.written.script }),
        ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
        // Only on a decline: a written attempt's words are `script`, and a failed one produced none.
        ...(attempt.outcome === 'declined' && attempt.detail?.refused !== undefined ? { refused: attempt.detail.refused } : {}),
    };
}
