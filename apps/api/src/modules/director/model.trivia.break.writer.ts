import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { FactRepository } from '#modules/enrichment/fact.repository.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { permittedYears, shownWithoutRecent } from './break.answer.guard.js';
import { type BreakPromptShape } from './break.prompt.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import { timeClaimFor } from './clock.words.js';
import { mentionsFact } from './fact.mentions.js';
import { writeWithModel } from './model.break.write.js';
import { MODEL_WRITER } from './model.talk.break.writer.js';
import { stationPromptSettings } from './prompt.settings.js';
import { TRIVIA_KIND } from './trivia.kind.js';
import type { TriviaFact } from './trivia.source.js';

/**
 * A model passing on a piece of trivia, with the station reading the claim out underneath it.
 *
 * Registered ahead of `TriviaBreakWriter` rather than instead of it, for the reason every model
 * binding is: a model that is down, slow, or refused falls through the registry to a frame around the
 * stored claim. **A slow model costs a better-told piece of trivia, never a silent slot.**
 *
 * ## What it earns, and the one thing it must not do
 *
 * The floor can say "Did you know? Dummy was recorded in Bath over ten months." and nothing else. A
 * presenter picks the one of six a listener would most enjoy, says it in their own voice, and ties it
 * to the record coming up if it goes there. That is what the model is for.
 *
 * What it must not do is what a trivia break most tempts it to: add the second half of the story from
 * memory. Every claim here came out of an article with the span that supports it, and anything the
 * model adds is delivered in the same voice with no source at all — which is the failure the whole
 * fact store exists to prevent (`docs/internals/breaks.md` § "A claim needs its evidence"). So the
 * shape forbids it in so many words, and the guard refuses the part of it that is checkable: a year
 * the station was never shown, through `AnswerGuard.years`, exactly as the almanac's does.
 *
 * ## It declines with nothing to say, exactly as the floor does
 *
 * A model asked to fill a trivia slot with no claims in it is being asked for trivia it remembers, and
 * it would oblige.
 *
 * ## Which claim it used is read back, never asked
 *
 * `mentionsFact`, the station's own read-back, judges which claims the script said, and only those
 * are rested. A claim it cannot judge is left in the store rather than guessed at, `entriesUsed`'s
 * rule: guessing all six spends a week's material on one break, guessing the first spends one the
 * model may not have said.
 */

/**
 * How long a trivia break may run, in words.
 *
 * Seventy, the almanac's ceiling: one claim said the way a presenter says one, plus the hand back to
 * the music. Past this the model is telling the story around the claim, and that story is the part
 * nothing can check.
 */
export const TRIVIA_BREAK_MAX_WORDS = 70;

/**
 * What the model is told a trivia break IS.
 *
 * `showsPrevious: false` and `showsFacts: false` for the almanac's reasons, and the second is sharper
 * here: the notes on the record coming up are claims of the same kind as the trivia, and a model
 * shown both will braid them into one story nobody can trace. `showsNotebook: false` with them.
 */
export const TRIVIA_BREAK_SHAPE: BreakPromptShape = {
    job: 'You pass on one piece of trivia about the music this station plays. It is read aloud exactly as you write it.',
    showsPrevious: false,
    showsFacts: false,
    showsNotebook: false,
    opening: request => (request.trivia === undefined || request.trivia.length === 0 ? undefined : describeTrivia(request.trivia)),
    rules: [
        'Pick ONE of the facts above, the one a listener would most enjoy, say what it is about, and pass it on in a sentence or two. Then hand ' +
            'back to the music in a line.',
        'Everything you say about it has to be in the fact you picked. Do not add the rest of the story, what else that artist did, what ' +
            'year anything else happened or how it was received: the station looked up that one sentence and nothing around it, and what you ' +
            'remember sounds exactly like what you were given.',
        'Keep every name, number and year exactly as it is written. Do not round a figure, convert it or work out a new one from it.',
        'Do not call it famous, legendary, surprising or little-known, and do not say what it means. Say the fact and hand back.',
    ],
};

