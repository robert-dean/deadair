import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import type { SpokenWeather } from '#modules/weather/weather.words.js';
import { WEATHER_KIND } from '#modules/weather/weather.kind.js';
import { breakPrompt, readAnswer, writeDecline, writeTrim, type AnswerGuard, type BreakPromptShape } from './break.prompt.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import { timeClaimIn } from './clock.words.js';
import { BreakWriter, patienceFor, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import { BUDGET_MS, MAX_OUTPUT_TOKENS, MODEL_WRITER, MODEL_WRITER_DEFAULT, MODEL_WRITER_KEYS } from './model.talk.break.writer.js';

/**
 * A model giving the weather, with the station's own report underneath it.
 *
 * Registered ahead of `WeatherBreakWriter` rather than instead of it, for the reason every model
 * binding here is: a plugin that is down, a host answering at two tokens a second, an answer that
 * invented a figure — all of it falls through the registry to a report that states what the service
 * measured. **A slow model costs a better-said forecast, never a silent slot.**
 *
 * How it is bounded is `ModelTalkBreakWriter`'s, imported rather than restated so the two cannot
 * drift, and it shares `llm.breakWriter` with the other bindings for the same reason they share it:
 * an operator turning the model on is saying the station may use one to talk.
 *
 * ## What is its own is the risk, and it is `ModelNewsBreakWriter`'s risk with a sharper edge
 *
 * A bulletin states things a listener cannot check. So does this, and the failure mode is worse in
 * one specific way: **a plausible temperature is far easier to write than a plausible news story.**
 * A model knows roughly what August in Atlanta is like and will fill in a figure it was not given
 * without any sense of having invented anything, where the same model inventing a headline at least
 * has to make something up. The guard against that lives in the prompt (see the weather rules in
 * `break.prompt.ts`) and in {@link inventedFigure} below, which refuses a script naming a number
 * nobody measured.
 *
 * The model earns its place by saying the figures as a person would — "seventeen and wet out there,
 * getting up to twenty-four later" — rather than reading a table. Everything else is the floor's job
 * and the floor does it correctly.
 *
 * It declines outright when there is nothing to report, exactly as the floor does. Asking a model to
 * fill a weather slot with no reading in it is asking for an invented forecast, and it would get one.
 */

/**
 * How long a weather break may run, in words.
 *
 * Far shorter than a bulletin's 300, and the difference is what the two are made of: a bulletin is
 * three stories that each need a sentence, and this is one place and at most two horizons. Sixty
 * words is a generous version of what a station actually says between two records, and anything past
 * it is a model that has started describing the sky.
 *
 * A ceiling permits rather than asks, so this is a backstop and not the shape: what keeps a weather
 * break short is the prompt asking for the conditions and today, and `readAnswer` cutting at the last
 * whole sentence that fits.
 */
export const WEATHER_MAX_WORDS = 60;

/**
 * What the model is told a weather break IS.
 *
 * `showsPrevious: false` for `NEWS_SHAPE`'s reason: a model shown the record that has just finished
 * will open the weather by back-announcing it, which is a presenter who has not decided what this
 * break is. The record COMING UP is still shown, because handing back to the music is the one piece
 * of continuity a break like this owes the hour.
 */
export const WEATHER_SHAPE: BreakPromptShape = {
    job: 'You give the weather in one or two sentences. It is read aloud exactly as you write it.',
    showsPrevious: false,
    // `NEWS_SHAPE`'s two withholdings, for its two reasons. A note about the record coming up is pure
    // risk in a break whose whole value is being correct, and the character's accumulated sayings are
    // worse: nothing about one is even trying to be true today. The sheet still goes, so this still
    // sounds like the station's presenter.
    showsFacts: false,
    showsNotebook: false,
    opening: request =>
        (request.subject === undefined ? 'This is the weather.' : `This is the weather in ${request.subject.label}, so say so.`) +
        ' Say what it is like now, and today if you were given it, then hand back to the music in a line. ' +
        'You are reporting a measurement, not describing a scene.',
    // Two rules a weather break owes and a talk break does not. Both are the shapes a model reaches
    // for when it has three numbers and a sentence to fill, and both are things nothing can check.
    rules: [
        'Never compare it to anything. Not yesterday, not last week, not what it should be at this time of year — the station was not told ' +
            'any of that, and a comparison it invents sounds exactly like one it measured.',
        'Do not tell anyone what to do about it. No coats, no umbrellas, no advice about the drive. Say what it is like and stop.',
    ],
};

@Injectable()
export class ModelWeatherBreakWriter extends BreakWriter {
    readonly kind = WEATHER_KIND;
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
        // both of them decline: this is the one break where having no substrate is a reason to say
        // nothing rather than a reason to say something general.
        const weather = request.weather;
        if (weather === undefined) return undefined;

        if (!settingIsOn(this.config, MODEL_WRITER_KEYS.enabled, MODEL_WRITER_DEFAULT)) return undefined;
        if (!this.llm.canGenerate()) {
            this.logger.debug(`director: no model to give the weather with (${this.llm.explainGenerator()})`);
            return undefined;
        }

        const model = this.config.get(MODEL_WRITER_KEYS.model, '').trim();
        const messages = breakPrompt(
            request,
            {
                station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
                dj: request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, ''),
                maxWords: WEATHER_MAX_WORDS,
                cleanLanguage: speaksClean(advisoryPolicy(this.config)),
                ...(request.persona === undefined ? {} : { persona: request.persona }),
            },
            WEATHER_SHAPE,
        );

        const result = await this.llm.converse(
            {
                messages,
                ...(model.length === 0 ? {} : { model }),
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                reasoningEffort: 'low',
            },
            // No tools, and here that includes `get_weather`. Everything this break may contain is
            // already in the prompt, fetched once by `WeatherSource` so the floor and this see the
            // same figures — and a model that could fetch its own could report a reading the floor
            // underneath it would contradict.
            {
                tools: false,
                budgetMs: BUDGET_MS,
                // Derived from when this break is due rather than fixed: see `patienceFor`.
                maxWaitMs: patienceFor(request.airsAt),
                // See `BreakWriteRequest.priority`: absent for a break that is going on air.
                ...(request.priority === undefined ? {} : { priority: request.priority }),
            },
        );

        // `dialect: 'optional'` for `ModelNewsBreakWriter`'s measured reason: "no advice, no scene"
        // and "sound like nobody else" are not simultaneously satisfiable, and this kind earns its
        // keep by being correct rather than by being in voice. The three prohibitions in
        // `characterFault` stay, since none of them is in tension with reporting a measurement.
        const guard: AnswerGuard = {
            maxWords: WEATHER_MAX_WORDS,
            ...(request.persona === undefined ? {} : { persona: request.persona, dialect: 'optional' as const }),
            ...(request.recent === undefined ? {} : { recent: request.recent }),
            ...(request.dayPart === undefined ? {} : { dayPart: request.dayPart }),
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

            this.logger.info(`director: ${declined?.reason ?? 'the model wrote nothing the station could read as a forecast'}`, {
                finish: result.finishReason,
                tokens: result.usage?.outputTokens,
                place: weather.place,
                persona: request.persona?.key,
                fault: declined?.fault,
            });
            return undefined;
        }

        // The check this kind has and no other does. Everything above judges the SHAPE of an answer;
        // this judges whether it is true, which for a forecast is answerable — a temperature is a
        // number, the station knows which numbers it was given, and any other number in the script is
        // one the model made up. Refused rather than trimmed, because there is no cut that removes an
        // invented figure and leaves a break worth airing.
        const invented = inventedFigure(script, weather);
        if (invented !== undefined) {
            const reason = `the model gave a forecast with a figure the station was never given (${invented})`;
            this.lastDetail = { ...this.lastDetail, reason };
            this.logger.info(`director: ${reason}`, { place: weather.place, persona: request.persona?.key });
            return undefined;
        }

        // A forecast cut back to its last whole sentence. See `writeTrim`.
        const trimmed = writeTrim(result.text, guard);
        if (trimmed !== undefined) {
            this.lastDetail = { ...this.lastDetail, reason: trimmed.reason };
            this.logger.info(`director: ${trimmed.reason}`, { kept: trimmed.kept, dropped: trimmed.dropped, place: weather.place });
        }

        const claimsTime = timeClaimIn(script, request.clock, request.dayPart);

        return {
            script,
            // Named for where it is about, as the floor beneath it is. See `WeatherBreakWriter`.
            label: request.subject === undefined ? 'Weather' : `Weather: ${request.subject.label}`,
            // Told what plays next means allowed to name it, so assume it did: over-stamping costs a
            // break the order drifted under, which is the safe direction.
            claimsNext: request.next !== undefined,
            // Stamped only when the answer really carries the time, the same posture the bulletin
            // takes and for the same reason. See `timeClaimIn`.
            ...(claimsTime === undefined ? {} : { claimsTime }),
        };
    }
}

