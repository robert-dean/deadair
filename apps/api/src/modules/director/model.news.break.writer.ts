import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { breakPrompt, characterDecline, readAnswer, type AnswerGuard, type BreakPromptShape } from './break.prompt.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import { saysTime } from './clock.words.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import { BUDGET_MS, MAX_OUTPUT_TOKENS, MAX_WAIT_MS, MODEL_WRITER, MODEL_WRITER_KEYS } from './model.talk.break.writer.js';
import { NEWS_KIND } from './news.break.writer.js';

/**
 * A model reading the headlines, with the station's own bulletin underneath it.
 *
 * Registered ahead of `NewsBreakWriter` rather than instead of it, for the reason every model
 * binding here is: a plugin that is down, a host answering at two tokens a second, an answer that
 * broke character — all of it falls through the registry to a bulletin that reads the headlines
 * correctly. **A slow model costs a better-read bulletin, never a silent slot.**
 *
 * How it is bounded is `ModelTalkBreakWriter`'s, imported rather than restated so the two cannot
 * drift, and it shares `llm.breakWriter` with the other two bindings for the same reason they share
 * it: an operator turning the model on is saying the station may use one to talk.
 *
 * ## What is its own is the risk
 *
 * Every other break a model writes is about music, where the worst failure is an awkward sentence.
 * This one states things as fact to somebody who cannot check them, so it is the one kind where the
 * floor underneath is not merely a safety net but arguably the better product — reading a published
 * headline is a thing that cannot be wrong. The model earns its place by making three headlines
 * sound like a bulletin rather than a list, and everything in {@link NEWS_SHAPE} and in the stories
 * rule in `break.prompt.ts` exists to stop it earning it by inventing.
 *
 * It declines outright when there is nothing to report, exactly as the floor does. Asking a model
 * to fill a bulletin slot with no stories in it is asking for a fabricated bulletin, and it would
 * get one.
 */

/**
 * How long a bulletin may run, in words.
 *
 * Raised from 120 when the stories arrived. That number was three stories' HEADLINES plus the words
 * around them, and it was the right size for exactly as long as a headline was all a writer had; a
 * bulletin now has the article under each one and is asked for a sentence of what happened, which is
 * three sentences this did not previously have room for.
 *
 * Raising a ceiling is otherwise the wrong move here and the persona work argues it at length — a
 * ceiling permits, it does not ask, and 2 of 137 captured breaks ever reached one. The difference is
 * that this ceiling was measurably in the way of something the prompt now explicitly asks for, which
 * is the one condition under which raising one is not just permitting slop.
 *
 * `readAnswer` still DECLINES anything past it rather than cutting, so a model that turned the news
 * into an essay loses the slot to the floor, which reads it in twenty seconds and is never wrong.
 */
export const NEWS_MAX_WORDS = 170;

/**
 * What the model is told a bulletin IS.
 *
 * `showsPrevious: false` for `WELCOME_SHAPE`'s reason, sharpened: a model shown the record that has
 * just finished will open the news by back-announcing it, which is a presenter who has not decided
 * what this break is. The record COMING UP is deliberately still shown, because handing back to the
 * music is the one piece of continuity a bulletin owes the hour.
 */
export const NEWS_SHAPE: BreakPromptShape = {
    job: 'You read a short news bulletin. It is read aloud exactly as you write it.',
    showsPrevious: false,
    opening: () =>
        'This is the news. Introduce it in a sentence, report the stories below in the order they are given, and then hand back to the music. ' +
        'Each story gets its headline and a sentence of what happened, from the text you are given and nowhere else. ' +
        'You are reporting, not commenting: no jokes about the stories, no opinions, and nothing about how they make anyone feel.',
};

@Injectable()
export class ModelNewsBreakWriter extends BreakWriter {
    readonly kind = NEWS_KIND;
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

        // Before the model is asked anything. Nothing to report is the floor's branch as well, and
        // both of them decline: a bulletin is the one break where having no substrate is a reason
        // to say nothing rather than a reason to say something general.
        if ((request.stories?.length ?? 0) === 0) return undefined;

        if (!this.config.get(MODEL_WRITER_KEYS.enabled, false)) return undefined;
        if (!this.llm.canGenerate()) {
            this.logger.debug(`director: no model to read the news with (${this.llm.explainGenerator()})`);
            return undefined;
        }

        const model = this.config.get(MODEL_WRITER_KEYS.model, '').trim();
        const messages = breakPrompt(
            request,
            {
                station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
                dj: request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, ''),
                maxWords: NEWS_MAX_WORDS,
                ...(request.persona === undefined ? {} : { persona: request.persona }),
            },
            NEWS_SHAPE,
        );

        const result = await this.llm.converse(
            {
                messages,
                ...(model.length === 0 ? {} : { model }),
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                reasoningEffort: 'low',
            },
            // No tools. Everything this bulletin may contain is already in the prompt, and a model
            // that could go looking for more of a story is a model that can report something the
            // station never fetched — which is the whole failure this kind is shaped against.
            { tools: false, budgetMs: BUDGET_MS, maxWaitMs: MAX_WAIT_MS },
        );

        const guard: AnswerGuard = {
            maxWords: NEWS_MAX_WORDS,
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
            // The character reason where there is one, on the row as well as in the log. See
            // `characterDecline` and `WriteDetail.reason`.
            const declined = characterDecline(result.text, guard);
            if (declined !== undefined) this.lastDetail = { ...this.lastDetail, reason: declined.reason };

            this.logger.info(`director: ${declined?.reason ?? 'the model wrote nothing the station could read as news'}`, {
                finish: result.finishReason,
                tokens: result.usage?.outputTokens,
                stories: request.stories?.length,
                persona: request.persona?.key,
                fault: declined?.fault,
            });
            return undefined;
        }

        return {
            script,
            label: 'News',
            // Told what plays next means allowed to name it, so assume it did: over-stamping costs a
            // bulletin the order drifted under, which is the safe direction.
            claimsNext: request.next !== undefined,
            // Stamped only when the answer really carries the time, which is the opposite posture and
            // deliberately so: a model that paraphrased "just after nine" into its own words made a
            // claim with a lifetime this station cannot check.
            ...(request.clock !== undefined && saysTime(script, request.clock)
                ? { claimsTime: { from: request.clock.validFrom, until: request.clock.validUntil } }
                : {}),
        };
    }
}
