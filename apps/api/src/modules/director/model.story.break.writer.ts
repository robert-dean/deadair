import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { breakPrompt, maxWordsFor, readAnswer, writeDecline, writeTrim, type AnswerGuard, type PromptSettings } from './break.prompt.js';
import { resolveStoryWords } from './break.words.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import { timeClaimIn } from './clock.words.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak, patienceFor } from './break.writer.js';
import { BUDGET_MS, MAX_OUTPUT_TOKENS, MODEL_WRITER, MODEL_WRITER_DEFAULT, MODEL_WRITER_KEYS } from './model.talk.break.writer.js';
import { STORY_KIND, STORY_SHAPE } from './story.break.writer.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/**
 * A model TELLING one of the presenter's stories, with the story itself underneath it.
 *
 * Registered ahead of `StoryBreakWriter` for the reason every model binding here is, but what it
 * earns is unusual and worth stating: the floor beneath this one is not a template, it is the
 * operator's own prose. So a station with no model still tells the story — it just reads it the same
 * way every time, in the words it was written in.
 *
 * What the model adds is the TELLING. The same night sounds different when it is nine in the
 * morning, when the record coming up is one the character has an opinion about, and when a regular
 * listener has heard it twice already; all three of those are in the prompt and none of them can be
 * in a stored sentence. That is why this binding exists and why its bar for declining is the
 * ordinary one rather than the bulletin's.
 *
 * How it is bounded is `ModelTalkBreakWriter`'s, imported rather than restated so the two cannot
 * drift, and it shares `llm.breakWriter` with the other bindings because an operator turning the
 * model on is saying the station may use one to talk.
 *
 * It declines outright when there is no story, exactly as the floor does: a model asked to fill a
 * story slot with nothing in it would invent a past for the character, which is the one thing this
 * kind must never do unattended.
 */
@Injectable()
export class ModelStoryBreakWriter extends BreakWriter {
    readonly kind = STORY_KIND;
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

        // Before the model is asked anything, and for the bulletin's reason exactly: having no
        // substrate is a reason to say nothing rather than a reason to make something up. A model
        // asked for a story with none in the prompt writes the character a past nobody approved.
        if (request.story === undefined) return undefined;

        if (!settingIsOn(this.config, MODEL_WRITER_KEYS.enabled, MODEL_WRITER_DEFAULT)) return undefined;
        if (!this.llm.canGenerate()) {
            this.logger.debug(`director: no model to tell a story with (${this.llm.explainGenerator()})`);
            return undefined;
        }

        const model = this.config.get(MODEL_WRITER_KEYS.model, '').trim();
        // The station's own ceiling for this kind, read once and used twice: what the model is told
        // and what `readAnswer` cuts at have to be the same number, or a story is asked for at a
        // hundred and twenty words and refused at forty in silence.
        //
        // Both numbers now come off `maxWordsFor` rather than off this one, because `STORY_SHAPE`
        // offers a latitude: at the default ceiling the rung raises nothing, and on a station that
        // pulled `rotation.storyWords` down it does. Held in a `settings` object for that reason,
        // exactly as the talk break holds one.
        const settings: PromptSettings = {
            station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
            dj: request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, ''),
            maxWords: resolveStoryWords(this.config),
            cleanLanguage: speaksClean(advisoryPolicy(this.config)),
            ...(request.persona === undefined ? {} : { persona: request.persona }),
            ...(request.notebook === undefined ? {} : { notebook: request.notebook }),
            ...(request.reactions === undefined ? {} : { reactions: request.reactions }),
            story: request.story,
        };
        const maxWords = maxWordsFor(settings, STORY_SHAPE);
        const messages = breakPrompt(request, settings, STORY_SHAPE);

        const result = await this.llm.converse(
            {
                messages,
                ...(model.length === 0 ? {} : { model }),
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                reasoningEffort: 'low',
            },
            // No tools, for the talk break's reason: everything this break may contain is already in
            // the prompt, and a model that went looking would be researching the character's own
            // past — which is the enrichment pass's job, where an operator gets to see it first.
            {
                tools: false,
                budgetMs: BUDGET_MS,
                maxWaitMs: patienceFor(request.airsAt),
                ...(request.priority === undefined ? {} : { priority: request.priority }),
            },
        );

        // The dialect is REQUIRED here, unlike a bulletin's: a story is the character talking about
        // its own life, so a script that came back in flat announcer English is not a plainer version
        // of this break, it is a different break. The floor under it is the operator's own prose,
        // which cannot fail the check.
        const guard: AnswerGuard = {
            maxWords,
            ...(request.persona === undefined ? {} : { persona: request.persona }),
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
            const declined = writeDecline(result.text, guard);
            if (declined !== undefined) this.lastDetail = { ...this.lastDetail, reason: declined.reason };

            this.logger.info(`director: ${declined?.reason ?? 'the model wrote nothing the station could tell as a story'}`, {
                finish: result.finishReason,
                tokens: result.usage?.outputTokens,
                story: request.story.title,
                persona: request.persona?.key,
                fault: declined?.fault,
            });
            return undefined;
        }

        const trimmed = writeTrim(result.text, guard);
        if (trimmed !== undefined) {
            this.lastDetail = { ...this.lastDetail, reason: trimmed.reason };
            this.logger.info(`director: ${trimmed.reason}`, { kept: trimmed.kept, dropped: trimmed.dropped, story: request.story.title });
        }

        const claimsTime = timeClaimIn(script, request.clock, request.dayPart);

        return {
            script,
            // The story's own handle, as the floor uses. Never the first words of the script: a
            // running order reading "You saw three lights over the desert…" tells an operator what
            // was said and not which story it was.
            label: request.story.title,
            // Told what plays next means allowed to name it, so assume it did — over-stamping costs
            // a break the order drifted under, which is the safe direction. Unlike the floor, which
            // says nothing about the record at all.
            claimsNext: request.next !== undefined,
            ...(claimsTime === undefined ? {} : { claimsTime }),
        };
    }
}
