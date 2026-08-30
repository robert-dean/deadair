import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { breakPrompt, DEFAULT_MAX_WORDS, readAnswer, writeDecline, writeTrim, type AnswerGuard, type BreakPromptShape } from './break.prompt.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import { timeClaimIn } from './clock.words.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak, patienceFor } from './break.writer.js';
import { BUDGET_MS, MAX_OUTPUT_TOKENS, MODEL_WRITER, MODEL_WRITER_DEFAULT, MODEL_WRITER_KEYS } from './model.talk.break.writer.js';
import { WELCOME_KIND } from './welcome.writer.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

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
    opening: request =>
        [
            'Somebody has just tuned in. They have not heard anything before this, so tell them what they are listening to.',
            // The greeting words verbatim, for the reason `request.clock` gets the same treatment: an
            // invented phrasing has no expiry the station can check, and this one is stamped as a
            // claim and checked at hand-over.
            request.greeting === undefined ? undefined : `Open with "${request.greeting.words}", in those words and no other way of saying it.`,
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

        if (!settingIsOn(this.config, MODEL_WRITER_KEYS.enabled, MODEL_WRITER_DEFAULT)) return undefined;
        if (!this.llm.canGenerate()) {
            this.logger.debug(`director: no model to greet with (${this.llm.explainGenerator()})`);
            return undefined;
        }

        const model = this.config.get(MODEL_WRITER_KEYS.model, '').trim();
        const messages = breakPrompt(
            request,
            {
                station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
                dj: request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, ''),
                cleanLanguage: speaksClean(advisoryPolicy(this.config)),
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
            },
            WELCOME_SHAPE,
        );

        const result = await this.llm.converse(
            {
                messages,
                ...(model.length === 0 ? {} : { model }),
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                reasoningEffort: 'low',
            },
            // No tools, for the talk break's reason: everything this needs is already in the prompt,
            // and the one thing a greeting must not be is late.
            {
                tools: false,
                budgetMs: BUDGET_MS,
                // Derived from when this break is due rather than fixed: see `patienceFor`.
                maxWaitMs: patienceFor(request.airsAt),
                // See `BreakWriteRequest.priority`: absent for a welcome that is going on air.
                ...(request.priority === undefined ? {} : { priority: request.priority }),
            },
        );

        const guard: AnswerGuard = {
            maxWords: DEFAULT_MAX_WORDS,
            ...(request.persona === undefined ? {} : { persona: request.persona }),
            // The list the prompt was built from, so a signature is refused here only where the
            // prompt named it as spent. See `AnswerGuard.recent`.
            ...(request.recent === undefined ? {} : { recent: request.recent }),
            // The same daypart the prompt stated, so a script is refused for contradicting it
            // only where it was actually told. See `AnswerGuard.dayPart`.
            ...(request.dayPart === undefined ? {} : { dayPart: request.dayPart }),
            // Beside the daypart and off the same instant: the words are what the prompt stated and
            // this is what the clock says, which is the half of the question a stretch cannot answer.
            ...(request.moment === undefined ? {} : { moment: request.moment }),
        };
        const script = readAnswer(result.text, guard);

        this.lastDetail = {
            // What the host RESOLVED, not what the setting said. A station that never pinned a
            // model left this empty, so every row read "the plugin default" and the record could
            // not answer which model wrote anything. See `LlmConversation.model`.
            model: result.model,
            ...(result.usage === undefined ? {} : { usage: result.usage as Record<string, number> }),
            ...(captureWrites(this.config) ? { prompt: messages, raw: result.text } : {}),
        };

        if (script === undefined) {
            // Why it was refused, on the row as well as in the log. See `writeDecline` and
            // `WriteDetail.reason`.
            const declined = writeDecline(result.text, guard);
            if (declined !== undefined) this.lastDetail = { ...this.lastDetail, reason: declined.reason };

            this.logger.info(`director: ${declined?.reason ?? 'the model wrote nothing the station could greet a listener with'}`, {
                finish: result.finishReason,
                tokens: result.usage?.outputTokens,
                persona: request.persona?.key,
                fault: declined?.fault,
            });
            return undefined;
        }

        // A greeting the station cut rather than refused. See `writeTrim`, and the talk break for why
        // it is re-derived rather than measured against what was sent.
        const trimmed = writeTrim(result.text, guard);
        if (trimmed !== undefined) {
            this.lastDetail = { ...this.lastDetail, reason: trimmed.reason };
            this.logger.info(`director: ${trimmed.reason}`, { kept: trimmed.kept, dropped: trimmed.dropped, persona: request.persona?.key });
        }

        const claimsTime = timeClaimIn(script, request.greeting, request.dayPart);

        return {
            script,
            label: 'Welcome',
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
