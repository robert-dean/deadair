import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { SpokenWeather } from '#modules/weather/weather.words.js';
import { WEATHER_KIND } from '#modules/weather/weather.kind.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak } from './break.writer.js';
import {
    parseTemplates,
    TEMPLATE_KEYS,
    unknownPlaceholders,
    usable,
    wasHeard,
    type RenderedTemplate,
    type TemplateInputs,
} from './break.templates.js';
import { saysTime } from './clock.words.js';
import { spoken } from './talk.break.writer.js';

/**
 * The station saying what it is like outside.
 *
 * The floor under a weather break, in the sense `NewsBreakWriter` is a floor under a bulletin: no
 * network, no model, and no way to fail that costs the station a break it could have had. What makes
 * it a different KIND rather than another pool of talk-break phrasings is what it is about — a talk
 * break is about the records either side of it, a bulletin is about something that happened, and
 * this is about a place.
 *
 * ## It reads a measurement and does not interpret one
 *
 * The safety property here is the bulletin's in a different shape. A bulletin cannot be wrong about
 * the news if it reads the publisher's own words; this cannot be wrong about the weather if it says
 * only the figures the service reported. So there is no "it feels like autumn out there", no
 * comparison with yesterday, and no advice about coats: every one of those is a sentence nothing can
 * check against a source, and the model binding in front of this is allowed to be warmer and is
 * checked harder for it.
 *
 * The conversion into the station's units happened before this file — in `weather.words.ts`, once,
 * for both writers — so nothing here does arithmetic on a temperature either.
 *
 * ## No reading means no break
 *
 * `write` answers `undefined` when there is nothing to report, and that is the important branch
 * rather than an edge case: no plugin, nowhere named, and a service that is down all arrive here the
 * same way. A break that announced the weather and then said nothing is worse than the slot being
 * passed over, and passing over a slot is something the station is built to absorb.
 *
 * **Which of those three it was is said by `WeatherSource`**, not here, because this writer sees only
 * the absence. That is deliberate: an operator whose weather band is silent every hour needs to be
 * told whether to install a plugin, fill in a setting, or wait.
 *
 * ## The phrasings are the operator's, and are their own set
 *
 * `rotation.weatherTemplates`, defaulting to {@link WEATHER_TEMPLATES}, in the syntax
 * `break.templates.ts` already parses, with `{{weather.report}}` for the reading itself. Not chained
 * into the persona's `templates`, for `NewsBreakWriter`'s reason: those are written as
 * back-announces, and "That was X, from Y" is not how a forecast opens.
 */

/** The kind of segment this writes. The same string as `segments.kind`, and what a clock band names. */
export { WEATHER_KIND };

/** What `segments.writer` records for anything written here. */
export const WEATHER_WRITER = 'deterministic';

/** The `deadair.settings` key for the phrasings. In `rotation`, beside the station's other words. */
export const WEATHER_BREAK_KEYS = {
    templates: 'rotation.weatherTemplates',
} as const;

/**
 * The station's own ways of giving the weather.
 *
 * The DEFAULT of `rotation.weatherTemplates`, so an operator who clears the box gets these back
 * rather than a station that announces the weather and reports none — the same rule the other pools
 * follow, and the way to stop the station giving the weather is to take `weather` off the clock.
 *
 * Every one of them puts `{{weather.report}}` outside an optional chunk, which is not a style choice:
 * a phrasing that could drop the reading is a phrasing that can produce "And now the weather. Next
 * up, The Cure." Everything else is optional, so a station with no name, no clock and nothing coming
 * up still has all of them available.
 *
 * Each one also puts the reading after a full stop, because {@link reportOf} writes a capitalised
 * sentence — the reading is a sentence rather than a phrase, which is what a station actually says.
 */
