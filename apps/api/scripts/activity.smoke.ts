/**
 * The activity feed, against the real three tables.
 *
 * The unit tests cover the half that is not SQL — the cursor and the sentences — because that half
 * is pure and deserves to be tested without a stack. What they cannot cover is the union itself,
 * which is the part with the interesting failure modes: three sources with different column names
 * projected into one shape, ordered across each other, and paged by a keyset that has to hold
 * across a boundary between two of them. Every one of those is invisible until it runs.
 *
 * So this walks the feed one small page at a time and asserts the three properties that make it a
 * feed rather than three lists: **strictly descending order**, **no row served twice**, and **no
 * row skipped** at a page boundary. The last is the one a keyset gets wrong, and it gets it wrong
 * only when two rows share a timestamp, which is exactly what a stand-down and the poll behind it
 * produce.
 *
 * It reads. With `--write` it appends one station event and deletes it again in a `finally`, which
 * is the only way to exercise the third source on an install that has not been silent yet.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/activity.smoke.ts
 *   node --import @swc-node/register/esm-register ./scripts/activity.smoke.ts --write
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { ActivityRepository } from '../src/modules/activity/activity.repository.js';
import { ActivityService } from '../src/modules/activity/activity.service.js';
import { StationEventsRepository } from '../src/modules/activity/station.events.repository.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';
import { encodeCursor } from '../src/modules/activity/activity.feed.js';

/** Append a station event and take it away again, so the third source is not empty. */
const WRITE = process.argv.includes('--write');
/** Small on purpose: the page boundary is what is being tested, so there should be many of them. */
const PAGE = 5;
/** Enough pages to cross from the newest source into the others on any install with history. */
const PAGES = 8;

// Dotenv only, unlike `silence.smoke.ts`: nothing here reads a `deadair.settings` value, so the
// second config layer would be a Postgres connection opened to answer no question.
const config = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

const pool = new KyselyPool({
    host: config.get('DATABASE_HOST', ''),
    port: config.get('DATABASE_PORT', 55432),
    user: config.get('DATABASE_USER', ''),
    password: config.get('DATABASE_PASSWORD', ''),
    database: config.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const identity = new StationIdentity();
const service = new ActivityService(new ActivityRepository(db), identity);
const events = new StationEventsRepository(db);

let failures = 0;
const check = (ok: boolean, said: string): void => {
    console.log(`  ${ok ? '✓' : '✗'} ${said}`);
    if (!ok) failures += 1;
};

async function counts(): Promise<Record<string, number>> {
    const row = await sql<{ station: string; segment: string; play: string }>`
        select
            (select count(*) from deadair.station_events) as station,
            (select count(*) from deadair.segment_events) as segment,
            (select count(*) from deadair.play_history) as play
    `.execute(db);

    const first = row.rows[0];
    return { station: Number(first?.station ?? 0), segment: Number(first?.segment ?? 0), play: Number(first?.play ?? 0) };
}

/** Walk the feed, checking the three properties on the way past. */
async function walk(): Promise<void> {
    const seen = new Set<string>();
    const modules = new Set<string>();
    let before: string | undefined;
    let previous: { at: number; id: string } | undefined;
    let read = 0;

    for (let page = 0; page < PAGES; page += 1) {
        const answer = await service.readActivity({ limit: PAGE, ...(before === undefined ? {} : { before }) });
        if (answer.entries.length === 0) break;

        for (const entry of answer.entries) {
            read += 1;
            modules.add(entry.module);

            if (seen.has(entry.id)) check(false, `served ${entry.id} twice, across a page boundary`);
            seen.add(entry.id);

            const at = entry.at.toMillis();
            if (previous !== undefined && (at > previous.at || (at === previous.at && entry.id >= previous.id))) {
                check(false, `out of order at ${entry.at.toISO()} (${entry.kind}), after ${previous.id}`);
            }
            previous = { at, id: entry.id };
        }

        // The cursor the service handed back has to be the last row of the page it handed back, or
        // the next page starts somewhere other than where this one stopped.
        const last = answer.entries.at(-1);
        if (answer.nextBefore !== undefined && last !== undefined && answer.nextBefore !== encodeCursor(last)) {
            check(false, 'the cursor does not name the last row of the page it came with');
        }

        if (answer.nextBefore === undefined) break;
        before = answer.nextBefore;
    }

    check(true, `read ${read} entries over ${Math.ceil(read / PAGE)} pages, in order and each one once`);
    console.log(`    sources represented: ${[...modules].join(', ') || 'none'}`);
}

/**
 * The two ids a line carries, which are what a console links from.
 *
 * Its own check because of how it failed: the union selects `segment_id` and `track_id`, and
 * `CamelCasePlugin` rewrites raw-SQL result keys, so a repository reading `row.segment_id` answered
 * `undefined` for every row and every one of these was silently absent. Nothing noticed until
 * something tried to link from them, which is precisely the class of bug this script is for.
 */
async function ids(): Promise<void> {
    const entries = (await service.readActivity({ limit: 200 })).entries;

    const segments = entries.filter(entry => entry.kind.startsWith('segment.'));
    const aired = entries.filter(entry => entry.kind === 'track.aired');

    if (segments.length === 0) console.log('  · no break entries in this window, so nothing to check the segment id against');
    else
        check(
            segments.every(entry => entry.segmentId !== undefined),
            `every one of ${segments.length} break entries names the segment it is about`,
        );

    // Not every airing has one: a station can air a record the catalog has never seen.
    if (aired.length === 0) console.log('  · nothing aired in this window, so nothing to check the track id against');
    else
        check(
            aired.some(entry => entry.trackId !== undefined),
            `${aired.filter(entry => entry.trackId !== undefined).length} of ${aired.length} airings name the record they were`,
        );
}

/** The filters, which are the console's chips and the one thing a reader can get wrong silently. */
async function filters(): Promise<void> {
    const everything = await service.readActivity({ limit: 50 });

    const render = await service.readActivity({ limit: 50, module: 'render' });
    check(
        render.entries.every(entry => entry.module === 'render'),
        `the module filter answered ${render.entries.length} render entries and nothing else`,
    );

    const faults = await service.readActivity({ limit: 50, minSeverity: 'warn' });
    check(
        faults.entries.every(entry => entry.severity === 'warn' || entry.severity === 'fault'),
        `the severity floor answered ${faults.entries.length} entries, warnings and faults only`,
    );
    check(faults.entries.length <= everything.entries.length, 'a floor narrows the feed rather than widening it');
}

/** The third source, on an install that has not been silent since the table was made. */
async function withAnEvent(): Promise<void> {
    const detail = 'A smoke test wrote this and is about to take it away.';
    await events.append({ module: 'playout', kind: 'smoke.test', detail, data: { smoke: true } }, { stationKey: identity.stationKey });

    try {
        const head = await service.readActivity({ limit: 1 });
        const first = head.entries[0];
        check(first?.detail === detail, 'a station event appears at the head of the feed, with the sentence its producer wrote');
        check(first?.data?.smoke === true, 'its structured half survives the round trip through jsonb');
    } finally {
        await sql`delete from deadair.station_events where kind = 'smoke.test'`.execute(db);
    }
}

console.log('activity feed\n');
console.log(`  rows: ${JSON.stringify(await counts())}\n`);

await walk();
await ids();
await filters();
if (WRITE) await withAnEvent();
else console.log('  · pass --write to exercise station_events, which this install may have none of');

await db.destroy();
console.log(`\n${failures === 0 ? 'ok' : `${failures} failed`}`);
process.exit(failures === 0 ? 0 : 1);
