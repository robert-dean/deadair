import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { AlmanacEntry } from '@deadair/plugin-sdk';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { ALMANAC_KIND } from '#modules/almanac/almanac.kind.js';
import { SaidLog } from './almanac.source.js';
import {
    breakPrompt,
    permittedYears,
    readAnswer,
    shownWithoutRecent,
    writeDecline,
    writeTrim,
    yearsIn,
    type AnswerGuard,
    type BreakPromptShape,
} from './break.prompt.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import { timeClaimIn } from './clock.words.js';
import { BreakWriter, patienceFor, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import { BUDGET_MS, MAX_OUTPUT_TOKENS, MODEL_WRITER, MODEL_WRITER_DEFAULT, MODEL_WRITER_KEYS } from './model.talk.break.writer.js';

/**
 * A model reading the date out, with the station's own framing underneath it.
 *
 * Registered ahead of `AlmanacBreakWriter` rather than instead of it, for the reason every model
 * binding here is: a plugin that is down, a host answering at two tokens a second, an answer that
 * invented a year — all of it falls through the registry to a frame around the source's own
 * sentence. **A slow model costs a better-said anniversary, never a silent slot.**
 *
 * How it is bounded is `ModelTalkBreakWriter`'s, imported rather than restated so the two cannot
 * drift, and it shares `llm.breakWriter` with the other bindings for the same reason they share it.
 *
 * ## What it earns, and the one thing it must not do
 *
 * The floor can say "Born on this day in 1966: Nuno Bettencourt, Portuguese guitarist." and nothing
 * else, because that is all the entry says. A presenter says "Nuno Bettencourt turns sixty today" —
 * which is arithmetic on two numbers the station HAS — or picks the one of six entries that suits a
 * music station and hands back to the record. That is the whole of what the model is for here.
 *
 * What it must not do is the thing it is best at: filling in what it knows. The station was given a
 * sentence and a year, and everything else a model can remember about that person, that record or
 * that year is unsourced — which on this kind is indistinguishable from the sourced part, because
 * both are delivered in the voice the station uses for things it looked up.
 *
 * ## The risk here is `ModelWeatherBreakWriter`'s, with the edge on a different number
 *
 * A plausible temperature is easy to write, and so is a plausible year: a model asked about a record
 * released in 1977 will happily say 1976, and nothing about the sentence gives it away. The guard for
 * it already exists and is not written here — `AnswerGuard.years`, filled by `permittedYears` from
 * the prompt this writer just built, so a script naming a year the station was never shown is refused
 * as `invented-year` in both `readAnswer` and `writeDecline`, reaches `script_history.reason` and can
 * be counted. That is where `inventedFigure` ended up for the same reason: a second copy of one
 * question is two answers to it.
 *
 * It declines outright when there is nothing to read out, exactly as the floor does. Asking a model
 * to fill this slot with no entries in it is asking for invented history, and it would get it.
 */

/**
 * How long a break about the date may run, in words.
 *
 * Seventy, a shade above the weather's sixty and a long way under a bulletin's three hundred. One
 * anniversary, said the way a presenter says one, plus the hand back to the music — a model that has
 * gone past this is telling the story rather than mentioning it, and the story is the part nothing
 * can check.
 *
 * A ceiling permits rather than asks, so this is a backstop and not the shape: what keeps it short
 * is the prompt asking for one entry, and `readAnswer` cutting at the last whole sentence that fits.
 */
export const ALMANAC_MAX_WORDS = 70;

/**
 * What the model is told a break about the date IS.
 *
 * `showsPrevious: false` for `WEATHER_SHAPE`'s reason, and `showsFacts: false` for a sharper version
 * of `NEWS_SHAPE`'s: a note about the record coming up is a second sourced claim in a break whose
 * whole value is that every claim in it came from one place, and the two would be indistinguishable
 * on air. `showsNotebook: false` with them — the character's accumulated sayings are not trying to
 * be true about 1966.
 */
export const ALMANAC_SHAPE: BreakPromptShape = {
    job: 'You mention one thing that happened on this date in another year. It is read aloud exactly as you write it.',
    showsPrevious: false,
    showsFacts: false,
    showsNotebook: false,
    // The entry IS this break, which is the stricter of the two terms and the one the rules below
    // are written for. See `BreakPromptShape.almanac`.
    almanac: 'read',
    opening: () =>
        'Pick ONE of the entries below — the one a music station would want — and say it in a sentence or two, then hand back to the music in a ' +
        'line. Say the year it happened. You are passing on something somebody looked up, not telling a story about it.',
    // Three rules this kind owes and a talk break does not. Each is a shape a model reaches for when
    // it is handed a name and a year, and each produces a sentence nothing can check against a
    // source — in the voice the station uses for the things it looked up.
    rules: [
        'Everything you say about the entry has to be in the entry. Do not add what somebody is famous for, which band they were in, what else ' +
            'came out that year, or how it was received: the station was not told any of that, and what you remember about it sounds exactly ' +
            'like what it was given.',
        'Use the year as it is written. Do not round it to a decade, do not work out an era from it, and do not name a year that is not there.',
        'Do not tell anyone what it means. No "and the rest is history", no "they do not make them like that any more" — say what happened and ' +
            'hand back.',
    ],
};

@Injectable()
export class ModelAlmanacBreakWriter extends BreakWriter {
    readonly kind = ALMANAC_KIND;
    readonly name = MODEL_WRITER;

    private lastDetail?: WriteDetail;

    constructor(
        private readonly llm: LlmService,
        private readonly said: SaidLog,
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

        // Before the model is asked anything. Nothing to read out is the floor's branch as well, and
        // both of them decline: this is a break where having no substrate is a reason to say nothing
        // rather than a reason to say something general.
        const almanac = request.almanac;
        if (almanac === undefined || almanac.entries.length === 0) return undefined;

        if (!settingIsOn(this.config, MODEL_WRITER_KEYS.enabled, MODEL_WRITER_DEFAULT)) return undefined;
        if (!this.llm.canGenerate()) {
            this.logger.debug(`director: no model to read the date out with (${this.llm.explainGenerator()})`);
            return undefined;
        }

        const model = this.config.get(MODEL_WRITER_KEYS.model, '').trim();
        const messages = breakPrompt(
            request,
            {
                station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
                dj: request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, ''),
                maxWords: ALMANAC_MAX_WORDS,
                cleanLanguage: speaksClean(advisoryPolicy(this.config)),
                ...(request.persona === undefined ? {} : { persona: request.persona }),
            },
            ALMANAC_SHAPE,
        );

        const result = await this.llm.converse(
            {
                messages,
                ...(model.length === 0 ? {} : { model }),
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                reasoningEffort: 'low',
            },
            // No tools, and here that includes `get_this_day`. Everything this break may contain is
            // already in the prompt, fetched once by `AlmanacSource` so the floor and this see the
            // same entries — and a model that could fetch its own could read out an anniversary the
            // station had already spent, which is the one thing `SaidLog` exists to prevent.
            {
                tools: false,
                budgetMs: BUDGET_MS,
                // Derived from when this break is due rather than fixed: see `patienceFor`.
                maxWaitMs: patienceFor(request.airsAt),
                // See `BreakWriteRequest.priority`: absent for a break that is going on air.
                ...(request.priority === undefined ? {} : { priority: request.priority }),
            },
        );

        // `dialect: 'optional'` for `ModelWeatherBreakWriter`'s measured reason: a kind that earns
        // its keep by being correct must not be refused for not being sufficiently in voice. The
        // three prohibitions in `characterFault` stay.
        const guard: AnswerGuard = {
            maxWords: ALMANAC_MAX_WORDS,
            ...(request.persona === undefined ? {} : { persona: request.persona, dialect: 'optional' as const }),
            ...(request.recent === undefined ? {} : { recent: request.recent }),
            ...(request.dayPart === undefined ? {} : { dayPart: request.dayPart }),
            ...(request.moment === undefined ? {} : { moment: request.moment }),
            // The check this kind lives or dies by, and it is the guard's own `invented-year` rather
            // than anything written here: a historical claim's checkable part IS its year, the
            // entries are in the prompt, and `permittedYears` reads every year it was SHOWN. A
            // bespoke check beside it would be two answers to one question — the mistake
            // `inventedFigure` made until it moved onto this guard — and it would miss what this one
            // catches, since `yearsIn` reads "nineteen sixty-six" as well as 1966.
            years: permittedYears([request.next], request.moment, shownWithoutRecent(messages, request.recent)),
        };
        const script = readAnswer(result.text, guard);

        this.lastDetail = {
            // What the host RESOLVED, not what the setting said. See `LlmConversation.model`.
            model: result.model,
            ...(result.usage === undefined ? {} : { usage: result.usage as Record<string, number> }),
            ...(captureWrites(this.config) ? { prompt: messages, raw: result.text } : {}),
        };

        if (script === undefined) {
            // Why it was refused, on the row as well as in the log. See `writeDecline` and
            // `WriteDetail.reason`.
            const declined = writeDecline(result.text, guard);
            if (declined !== undefined) this.lastDetail = { ...this.lastDetail, reason: declined.reason };

            this.logger.info(`director: ${declined?.reason ?? 'the model wrote nothing the station could read as a piece of history'}`, {
                finish: result.finishReason,
                tokens: result.usage?.totalTokens ?? result.usage?.outputTokens,
                date: almanac.day.date,
                persona: request.persona?.key,
                fault: declined?.fault,
            });
            return undefined;
        }

        // A break cut back to its last whole sentence. See `writeTrim`.
        const trimmed = writeTrim(result.text, guard);
        if (trimmed !== undefined) {
            this.lastDetail = { ...this.lastDetail, reason: trimmed.reason };
            this.logger.info(`director: ${trimmed.reason}`, { kept: trimmed.kept, dropped: trimmed.dropped, date: almanac.day.date });
        }

        // Spent here, where the entry has actually reached a script, exactly as the floor spends it.
        // Which entry the model used is read back out of the script rather than assumed — see
        // {@link entriesUsed}.
        for (const entry of entriesUsed(script, almanac.entries)) this.said.keep(entry, almanac.day.date);

        const claimsTime = timeClaimIn(script, request.clock, request.dayPart);

        return {
            script,
            // Named for the day it is about, as the floor beneath it is. See `AlmanacBreakWriter`.
            label: `This day: ${almanac.day.date}`,
            listenerLabel: 'This day in history',
            // Told what plays next means allowed to name it, so assume it did: over-stamping costs a
            // break the order drifted under, which is the safe direction.
            claimsNext: request.next !== undefined,
            // The clock's window where the script really named the time, and the station's own day
            // otherwise. Never neither, which is where this differs from every other binding: a
            // break of this kind says "on this day" by construction, and the one thing that makes
            // that false is the date turning over underneath it.
            //
            // The clock's window WINS where there is one, and it is always the narrower of the two:
            // a rough time is minutes wide, it is stamped as absolute instants, and every one of
            // those instants is inside the day it was read in. So the narrower claim implies the
            // wider and nothing is lost by taking it.
            claimsTime: claimsTime ?? { from: almanac.day.from, until: almanac.day.until },
        };
    }
}

/**
 * The entries a script actually used, judged by the years it named.
 *
 * The floor knows which entry it framed; this does not, and guessing would be the expensive kind of
 * wrong in both directions — marking all six spends a day's material on one break, and marking the
 * first spends an entry the model may not have mentioned, which is the same anniversary read twice
 * this afternoon.
 *
 * So it reads the script back, through the same `yearsIn` the guard uses — which reads "nineteen
 * sixty-six" as well as 1966. The `invented-year` check has already refused anything naming a year
 * the station was not shown, so every year left in the script was given to it.
 *
 * A script that named NO year spends nothing, and that is the honest answer rather than a gap: an
 * observance carries no year to name, and a model that mentioned one without saying when is a model
 * whose choice cannot be recovered. The cost is that entry coming round again later today, which is
 * the same inaccuracy `ReadLog` buys from the other side.
 */
export function entriesUsed(script: string, entries: readonly AlmanacEntry[]): AlmanacEntry[] {
    const named = new Set(yearsIn(script));
    if (named.size === 0) return [];

    return entries.filter(entry => entry.year !== undefined && named.has(Math.abs(Math.trunc(entry.year))));
}