export const WEATHER_TEMPLATES: readonly string[] = [
    'And now the weather. {{weather.report}}[[ Next up, {{next.artist}} with {{next.title}}.]]',
    "Here's the weather[[ on {{station.name}}]]. {{weather.report}}[[ Now, {{next.title}}.]]",
    '[[{{greeting}}. ]]Time for the forecast. {{weather.report}}[[ Then, {{next.artist}}.]]',
    "It's {{clock.rough}}[[ on {{station.name}}]]. {{weather.report}}",
    // The one that says WHERE, which is what makes a band pointed at a location sound like one.
    // `{{weather.place}}` is outside an optional chunk, so `usable` drops this phrasing rather than
    // the station saying "the weather in ." — the same rule every phrasing here follows about the
    // reading itself.
    'The weather in {{weather.place}} now. {{weather.report}}[[ Then, {{next.title}}.]]',
];

/**
 * How many recent breaks a phrasing avoids repeating.
 *
 * Three, and it is doing MORE work here than it does for a bulletin: the headlines change between
 * bulletins even when the frame does not, where a temperature moves a degree an hour. Two weather
 * breaks an hour apart that open the same way and report the same figure are the closest the station
 * comes to sounding like a loop.
 */
const RECENT_WINDOW = 3;

@Injectable()
export class WeatherBreakWriter extends BreakWriter {
    readonly kind = WEATHER_KIND;
    readonly name = WEATHER_WRITER;

    /** Which phrasing produced the last line, for the record. See {@link detailOfLastWrite}. */
    private lastTemplate?: string;

    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    detailOfLastWrite(): WriteDetail | undefined {
        return this.lastTemplate === undefined ? undefined : { source: this.lastTemplate };
    }

    async write(request: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastTemplate = undefined;

        const report = request.weather === undefined ? undefined : reportOf(request.weather);
        // Nothing to report. See the note on the class: this is the branch that keeps the station
        // from announcing the weather it does not have. Which of the three empty states this is was
        // said by `WeatherSource`, which is the only thing that can tell them apart.
        if (report === undefined) return undefined;

        const dj = (request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, '')).trim();

        // No `previous`, deliberately, and for `NewsBreakWriter`'s reason: `usable` insists a
        // phrasing say something about the record just finished whenever there is one, and a
        // forecast that back-announces on its way into it is a presenter who has not decided what
        // this break is. Withholding it makes every phrasing here usable mid-order.
        const inputs: TemplateInputs = {
            weather: report,
            // Where it is, for the one phrasing that names it. The location's own label when a band
            // asked for one, and the place the service resolved otherwise — which for the station's
            // own weather is the town rather than whatever was typed into the settings box.
            weatherPlace: request.subject?.label ?? request.weather?.place,
            ...(request.subject === undefined ? {} : { subject: request.subject.label }),
            ...(request.next === undefined ? {} : { next: request.next }),
            ...(request.station === undefined ? {} : { station: request.station }),
            ...(dj.length === 0 ? {} : { dj }),
            ...(request.clock === undefined ? {} : { clock: request.clock.words }),
            ...(request.greeting === undefined ? {} : { greeting: request.greeting.words }),
        };

        const templates = parseTemplates(this.config.get(WEATHER_BREAK_KEYS.templates, ''), WEATHER_TEMPLATES);
        this.complainAboutTypos(templates);

        const fits = usable(templates, inputs, spoken);
        // An operator whose every phrasing needs something this moment has not got. The reading
        // exists and there is no frame to read it in, which is a slot passed over rather than a bare
        // temperature with no station attached to it.
        if (fits.length === 0) return undefined;

        const chosen = choose(fits, (request.recent ?? []).slice(0, RECENT_WINDOW));
        this.lastTemplate = chosen.template;

