import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { WeatherReading } from '@deadair/plugin-sdk';
import { asWeatherPlugin, type WeatherPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';
import { parseUnits, WEATHER_KEYS, type StationUnits } from './weather.keys.js';
import { spoken, type SpokenWeather } from './weather.words.js';

/**
 * What it is like outside, out of whatever weather plugins are installed.
 *
 * ## One answer, not a merge and not a menu
 *
 * `NewsService` enumerates: two services are two newsrooms and the operator picks
 * between them. `SearchService` combines: two engines return overlapping pages
 * about one subject. This does neither, because two services asked what it is
 * like in one place give two readings of the same sky — and a station that
 * averaged them would broadcast a temperature nobody measured, while one that
 * listed them would be asking a presenter to choose. So the first plugin that
 * answers wins and the rest are not asked.
 *
 * ## The station's own place, and its own units
 *
 * A caller that names no place gets `station.location`, which is what makes a
 * fresh install able to report its own weather without an operator creating
 * anything. A station that has named no place at all has no default, and every
 * caller here answers `undefined` rather than guessing — a station guessing where
 * it is would be worse than silent, because it would sound right.
 *
 * The conversion out of the capability's metric happens on the way out, in
 * `weather.words.ts`, once. Nothing downstream of this service ever sees a
 * Celsius figure it has to remember to convert.
 *
 * ## A plugin that cannot answer contributes nothing
 *
 * Every call into a plugin is caught and logged rather than thrown, the rule
 * `NewsService`, `SearchService` and `ToolRegistry` all apply. What is different
 * here is that there is usually only one plugin, so a caught failure IS the whole
 * answer — which is why it is logged at `info` with the place on it rather than
 * at `debug`.
 */
@Injectable()
export class WeatherService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Whether anything can answer at all, for a caller deciding whether to offer the feature. */
    hasWeather(): boolean {
        return this.plugins().length > 0;
    }

    /**
     * Where the station is, as the operator wrote it.
     *
     * `undefined` for a station that has not said, which is the default on a
     * fresh install and is an ordinary state rather than a fault.
     */
    home(): string | undefined {
        const place = this.config.get(WEATHER_KEYS.location, '').trim();
        return place.length === 0 ? undefined : place;
    }

    /** What this station says its measurements in. A STRING in the table, compared as one. */
    units(): StationUnits {
        return parseUnits(this.config.get(WEATHER_KEYS.units, ''));
    }

    /**
     * What it is like, in this station's units.
     *
     * `undefined` covers every way of having no answer — nothing installed, no
     * place named, a place nothing could resolve, a service that is down — because
     * they are one outcome to every caller and the log line is where the
     * difference lives. The one caller that has to tell them apart is the break
     * writer, and it asks the questions above separately for exactly that reason.
     *
     * @param place - Where to ask about. Defaults to {@link home}.
     * @param days - How much forecast to include beyond now.
     * @param units - A location's own override, where one is set. Defaults to {@link units}.
     */
    async read(place?: string, days = 0, units?: StationUnits): Promise<SpokenWeather | undefined> {
        const reading = await this.reading(place, days);
        return reading === undefined ? undefined : spoken(reading, units ?? this.units());
    }

    /**
     * {@link read} without the conversion, for a caller that wants what the
     * service actually reported.
     *
     * Separate rather than folded in, for `ChartsService.readCharts`'s reason: the
     * metric reading is what a future consumer with its own arithmetic wants — the
     * moment resolver in [station-moment](https://github.com/robert-dean/deadair/discussions/38) is the one this exists for
     * — and converting it back would be two roundings.
     */
    async reading(place?: string, days = 0): Promise<WeatherReading | undefined> {
        const asked = (place ?? this.home() ?? '').trim();
        if (asked.length === 0) return undefined;

        for (const plugin of this.plugins()) {
            const reading = await this.ask(plugin, asked, days);
            // The FIRST that answers, and then stop. See the note on this class:
            // a second reading of one sky is not more knowledge about it.
            if (reading !== undefined) return reading;
        }

        return undefined;
    }

    /**
     * One plugin's answer, defended.
     *
     * A reading with no place on it is dropped rather than passed on as a hole:
     * the place is what a presenter says out loud, and it is the only evidence
     * anybody has that the right town was found.
     */
    private async ask(plugin: WeatherPlugin, place: string, days: number): Promise<WeatherReading | undefined> {
        try {
            const reading = await this.pluginInvoker.invoke(plugin.record.id, 'weather.getWeather', async () =>
                plugin.instance.getWeather({ place, ...(days > 0 ? { days } : {}) }),
            );

            if (reading === undefined) return undefined;
            if (!reading.place?.trim() || !reading.observedAt?.trim() || reading.current === undefined) {
                this.logger.info(`weather: a service answered with nothing usable (${plugin.record.id})`);
                return undefined;
            }

            return reading;
        } catch (error) {
            this.logger.info(`weather: a service could not be asked (${plugin.record.id}: ${place}: ${errorText(error)})`);
            return undefined;
        }
    }

    /** Every plugin that can answer right now, in a stable order. */
    private plugins(): WeatherPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asWeatherPlugin).sort(byPluginId);
    }
}
