/**
 * The whole almanac chain, against the real feed.
 *
 * Everything from a date to the sentence the station would say: the plugin fetches and parses,
 * `almanac.lean.ts` puts this station's own subject matter first, and `reportOf` builds the floor's
 * read. What a unit test cannot cover is exactly what this does — that the parser matches what
 * Wikipedia ACTUALLY sends today, rather than what a fixture said it sent when it was written.
 *
 * It also answers the question the lean was chosen against, and which no fixture can: **how much of
 * a real day is music**. A station set to "Music only" has nothing to say on a day whose count here
 * is zero, and that is a property of the calendar rather than of the code.
 *
 * It reads only, touches no database, and needs no station running. It DOES reach the internet, so a
 * sandbox that blocks `*.wikipedia.org` will fail it honestly rather than silently.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/almanac.smoke.ts
 *
 * A date other than today, as month and day, and a language other than English:
 *   node --import @swc-node/register/esm-register ./scripts/almanac.smoke.ts 1 3
 *   ALMANAC_LANGUAGE=de node --import @swc-node/register/esm-register ./scripts/almanac.smoke.ts
 */
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

import { WikipediaPlugin } from '../../../plugins/wikipedia/src/wikipedia.plugin.js';
import { reportOf } from '../src/modules/director/almanac.break.writer.js';
import { isMusical, leaned } from '../src/modules/almanac/almanac.lean.js';

/** A thin day and a busy one are different questions, so the date is a parameter with today as its default. */
function askedDate(): { month: number; day: number } {
    const month = Number(process.argv[2]);
    const day = Number(process.argv[3]);
    if (Number.isFinite(month) && Number.isFinite(day)) return { month, day };

    const now = new Date();
    return { month: now.getMonth() + 1, day: now.getDate() };
}

async function main(): Promise<void> {
    const { month, day } = askedDate();
    const language = process.env.ALMANAC_LANGUAGE ?? 'en';
    const host = createFakePluginHost();

    // The real internet rather than a scripted queue, which is the whole point of this script. The
    // headers are forwarded so the identifying User-Agent is exercised too.
    host.setFetchImpl(async (url, init) => await fetch(url, { headers: (init?.headers ?? {}) as Record<string, string> }));
    host.seedConfig({ contactEmail: 'almanac.smoke@example.com', language });
    host.seedRemainingMs(60_000);

    const plugin = new WikipediaPlugin();
    await plugin.init(host as never);

    console.log(`date: ${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}  language: ${language}\n`);

    try {
        const answered = await plugin.getDay({ month, day });
        if (answered === undefined) {
            console.log('no day, which is the ordinary answer for an edition that does not publish the feed');
            return;
        }

        const musical = answered.entries.filter(isMusical);
        console.log(`entries: ${answered.entries.length}, of which ${musical.length} are music`);
        for (const kind of ['event', 'birth', 'death', 'observance'] as const) {
            console.log(`  ${kind}: ${answered.entries.filter(entry => entry.kind === kind).length}`);
        }

        // What each lean would actually put in front of a writer, which is the decision an operator
        // makes in one dropdown and hears for the rest of the day.
        for (const lean of ['music', 'musicOnly', 'any'] as const) {
            const ordered = leaned(answered.entries, lean);
            console.log(`\n${lean}: ${ordered.length} entries`);
            for (const entry of ordered.slice(0, 3)) console.log(`  ${reportOf(entry)}`);
            if (ordered.length === 0) console.log('  (nothing, so the station passes over the slot)');
        }

        console.log(`\ntestConnection: ${JSON.stringify(await plugin.testConnection())}`);
    } finally {
        await plugin.dispose();
    }
}

await main();
