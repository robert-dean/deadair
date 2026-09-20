import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import { WEATHER_KIND } from '#modules/weather/weather.kind.js';
import { WeatherService } from '#modules/weather/weather.service.js';
import { weatherLocations, type WeatherLocation } from '#modules/weather/weather.topic.js';
import type { SpokenWeather } from '#modules/weather/weather.words.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { TALK_BREAK_KIND } from './talk.break.writer.js';
import type { BreakContext } from './break.request.js';
import type { BreakSubject } from './break.writer.js';

/**
 * The reading a weather break is written from, fetched once and handed to whichever writer takes it.
 *
 * The `BulletinSource` of the weather, and it exists for the same reason: everything decided ONCE —
 * which place, how far ahead, and which units — is decided here, so the model binding and the floor
 * underneath it see exactly the same substrate. A writer that fetched its own would make the floor
 * do network I/O, which is the one thing a floor must not do.
 *
 * ## Two kinds ask, on opposite terms, and one of them has to be switched on
 *
 * `readingFor` answers `undefined` for every kind but those two, which is what keeps `WriteBreakJob`
 * free of a branch about the weather.
 *
 * The WEATHER break always asks: the reading is the break, and a slot with no reading is a slot the
 * station passes over. The TALK break asks only when `rotation.weatherInTalk` is on, and the reading
 * is then offered as colour on a break about a record — `BreakPromptShape.weather` is where those
 * terms are set out, and most breaks decline it.
 *
 * It is a SETTING rather than always-on because the talk break is the kind this station makes most
 * of, so this decides whether a weather service is asked on every link. The window in which a reading
 * is reused belongs to the plugin, which caches by place, so the cost is far below one request per
 * break — but it is not nothing, and it is not this module's call to make on an operator's behalf.
 *
 * This used to say that a talk break wanting the weather "reaches `get_weather` itself". It could
 * not: every break writer passes `tools: false`, so no tool answer has ever reached air, and the
 * sentence described an escape hatch that was never open. It is why this gap went unnoticed.
 *
 * ## What it is ABOUT is decided here too
 *
 * A band on the format clock may ask for the weather in one of the operator's locations, which
 * arrives as `context.topic` on the segment. Resolving that key to a PLACE happens here, exactly as
 * resolving a news category does, so the two writers cannot disagree about which town this break is
 * for. A band that names none gets `station.location`, which is what makes a weather band work on a
 * station that has created no locations at all.
 *
 * ## Nothing here throws, and the decline says which nothing it is
 *
 * No plugin installed, no place named, a service that is down: all three answer with no reading, and
 * the writer for the kind then declines. That is a slot the station passes over, which is exactly
 * what a segment that is not `ready` already costs it.
 *
 * The three are told apart HERE and nowhere else, because this is the only place that can. A station
 * whose clock asks for the weather every hour and is silent every time needs to be told which of
 * "install a plugin", "say where you are" and "the service is down" it is looking at — and the
 * writer, which sees only the absence, could not say.
 *
 * ## A fourth way, which is the reading being right and too old
 *
 * A break is written before it airs, so anything it asserts about the present has to survive the
 * gap. `break.claims.ts` is where the station already knows that, and weather arrived after it and
 * did not inherit it: `inventedFigure` refuses a figure the reading did not carry, which makes the
 * numbers unfabricable and says nothing about whether they are still true, because it checks the
 * script against the reading it was written from rather than against the sky at the slot.
 *
 * So the age is judged HERE, against `segments.airs_at` rather than against now — the same argument
 * and the same parameter as `BulletinSource.storiesFor`, which was already given the air time one
 * line above the call to this. A reading that will be too old by the time anybody hears it is a
 * fourth kind of nothing, and it declines exactly like the other three.
 */

/** The `deadair.settings` keys. In `rotation`, beside the station's other words. */
export const WEATHER_SOURCE_KEYS = {
    days: 'rotation.weatherDays',
    maxAgeMinutes: 'rotation.weatherMaxAgeMinutes',
    inTalk: 'rotation.weatherInTalk',
} as const;

/**
 * OFF, so nothing changes for a station that upgrades into this.
 *
 * The talk break is the kind this station makes most of, so switching it on by default would change
 * the sound of every existing install on an image pull and would start asking a weather service on
 * every link. Both are the operator's to choose.
 *
 * Exported so `settings.registry.ts` declares the same value this reads, which is the arrangement
 * every other setting has.
 */
export const DEFAULT_WEATHER_IN_TALK = false;

/**
 * How far ahead a weather break looks, when the operator has not said.
 *
 * One, which is today: the conditions now plus the day's high, which is what a station between two
 * records actually says. Zero is a legitimate setting and means the conditions alone, and seven is
 * a station that reads a forecast rather than mentioning the weather — both are the operator's to
 * choose and neither is what most want.
 */
export const DEFAULT_WEATHER_DAYS = 1;

/** The plugin's own ceiling, restated so a typo in a settings box cannot ask for a month. */
export const MAX_WEATHER_DAYS = 7;

