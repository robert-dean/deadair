import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { breakPrompt, readAnswer, writeDecline, writeTrim, type AnswerGuard, type BreakPromptShape } from './break.prompt.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import { timeClaimIn } from './clock.words.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak, patienceFor } from './break.writer.js';
import { BUDGET_MS, MAX_OUTPUT_TOKENS, MODEL_WRITER, MODEL_WRITER_DEFAULT, MODEL_WRITER_KEYS } from './model.talk.break.writer.js';
import { NEWS_KIND } from './news.break.writer.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

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
 * Raised from 120 when the stories arrived, and from 170 after that. 120 was three stories'
 * HEADLINES plus the words around them, and it was the right size for exactly as long as a headline
 * was all a writer had; a bulletin now has the article under each one and is asked for a sentence of
 * what happened, which is three sentences this did not previously have room for. 170 turned out to
 * still be inside that ask rather than outside it: the first bulletin this station ever captured came
 * back at 203 words, correctly reported, and lost the slot for being eleven words a story too
 * generous.
 *
 * Raising a ceiling is otherwise the wrong move here and the persona work argues it at length — a
 * ceiling permits, it does not ask, and 2 of 137 captured breaks ever reached one. The difference is
 * that this ceiling was measurably in the way of something the prompt now explicitly asks for, which
 * is the one condition under which raising one is not just permitting slop. So it is set clear of the
 * ask rather than just above the last answer, because a bulletin refused for one story running long
 * is the same failure again a fortnight later. What bounds a bulletin's length is the prompt asking
 * for a sentence a story, and this is only the backstop under it.
 *
 * Past it, `readAnswer` cuts at the last whole sentence that fits, which for a bulletin means the
 * last complete STORY rather than a hard stop in the middle of one — and a bulletin that reported two
 * stories and did not hand back is worth more than the floor's, which reports headlines only. What
 * still loses the slot is a single sentence longer than this, which cannot be cut anywhere.
 */
