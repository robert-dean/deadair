/**
 * The `weather` kind. A weather plugin answers "what is it like outside", for
 * one place, as numbers.
 *
 * ## Why this is not `news`, and not `search`
 *
 * All three answer about the world rather than about records, and they are asked
 * different questions. News serves a MENU an operator assembled and answers
 * "what happened", with a de-duplication contract because the same entry comes
 * back on every poll. Search takes words the caller made up and answers "what
 * does the web say about that", with nothing stable to de-duplicate against.
 * This is asked about one PLACE and answers with measurements — a temperature is
 * not a headline, and the station wants to do arithmetic on it rather than read
 * it out verbatim.
 *
 * ## The plugin resolves the place, and the host never geocodes
 *
 * {@link WeatherQuery.place} is a name somebody typed, and turning it into
 * coordinates is exactly the per-service quirk this boundary exists to absorb:
 * one service ships a geocoder, one takes coordinates only, one wants its own
 * city ids. A host that geocoded would have to pick one of those services to
 * geocode WITH, which is the shape of dependency a capability is supposed to
 * remove.
 *
 * {@link WeatherReading.place} comes back as the SERVICE resolved it, because a
 * DJ has to be able to say a real place name rather than whatever was typed into
 * a settings box.
 *
 * ## Everything is metric
 *
 * Temperatures in Celsius, wind in km/h, and no unit field anywhere. What a
 * station SAYS is a station's own decision — a British station says Celsius
 * whichever service it reads — and it is settled where the words are made,
 * beside every other decision about how this station talks. A plugin converting
 * would mean the units on the wire depended on which plugin was installed, which
 * is the one thing a capability must not let happen.
 *
 * This is `ConfigField.unit`'s rule one layer down: the value on the wire is
 * always the declared unit, and nothing downstream learns that the presentation
 * converts.
 *
 * ## A condition is a closed vocabulary
 *
 * {@link WeatherCondition} is short and fixed. WMO code 73, an icon string of
 * `snow`, and a numeric condition id are three spellings of the same weather,
 * and mapping them is the plugin's job for {@link WeatherQuery.place}'s reason.
 * The service's own word survives beside it as
 * {@link WeatherConditions.description}, unread by anything that speaks
 * deterministically and available to a model that wants a phrase somebody wrote.
 *
 * ## Nothing here airs
 *
 * A reading is a number. Whether any of it is spoken is settled by a break
 * writer on a station that is on air, and this capability has no way to reach
 * one.
 *
 * Every shape here is JSON-safe.
 */

/**
 * What the sky is doing, in the fewest words that are still distinguishable.
 *
 * Ten arms, chosen so a station can say something true about each one without a
 * caveat, and deliberately not a scale: an intensity ("heavy rain") belongs on
 * the numbers, where a caller can decide for itself what counts as heavy. Every
 * service's own scheme collapses onto this and the plugin is what does the
 * collapsing.
 */
export type WeatherCondition = 'clear' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'sleet' | 'thunderstorm' | 'hail';

/** What a weather source is asked. */
export interface WeatherQuery {
    /**
     * The place, as somebody wrote it: `Atlanta`, `Chipping Norton, Oxfordshire`.
     *
     * Resolved by the plugin. See the note on this file about why the host does
     * not do it, and {@link WeatherReading.place} for what comes back.
     */
    place: string;
    /**
     * How many days of forecast to include beyond the current conditions.
     *
     * `0` or absent asks for now alone, which is the common call. A count rather
     * than named horizons (`today`, `tomorrow`, `week`) because those are words
     * for a person and this is a number for a service — and because the words
     * differ per caller: a break writer's "the weekend" and a model's "this week"
     * are the same request with different arithmetic in front of it.
     *
     * A plugin CAPS this at whatever its service will give and answers with what
     * it got, rather than refusing. Asking for more days than exist is a caller
     * being optimistic, not a caller being wrong.
     */
    days?: number;
}

/**
 * What it is like, at one moment or across one day.
 *
 * Every measurement is optional, and that is a fact about the services rather
 * than caution: they report different subsets, a forecast day carries figures an
 * observation does not, and a station that must ask whether it HAS the humidity
 * before mentioning it is a station that never says something it does not know.
 * A zero would be a lie in exactly the cases that matter.
 */
export interface WeatherConditions {
    condition: WeatherCondition;
    /**
     * The service's own words for it: `light drizzle`, `partly cloudy`.
     *
     * Raw material for a model, never read verbatim by anything deterministic —
     * the same standing `NewsItem.summary` has. Plain text, and absent whenever
     * the service offers nothing better than the code that became
     * {@link condition}.
     */
    description?: string;
    /** Degrees Celsius. See the note on this file: everything here is metric. */
    temperatureC?: number;
    /** Degrees Celsius, as it feels with the wind and the humidity, when the service computes one. */
    feelsLikeC?: number;
    /** Kilometres per hour. */
    windKph?: number;
    /** Relative humidity, as a percentage between 0 and 100. */
    humidity?: number;
    /** The chance of precipitation, as a percentage between 0 and 100. Rare on an observation. */
    precipitationChance?: number;
}

/** One day of the forecast. */
export interface WeatherDay extends WeatherConditions {
    /**
     * The calendar day AT THE PLACE, as `YYYY-MM-DD`. Never a `Date`.
     *
     * At the place rather than at the server, because that is the only reading of
     * it that makes "tomorrow" mean what a listener thinks it means. A station in
     * one timezone reporting a town in another is an ordinary thing to ask for.
     */
    date: string;
    highC?: number;
    lowC?: number;
    /** ISO-8601. Never a `Date`. */
    sunrise?: string;
    /** ISO-8601. Never a `Date`. */
    sunset?: string;
}

/** What one place is like. */
export interface WeatherReading {
    /**
     * The place as the SERVICE resolved it, which is not what was asked for.
     *
     * Kept because it is the part a presenter says out loud, and because it is
     * the only evidence anybody has that the right town was found: a station
     * announcing the weather in Birmingham, Alabama to an audience in Birmingham
     * is a failure nothing else here can detect.
     */
    place: string;
    /**
     * When the observation was made, as an ISO-8601 string. Never a `Date`.
     *
     * Not when it was fetched. A plugin serving a cached reading reports the age
     * of the READING, which is what lets a caller decide a forecast is too old to
     * broadcast — a decision no plugin is in a position to make, since only the
     * caller knows whether anybody is listening.
     */
    observedAt: string;
    /** What it is like right now. */
    current: WeatherConditions;
    /**
     * Today first, then forward.
     *
     * Absent or empty when {@link WeatherQuery.days} asked for none, and when the
     * service has no forecast to give. Those are the same answer to a caller, and
     * the difference belongs in the plugin's own log.
     */
    days?: WeatherDay[];
}

/**
 * Implemented by a `weather` plugin.
 */
export interface WeatherProvider {
    /**
     * What it is like there.
     *
     * `undefined` is an ordinary answer and not a failure: an unconfigured
     * plugin, a place the service could not resolve, and a service that is down
     * are one outcome to every caller, which is {@link SearchProvider.search}'s
     * empty array wearing the shape this capability has. Throw only for something
     * the operator has to go and fix, since the host turns a throw into a line an
     * operator reads.
     *
     * A place that resolved to somewhere unexpected is NOT one of those cases and
     * must be answered rather than swallowed — {@link WeatherReading.place} is
     * how that becomes visible.
     */
    getWeather(query: WeatherQuery): Promise<WeatherReading | undefined>;
}
