import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { breakPrompt, DEFAULT_MAX_WORDS, readAnswer, writeDecline, type AnswerGuard, type BreakPromptShape } from './break.prompt.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import { saysTime } from './clock.words.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak, patienceFor } from './break.writer.js';
import { BUDGET_MS, MAX_OUTPUT_TOKENS, MODEL_WRITER, MODEL_WRITER_KEYS } from './model.talk.break.writer.js';
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

        if (!this.config.get(MODEL_WRITER_KEYS.enabled, false)) return undefined;
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
        };
        const script = readAnswer(result.text, guard);

        this.lastDetail = {
            model: model.length === 0 ? 'the plugin default' : model,
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
            ...(request.greeting !== undefined && saysTime(script, request.greeting)
                ? { claimsTime: { from: request.greeting.validFrom, until: request.greeting.validUntil } }
                : {}),
        };
    }
}
