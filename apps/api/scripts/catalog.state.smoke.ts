/**
 * What the library is in each state, against the real catalog.
 *
 * The unit tests mock the repository, so nothing else runs this SQL — and it is the kind of SQL
 * that is wrong quietly: five `exists` predicates and five conditional counts, where a mistake does
 * not throw, it just answers a plausible number. The check that actually catches that is the one
 * below: **every filtered total has to add up against the counts**, because they are computed two
 * different ways (a `where` over the list, a `count(case ...)` over the whole set) and agreeing by
 * accident is not a thing they can do.
 *
 * Read-only. It writes nothing and needs no transaction.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/catalog.state.smoke.ts
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
import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import { TracksRepository } from '../src/modules/catalog/tracks.repository.js';

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
const tracks = new TracksRepository(db);

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

const base = { limit: 5, offset: 0, sort: 'asc' as const, schemaVersion: ANALYSIS_SCHEMA_VERSION };

try {
    const counts = await tracks.trackStateCounts(base);
    say(
        `${counts.total} records: ${counts.cached} cached, ${counts.measured} measured, ${counts.enriched} enriched, ${counts.benched} benched, ${counts.failing} failing`,
    );

    if (counts.total === 0) {
        say('an empty catalog proves nothing here; sync a playlist and run this again');
        process.exit(0);
    }

    // The whole point of the file: the filter and the count are two different pieces of SQL over the
    // same predicate, so a disagreement is a bug in one of them.
    for (const [state, expected] of [
        ['cached', counts.cached],
        ['uncached', counts.total - counts.cached],
        ['unmeasured', counts.total - counts.measured],
        ['benched', counts.benched],
        ['failing', counts.failing],
    ] as const) {
        const { total } = await tracks.listTracks({ ...base, state });
        check(`the ${state} filter agrees with the ${state} count`, total, expected);
    }

    // Every row carries three booleans, and a page must not multiply rows: a record with several
    // copies has to appear once however many of them have bytes.
    const page = await tracks.listTracks({ ...base, limit: 50 });
    check('a page has no duplicate rows', new Set(page.data.map(row => row.id)).size, page.data.length);
    check(
        'every row carries the three state flags',
        page.data.every(row => typeof row.hasAudio === 'boolean' && typeof row.measured === 'boolean' && typeof row.enriched === 'boolean'),
        true,
    );

    // The counts describe the set the operator is looking at, so a search narrows them. A term
    // nothing matches is the sharpest version of that.
    const narrowed = await tracks.trackStateCounts({ ...base, search: 'zzzzzzzzzznothing' });
    check('a search that matches nothing narrows the counts to zero', narrowed, {
        total: 0,
        cached: 0,
        measured: 0,
        enriched: 0,
        benched: 0,
        failing: 0,
    });

    // And the state filter deliberately does NOT narrow them, or the answer would be "of the benched
    // records, how many are benched".
    const filtered = await tracks.trackStateCounts({ ...base, state: 'benched' });
    check('the chosen state does not narrow the counts it was chosen from', filtered.total, counts.total);
} finally {
    await db.destroy();
}
