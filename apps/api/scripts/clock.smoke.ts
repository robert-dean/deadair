/**
 * The format clock table, against the real database.
 *
 * The interesting part of a band used to be its PARSER, which a unit test covered without a stack.
 * Now that a band is a row, the interesting part is the table: the shape check that keeps an
 * anchored rule and a spacing rule from being written as each other, the ordering that IS the
 * operator's precedence, and the enabled flag that decides which bands the planner is even shown.
 * None of those is arithmetic over an array, so none of them belongs in a unit test.
 *
 * It WRITES, and cleans up after itself in a `finally`: everything it creates is under one kind and
 * is deleted at the end whichever way the run goes.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/clock.smoke.ts
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { ClockBandRepository } from '../src/modules/director/clock.band.repository.js';
import { isAnchored } from '../src/modules/director/clock.bands.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

/** Everything this run writes carries it, so the cleanup can be one statement. */
const KIND = 'smoke-clock-band';

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

const bands = new ClockBandRepository(db, new StationIdentity());

let failures = 0;
const check = (ok: boolean, said: string): void => {
    console.log(`  ${ok ? '✓' : '✗'} ${said}`);
    if (!ok) failures += 1;
};

try {
    console.log('the format clock');

    // ── what goes in comes back ────────────────────────────────────────────────
    const halfPast = await bands.create({ at: 'clock', minute: 30, kind: KIND, position: 1 });
    const daily = await bands.create({ at: 'clock', hour: 9, minute: 0, kind: KIND, position: 2 });
    const spacing = await bands.create({ at: 'interval', everyMs: 90 * 60_000, kind: KIND, position: 3 });

    check(isAnchored(halfPast) && halfPast.minute === 30 && halfPast.hour === undefined, 'an hourly band has a minute and no hour');
    check(isAnchored(daily) && daily.hour === 9 && daily.minute === 0, 'a daily band keeps the hour it was written with');
    check(!isAnchored(spacing) && spacing.everyMs === 90 * 60_000, 'minutes go in and milliseconds come back');

    // ── the shape check ───────────────────────────────────────────────────────
    const refused = await db
        .insertInto('deadair.clockBands')
        .values({ kind: KIND, at: 'interval', minute: 30, everyMinutes: null })
        .execute()
        .then(() => false)
        .catch(() => true);
    check(refused, 'a spacing rule written as an anchored one is refused by the table');

    // ── order is preference ───────────────────────────────────────────────────
    const listed = (await bands.list()).filter(band => band.kind === KIND);
    check(
        listed.map(band => band.id).join() === [halfPast.id, daily.id, spacing.id].join(),
        'the list comes back in the order the operator put them in',
    );

    await bands.update(spacing.id, { at: 'interval', everyMs: 90 * 60_000, kind: KIND, position: 0 });
    const reordered = (await bands.list()).filter(band => band.kind === KIND);
    check(reordered[0]?.id === spacing.id, 'and moving one changes that order');

    // ── switched off is not gone ──────────────────────────────────────────────
    await bands.update(daily.id, { at: 'clock', hour: 9, minute: 0, kind: KIND, position: 2, enabled: false });
    const inForce = (await bands.active()).filter(band => band.kind === KIND);
    const stored = (await bands.list()).filter(band => band.kind === KIND);
    check(inForce.length === 2, 'a band that is switched off is not handed to the planner');
    check(stored.length === 3, 'and is still there for the operator to switch back on');

    // ── deleting ──────────────────────────────────────────────────────────────
    check(await bands.remove(halfPast.id), 'a band this station has can be deleted');
    check(!(await bands.remove(halfPast.id)), 'and deleting it twice is not an error the second time');

    console.log(failures === 0 ? '\nall good' : `\n${failures} problem${failures === 1 ? '' : 's'}`);
} finally {
    // Everything under one kind, deleted whichever way the run went: this script writes to the same
    // database an operator is running a station on.
    await db.deleteFrom('deadair.clockBands').where('kind', '=', KIND).execute();
    await db.destroy();
}

process.exit(failures === 0 ? 0 : 1);
