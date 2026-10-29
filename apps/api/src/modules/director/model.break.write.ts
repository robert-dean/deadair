import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { LlmMessage, SpeechDelivery } from '@deadair/plugin-sdk';
import type { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { modelList } from '#modules/llm/model.list.js';
import { homeGuard, languageGuard, speakerGuard, stationGuard } from './prompt.settings.js';
import { breakPrompt, maxWordsFor, type BreakPromptShape, type PromptSettings } from './break.prompt.js';
import { liftDelivery, readAnswer, writeDecline, writeTrim, type AnswerGuard } from './break.answer.guard.js';
import { patienceFor, type BreakWriteRequest, type WriteDetail } from './break.writer.js';
import { breakGeneration, BUDGET_MS, MODEL_WRITER_DEFAULT, MODEL_WRITER_KEYS } from './model.talk.break.writer.js';

/**
 * The part of a model-written break that is the same whatever kind it is.
 *
 * Eight writers ask the model for a break, and each of them ran one skeleton for it: the switch, the
 * model list, one `converse` call with the same bounds, the guard's common half, `readAnswer`, the
 * detail the registry records, the decline and the trim. Copied eight times it drifted, quietly: the
 * dedication stopped recording its trims, and only the talk break ever recorded the fault the
 * registry decides a second ask on. So the skeleton lives here, and a writer keeps what is genuinely
 * its own: what it refuses to start without, its settings, its shape, the guard's extras, and what it
 * makes of the script.
 *
 * Its bounds are `ModelTalkBreakWriter`'s, imported rather than restated, for the reason each writer
 * used to import them: one budget to tune, one wait to tune, one token ceiling to raise.
 */

/** What a writer hands over. */
export interface ModelWriteAsk {
    request: BreakWriteRequest;
    /** What the prompt is built from, and what the word ceiling is read off: the two must be one object. */
    settings: PromptSettings;
    shape: BreakPromptShape;
    /**
     * The guard's own half for this kind: cues, years, the reading, the names. A function of the
     * built prompt, because `permittedYears` reads every year the prompt SHOWED.
     */
    guard: (messages: LlmMessage[]) => Partial<AnswerGuard>;
    /**
     * `'optional'` for a kind that earns its keep by being correct rather than in voice: the news,
     * the weather and the date. See `CharacterContext.dialect`.
     */
    dialect?: 'optional';
    /**
     * The readings this break was OFFERED, lifted off the front of the answer before anything judges
     * it. See `liftDelivery`. Absent for a kind whose shape offers none.
     */
    deliveries?: readonly SpeechDelivery[];
    /**
     * Whether a decline records its `fault` and the refused words, which is what lets the registry
     * ask once more. The talk break alone, because that is where the second ask was measured and
     * built; see `break.retry.ts`. Turning it on for another kind changes what airs, so it is a
     * decision for that kind and not a default here.
     */
    retryable?: boolean;
    /** What the log says this was for: "no model to {@link noModel}", and the decline without a reason. */
    purpose: { noModel: string; nothing: string };
    /** This kind's own fields on the decline and trim log lines: the story, the date, the place. */
    context?: Record<string, unknown>;
}

/** What came back: always the detail, and the script with what judged it when one was written. */
export interface ModelWriteOutcome {
    /** What `detailOfLastWrite` answers. Absent when the model was never asked. */
    detail?: WriteDetail;
    written?: {
        script: string;
        /** The guard the script passed, for the read-backs that judge against it (`mentionsStory`). */
        guard: AnswerGuard;
        messages: LlmMessage[];
        /** Only when the model chose one, and only one it was offered. */
        delivery?: SpeechDelivery;
    };
}

/** The writer's three collaborators, which are all this needs of it. */
export interface ModelWriteHost {
    llm: LlmService;
    config: AppConfig;
    logger: Logger;
}

export async function writeWithModel(host: ModelWriteHost, ask: ModelWriteAsk): Promise<ModelWriteOutcome> {
    const { llm, config, logger } = host;
    const { request, settings, shape } = ask;

    // Both cheap, both silent, and both an ordinary state rather than a fault. Read per break rather
    // than held, so an operator turning the model on hears it on the next break.
    if (!settingIsOn(config, MODEL_WRITER_KEYS.enabled, MODEL_WRITER_DEFAULT)) return {};
    if (!llm.canGenerate()) {
        // At debug: a station with no model configured would otherwise say so every fourth record,
        // and `LlmService` already explains it once where it matters.
        logger.debug(`director: no model to ${ask.purpose.noModel} (${llm.explainGenerator()})`);
        return {};
    }

    // In the operator's order; the first is what the request names, and the rest are who to ask
    // when it fails before answering. See `modelList`.
    const models = modelList(config, MODEL_WRITER_KEYS.model);
    const model = models[0] ?? '';
    const messages = breakPrompt(request, settings, shape);

    const result = await llm.converse(
        {
            messages,
            ...(model.length === 0 ? {} : { model }),
            // How hard to think and how much room to do it in are the operator's, because they depend
            // on the model: see `breakGeneration`.
            ...breakGeneration(config),
        },
        {
            // No tools, for every kind: everything a break may contain is already in the prompt,
            // fetched once so the floor and the model see the same substrate, and a tool round trip
            // would buy something the station never fetched at the cost of another generation.
            tools: false,
            models,
            budgetMs: BUDGET_MS,
            // Derived from when this break is due rather than fixed: see `patienceFor`.
            maxWaitMs: patienceFor(request.airsAt),
            // Absent for every break that is going on air, which is the gate's own default. Present
            // only for a rehearsal, which must not outrank one.
            ...(request.priority === undefined ? {} : { priority: request.priority }),
        },
    );

    const guard: AnswerGuard = {
        // The prompt's own ceiling, off the same settings: what the model is told and what it is
        // refused at have to come from one `maxWordsFor` call. See `maxWordsFor`.
        maxWords: maxWordsFor(settings, shape),
        ...(request.persona === undefined ? {} : { persona: request.persona, ...(ask.dialect === undefined ? {} : { dialect: ask.dialect }) }),
        // The list the prompt was built from, so a signature is refused only where the prompt named
        // it as spent. See `AnswerGuard.recent`.
        ...(request.recent === undefined ? {} : { recent: request.recent }),
        // And the presenter's own, which the prompt read beside it. See `AnswerGuard.own`.
        ...(request.own === undefined ? {} : { own: request.own }),
        // The same daypart the prompt stated, so a script is refused for contradicting it only where
        // it was actually told. See `AnswerGuard.dayPart`.
        ...(request.dayPart === undefined ? {} : { dayPart: request.dayPart }),
        // Beside the daypart and off the same instant: the words are what the prompt stated and this
        // is what the clock says, which is the half of the question a stretch cannot answer.
        ...(request.moment === undefined ? {} : { moment: request.moment }),
        ...languageGuard(config),
        ...homeGuard(config),
        ...stationGuard(config),
        ...speakerGuard(config, request),
        ...ask.guard(messages),
    };

    // A reading the model chose, lifted off the front before anything judges the answer. From here
    // on `answer` is what every check reads, so the decline, the trim and the script agree about
    // which words they were looking at. `raw` below keeps the answer as it came, mark and all.
    const { text: answer, delivery } =
        ask.deliveries === undefined ? { text: result.text, delivery: undefined } : liftDelivery(result.text, ask.deliveries);
    const script = readAnswer(answer, guard);

    // Recorded whichever way it went, and BEFORE the answer is judged, so a model that produced forty
    // seconds of nothing leaves behind the same numbers as one that worked.
    let detail: WriteDetail = {
        // What the host RESOLVED, not what the setting said. A station that never pinned a model left
        // this empty, so every row read "the plugin default" and the record could not answer which
        // model wrote anything. See `LlmConversation.model`.
        model: result.model,
        ...(result.usage === undefined ? {} : { usage: result.usage as Record<string, number> }),
        ...(captureWrites(config) ? { prompt: messages, raw: result.text } : {}),
    };

    if (script === undefined) {
        // Not a throw: a model that rambled or answered with nothing is the ordinary case this whole
        // arrangement exists to absorb. The registry turns it into the floor's sentence and keeps the
        // reason, which is put on the detail so it reaches `script_history.reason`.
        const words = answer.trim().split(/\s+/).filter(Boolean).length;
        const declined = writeDecline(answer, guard);
        if (declined !== undefined) {
            detail = { ...detail, reason: declined.reason, ...(ask.retryable === true ? { fault: declined.fault } : {}) };
        }
        // What was refused, beside why. See `WriteDetail.refused`.
        const refused = result.text.trim();
        if (ask.retryable === true && refused.length > 0) detail = { ...detail, refused };

        logger.info(
            // The one case the answer alone cannot explain: an empty answer that stopped at the token
            // ceiling is a model that thought until it ran out, not one with nothing to say.
            words === 0 && result.finishReason === 'length'
                ? 'director: the model used its whole answer thinking and never spoke; raise the token ceiling'
                : `director: ${declined?.reason ?? `the model wrote nothing the station could ${ask.purpose.nothing}`}`,
            {
                finish: result.finishReason,
                words,
                tokens: result.usage?.totalTokens ?? result.usage?.outputTokens,
                ...ask.context,
                persona: request.persona?.key,
                fault: declined?.fault,
            },
        );
        return { detail };
    }

    // A break the station CUT rather than refused. Re-derived through `writeTrim` rather than measured
    // here, so the row and the log carry a number nobody invented, and put on the detail so it reaches
    // `script_history.reason` on a row whose outcome is `written`: a cut nothing records reads
    // afterwards as a model that writes to length.
    const trimmed = writeTrim(answer, guard);
    if (trimmed !== undefined) {
        detail = { ...detail, reason: trimmed.reason };
        logger.info(`director: ${trimmed.reason}`, { kept: trimmed.kept, dropped: trimmed.dropped, ...ask.context, persona: request.persona?.key });
    }

    return { detail, written: { script, guard, messages, ...(delivery === undefined ? {} : { delivery }) } };
}
