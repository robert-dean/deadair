import { Plugin, type PluginConnectionResult, type WeatherPluginInstance, type WeatherQuery, type WeatherReading } from '@deadair/plugin-sdk';

import { nwsGrid, nwsRead, type NwsGrid } from './nws.provider.js';
import { openMeteoRead } from './openmeteo.provider.js';
import { openWeatherGeocode, openWeatherRead } from './openweathermap.provider.js';
import { geocode, type GeoPoint } from './weather.geocode.js';
import { hasBudget, type Service } from './weather.http.js';
import {
    DEFAULT_CACHE_MINUTES,
    MAX_CACHE_MINUTES,
    MAX_FORECAST_DAYS,
    PLUGIN_ID,
    PLUGIN_VERSION,
    REQUEST_TIMEOUT_MS,
    type EngineId,
} from './weather.manifest.js';

export { weatherManifest } from './weather.manifest.js';

/**
 * What it is like outside, as something the station can ask.
 *
 * Thin, like `plugins/websearch`. Reaching a service lives in `host.fetch`,
 * turning its answer into the capability's shape lives in the three provider
 * files, and deciding what to SAY about it lives in the API — this plugin never
 * composes a sentence and never converts a unit.
 *
 * ## One service at a time, and it is the operator's choice
 *
 * No fallback to a second service when the chosen one fails, deliberately and
 * for `plugins/websearch`'s reason: only one is credentialed on any given
 * install, and a station that really wants two installs this plugin twice.
 *
 * ## Two caches, and they hold different kinds of thing
 *
 * A PLACE's coordinates do not move, so they are kept for as long as the plugin
 * is loaded. A READING is worth minutes, so it is kept for the operator's own
 * window. Both live in memory rather than in `host.storage`, which is the right
 * lifetime for both: an operator saving the form reinitializes the plugin, and
 * what they have usually just changed is which service answers — so a reading
 * fetched from the previous one must not survive that.
 *
 * The reading cache is what stops one break asking twice. A model that calls the
 * tool for now and then again for the week is two calls for one sentence, and
 * without this it is two requests to somebody else's service.
 *
 * ## The host is captured before the first await
 *
 * `dispose()` releases the host, and an operator saving the config reinitializes
 * the plugin — so a request in flight when they press Save comes back to an
 * instance whose `host` getter now throws. Measured on `plugins/websearch`,
 * where a catch handler reaching for `this.host.logger` turned a search that had
 * simply failed into an invoker failure, three of which quarantine the plugin.
 * Every method here takes `const host = this.host` at the top and uses that.
 */
export class WeatherPlugin extends Plugin implements WeatherPluginInstance {
    private engine: EngineId = 'openmeteo';
    private apiKey = '';
    private cacheMs = DEFAULT_CACHE_MINUTES * 60_000;

    /**
     * How this station identifies itself to a service, when the operator has
     * given a contact.
     *
     * Built once at load rather than per request, and absent when the field is
     * empty — in which case the host's own default header stands, which names the
     * software and nobody to write to.
     */
    private userAgent?: string;

    /** Where a place is, once something has said. Keyed by engine and place, because the geocoders differ. */
    private readonly places = new Map<string, GeoPoint>();

    /** Which grid square answers about a coordinate. Only the National Weather Service arm has one. */
    private readonly grids = new Map<string, NwsGrid>();

    /** A reading and when it was fetched, keyed by engine, place and how many days were asked for. */
    private readonly readings = new Map<string, { at: number; reading: WeatherReading }>();

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();

        this.engine = readEngine(config.engine);
        this.apiKey = readText(config.apiKey);
        this.cacheMs = clamp(positive(config.cacheMinutes) ?? DEFAULT_CACHE_MINUTES, 1, MAX_CACHE_MINUTES) * 60_000;

        const contact = readText(config.contact);
        this.userAgent = contact.length === 0 ? undefined : `${PLUGIN_ID}/${PLUGIN_VERSION} (${contact})`;

        // Everything the plugin accumulates is released the same way it is built,
        // which matters more in-process than out of it: a map a plugin forgets
        // lives in the API server until a restart.
        this.register(() => {
            this.places.clear();
            this.grids.clear();
            this.readings.clear();
        });

