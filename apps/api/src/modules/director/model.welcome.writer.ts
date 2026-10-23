import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { stationPromptSettings } from './prompt.settings.js';
import { languageName } from '#modules/shared/language.name.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { type BreakPromptShape, type PromptSettings } from './break.prompt.js';
import { permittedYears, shownWithoutRecent } from './break.answer.guard.js';
import { timeClaimFor } from './clock.words.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import { writeWithModel } from './model.break.write.js';
import { MODEL_WRITER } from './model.talk.break.writer.js';
import { WELCOME_KIND } from './welcome.writer.js';

/**
 * A model greeting somebody who has just tuned in, with the station's own words underneath it.
 *
 * Registered ahead of `WelcomeWriter` rather than instead of it, for the reason every model binding
 * here is: everything that can go wrong — no plugin, a plugin that is down, a model that rambles, a
 * host answering at two tokens a second — falls through the registry to a correct sentence. **A slow
 * model costs a better greeting, never a silent station.**
 *
 * Everything about how it is bounded is `ModelTalkBreakWriter`'s, imported rather than restated so
 * the two cannot drift: one budget to tune, one wait to tune, one token ceiling to raise. What is its
 * own is {@link WELCOME_SHAPE}, which is the whole of what makes a greeting a greeting.
 *
 * It shares `llm.breakWriter` with the talk break deliberately. An operator turning the model on is
 * saying the station may use one to talk, and a second switch for the same decision would be a
 * setting whose only job is to be inconsistent with the first.
 */

/**
 * What the model is told a welcome IS.
 *
 * `showsPrevious: false` is the load-bearing line and it is a withholding rather than an
 * instruction: a model shown a record will find a way to cue it, and cueing the record before this
 * one to somebody who arrived thirty seconds ago is announcing something they never heard. The
 * deterministic floor withholds exactly the same thing by building its inputs without it.
 */
export const WELCOME_SHAPE: BreakPromptShape = {
    job: 'You welcome somebody who has just started listening. It is read aloud exactly as you write it.',
    showsPrevious: false,
    // The talk break's rule in this kind's own words, including its second half. A greeting listed
    // too: "Deadair blasting Winds Of Change by The Meadowfolk. Barn vibes. Length just over five
    // minutes forty-two seconds." is a real one from this station, and the running time of a record is
    // the clearest possible case of a fact that reached the prompt and should never have reached the
    // air. It is also the kind where saying what the saved words are for matters most: a greeting has
    // one record to talk about and nothing behind it, so a model that only knows what to leave out
    // has very little left to say at all.
    rules: [
        'Make one point, and make it the way only you would. A greeting is a single thought said well, not a list of facts about the ' +
            'record coming up: the words you save by leaving those out are yours to spend on sounding like yourself.',
    ],
    // The front door is a place a character is allowed to sound like itself. See `allowsLatitude`
    // for why this was off and what changed: a station whose links are unleashed and whose greeting
    // is prim was two characters, and the arriving listener meets the prim one first.
    //
    // It does NOT lengthen a greeting by itself. `maxWordsFor` takes the larger of this kind's own
    // ceiling and the rung's, and a welcome's ceiling is `DEFAULT_MAX_WORDS`, so the rung raises it
    // to 70 or 100 words. That is the one cost of this flag worth watching: a greeting is the one
    // break with a listener who has heard nothing yet, and there is no evidence a long one is better.
    allowsLatitude: true,
    // The rule above with its first half turned around, and its second half kept word for word. The
    // list-of-facts half is what the running-time failure argued for and no amount of room excuses
    // it: a greeting that spends 100 words listing the sleeve notes is the same fault at more length.
    latitudeRules: [
        'Say the whole of what you actually want to say to somebody who has just walked in. This is not a formality to get through: if ' +
            'you have a thought about being on air right now, follow it, and stop when you are finished rather than when you have been ' +
            'brief. What it must not turn into is a list of facts about the record coming up, however long you take.',
    ],
    opening: (request, settings) =>
        [
            'Somebody has just tuned in. They have not heard anything before this, so tell them what they are listening to.',
            // The greeting words verbatim, for the reason `request.clock` gets the same treatment: an
            // invented phrasing has no expiry the station can check, and this one is stamped as a
            // claim and checked at hand-over.
            request.greeting === undefined
                ? undefined
                : settings.language === undefined
                  ? `Open with "${request.greeting.words}", in those words and no other way of saying it.`
                  : // Words in English cannot come back verbatim from a break that is not, so the greeting
                    // is asked for in the station's own language and is not a claim the station can check.
                    `Open with the ${languageName(settings.language)} for "${request.greeting.words}".`,
        ]
            .filter(Boolean)
            .join(' '),
};