/**
 * How old an observation may be at the moment the break AIRS, when the operator has not said.
 *
 * Two hours, and the size is deliberately generous rather than tight. What this bounds is this
 * morning's weather going out at teatime, which is a station saying something false in a confident
 * voice; it is not an attempt to keep the figure to the minute.
 *
 * **Measured against the real services rather than guessed** (`scripts/weather.smoke.ts`, which
 * reports the age and whether it survives the window, 2026-08-30): Open-Meteo answered 14 minutes
 * behind, and the US National Weather Service **44**. Add `WRITE_AHEAD` — eight records, call it
 * thirty-five minutes — and an NWS reading reaches its slot at about eighty minutes old, with forty
 * to spare. An hour would have declined every weather break on every NWS station, silently, and read
 * to that operator as a band that does not work.
 *
 * Measured against `segments.airs_at` rather than against now, which is the whole point: the reading
 * that was fresh when the words were written is the one that has to still be true when they are
 * spoken.
 */
export const DEFAULT_WEATHER_MAX_AGE_MINUTES = 120;

/**
 * The narrowest and widest an operator may set that to.
 *
 * The floor is a quarter of an hour because below it the write-ahead window alone would decline
 * every break, and a setting whose every value is silence is a setting nobody can use. The ceiling
 * is half a day, which is past the point where a reading is still about today's weather at all.
 */
export const MIN_WEATHER_MAX_AGE_MINUTES = 15;
export const MAX_WEATHER_MAX_AGE_MINUTES = 720;

/** What a weather break was given to read, and what it is about. */
export interface WeatherReport {
    /** The reading, in the units this break should be read in. Absent when there is none. */
    reading?: SpokenWeather;
    /**
     * When that reading stops being worth saying, as epoch millis. Present exactly when
     * {@link reading} is.
     *
     * Decided here rather than by whichever writer takes it, so the floor and the model binding
     * above it stamp the same expiry onto the same substrate. See `segments.claims_reading_until`.
     */
    freshUntil?: number;
    /** The location the format clock asked for, when it asked for one. */
    subject?: BreakSubject;
}