export const NEWS_MAX_WORDS = 300;

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
    // The record coming up is still shown, and its NOTES are not. A bulletin needs the title and the
    // artist to hand back to the music in a line, and a note there is pure risk in the one kind of
    // break where being wrong is worst. Both of the false discography claims this station has put on
    // air arrived exactly that way; see `BreakPromptShape.showsFacts`.
    showsFacts: false,
    // The same call one source further out, and for the same reason: a model reporting the news and
    // handed a list of the character's own past sayings will read one out, and it is worse than a
    // discography note because nothing about it is even trying to be true today. The sheet still
    // goes, so this still sounds like the station's presenter; what is withheld is the accumulation.
    showsNotebook: false,
    opening: request =>
        // What it is ABOUT, when a band asked for one. Said in the opening rather than as a rule
        // because it changes what the bulletin IS rather than constraining how it is written — and
        // it is only a description: the stories below have already been cut to the category, so a
        // model that ignored this sentence would still be reading the right ones.
        (request.subject === undefined ? 'This is the news.' : `This is the ${request.subject.label} news, so say so as you introduce it.`) +
        ' Introduce it in a sentence, report the stories below in the order they are given, and then hand back to the music. ' +
        'Each story gets its headline and a sentence of what happened, from the text you are given and nowhere else. ' +
        'You are reporting, not commenting: no jokes about the stories, no opinions, and nothing about how they make anyone feel.',
    // Two rules a bulletin owes and a talk break does not, both of them measured failures rather
    // than tidiness.
    //
    // The first is padding, and it comes from a story whose text is thin: told to give each story a
    // sentence of what happened and handed two lines about a soap box derby, a model reaches for
    // something it knows instead. "Gravity is an inescapable force. It's why Earth has its
    // atmosphere and orbits the sun" went out as news, twice, along with "Gravity can bring us to
    // our knees" and "gravity powers the cars and also keeps Earth alive". Every one of those is
    // true, none of them is news, and all three are the model filling a hole rather than leaving it.
    //
    // The second is where a bulletin STOPS. One captured bulletin reported its three stories
    // correctly and then wrote twelve more sentences of atmosphere — "the needle slides into
    // rhythm", "feel the echo of a pattern within the hiss" — at 214 words against a ceiling of 300.
    // The ceiling is a backstop and was never going to catch it. Nothing had said the bulletin ends.
    rules: [
        'Never explain a word from a story. If a story mentions gravity, a court or a currency, your listener knows what those are — ' +
            'reaching for a definition is filling a gap the story left, and a gap in the news is better left open.',
        'Stop when the stories stop. The last thing you say is the handover to the record coming up, in one line, and then you are done. ' +
            'No sign-off about the night, no scene-setting, nothing about the sound of the station.',
    ],
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

        if (!settingIsOn(this.config, MODEL_WRITER_KEYS.enabled, MODEL_WRITER_DEFAULT)) return undefined;
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
                cleanLanguage: speaksClean(advisoryPolicy(this.config)),
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
            {
                tools: false,
                budgetMs: BUDGET_MS,
                // Derived from when this break is due rather than fixed: see `patienceFor`.
                maxWaitMs: patienceFor(request.airsAt),
                // See `BreakWriteRequest.priority`: absent for a bulletin that is going on air.
                ...(request.priority === undefined ? {} : { priority: request.priority }),
            },
        );

        // The prompt tells the model who it is (`persona` above, into `breakPrompt`) — a bulletin is
        // free to sound like this station's presenter — and the guard holds it to three quarters of
        // that. **The character is a LEAN here and not a requirement**, which is `dialect:
        // 'optional'` and is the whole of what makes this kind different.
        //
        // The measurement it rests on: every News break under `wisecrack` this station wrote fell
        // through to the deterministic floor as `out-of-character`, because "no jokes, no opinions"
        // in `NEWS_SHAPE.opening` and "sound like nobody else" in the check are not simultaneously
        // satisfiable. A talk break earns its persona by being about nothing but voice; a bulletin
        // earns its keep by being correct.
        //
        // What this kind used to do about that was omit `persona` from the guard ENTIRELY, and that
        // was broader than the measurement. `characterFault` is four checks and only ONE of them
        // asks for anything: the other three forbid echoing a sample line, using wording the sheet
        // bans, and reusing a signature the station just spent, none of which is in tension with
        // reporting neutrally. Dropping all four re-permitted the exact failure `persona.sheet.ts`
        // was built for and names at the top — `I said what I said` closing a talk break, a welcome
        // AND a news bulletin. So the prohibitions are back and only the dialect is excused, which
        // cannot cost a bulletin: all three are things a script must not DO, and the floor underneath
        // is the operator's own news phrasings, which chain no persona templates and cannot trip them.
        const guard: AnswerGuard = {
            maxWords: NEWS_MAX_WORDS,
            ...(request.persona === undefined ? {} : { persona: request.persona, dialect: 'optional' as const }),
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
            model: model.length === 0 ? 'the plugin default' : model,
            ...(result.usage === undefined ? {} : { usage: result.usage as Record<string, number> }),
            ...(captureWrites(this.config) ? { prompt: messages, raw: result.text } : {}),
        };

        if (script === undefined) {
            // Why it was refused, on the row as well as in the log. See `writeDecline` and
            // `WriteDetail.reason`.
            const declined = writeDecline(result.text, guard);
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

        // A bulletin cut back to its last whole STORY, which is what a sentence boundary is here. See
        // `writeTrim`, and `NEWS_MAX_WORDS` for why a cut bulletin is worth more than the floor's.
        const trimmed = writeTrim(result.text, guard);
        if (trimmed !== undefined) {
            this.lastDetail = { ...this.lastDetail, reason: trimmed.reason };
            this.logger.info(`director: ${trimmed.reason}`, { kept: trimmed.kept, dropped: trimmed.dropped, stories: request.stories?.length });
        }

        const claimsTime = timeClaimIn(script, request.clock, request.dayPart);

        return {
            script,
            // Named for what it covers, as the floor beneath it is. See `NewsBreakWriter`.
            label: request.subject === undefined ? 'News' : `${request.subject.label} news`,
            // Told what plays next means allowed to name it, so assume it did: over-stamping costs a
            // bulletin the order drifted under, which is the safe direction.
            claimsNext: request.next !== undefined,
            // Stamped only when the answer really carries the time, which is the opposite posture and
            // deliberately so: a model that paraphrased "just after nine" into its own words made a
            // claim with a lifetime this station cannot check. Every offer this break had rather
            // than the clock alone, since a bulletin that opened "this morning" has dated itself
            // just as firmly as one that named the hour. See `timeClaimIn`.
            ...(claimsTime === undefined ? {} : { claimsTime }),
        };
    }
}