@Injectable()
export class ModelTriviaBreakWriter extends BreakWriter {
    readonly kind = TRIVIA_KIND;
    readonly name = MODEL_WRITER;

    private lastDetail?: WriteDetail;

    constructor(
        private readonly llm: LlmService,
        private readonly facts: FactRepository,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    detailOfLastWrite(): WriteDetail | undefined {
        return this.lastDetail;
    }

    async write(request: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastDetail = undefined;

        const trivia = request.trivia;
        if (trivia === undefined || trivia.length === 0) return undefined;

        const outcome = await writeWithModel(
            { llm: this.llm, config: this.config, logger: this.logger },
            {
                request,
                settings: {
                    ...stationPromptSettings(this.config, request),
                    maxWords: TRIVIA_BREAK_MAX_WORDS,
                    ...(request.persona === undefined ? {} : { persona: request.persona }),
                },
                shape: TRIVIA_BREAK_SHAPE,
                // The almanac's `optional`, for its measured reason: a kind that earns its keep by being
                // correct must not be refused for not being sufficiently in voice.
                dialect: 'optional',
                guard: messages => ({
                    // The one record this kind is shown, so a script that says it has already played is
                    // refused rather than aired.
                    ...(request.next === undefined ? {} : { cues: { next: request.next } }),
                    // Every year the prompt SHOWED, the facts' own included, and nothing else. A model
                    // that remembers the year a record came out and says it beside a claim that never
                    // named one is the most plausible invention this kind can produce.
                    years: permittedYears([request.next], request.moment, shownWithoutRecent(messages, request.recent)),
                }),
                purpose: { noModel: 'pass a piece of trivia on with', nothing: 'pass on as trivia' },
                context: { facts: trivia.length },
            },
        );
        this.lastDetail = outcome.detail;
        if (outcome.written === undefined) return undefined;
        const { script, guard } = outcome.written;

        // Spent here, where the words have won, and only what the read-back says was said.
        const used = factsUsed(script, trivia, recordNamesOf(request));
        if (used.length > 0) {
            await this.facts
                .markUsed(used.map(fact => fact.factId))
                .catch(error => this.logger.warn(`director: could not rest a trivia claim (${errorText(error)})`));
        }

        const claimsTime = timeClaimFor(script, guard.language, request.clock, request.dayPart);

        return {
            script,
            label: used[0] === undefined ? 'Trivia' : `Trivia: ${used[0].about}`,
            listenerLabel: 'Trivia',
            // Told what plays next means allowed to name it, so assume it did: over-stamping costs a
            // break the order drifted under, which is the safe direction.
            claimsNext: request.next !== undefined,
            ...(claimsTime === undefined ? {} : { claimsTime }),
        };
    }
}

/**
 * The facts as the model is shown them: what each is about, then the claim, one line each.
 *
 * The subject is the catalog's own names and the claim is the store's sentence, so nothing in a line
 * is the station's wording. Exported for the tests, which assert on exactly this.
 */
export function describeTrivia(trivia: readonly TriviaFact[]): string {
    return [
        'Facts about music this station plays, one per line, each with what it is about. These were looked up, each from a published source; ' +
            'they are not yours to add to.',
        ...trivia.map(fact => `- About ${fact.about}: ${fact.claim}`),
    ].join('\n');
}

/**
 * The claims a script actually said, by the station's own read-back.
 *
 * `mentionsFact` looks for a claim's distinctive names and figures, with the record coming up left out
 * because a hand-back names it anyway. A claim it cannot judge, or judges unsaid, is not spent.
 */
export function factsUsed(script: string, trivia: readonly TriviaFact[], recordNames: readonly string[]): TriviaFact[] {
    return trivia.filter(fact => mentionsFact(script, fact.claim, recordNames) === true);
}

/** The next record's title and artist, which a hand-back names whatever fact it passed on. */
function recordNamesOf(request: BreakWriteRequest): string[] {
    const next = request.next;
    return next === undefined ? [] : [next.title, next.artist].filter((name): name is string => typeof name === 'string' && name.length > 0);
}
