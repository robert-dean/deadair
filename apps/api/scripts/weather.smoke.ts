/**
 * The whole weather chain, against the real services.
 *
 * Everything from a place name to the sentence the station would say: the plugin geocodes and
 * fetches, `weather.words.ts` converts into the station's units, and `reportOf` builds the floor's
 * read. What a unit test cannot cover is exactly what this does — that the parsers match what the
 * services ACTUALLY send today, rather than what a fixture said they sent when it was written.
 *
 * It also answers the one question `rotation.weatherMaxAgeMinutes` was chosen against: how far behind
 * each engine's observations actually are, and whether one of them still survives the write-ahead
 * window. A `NO` on that line is an engine that will pass over every weather slot on a station that
 * is otherwise working, which is not a thing a fixture can tell anybody.
 *
 * It reads only, touches no database, and needs no station running. It DOES reach the internet, so a
 * sandbox that blocks the two hosts will fail it honestly rather than silently.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/weather.smoke.ts
 *
 * An engine other than the keyless default takes its id and, where it needs one, a key:
 *   node --import @swc-node/register/esm-register ./scripts/weather.smoke.ts nws
 *   WEATHER_KEY=... node --import @swc-node/register/esm-register ./scripts/weather.smoke.ts openweathermap
 */
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

import { WeatherPlugin } from '../../../plugins/weather/src/weather.plugin.js';
import { reportOf } from '../src/modules/director/weather.break.writer.js';
import { DEFAULT_WEATHER_MAX_AGE_MINUTES } from '../src/modules/director/weather.source.js';
import { spoken } from '../src/modules/weather/weather.words.js';

/** Places chosen to exercise the three answers: one inside every service, one outside the US, one nowhere. */
const PLACES = ['Atlanta', 'Chipping Norton, Oxfordshire', 'Nowheresvilleqqq'];

/**
 * Roughly how far a break is written ahead of the slot it airs in.
 *
 * `WRITE_AHEAD` is eight items and this catalog averages four and a half minutes a record, but the
 * planner's constants are not imported here: this script deliberately reaches nothing but the plugin
 * and the two pure modules, and a number with the reason beside it is worth more than a dependency
 * on the director for one line of output.
 */
const WRITE_AHEAD_MS = 8 * 270_000;

/** How old an observation is right now, in the words an operator would use. */
const ageOf = (observedAt: string): string => {
    const at = Date.parse(observedAt);
    if (!Number.isFinite(at)) return 'undateable, which the station reads as too old';

    return `${Math.round((Date.now() - at) / 60_000)} minutes old`;
};

/**
 * Whether this service is fresh enough for the station's default window, at the slot rather than now.
 *
 * The one thing this script can answer that no unit test can: `DEFAULT_WEATHER_MAX_AGE_MINUTES` is
 * two hours because a national service can be most of an hour behind before the station ever sees a
 * reading, and this is where that claim is checked against what the services actually send today. A
 * `no` here is not a bug in the station — it is an engine whose observations cannot survive the
 * write-ahead window, and an operator pointed at it will hear silence at every weather slot.
 */
function survives(observedAt: string): string {
    const at = Date.parse(observedAt);
    if (!Number.isFinite(at)) return 'no — an undateable observation is declined';

    const spareMs = at + DEFAULT_WEATHER_MAX_AGE_MINUTES * 60_000 - (Date.now() + WRITE_AHEAD_MS);
    return spareMs > 0
        ? `yes, with ${Math.round(spareMs / 60_000)} minutes to spare at the far end of the write-ahead window`
        : `NO — it would be ${Math.round(-spareMs / 60_000)} minutes past the window by the time it aired`;
}

async function main(): Promise<void> {
    const engine = process.argv[2] ?? 'openmeteo';
    const host = createFakePluginHost();

    // The real internet rather than a scripted queue, which is the whole point of this script. The
    // headers are forwarded so the identifying User-Agent is exercised too.
    host.setFetchImpl(async (url, init) => await fetch(url, { headers: (init?.headers ?? {}) as Record<string, string> }));
    host.seedConfig({ engine, contact: 'weather.smoke@example.com', ...(process.env.WEATHER_KEY ? { apiKey: process.env.WEATHER_KEY } : {}) });
    host.seedRemainingMs(60_000);

    const plugin = new WeatherPlugin();
    await plugin.init(host as never);

    console.log(`engine: ${engine}\n`);

    try {
        for (const place of PLACES) {
            let reading;
            try {
                reading = await plugin.getWeather({ place, days: 2 });
            } catch (error) {
                console.log(`${place}: refused — ${error instanceof Error ? error.message : String(error)}\n`);
                continue;
            }

            if (reading === undefined) {
                console.log(`${place}: no reading, which is the ordinary answer for a place nothing resolved\n`);
                continue;
            }

            console.log(place);
            console.log(`  resolved as: ${reading.place}`);
            console.log(`  observed at: ${reading.observedAt}  (${ageOf(reading.observedAt)})`);
            console.log(`  still true:  ${survives(reading.observedAt)}`);
            console.log(`  now:         ${JSON.stringify(reading.current)}`);
            console.log(`  today:       ${JSON.stringify(reading.days?.[0] ?? null)}`);
            console.log(`  metric:      ${reportOf(spoken(reading, 'metric'))}`);
            console.log(`  imperial:    ${reportOf(spoken(reading, 'imperial'))}\n`);
        }

        console.log(`testConnection: ${JSON.stringify(await plugin.testConnection())}`);
    } finally {
        await plugin.dispose();
    }
}

await main();
