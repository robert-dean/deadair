/**
 * Event destinations and their delivery log, against the real tables.
 *
 * The unit tests cover the service with the repository stubbed. What they cannot cover is the one
 * piece of SQL with a failure mode worth the name: the log is trimmed to the newest fifty per
 * destination as each row is written, by a delete whose subquery has to pick the RIGHT fifty and
 * touch no other destination's rows. So this writes more than fifty attempts to one destination and a
 * few to another, and asserts that exactly the newest fifty survive for the first, all of the
 * second's survive, the list comes back newest first, and removing a destination takes its log with
 * it.
 *
 * It writes: two destinations, created and removed again in a `finally`. Point it at a database whose
 * contents do not matter.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/events.smoke.ts
 */
import { randomUUID } from 'node:crypto';
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { DELIVERIES_KEPT, EventDestinationsRepository } from '../src/modules/events/event.destinations.repository.js';

/** Past the cap by enough that an off-by-one in the trim shows. */
const WRITTEN = DELIVERIES_KEPT + 7;

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
const repository = new EventDestinationsRepository(db);

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failures.push(what);
};

const busy = await repository.create({ name: 'smoke: busy', url: 'http://127.0.0.1:9/busy', secretSealed: 'sealed', enabled: true });
const quiet = await repository.create({ name: 'smoke: quiet', url: 'http://127.0.0.1:9/quiet', secretSealed: 'sealed', enabled: true });

try {
    const busyEvents: string[] = [];
    for (let index = 0; index < WRITTEN; index += 1) {
        const eventId = randomUUID();
        busyEvents.push(eventId);
        await repository.recordDelivery({
            destinationId: busy.id,
            eventId,
            eventType: 'destination.test',
            attempt: 1,
            outcome: 'delivered',
            httpStatus: 204,
            durationMs: index,
        });
    }
    for (let index = 0; index < 3; index += 1) {
        await repository.recordDelivery({
            destinationId: quiet.id,
            eventId: randomUUID(),
            eventType: 'destination.test',
            attempt: 1,
            outcome: 'failed',
            durationMs: 0,
            error: 'Answered 503.',
        });
    }

    const kept = await repository.listDeliveries(busy.id);
    const stored = await db.selectFrom('deadair.eventDeliveries').select('eventId').where('destinationId', '=', busy.id).execute();
    check(stored.length === DELIVERIES_KEPT, `the busy destination keeps exactly ${DELIVERIES_KEPT} rows (has ${stored.length})`);
    check(
        kept.map(row => row.eventId).join() === busyEvents.slice(-DELIVERIES_KEPT).reverse().join(),
        'what it keeps is the newest, listed newest first',
    );

    const quietKept = await repository.listDeliveries(quiet.id);
    check(quietKept.length === 3, `the other destination keeps all ${quietKept.length} of its 3 rows`);
    check(
        quietKept.every(row => row.error === 'Answered 503.' && row.httpStatus === undefined),
        'an absent status reads back as absent, and the error as written',
    );

    await repository.remove(busy.id);
    const orphans = await db.selectFrom('deadair.eventDeliveries').select('id').where('destinationId', '=', busy.id).execute();
    check(orphans.length === 0, 'removing a destination removes its log');
} finally {
    await repository.remove(busy.id);
    await repository.remove(quiet.id);
    await db.destroy();
}

if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
}
console.log('\nevent destinations: all checks passed');