        // The key is never logged. Neither is anything about a place, because
        // nothing here knows one yet — the station supplies those per call.
        this.host.logger.info('weather ready', { service: this.engine, reuseMinutes: Math.round(this.cacheMs / 60_000) });
    }

    protected async onUnload(): Promise<void> {
        this.apiKey = '';
        this.userAgent = undefined;
    }

    /**
     * What it is like there.
     *
     * `undefined` for a place nothing could resolve, which is an ordinary answer
     * and covers a typo, a village too small to be indexed, and a coordinate the
     * chosen service does not cover. A service that REFUSED is different and
     * throws, because a rate limit reported as "nowhere of that name" is a
     * station that looks like it is asking about somewhere that does not exist.
     *
     * The budget check is before the first request rather than after, for
     * `plugins/rss`'s reason: being cut off mid-request costs the request and
     * leaves nothing to show for it.
     */
    async getWeather(query: WeatherQuery): Promise<WeatherReading | undefined> {
        const host = this.host;
        const place = query.place.trim();
        if (place.length === 0) return undefined;

        const days = Math.min(Math.max(0, Math.trunc(query.days ?? 0)), MAX_FORECAST_DAYS);

        const cached = this.cachedReading(place, days);
        if (cached !== undefined) return cached;

        if (!hasBudget(host, REQUEST_TIMEOUT_MS)) {
            host.logger.debug('weather: not enough of the call left to ask a service');
            return undefined;
        }

        const service: Service = { host, ...(this.userAgent === undefined ? {} : { userAgent: this.userAgent }) };

        const point = await this.resolve(service, place);
        if (point === undefined) {
            host.logger.info('weather: nothing of that name was found', { place, service: this.engine });
            return undefined;
        }

        const reading = await this.read(service, point, days);
        if (reading === undefined) return undefined;

        this.readings.set(this.readingKey(place, days), { at: Date.now(), reading });
        return reading;
    }

    /**
     * Whether the service actually answers.
     *
     * A real lookup rather than a ping, because every way this fails fails at the
     * lookup: a wrong key is a 401 on the query and nowhere else, and the
     * National Weather Service serves its index happily and 404s for anywhere
     * outside the United States. The place asked about is deliberately inside
     * that coverage, so the one arm that can be geographically wrong is tested
     * where it should work.
     *
     * The answer NAMES the place that came back, which is the point: the commonest
     * way a weather plugin is wrong is not failing, it is confidently answering
     * about a different town of the same name.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;

        try {
            const reading = await this.getWeather({ place: 'Atlanta', days: 1 });
            if (reading === undefined) {
                return { ok: false, message: `${this.engine} answered, but could not find anywhere called Atlanta — which a working service does.` };
            }

            const temperature = reading.current.temperatureC;
            const where = `${this.engine} answered about ${reading.place}`;
            return { ok: true, message: temperature === undefined ? `${where}.` : `${where}: ${temperature}°C.` };
        } catch (error) {
            host.logger.debug('weather: the connection test failed', { service: this.engine, error: message(error) });
            return { ok: false, message: message(error) };
        }
    }

    /** A reading fetched recently enough to hand back again. */
    private cachedReading(place: string, days: number): WeatherReading | undefined {
        const held = this.readings.get(this.readingKey(place, days));
        if (held === undefined) return undefined;

        if (Date.now() - held.at > this.cacheMs) {
            this.readings.delete(this.readingKey(place, days));
            return undefined;
        }

        return held.reading;
    }

    private readingKey = (place: string, days: number): string => `${this.engine}|${place.toLowerCase()}|${days}`;

    /**
     * Where a place is, asked once and then remembered.
     *
     * Keyed by engine as well as by place, because two of the three arms use
     * Open-Meteo's geocoder and one uses its own — and the whole value of keeping
     * the name is that it is the name the ANSWERING service would use.
     */
    private async resolve(service: Service, place: string): Promise<GeoPoint | undefined> {
        const key = `${this.engine}|${place.toLowerCase()}`;
        const held = this.places.get(key);
        if (held !== undefined) return held;

        const found = this.engine === 'openweathermap' ? await openWeatherGeocode(service, this.apiKey, place) : await geocode(service, place);
        if (found === undefined) return undefined;

        this.places.set(key, found);
        return found;
    }

    /** The dispatch, and the only place the key is read. */
    private async read(service: Service, point: GeoPoint, days: number): Promise<WeatherReading | undefined> {
        switch (this.engine) {
            case 'openmeteo':
                return await openMeteoRead(service, point, days);
            case 'openweathermap':
                return await openWeatherRead(service, this.apiKey, point, days);
            case 'nws': {
                const grid = await this.gridFor(service, point);
                return grid === undefined ? undefined : await nwsRead(service, grid, point.name, days);
            }
            default:
                return undefined;
        }
    }

    /** Which grid square the service answers about this coordinate from. It never moves. */
    private async gridFor(service: Service, point: GeoPoint): Promise<NwsGrid | undefined> {
        const key = `${point.latitude},${point.longitude}`;
        const held = this.grids.get(key);
        if (held !== undefined) return held;

        const found = await nwsGrid(service, point);
        if (found === undefined) return undefined;

        this.grids.set(key, found);
        return found;
    }
}

/**
 * The engine, or the default.
 *
 * Read leniently here where the manifest's schema refuses it, which is the split
 * `plugins/rss` keeps: a save is the one moment there is somebody to tell, and a
 * running station handed a value it cannot read should fall back to the keyless
 * service rather than throw on every call. Falling back is safe precisely because
 * that service needs no credential.
 */
function readEngine(value: unknown): EngineId {
    if (value !== 'openmeteo' && value !== 'nws' && value !== 'openweathermap') return 'openmeteo';
    return value;
}

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const positive = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