@Injectable()
export class WeatherSource {
    constructor(
        private readonly weather: WeatherService,
        private readonly topics: TopicRepository,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * What this break has to report, or `undefined` when it is not that sort of break.
     *
     * @param kind - The segment's kind. Anything but `weather` answers `undefined`.
     * @param context - The segment's context, which is where a format-clock band puts its location.
     * @param airsAt - When these words will be spoken, which is what the reading's age is judged
     *   against. A parameter rather than a clock read for `storiesFor`'s two reasons: the caller
     *   already holds the instant it is writing for, and a window nothing can pin is a window
     *   nothing can test. Defaults to now, which is the honest answer for a break whose row does
     *   not know when it airs.
     */
    async readingFor(kind: string, context: BreakContext | undefined, airsAt: number = Date.now()): Promise<WeatherReport | undefined> {
        // The talk break is behind a setting and the weather break is not, which is the whole of the
        // difference between a break the reading IS and a break it decorates. Read per break rather
        // than held, as every other switch here is, so an operator turning it on hears it on the next
        // link rather than on the next restart.
        const offered = kind === TALK_BREAK_KIND && settingIsOn(this.config, WEATHER_SOURCE_KEYS.inTalk, DEFAULT_WEATHER_IN_TALK);
        if (kind !== WEATHER_KIND && !offered) return undefined;

        // Asked before anything else, so a station with no weather plugin costs nothing and says
        // nothing: `BreakPlanner` would not have planted this break if nothing could write the kind,
        // but a plugin can be uninstalled between planting and writing.
        if (!this.weather.hasWeather()) {
            this.say(
                offered,
                'director: a weather break had no service to ask, so the station passed over the slot. Install and enable a weather plugin.',
            );
            return {};
        }

        // A LOCATION is a thing a weather band was pointed at, so only a weather break resolves one.
        // A talk break gets the station's own place and no subject, and both halves of that matter:
        // a talk break's `context.topic` is not a weather location, so reading it here would report
        // the wrong town, and `BreakWriteRequest.subject` is what the break is ABOUT — which for a
        // link between two records is the records, never the weather. It is also what `labelFor`
        // would otherwise put on the row and in front of a listener.
        const asked = offered ? undefined : await this.locationFor(context);
        const place = asked?.place ?? this.weather.home();
        if (place === undefined) {
            // The one decline an operator can fix in ten seconds, and the one they will never guess:
            // a clock band asking for the weather on a station that has not said where it is.
            this.say(
                offered,
                'director: a weather break had nowhere to report on, so the station passed over the slot. Set "Where the station is" in Settings.',
            );
            return {};
        }

        const days = clamp(this.config.get(WEATHER_SOURCE_KEYS.days, DEFAULT_WEATHER_DAYS), 0, MAX_WEATHER_DAYS, DEFAULT_WEATHER_DAYS);
        const subject = asked === undefined ? undefined : { key: asked.key, label: asked.label };

        try {
            const reading = await this.weather.read(place, days, asked?.units);
            if (reading === undefined) {
                // Said at info rather than debug, and it is the one line here worth an operator's
                // attention: a station whose clock asks for the weather every hour and whose service
                // is refusing is silent every hour, and this is what says so.
                this.say(offered, 'director: a weather break got no reading, so the station passed over the slot', { place });
                return subject === undefined ? {} : { subject };
            }

            // The fourth way of having nothing: a reading that is correct and will be too old to be
            // true by the time anybody hears it. Judged against the SLOT, not against now.
            const maxAgeMinutes = clamp(
                this.config.get(WEATHER_SOURCE_KEYS.maxAgeMinutes, DEFAULT_WEATHER_MAX_AGE_MINUTES),
                MIN_WEATHER_MAX_AGE_MINUTES,
                MAX_WEATHER_MAX_AGE_MINUTES,
                DEFAULT_WEATHER_MAX_AGE_MINUTES,
            );
            const fresh = freshUntil(reading.observedAt, maxAgeMinutes * 60_000);
            if (fresh === undefined || fresh <= airsAt) {
                // At info beside the other three, and it names both fixes because only the operator
                // can tell them apart: a service that has stopped updating and a window set too
                // tight for it produce the same silence.
                this.say(
                    offered,
                    'director: a weather break had only a reading that will be too old to be true when it airs, so the station passed over the ' +
                        'slot. The service is behind, or "How old a reading may be" is set tighter than it updates.',
                    { place, observedAt: reading.observedAt, airsAt: new Date(airsAt).toISOString(), maxAgeMinutes },
                );
                return subject === undefined ? {} : { subject };
            }

            return { reading, freshUntil: fresh, ...(subject === undefined ? {} : { subject }) };
        } catch (error) {
            // `WeatherService` already swallows a plugin's failures, so reaching here means something
            // else went wrong. Absorbed for the same reason everything else is: a break the station
            // passes over is something it is built to do, and a throw here would take the job with it.
            this.logger.warn(`director: a weather break could not be prepared (${errorText(error)})`);
            return subject === undefined ? {} : { subject };
        }
    }

    /**
     * A decline, at the volume the kind of break deserves.
     *
     * The four `info` lines here exist for one reader: an operator whose format clock asks for the
     * weather every hour and who hears silence every hour, and who cannot tell "install a plugin"
     * from "say where you are" from "the service is down" without being told. That is worth a line
     * every time, because every one of those is a slot the station passed over.
     *
     * A talk break is the opposite case in all three respects. Nobody asked for the weather, nothing
     * was passed over — the break is written without it, exactly as it was before the operator
     * switched this on — and the station makes hundreds of them a day, so the same line at `info`
     * would bury every other thing in the log under a report that nothing is wrong. So it drops to
     * `debug`, where an operator who has switched this on and is wondering why they never hear it can
     * still find all four sentences, unchanged.
     */
    private say(offered: boolean, message: string, detail?: Record<string, unknown>): void {
        if (offered) this.logger.debug(message, detail);
        else this.logger.info(message, detail);
    }

    /**
     * The location a band asked for, resolved against this station's own.
     *
     * Looked up rather than trusted, and falling back to the station's own place rather than
     * refusing — `ClockService.subjectFor`'s rule: a key from a band saved before somebody deleted
     * the location is a stale request, and the weather where the station is is a better answer to it
     * than silence. Unlike a news category, there is no risk of airing the wrong thing under the
     * right name here, because the reading names the place it is about.
     */
    private async locationFor(context: BreakContext | undefined): Promise<WeatherLocation | undefined> {
        const key = typeof context?.topic === 'string' ? context.topic.trim() : '';
        if (key.length === 0) return undefined;

        try {
            return weatherLocations(await this.topics.list(WEATHER_KIND)).find(location => location.key === key);
        } catch (error) {
            this.logger.info(`director: could not read the station's locations, so a weather break covers the station itself (${errorText(error)})`);
            return undefined;
        }
    }
}

/**
 * A setting held inside its declared range, on the resolver rule: a row already stored is CLAMPED
 * rather than refused, because a setting that refuses to load stops the break behind it.
 *
 * `Number(value)` rather than a typed read, because every layer of `AppConfig` holds strings and
 * `get`'s overload widens its return from the DEFAULT — so a set value arrives as text while
 * TypeScript reports a number. `BulletinSource` has the same three lines for the same reason.
 */
/**
 * The moment this observation stops being worth saying out loud, or `undefined` for one that cannot
 * be dated at all.
 *
 * `WeatherReading.observedAt` is ISO-8601 by contract and `WeatherService` already refuses a reading
 * whose is blank, so an unparseable one is a plugin doing something the capability forbids. It is
 * treated as ALREADY TOO OLD rather than as fresh, which is the direction that fails toward a slot
 * the station passes over instead of toward a confident sentence about a sky nobody measured.
 *
 * Exported for the tests, and because the number itself is what a break has to be held to: see
 * `segments.claims_reading_until`.
 */
export function freshUntil(observedAt: string, maxAgeMs: number): number | undefined {
    const at = Date.parse(observedAt);
    return Number.isFinite(at) ? at + maxAgeMs : undefined;
}

function clamp(value: number, low: number, high: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;

    return Math.min(Math.max(Math.floor(parsed), low), high);
}