/**
 * The first number in the script that the station was not given, or `undefined` when every one of
 * them was measured.
 *
 * The whole of this writer's own safety property, and the reason it can exist at all: unlike a
 * paraphrased news story, a forecast's claims ARE its numbers, and the set of true ones is known
 * exactly. So a script saying "twenty-two" when the service said seventeen is refusable with
 * certainty, where "the council said it would look into it" is not.
 *
 * Three things about how it judges are deliberate.
 *
 * **Only digits are checked, not words.** A model writing "seventeen" has said a true thing and a
 * model writing "22" has not, and catching the spelled-out form would mean a number vocabulary in
 * eleven languages to catch a shape no model actually produces — every captured break that reported
 * a figure reported it in digits. What it costs is an invented figure spelled out, which is a real
 * gap and a much smaller one than refusing "seventeen degrees" for not being in the list.
 *
 * **The permitted set is every figure in the reading**, not only the ones the prompt emphasised: the
 * humidity, each day's high and low, and the percentages. A model that mentioned the humidity when
 * the prompt did not ask it to has said something true, and refusing that would push it toward
 * saying less than it knows rather than more than it was told.
 *
 * **A year, a clock time and an ordinal are not figures.** `2026`, `9:30` and `1st` all appear in
 * ordinary speech about the weather and none of them is a measurement, so a number attached to a
 * colon or a date-shaped run is left alone. The station's other guards already own what a script may
 * claim about the time.
 */
export function inventedFigure(script: string, weather: SpokenWeather): string | undefined {
    const measured = new Set<number>();
    const keep = (value: number | undefined): void => {
        if (value !== undefined) measured.add(Math.round(value));
    };

    keep(weather.current.temperature);
    keep(weather.current.feelsLike);
    keep(weather.current.wind);
    keep(weather.current.humidity);
    keep(weather.current.precipitationChance);

    for (const day of weather.days ?? []) {
        keep(day.high);
        keep(day.low);
        keep(day.temperature);
        keep(day.wind);
        keep(day.humidity);
        keep(day.precipitationChance);
    }

    // A clock time, a date and a year are removed before anything is read as a measurement. The
    // station's other guards own what a script may claim about the time; this one owns the figures.
    const figures = script
        .replace(/\d{1,2}:\d{2}/g, ' ')
        .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, ' ')
        .replace(/\b(?:19|20)\d{2}\b/g, ' ');

    for (const match of figures.matchAll(/-?\d+(?:\.\d+)?/g)) {
        const said = Math.round(Number(match[0]));
        if (!Number.isFinite(said) || measured.has(said)) continue;
        return match[0];
    }

    return undefined;
}
