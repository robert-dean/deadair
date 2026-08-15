/**
 * The break request table, against the real database.
 *
 * The unit tests cover where a requested break GOES, which is arithmetic over an array and deserves
 * to be tested without a stack. What they cannot cover is this table, and the two questions asked of
 * it are the ones with real failure modes:
 *
 * - **the cooldown**, which is a query over a partial index and is the whole reason a request is a
 *   row rather than a map — a map forgets across exactly the restart that makes every listener look
 *   like a fresh arrival at once;
 * - **the conditional transitions**, which are what stop a late message putting a break that has
 *   already aired back into the queue. A `moveTo` that quietly succeeded from the wrong state would
 *   be invisible here and audible on air.
 *
 * It WRITES, and cleans up after itself in a `finally`: everything it creates is under one dedupe key
 * and is deleted at the end whichever way the run goes.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/break.request.smoke.ts
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { BreakRequestRepository } from '../src/modules/director/break.request.repository.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

/** Everything this run writes carries it, so the cleanup can be one statement. */
const KEY = 'smoke:break-request';

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
const requests = new BreakRequestRepository(db, identity);

let failures = 0;
const check = (ok: boolean, said: string): void => {
    console.log(`  ${ok ? '✓' : '✗'} ${said}`);
    if (!ok) failures += 1;
};

try {
    console.log('break requests');

    // ── what goes in comes back ────────────────────────────────────────────────
    const context = { headline: 'the bridge is shut', minutes: 4, live: true };
    const opened = await requests.open(
        { kind: 'news', urgency: 'interrupt', source: 'smoke', reason: 'a smoke test asked', context, key: KEY },
        'pending',
        Date.now() + 60_000,
    );

    check(opened.state === 'pending', 'a request opens in the state it was given');
    // Compared key by key rather than as JSON: `jsonb` stores an object as a normalized map and
    // hands the keys back in its own order, which is not the order they were written in.
    const sameContext = opened.context !== undefined && Object.entries(context).every(([key, value]) => opened.context?.[key] === value);
    check(sameContext, `the context comes back as the flat object it went in as (${JSON.stringify(opened.context)})`);
    check(opened.expiresAt !== undefined, 'the expiry comes back as epoch millis');
    check(opened.segmentId === undefined, 'a request with no break yet reads as undefined rather than null');

    // ── the cooldown ──────────────────────────────────────────────────────────
    check(await requests.acceptedSince(KEY, Date.now() - 60_000), 'a request just taken is inside its own cooldown');
    check(!(await requests.acceptedSince(KEY, Date.now() + 1_000)), 'and outside a window that has not started yet');
    check(!(await requests.acceptedSince('smoke:never-used', Date.now() - 60_000)), 'a key nothing used is not holding anything off');

    // ── the drain ─────────────────────────────────────────────────────────────
    const waiting = await requests.waiting();
    check(
        waiting.some(row => row.id === opened.id),
        'a pending request is waiting for a slot',
    );

    // ── the transitions ───────────────────────────────────────────────────────
    check(!(await requests.moveTo(opened.id, 'placed', 'ready')), 'a request cannot be placed from a state it is not in');
    check(await requests.moveTo(opened.id, 'ready', 'pending'), 'and can be moved on from the state it IS in');
    check(await requests.moveTo(opened.id, 'placed', ['pending', 'ready']), 'a transition may name several states it will accept');
    check(!(await requests.moveTo(opened.id, 'placed', ['pending', 'ready'])), 'and the same message arriving twice moves nothing the second time');

    const settled = await requests.waiting();
    check(!settled.some(row => row.id === opened.id), 'a placed request has stopped waiting');

    console.log(failures === 0 ? '\nall good' : `\n${failures} problem${failures === 1 ? '' : 's'}`);
} finally {
    // Everything under one key, deleted whichever way the run went: this script writes to the same
    // database an operator is running a station on.
    await db.deleteFrom('deadair.breakRequests').where('dedupeKey', '=', KEY).execute();
    await db.destroy();
}

process.exit(failures === 0 ? 0 : 1);
