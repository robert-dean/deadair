/**
 * When a plugin was first enabled, end to end against the real database.
 *
 * This exists because the first version of it did not work and could not have been caught anywhere
 * else. `first_enabled_at` has to be set on a new row and KEPT on an existing one, which means the
 * conflict branch reads the column it is writing — and Postgres allows that only there. The obvious
 * spelling, one `coalesce(first_enabled_at, now())` shared by both branches, fails with "column
 * first_enabled_at does not exist" the moment a plugin is enabled for the first time, because there
 * is no row in `values` to read it from. A unit test against a fake repository would have agreed
 * with the fake and said nothing.
 *
 * What it pins: a first enable stamps, a second does not move the stamp, disabling leaves it, and
 * re-enabling afterwards still does not move it. That last one is the whole point of the column,
 * since a plugin turned off and on again is not one the operator has stopped trusting.
 *
 * It works inside a transaction and rolls back, so it touches nothing the station owns. Run from
 * `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/plugin.trust.smoke.ts
 */

/** The database half of `.env`, read by hand: this script wants a pool, not the app's whole config. */
function env(key: string, fallback: string): string {
    if (process.env[key] !== undefined) return process.env[key];
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
    return line?.[1]?.trim() ?? fallback;
}

import { readFileSync } from 'node:fs';
import { Kysely } from 'kysely';
import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import { PluginConfigRepository } from '../src/modules/plugins/plugin.config.repository.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const pool = new KyselyPool({
    host: env('DATABASE_HOST', 'localhost'),
    port: Number(env('DATABASE_PORT', '55432')),
    user: env('DATABASE_USER', 'postgres'),
    password: env('DATABASE_PASSWORD', 'postgres'),
    database: env('DATABASE_NAME', 'deadair'),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new EmptyUpdateRewriteDialect({ pool }, quiet), plugins: [...KyselyDefaultPlugins] });

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

/** A transaction thrown away on purpose, so a live install is never touched. */
class Rollback extends Error {}

/** An id nothing else will have, since this table is keyed by one. */
const PLUGIN_ID = 'zzsmoke.trust';

try {
    await db.transaction().execute(async trx => {
        const repository = new PluginConfigRepository(trx as never);

        say('the first enable');

        // The row does not exist, so this is the branch that used to throw.
        const first = await repository.setEnabled(PLUGIN_ID, true);
        check('a plugin enabled for the first time is stamped', first.firstEnabledAt !== undefined, true);

        const stamp = first.firstEnabledAt?.toISO();

        say('everything after it');

        const second = await repository.setEnabled(PLUGIN_ID, true);
        check('enabling an already-enabled plugin does not move the stamp', second.firstEnabledAt?.toISO(), stamp);

        const disabled = await repository.setEnabled(PLUGIN_ID, false);
        check('disabling leaves the stamp alone', disabled.firstEnabledAt?.toISO(), stamp);
        check('and does turn it off', disabled.enabled, false);

        // The case the column exists for: an operator who turned something off and changed their
        // mind is not somebody who has to be asked to trust it again.
        const again = await repository.setEnabled(PLUGIN_ID, true);
        check('re-enabling later keeps the original stamp', again.firstEnabledAt?.toISO(), stamp);

        say('a plugin that has only ever been configured');

        // A write that is not an enable must not stamp: a plugin whose settings were saved while it
        // sat disabled has never been trusted, and the console still has to ask.
        const other = await repository.upsert({ pluginId: `${PLUGIN_ID}.other`, config: { a: 1 } });
        check('saving config alone leaves it unstamped', other.firstEnabledAt, undefined);

        const disabledFirst = await repository.setEnabled(`${PLUGIN_ID}.other`, false);
        check('and so does an explicit disable on a row that was never on', disabledFirst.firstEnabledAt, undefined);

        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) throw error;
} finally {
    await db.destroy();
}

say(process.exitCode === 1 ? '\nsomething is wrong' : '\na first enable is remembered exactly once');