        return {
            script: chosen.script,
            // Named for where it is about, so an operator reading the running order or the script
            // history can tell one weather break from the next without opening either.
            label: request.subject === undefined ? 'Weather' : `Weather: ${request.subject.label}`,
            claimsNext: chosen.saysNext,
            // Only when the phrasing really says what time it is, which is the answered-rather-than-
            // assumed posture every deterministic writer here takes.
            ...(request.clock !== undefined && saysTime(chosen.script, request.clock)
                ? { claimsTime: { from: request.clock.validFrom, until: request.clock.validUntil } }
                : {}),
        };
    }

    /** Say once, per broken phrasing, that it names something nothing can fill. */
    private complainAboutTypos(templates: readonly string[]): void {
        for (const template of templates) {
            const unknown = unknownPlaceholders(template);
            if (unknown.length === 0 || complainedAbout.has(template)) continue;

            complainedAbout.add(template);
            this.logger.warn(`director: a weather phrasing names something the station cannot fill (${unknown.join(', ')}): "${template}"`);
        }
    }
}

/**
 * The reading as one sentence, or `undefined` when there is nothing worth saying.
 *
 * `headlinesOf`'s opposite number, and the rule it follows is the same one read from the other end:
 * the bulletin quotes and this one STATES, so every clause here has to be a figure the service
 * reported. What it deliberately will not do is compare, advise or characterise — "warmer than
 * yesterday", "wrap up", "a lovely afternoon" — because those are sentences nothing can check
 * against a source, and a station that says one confidently has no way to be corrected.
 *
 * A capitalised sentence rather than a phrase, because that is what a station says and because it
 * lets every phrasing put it after a full stop rather than each one guessing at a join.
 *
 * `undefined` where the reading carries no temperature AND no condition worth saying, which is a
 * service that answered with almost nothing: "It's clear." on its own is a break, and a bare place
 * name is not.
 */
export function reportOf(reading: SpokenWeather): string | undefined {
    const place = reading.place.trim();
    const { temperature, words } = reading.current;

    // The two shapes a first sentence takes, and the difference is only whether there is a figure.
    // A condition alone is a real break — "It's raining in Atlanta." is what a station says when it
    // has nothing else — and a figure alone would be one too if any service ever sent one, which is
    // why `words` is always present and the temperature is not.
    const now = temperature === undefined ? `It's ${words}` : `It's ${temperature} degrees and ${words}`;
    const opening = place.length === 0 ? `${now}.` : `${now} in ${place}.`;

    const outlook = outlookOf(reading);
    return outlook === undefined ? opening : `${opening} ${outlook}`;
}

/**
 * What the rest of today looks like, when the reading carries a forecast for it.
 *
 * Only the FIRST day, whatever the operator asked the source to fetch. A break between two records
 * is one sentence about now and at most one about later, and a station that reads five days of highs
 * has stopped being a music station — the extra days are fetched for the model binding in front of
 * this, which can pick the one worth mentioning.
 *
 * A high on its own where there is no low, because an overnight low with no high is a sentence about
 * a night nobody has reached yet.
 */
function outlookOf(reading: SpokenWeather): string | undefined {
    const today = reading.days?.[0];
    if (today?.high === undefined) return undefined;

    return today.low === undefined ? `A high of ${today.high} today.` : `A high of ${today.high} today, down to ${today.low} overnight.`;
}

/**
 * Phrasings an operator has typo'd, so the log says so once rather than once a break.
 *
 * Module-level for `TalkBreakWriter`'s reason: the writer is resolved per job, so a set on the
 * instance would warn every time.
 */
const complainedAbout = new Set<string>();

/** A phrasing that has not just been used, where one is available. `TalkBreakWriter.choose`'s rule. */
function choose(fits: readonly RenderedTemplate[], recent: readonly string[]): RenderedTemplate {
    const unheard = fits.filter(one => !wasHeard(one, recent));
    if (unheard.length > 0) return sample(unheard);

    const last = recent[0];
    const notLast = last === undefined ? fits : fits.filter(one => !wasHeard(one, [last]));
    return sample(notLast.length > 0 ? notLast : fits);
}

const sample = <T>(pool: readonly T[]): T => pool[Math.floor(Math.random() * pool.length)]!;
