/**
 * Event destinations and their delivery log, against the real tables.
 *
 * The unit tests cover the service with the repository stubbed. What they cannot cover is the one
 * piece of SQL with a failure mode worth the name: the log is trimmed to the newest fifty per
 * destination as each row is written, by a delete whose subquery has to pick the RIGHT fifty and
 * touch no other destination's rows. So this writes more than fifty attempts to one destination and a
 * few to another, and asserts that exactly the newest fifty survive for the first, all of the
 * second's survive, the list comes back newest first, and removing a destination takes its log with
 * it. Then the rest of the SQL the delivery job leans on: which destinations a type reaches, the state
 * mark that only moves forward, the failure count kept in the database, the switch-off that happens
 * once, and turning a destination back on clearing both.
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

const busy = await repository.create({ name: 'smoke: busy', url: 'http://127.0.0.1:9/busy', secretSealed: 'sealed', enabled: true, events: [] });
const quiet = await repository.create({
    name: 'smoke: quiet',
    url: 'http://127.0.0.1:9/quiet',
    secretSealed: 'sealed',
    enabled: true,
    events: ['talk.started'],
});

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

    // Who wants what: an empty list is every type, a named one only that.
    const wantsTrack = await repository.subscribedTo('track.started');
    const wantsTalk = await repository.subscribedTo('talk.started');
    check(wantsTrack.includes(busy.id) && !wantsTrack.includes(quiet.id), 'an empty subscription takes a type, a narrowed one does not');
    check(wantsTalk.includes(busy.id) && wantsTalk.includes(quiet.id), 'a type a destination named reaches it');
    await repository.update(quiet.id, { enabled: false });
    check(!(await repository.subscribedTo('talk.started')).includes(quiet.id), 'a destination that is off wants nothing');
    check((await repository.attemptsAt(quiet.id, randomUUID())) === 0, 'an event never tried has no attempts');

    // The state mark moves forward and never back, whatever order two deliveries finish in.
    await repository.markDelivered(busy.id, '2026-10-14T20:00:10.000Z');
    await repository.markDelivered(busy.id, '2026-10-14T20:00:05.000Z');
    const marked = await repository.get(busy.id);
    check(
        marked?.lastStateAt?.toUTC().toISO() === '2026-10-14T20:00:10.000Z',
        `the state mark keeps the newer moment (has ${marked?.lastStateAt?.toUTC().toISO()})`,
    );
    await repository.markDelivered(busy.id);
    check(
        (await repository.get(busy.id))?.lastStateAt?.toUTC().toISO() === '2026-10-14T20:00:10.000Z',
        'a delivery that is not a state event leaves it alone',
    );

    // Failures count in the database, a success clears them, and the station's switch-off happens once.
    await repository.markFailed(busy.id, 'Answered 503.');
    const tally = await repository.markFailed(busy.id, 'Answered 503.');
    check(tally?.consecutiveFailures === 2 && tally.enabled, 'two failures count two');
    await repository.markDelivered(busy.id);
    check((await repository.get(busy.id))?.consecutiveFailures === 0, 'a delivery clears the count');
    await repository.markFailed(busy.id, 'Answered 404.');
    check((await repository.disableFailing(busy.id)) && !(await repository.disableFailing(busy.id)), 'only the first of two switch-offs does it');
    const off = await repository.get(busy.id);
    check(
        off?.enabled === false && off.disabledReason === 'failing' && off.lastFailure === 'Answered 404.',
        'it is off, says why, and keeps the last failure',
    );
    const back = await repository.update(busy.id, { enabled: true });
    check(
        back?.enabled === true && back.disabledReason === undefined && back.consecutiveFailures === 0,
        'turning it back on clears why and the count',
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
