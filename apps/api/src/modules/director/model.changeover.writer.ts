import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import {
    breakPrompt,
    maxWordsFor,
    permittedYears,
    readAnswer,
    shownWithoutRecent,
    writeDecline,
    writeTrim,
    type AnswerGuard,
    type BreakPromptShape,
    type PromptSettings,
} from './break.prompt.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import { timeClaimIn } from './clock.words.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak, patienceFor } from './break.writer.js';
import { CHANGEOVER_KIND } from './changeover.writer.js';
import { BUDGET_MS, MAX_OUTPUT_TOKENS, MODEL_WRITER, MODEL_WRITER_DEFAULT, MODEL_WRITER_KEYS } from './model.talk.break.writer.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/**
 * A model marking a change of programme, with the station's own words underneath it.
 *
 * Registered ahead of `ChangeoverWriter` rather than instead of it, for the reason every model binding
 * here is: no plugin, a plugin that is down or a model that rambles all fall through the registry to a
 * correct sentence. Its bounds are `ModelTalkBreakWriter`'s, imported so the two cannot drift, and it
 * shares `llm.breakWriter` with every other kind for `ModelWelcomeWriter`'s reason.
 *
 * What is its own is {@link CHANGEOVER_SHAPE}, and the records it is NOT given. The request is handed
 * over with no `previous` and no `next`, which is the floor's withholding done the same way: the record
 * behind belonged to the other show, and one ahead would be a promise on a piece about the shows.
 */

/**
 * What the model is told a changeover IS.
 *
 * No latitude. A change of programme is the one break where the listener wants the facts, which show
 * and who, and a presenter taking the whole of their room to get there is the previous show running on.
 */
export const CHANGEOVER_SHAPE: BreakPromptShape = {
    job: 'You mark the moment one show on this station ends and the next begins. It is read aloud exactly as you write it.',
    showsPrevious: false,
    rules: [
        'Say which show is starting and that you are presenting it. When somebody else presented the show before, thank them once, by ' +
            'the name you were given and no other. When it was you, do not thank anybody: you are carrying on.',
        'This is about the shows, not the records. Do not say what the last show played or what is coming up next.',
    ],
    opening: request => {
        const change = request.changeover;
        const outgoing = change?.outgoing?.djName?.trim();

        return [
            change?.outgoingShow === undefined ? 'A programme on this station has just ended.' : `The show "${change.outgoingShow}" has just ended.`,
            outgoing === undefined || outgoing.length === 0
                ? 'You presented it yourself, or nobody named presented it, so there is nobody to thank.'
                : `It was presented by ${outgoing}.`,
            change?.incomingShow === undefined
                ? 'Nothing is scheduled now, so the station carries on with its own music. Do not name a show starting.'
                : `The show starting now is "${change.incomingShow}", and you are presenting it.`,
            // The greeting words verbatim, for `WELCOME_SHAPE`'s reason: an invented phrasing has no
            // expiry the station can check, and this one is stamped as a claim and checked at hand-over.
            request.greeting === undefined
                ? undefined
                : `You may open with "${request.greeting.words}", in those words and no other way of saying it.`,
        ]
            .filter(Boolean)
            .join(' ');
    },
};

@Injectable()
export class ModelChangeoverWriter extends BreakWriter {
    readonly kind = CHANGEOVER_KIND;
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

    async write(asked: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastDetail = undefined;

        if (!settingIsOn(this.config, MODEL_WRITER_KEYS.enabled, MODEL_WRITER_DEFAULT)) return undefined;
        if (!this.llm.canGenerate()) {
            this.logger.debug(`director: no model to mark the change of programme with (${this.llm.explainGenerator()})`);
            return undefined;
        }

        // Withheld here rather than trusted to the shape: `showsPrevious: false` hides the record
        // behind, and nothing in a shape can hide the one ahead. See the note on the class.
        const { previous: _previous, next: _next, ...request } = asked;

        const model = this.config.get(MODEL_WRITER_KEYS.model, '').trim();
        // Held rather than passed inline, for `ModelTalkBreakWriter`'s reason: the number the model is
        // told has to be the number the guard refuses at.
        const settings: PromptSettings = {
            station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
            dj: request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, ''),
            cleanLanguage: speaksClean(advisoryPolicy(this.config)),
            ...(request.persona === undefined ? {} : { persona: request.persona }),
            ...(request.notebook === undefined ? {} : { notebook: request.notebook }),
            // Passed and declined by the shape, which sets no `allowsCues`, for `ModelWelcomeWriter`'s
            // reason: what a kind permits belongs on the shape, in one place.
            ...(request.reactions === undefined ? {} : { reactions: request.reactions }),
        };
        const messages = breakPrompt(request, settings, CHANGEOVER_SHAPE);

        const result = await this.llm.converse(
            {
                messages,
                ...(model.length === 0 ? {} : { model }),
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                reasoningEffort: 'low',
            },
            // No tools, for the talk break's reason: everything it needs is in the prompt, and a
            // changeover is asked for with the new show's first record already on its way.
            {
                tools: false,
                budgetMs: BUDGET_MS,
                maxWaitMs: patienceFor(request.airsAt),
                ...(request.priority === undefined ? {} : { priority: request.priority }),
            },
        );

        const guard: AnswerGuard = {
            maxWords: maxWordsFor(settings, CHANGEOVER_SHAPE),
            ...(request.persona === undefined ? {} : { persona: request.persona }),
            ...(request.recent === undefined ? {} : { recent: request.recent }),
            ...(request.dayPart === undefined ? {} : { dayPart: request.dayPart }),
            ...(request.moment === undefined ? {} : { moment: request.moment }),
            // No record was shown, so no year belongs in the answer but one the prompt itself carried.
            years: permittedYears([], request.moment, shownWithoutRecent(messages, request.recent)),
        };
        const script = readAnswer(result.text, guard);

        this.lastDetail = {
            model: result.model,
            ...(result.usage === undefined ? {} : { usage: result.usage as Record<string, number> }),
            ...(captureWrites(this.config) ? { prompt: messages, raw: result.text } : {}),
        };

        if (script === undefined) {
            const declined = writeDecline(result.text, guard);
            if (declined !== undefined) this.lastDetail = { ...this.lastDetail, reason: declined.reason };

            this.logger.info(`director: ${declined?.reason ?? 'the model wrote nothing the station could mark the change of programme with'}`, {
                finish: result.finishReason,
                tokens: result.usage?.totalTokens ?? result.usage?.outputTokens,
                persona: request.persona?.key,
                fault: declined?.fault,
            });
            return undefined;
        }

        const trimmed = writeTrim(result.text, guard);
        if (trimmed !== undefined) {
            this.lastDetail = { ...this.lastDetail, reason: trimmed.reason };
            this.logger.info(`director: ${trimmed.reason}`, { kept: trimmed.kept, dropped: trimmed.dropped, persona: request.persona?.key });
        }

        const claimsTime = timeClaimIn(script, request.greeting, request.dayPart);

        return {
            script,
            label: 'Changeover',
            // The floor's label, so a player shows the same thing whichever writer won.
            listenerLabel: request.changeover?.incomingShow ?? request.station ?? 'Changeover',
            // Stamped only when the answer really carries a time of day, as the welcome's is.
            ...(claimsTime === undefined ? {} : { claimsTime }),
        };
    }
}