@Injectable()
export class ModelWelcomeWriter extends BreakWriter {
    readonly kind = WELCOME_KIND;
    readonly name = MODEL_WRITER;

    private lastDetail?: WriteDetail;

    constructor(
        private readonly llm: LlmService,
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

        // Held rather than passed inline, for `ModelTalkBreakWriter`'s reason: a persona's latitude
        // decides the word ceiling now that `WELCOME_SHAPE` offers one, and the number the model is
        // told has to be the number the guard refuses at. One `maxWordsFor` call over one object.
        const settings: PromptSettings = {
            ...stationPromptSettings(this.config, request),
            ...(request.persona === undefined ? {} : { persona: request.persona }),
            // Carried across like the persona. Note the SHAPE decides what a welcome does with
            // it: `showsPlayed` is off here because an arriving listener heard none of the show,
            // and the same argument does not reach a notebook — somebody tuning in has heard this
            // station before, which is the whole premise of a note.
            ...(request.notebook === undefined ? {} : { notebook: request.notebook }),
            // Passed and then declined by `WELCOME_SHAPE`, which does not set `allowsCues`. Handed
            // over anyway so every model writer assembles its settings the same way: what a kind
            // of break permits belongs on the shape, and a writer that pre-empted its own shape
            // would put the same decision in two places.
            ...(request.reactions === undefined ? {} : { reactions: request.reactions }),
        };

        const outcome = await writeWithModel(
            { llm: this.llm, config: this.config, logger: this.logger },
            {
                request,
                settings,
                shape: WELCOME_SHAPE,
                guard: messages => ({
                    // The one record this kind is shown, so a script that says it has already played is
                    // refused rather than aired: "Lovefool just slid into the mix" ahead of Lovefool. See
                    // `misCuedIn`.
                    ...(request.next === undefined ? {} : { cues: { next: request.next } }),
                    // The talk break's own guard, carried over: `WELCOME_SHAPE` never shows a previous
                    // record (`showsPrevious: false`), so the only one a greeting is ever handed is
                    // `request.next`, and `recent` is stripped out of the prompt before it reaches `shown`
                    // for `permittedYears`' own reason: a year another writer invented is quoted back into
                    // this prompt's "You said these recently" block too. See `ModelTalkBreakWriter.write`.
                    years: permittedYears([request.next], request.moment, shownWithoutRecent(messages, request.recent)),
                }),
                purpose: { noModel: 'greet with', nothing: 'greet a listener with' },
            },
        );
        this.lastDetail = outcome.detail;
        if (outcome.written === undefined) return undefined;
        const { script, guard } = outcome.written;
        const claimsTime = timeClaimFor(script, guard.language, request.greeting, request.dayPart);

        return {
            script,
            label: 'Welcome',
            // One word, and it is the same word either way round.
            listenerLabel: 'Welcome',
            // Told what the next record is means allowed to name it, so assume it did:
            // over-stamping costs a greeting the order drifted under, which is the safe direction.
            claimsNext: request.next !== undefined,
            // Stamped only when the answer really carries the greeting, which is the opposite posture
            // and deliberately so — the words either appear or they do not, so there is nothing to
            // assume, and a model that paraphrased "good morning" into something with a different
            // lifetime has made no claim this station can honour.
            //
            // The daypart is offered alongside because a welcome may date itself without greeting
            // anybody: "you're up late with us" is the same claim as "good evening" and expires on
            // its own schedule. The two intersect where a script used both. See `timeClaimIn`.
            ...(claimsTime === undefined ? {} : { claimsTime }),
        };
    }
}
