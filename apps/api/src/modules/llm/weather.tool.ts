import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import { WEATHER_KIND } from '#modules/weather/weather.kind.js';
import { WeatherService } from '#modules/weather/weather.service.js';
import { weatherLocations, type WeatherLocation } from '#modules/weather/weather.topic.js';
import { degreeLabel, speedLabel } from '#modules/weather/weather.words.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "What is it like outside?", as something a model can ask.
 *
 * ## The second source here that is not about records
 *
 * `NewsTool` was the first, and the two are unalike in the one way that matters
 * to a presenter: a headline is already the sentence, and this is a set of
 * numbers somebody has to turn into one. So what comes back is deliberately not
 * prose — a condition word, a temperature, a wind — and the model writes the
 * line. That is the same division `capabilities/weather.ts` keeps: a plugin
 * fetches and the host thinks.
 *
 * ## The bare call is the normal one
 *
 * Every parameter is optional and the common call is `get_weather()`, which
 * answers about `station.location`. That is the whole point of the setting: a
 * station reports its own weather without an operator naming anything, and a
 * `location` parameter with one obligatory value would be a round trip spent
 * teaching a model an id it has no basis for choosing.
 *
 * ## The station's own locations are offered, and only when there are any
 *
 * The `location` enum is the operator's own vocabulary — the same rows a band on
 * the format clock points at — and the parameter is left off entirely when the
 * station has named none. `NewsTool`'s rule, and the reason is the same: a knob
 * with an empty list behind it teaches a model that the filter works when it
 * does not.
 *
 * ## Nothing here airs
 *
 * A reading is a number. Whether any of it is spoken is the break writer's
 * decision on a station that is on air; this hands over measurements and has no
 * way to put one on the mount.
 */

/**
 * The horizons a model may ask for, and the day counts behind them.
 *
 * Words rather than the capability's day COUNT, because those are two different
 * audiences: a service takes a number and a model writes English, and a model
 * asked for a number picks 3 when it means "the next few days" and 14 when it
 * means "the week". The mapping is here rather than in the capability for the
 * same reason `weather.words.ts` holds the conversion — vocabulary is the
 * station's business.
 *
 * `week` is seven, which is what the plugin's own ceiling allows.
 */
const HORIZONS = {
    now: 0,
    today: 1,
    tomorrow: 2,
    week: 7,
} as const;

type Horizon = keyof typeof HORIZONS;

@Injectable()
export class WeatherTool implements ToolSource {
    constructor(
        private readonly weather: WeatherService,
        private readonly topics: TopicRepository,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        // Nothing to offer when no weather plugin is installed, which is the
        // default, and nothing to offer when the station has neither a place of
        // its own nor a location named: a declaration whose every call answers
        // "there is no weather" spends context teaching the model about a tool
        // that cannot help it. `NewsTool`'s rule and `ChartsTool`'s.
        if (!this.weather.hasWeather()) return [];

        const locations = await this.locations();
        const home = this.weather.home();
        if (home === undefined && locations.length === 0) return [];

        const units = this.weather.units();

        return [
            {
                // The one this whole vocabulary was written because of, and the only tool whose
                // answer the station has somewhere to put an expiry for: a weather BREAK stamps
                // `segments.claims_reading_until` off the same reading. A talk break that called
                // this and wrote the number down has no such stamp, so `perishable` is the honest
                // answer for the tool even though the kind above it is guarded.
                freshness: 'perishable',
                declaration: {
                    name: 'get_weather',
                    // Written for the model, and it says three things
                    // deliberately: that calling it bare is the normal way, that
                    // the figures are already in the units this station speaks,
                    // and that what comes back is measured rather than composed —
                    // which is what stops a model quoting it as though somebody
                    // had said it.
                    description:
                        `What it is actually like outside, from a weather service. Call it with no arguments for ${home ?? 'the station'} right now. ` +
                        `Temperatures are in ${degreeLabel(units)} and wind in ${speedLabel(units)}, already in the units this station speaks, so say the ` +
                        'numbers as they come. These are real measurements: you can say them on air, and you should not invent a figure or a ' +
                        'condition they do not carry.',
                    parameters: {
                        type: 'object',
                        properties: {
                            ...(locations.length === 0
                                ? {}
                                : {
                                      location: {
                                          type: 'string',
                                          enum: locations.map(location => location.key),
                                          description: `Somewhere other than ${home ?? 'the usual place'}: ${locations
                                              .map(location => `${location.key} (${location.label})`)
                                              .join(', ')}. Leave it out for where the station is.`,
                                      },
                                  }),
                            when: {
                                type: 'string',
                                enum: Object.keys(HORIZONS),
                                description:
                                    'How far ahead. "now" is the conditions this minute and is the default; "today" and "tomorrow" add that day\'s ' +
                                    'forecast; "week" adds the days ahead.',
                            },
                        },
                        required: [],
                        additionalProperties: false,
                    },
                },
                run: async args => await this.read(args, locations),
            },
        ];
    }

