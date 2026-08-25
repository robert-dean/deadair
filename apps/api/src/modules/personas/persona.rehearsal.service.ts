import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { BreakWriterRegistry } from '#modules/director/break.writer.registry.js';
import { TALK_BREAK_KIND } from '#modules/director/talk.break.writer.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import type { BreakTrack } from '#modules/director/break.writer.js';
import type { PersonaRehearsal, PersonaRehearsalAttempt } from './types/personas.types.js';
import { PersonaRepository } from './persona.repository.js';
import { PersonaNotesRepository } from './persona.notes.repository.js';
import { PersonaStoriesRepository } from './persona.stories.repository.js';

/**
 * Hear a persona before putting it on air.
 *
 * What a character sheet actually produces was unknowable until it aired: an operator wrote one,
 * switched the station over and waited for a break. That loop is slow enough to have already cost
 * something — {@link MIN_DICTION_MARKERS} came down from two to one because the station's own seed
 * samples failed it, which is a tuning question that should have taken a minute and took an evening.
 *
 * So this asks the writers for a break under a named persona and hands back everything they said,
 * which is the same triple the activity feed reports after the fact: the model's line, why it was
 * declined, and the phrasing the floor used instead.
 *
 * ## It cannot air, and holds nothing that could put it on air
 *
 * No segment row, no `script_history`, no request. The service has the writer registry, the persona
 * repository and the notebook, and that is all, so "a rehearsal cannot be planted" is a fact about
 * what it can reach rather than a rule somebody has to keep remembering. The voice sample route next
 * door is the same shape for the same reason.
 *
 * The notebook is the one thing here that could leave a mark, and does not: {@link forPrompt} reads
 * and {@link markUsed} rests, they are two calls, and this makes only the first. So a rehearsal hears
 * the character exactly as it stands without moving the rotation under the next real break — which
 * is also what keeps two readings a minute apart comparable, on the same argument as the fixed pair
 * of records below.
 *
 * ## It takes the one model slot, and losing the race is a legitimate answer
 *
 * `LlmGate` serializes, so a rehearsal queues behind a refill or a real break like everything else —
 * and it must not preempt either. Nothing here arranges that: `ModelTalkBreakWriter` already gives
 * up after its own `MAX_WAIT_MS` and the registry reports that as an ordinary decline, so a
 * rehearsal during a busy minute answers with the floor's line and a sentence saying why, which is
 * exactly what the station would have done at that moment anyway.
 */

/**
 * The two records a rehearsal is run against.
 *
 * Invented rather than read off the running order, and FIXED rather than drawn at random, because a
 * rehearsal is a measurement: an operator edits a sheet and rehearses again to hear what changed,
 * and a substrate that moved in between makes the two readings incomparable. Neither carries a
 * `trackId` or any facts, so what comes back is the character and nothing the enrichment tables
 * happened to know.
 *
 * Ordinary records with nothing remarkable about them, deliberately. A pair chosen to be easy to
 * talk about would flatter every sheet equally.
 */
export const REHEARSAL_PREVIOUS: BreakTrack = { title: 'Green Onions', artist: 'Booker T. & the M.G.s' };
export const REHEARSAL_NEXT: BreakTrack = { title: 'Ain’t No Sunshine', artist: 'Bill Withers' };

@Injectable()
export class PersonaRehearsalService {
    constructor(
        private readonly personas: PersonaRepository,
        private readonly notes: PersonaNotesRepository,
        private readonly stories: PersonaStoriesRepository,
        private readonly writers: BreakWriterRegistry,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Write a talk break under one persona, and answer with every writer that was asked.
     *
     * The persona is the one NAMED, never `presenting()`: the whole point is to hear a character
     * that is not on air, and resolving the on-air one here would make the page answer a different
     * question from the one its button asks.
     */
    async rehearse(id: string): Promise<PersonaRehearsal> {
        const persona = await this.personas.find(id);
        if (persona === undefined) throw httpError(404).withDetails({ message: `persona "${id}" does not exist` });

        // Read and NOT rested, which is the whole reason the repository splits the two. A rehearsal
        // exists to let an operator hear the character as it currently stands, so it has to carry the
        // notebook; and it must not spend the rotation, or clicking the button would hand the next
        // real break this character's second-best six lines.
        const { notes } = await this.notes.forPrompt(persona.key);
        // The same split, one table over, and the reason is sharper here: a story's turn is spent by
        // READING it, so a rehearsal that stamped would hand the next real break the second story
        // and report a telling nobody heard. The rung is not consulted either — an operator who
        // clicked the button is asking to hear the character, not to be shown its habits.
        const story = await this.stories.forPrompt(persona.key);

        const result = await this.writers.write({
            kind: TALK_BREAK_KIND,
            previous: REHEARSAL_PREVIOUS,
            next: REHEARSAL_NEXT,
            station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
            persona,
            notebook: notes,
            ...(story === undefined ? {} : { story: story.story }),
            // Empty rather than the last few real scripts, and that is what keeps a reading
            // repeatable. `recent` is what makes a signature phrase SPENT, so a rehearsal carrying
            // the station's actual history would decline a script for repeating something the
            // operator never heard — and would decline a different one each time they clicked.
            recent: [],
            // The station is always more important than hearing what it would have said. A
            // rehearsal queues behind every break and refill, and is taken off the model the moment
            // one arrives — at which point the registry falls through and the operator hears the
            // floor's line instead, which is a legitimate answer rather than a failure and is
            // already one of the attempts the page draws.
            priority: 'preview',
        });

        this.logger.info('personas: an operator rehearsed a persona', {
            key: persona.key,
            writer: result.writer ?? 'nothing',
            attempts: result.attempts.length,
        });

        return {
            personaId: persona.id,
            previous: `${REHEARSAL_PREVIOUS.title} — ${REHEARSAL_PREVIOUS.artist}`,
            next: `${REHEARSAL_NEXT.title} — ${REHEARSAL_NEXT.artist}`,
            attempts: result.attempts.map(toAttemptView),
            ...(result.written === undefined ? {} : { script: result.written.script }),
            ...(result.writer === undefined ? {} : { writer: result.writer }),
            ...(result.reason === undefined ? {} : { reason: result.reason }),
        };
    }
}

/**
 * One writer's turn, as the console draws it.
 *
 * Every attempt crosses, not only the winner, because a model that declined and a floor that covered
 * for it are two facts and the second alone reads as a station that never had a model — which is the
 * registry's own argument for reporting them, and the reason this page is worth looking at.
 */
function toAttemptView(attempt: {
    writer: string;
    outcome: string;
    written?: { script: string };
    reason?: string;
    durationMs: number;
}): PersonaRehearsalAttempt {
    return {
        writer: attempt.writer,
        outcome: attempt.outcome,
        durationMs: attempt.durationMs,
        ...(attempt.written === undefined ? {} : { script: attempt.written.script }),
        ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
    };
}
