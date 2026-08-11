import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { breakPrompt, DEFAULT_MAX_WORDS, readAnswer } from './break.prompt.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import { labelFor, TALK_BREAK_KIND } from './talk.break.writer.js';

/**
 * A model writing the station's talk breaks, with the station's own words underneath it.
 *
 * Registered AHEAD of `TalkBreakWriter` rather than instead of it, so everything that can go wrong
 * here — no plugin, a plugin that is down, a model that rambles, a host answering at two tokens a
 * second — falls through the registry to a correct sentence. That is not belt and braces, it is the
 * design: **a slow model must cost a better sentence, never a silent station.**
 *
 * ## It does nothing at all until an operator asks
 *
 * `llm.breakWriter` is off by default, and with it off this declines before it has done anything.
 * A station with no model plugin declines too, because {@link LlmService.canGenerate} is an ordinary
 * question with an ordinary "no" — every fresh install is that station, and it talks perfectly well.
 *
 * ## Everything about it is bounded, and the bounds are tight on purpose
 *
 * A break is a sentence. It is worth a few seconds of a model's time and no more, because the thing
 * waiting for it is a slot in a running order that will be handed over whether or not the words
 * arrive. The write window (`BreakPlanner.ripen`) is what gives these bounds room to be this tight:
 * by the time a break is asked for, its slot is about a quarter of an hour away.
 */

/** What `segments.writer` records for anything written here. */
export const MODEL_WRITER = 'model';

/**
 * How long to wait for the model's SLOT before giving up and letting the floor write.
 *
 * `LlmGate` holds one generation at a time, so this is the queue rather than the generation. A
 * break that has been waiting ten seconds for a show to finish generating is a break the station
 * should simply write itself: the deterministic line is instant and correct, and the model's turn
 * comes round for the next one.
 */
export const MAX_WAIT_MS = 10_000;

/**
 * How long the whole generation may take once it has the slot.
 *
 * Well under `LlmService.GENERATION_BUDGET_MS`, which is sized for a show. Forty words on a healthy
 * local model is a couple of seconds; this is what a host that has started swapping looks like, and
 * at that point the floor's sentence is worth more than a better one that arrives after the record
 * it was about has finished playing.
 */
export const BUDGET_MS = 45_000;

/**
 * A ceiling on the answer, in tokens.
 *
 * Roughly three times {@link DEFAULT_MAX_WORDS} in tokens, so an ordinary answer is never truncated
 * and a model that has decided to write an essay is stopped by the provider rather than by the
 * station reading forty seconds of it. `readAnswer` still declines anything over the word ceiling:
 * this is about not PAYING for the essay, that is about not airing it.
 */
export const MAX_OUTPUT_TOKENS = 160;

/** The `deadair.settings` keys this binding reads. */
export const MODEL_WRITER_KEYS = {
    enabled: 'llm.breakWriter',
    model: 'llm.breakModel',
    persona: 'llm.breakPersona',
} as const;

@Injectable()
export class ModelTalkBreakWriter extends BreakWriter {
    readonly kind = TALK_BREAK_KIND;
    readonly name = MODEL_WRITER;

    /** What the last write cost and how it got there. See {@link detailOfLastWrite}. */
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

        // Both cheap, both silent, and both an ordinary state rather than a fault. Read per break
        // rather than held, so an operator turning the model on hears it on the next break.
        if (!this.config.get(MODEL_WRITER_KEYS.enabled, false)) return undefined;
        if (!this.llm.canGenerate()) {
            // At debug: a station with no model configured would otherwise say so every fourth
            // record, and `LlmService` already explains it once where it matters.
            this.logger.debug(`director: no model to write with (${this.llm.explainGenerator()})`);
            return undefined;
        }

        const model = this.config.get(MODEL_WRITER_KEYS.model, '').trim();
        const messages = breakPrompt(request, {
            station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
            dj: this.config.get(TEMPLATE_KEYS.djName, ''),
            persona: this.config.get(MODEL_WRITER_KEYS.persona, ''),
        });

        const result = await this.llm.converse(
            {
                messages,
                ...(model.length === 0 ? {} : { model }),
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                // A talk break is not a reasoning problem, and on a host that spills its context
                // this is the difference between a break and a fall-through.
                reasoningEffort: 'low',
            },
            {
                // Nothing to look up: both records are already in the prompt. A tool round trip
                // here would buy a fact the station was not asked for at the cost of another whole
                // generation, and the one thing this must not do is be slow.
                tools: false,
                budgetMs: BUDGET_MS,
                maxWaitMs: MAX_WAIT_MS,
            },
        );

        const script = readAnswer(result.text, { maxWords: DEFAULT_MAX_WORDS });

        // Recorded whichever way it went, and BEFORE the answer is judged, so a model that produced
        // forty seconds of nothing leaves behind the same numbers as one that worked.
        this.lastDetail = {
            model: model.length === 0 ? 'the plugin default' : model,
            ...(result.usage === undefined ? {} : { usage: result.usage as Record<string, number> }),
            ...(captureWrites(this.config) ? { prompt: messages, raw: result.text } : {}),
        };

        if (script === undefined) {
            // Not a throw: a model that rambled or answered with nothing is the ordinary case this
            // whole arrangement exists to absorb. The registry turns it into the floor's sentence
            // and keeps the reason.
            this.logger.info('director: the model wrote nothing the station could say', {
                finish: result.finishReason,
                words: result.text.trim().split(/\s+/).filter(Boolean).length,
            });
            return undefined;
        }

        return {
            script,
            // Never asked of the model. A label is for the console and the mount, so generating one
            // would be paying for something no listener hears — and the deterministic labeller
            // already names the break for the records it sits between.
            label: labelFor(request),
            // Told what the next record is means allowed to name it, so assume it did. Over-stamping
            // costs a break the order drifted under, which is the safe direction; under-stamping
            // airs a promise nobody checked, which is the direction the claim exists to close.
            claimsNext: request.next !== undefined,
        };
    }
}