    /**
     * The reading, already in the units this place is reported in.
     *
     * A location the model named but the station does not hold is answered as
     * though it had named none — the stale-request rule `ClockService.subjectFor`
     * follows, because a model that read the enum a moment before an operator
     * deleted the row is not making a mistake it can learn from, and the
     * station's own weather is a better answer than a refusal.
     */
    private async read(args: Record<string, unknown>, locations: readonly WeatherLocation[]): Promise<unknown> {
        const wanted = readText(args.location);
        const asked = locations.find(location => location.key === wanted);
        const horizon = readHorizon(args.when);

        // The location's own units where the row overrides them, which is the one
        // place that override is honoured for a model — the answer says which it
        // used either way, so a mixed-units station cannot mislead a presenter.
        const reading = await this.weather.read(asked?.place, HORIZONS[horizon], asked?.units);

        // The line every tool here carries: "what did the model actually have to
        // work with" has to be answerable from the log alone when a break turns
        // out to have mentioned nothing.
        this.logger.debug('llm: read the weather', { location: asked?.key ?? 'home', when: horizon, found: reading !== undefined });

        if (reading === undefined) {
            // Said rather than left to be inferred from a null, and it is the
            // honest answer: the model cannot otherwise tell "the service is
            // down" from "this station cannot do weather", and only one of those
            // is worth trying again in the same break.
            return {
                note:
                    `No reading is available for ${asked?.label ?? 'the station'} at the moment. That is about the weather service rather than ` +
                    'about the weather. Talk about something else.',
            };
        }

        return {
            // The label the OPERATOR wrote wins over the name the service
            // resolved, where there is one: that is the word this station calls
            // the place, and it is what a presenter should be saying.
            place: asked?.label ?? reading.place,
            // Kept beside it rather than instead of it, because a service that
            // found the wrong town is a failure only visible here.
            resolvedAs: reading.place,
            observedAt: reading.observedAt,
            units: { temperature: degreeLabel(reading.units), wind: speedLabel(reading.units) },
            now: reading.current,
            ...(reading.days === undefined ? {} : { forecast: reading.days }),
        };
    }

    /**
     * The locations this station has named.
     *
     * Read per conversation rather than at boot, for `NewsTool`'s reason: an
     * operator adding a location should have the presenter able to ask about it
     * on the next break. A failure is a station with no extra locations, which is
     * a tool with no `location` parameter and everything else about it intact.
     */
    private async locations(): Promise<WeatherLocation[]> {
        try {
            return weatherLocations(await this.topics.list(WEATHER_KIND));
        } catch {
            return [];
        }
    }
}

/** An argument the model actually set. Blank is the interesting case: a model filling every field. */
const readText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/** Whatever the model asked for, or the conditions now, which is what a bare call means. */
function readHorizon(value: unknown): Horizon {
    const said = readText(value)?.toLowerCase();
    return said !== undefined && said in HORIZONS ? (said as Horizon) : 'now';
}
