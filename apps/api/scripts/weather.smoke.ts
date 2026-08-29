/**
 * The whole weather chain, against the real services.
 *
 * Everything from a place name to the sentence the station would say: the plugin geocodes and
 * fetches, `weather.words.ts` converts into the station's units, and `reportOf` builds the floor's
 * read. What a unit test cannot cover is exactly what this does — that the parsers match what the
 * services ACTUALLY send today, rather than what a fixture said they sent when it was written.
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
import { spoken } from '../src/modules/weather/weather.words.js';

/** Places chosen to exercise the three answers: one inside every service, one outside the US, one nowhere. */
const PLACES = ['Atlanta', 'Chipping Norton, Oxfordshire', 'Nowheresvilleqqq'];

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
            console.log(`  observed at: ${reading.observedAt}`);
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
