/**
 * The outbound queue, against the real table.
 *
 * The unit tests cover who gets a play and when one counts, because both are pure. What they cannot
 * cover is the part with the interesting failure modes, which is all SQL: a play written with epoch
 * millis and read back as a timestamp, a `due` query gated on two separate clocks, and a backoff
 * computed in the database from a column the same statement increments. Every one of those is
 * invisible until it runs.
 *
 * So this writes rows, walks them through the states the drain puts them in, and asserts what each
 * one has to be true of: **nothing is due before it is eligible**, **a deferred row climbs**, and
 * **a row that has failed enough is swept**.
 *
 * It writes, and cleans up after itself in a `finally`. Everything it writes carries a station key
 * of its own, so a run against a live install cannot touch that station's queue.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/scrobble.smoke.ts
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { ScrobbleRepository } from '../src/modules/scrobble/scrobble.repository.js';
import { MAX_ATTEMPTS, RETRY_BASE_MS, RETRY_MAX_MS } from '../src/modules/scrobble/scrobble.flush.job.js';

/** Its own station, so a run against a live install cannot see or touch the real queue. */
const STATION = 'scrobble-smoke';
const PLUGIN = 'deadair.smoke';

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
const repository = new ScrobbleRepository(db);

let failures = 0;
const check = (ok: boolean, said: string): void => {
    console.log(`  ${ok ? '✓' : '✗'} ${said}`);
    if (!ok) failures += 1;
};

const play = (title: string, playedAt: number) => ({ title, artist: 'Massive Attack', durationMs: 330_000, playedAt });

/** The `next_attempt_at` of one row, as milliseconds from now. */
async function backoffMs(id: string): Promise<number> {
    const row = await sql<{ ms: string }>`
        select extract(epoch from (next_attempt_at - now())) * 1000 as ms
        from deadair.scrobble_queue where id = ${id}::uuid
    `.execute(db);
    return Number(row.rows[0]?.ms ?? 0);
}

async function attemptsOf(id: string): Promise<number> {
    const row = await sql<{ attempts: number }>`select attempts from deadair.scrobble_queue where id = ${id}::uuid`.execute(db);
    return Number(row.rows[0]?.attempts ?? -1);
}

try {
    const now = Date.now();

    console.log('\nqueueing');
    await repository.enqueue([
        // Eligible already: it aired five minutes ago.
        { stationKey: STATION, pluginId: PLUGIN, play: play('Teardrop', now - 300_000), eligibleAt: now - 150_000 },
        // Not yet: it started a moment ago and half of it has not passed.
        { stationKey: STATION, pluginId: PLUGIN, play: play('Angel', now - 5_000), eligibleAt: now + 160_000 },
    ]);
    check((await repository.depth(STATION, PLUGIN)) === 2, 'both plays are in the queue');

    const due = await repository.due(STATION, PLUGIN, 10);
    check(due.length === 1, 'only the eligible one is due');
    check(due[0]?.play.title === 'Teardrop', 'and it is the one that has been playing longest');
    check(due[0]?.play.artist === 'Massive Attack', 'the payload round-trips through jsonb intact');
    check(due[0]?.attempts === 0, 'a fresh row has no attempts against it');

    console.log('\ndeferring');
    const first = due[0]!.id;
    await repository.defer([first], 'the service was unreachable', RETRY_BASE_MS, RETRY_MAX_MS);
    check((await attemptsOf(first)) === 1, 'a deferred row counts one attempt');
    check((await repository.due(STATION, PLUGIN, 10)).length === 0, 'and is no longer due');

    const afterOne = await backoffMs(first);
    await repository.defer([first], 'still unreachable', RETRY_BASE_MS, RETRY_MAX_MS);
    const afterTwo = await backoffMs(first);
    check(afterTwo > afterOne, `the backoff climbs (${Math.round(afterOne / 1000)}s then ${Math.round(afterTwo / 1000)}s)`);
    check(afterTwo <= RETRY_MAX_MS, 'and stays under the ceiling');

    console.log('\ngiving up');
    // Straight to the threshold, since the point is the sweep rather than the ladder.
    await db.updateTable('deadair.scrobbleQueue').set({ attempts: MAX_ATTEMPTS }).where('id', '=', first).execute();
    const abandoned = await repository.abandon(STATION, MAX_ATTEMPTS);
    check(abandoned === 1, 'a play nothing will ever take is swept');
    check((await repository.depth(STATION, PLUGIN)) === 1, 'and the one still waiting its turn is left alone');

    console.log('\nforgetting');
    const remaining = await db.selectFrom('deadair.scrobbleQueue').select('id').where('stationKey', '=', STATION).execute();
    await repository.forget(remaining.map(row => row.id));
    check((await repository.depth(STATION, PLUGIN)) === 0, 'an accepted play leaves no row behind');
} finally {
    await db.deleteFrom('deadair.scrobbleQueue').where('stationKey', '=', STATION).execute();
    await db.destroy();
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
