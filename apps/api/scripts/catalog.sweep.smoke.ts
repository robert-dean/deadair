/**
 * The sweep guard, end to end against the real database.
 *
 * `sweepIsSafe` is a pure function with its own unit tests, and the interesting part is not the
 * arithmetic — it is that the counting query and the UPDATE agree about which rows they are talking
 * about. They share a predicate written out twice (`plugin_id`, `missing_at is null`,
 * `origin = 'sync'`, `external_id <> all(...)`), and a disagreement between the two copies is
 * invisible from either side: the guard would measure one population and retire a different one.
 * Nothing else runs this SQL, because the unit tests fake the database on purpose so they can assert
 * the ORDER of the two statements.
 *
 * The scenario this exists for cannot be reproduced by hand safely. A renumber is "every binding at
 * once", and the only honest way to check the station refuses it is to actually present it with one.
 * So this builds its own library inside a transaction and rolls it back, and touches nothing the
 * station owns. It also reports what the guard would say about the REAL library, which is the number
 * that decides whether the default is set sensibly for this install.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/catalog.sweep.smoke.ts
 */

/** The database half of `.env`, read by hand: this script wants a pool, not the app's whole config. */
function env(key: string, fallback: string): string {
    if (process.env[key] !== undefined) return process.env[key];
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
    return line?.[1]?.trim() ?? fallback;
}

import { readFileSync } from 'node:fs';
import { Kysely, sql } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool, EmptyUpdateRewriteDialect } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import { CatalogResolverRepository } from '../src/modules/catalog/ingest/catalog.resolver.repository.js';
import { DEFAULT_SWEEP_MAX_PERCENT, SWEEP_GUARD_MIN_KNOWN, sweepIsSafe } from '../src/modules/catalog/ingest/catalog.sweep.guard.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const pool = new KyselyPool({
    host: env('DATABASE_HOST', 'localhost'),
    port: Number(env('DATABASE_PORT', '55432')),
    user: env('DATABASE_USER', 'postgres'),
    password: env('DATABASE_PASSWORD', 'postgres'),
    database: env('DATABASE_NAME', 'deadair'),
    // See the note in `rating.smoke.ts`: without these the script reads different types from the
    // same rows than the app does, which is how a repro invents a failure the app does not have.
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new EmptyUpdateRewriteDialect({ pool }, quiet), plugins: [...KyselyDefaultPlugins] });

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

/** A transaction thrown away on purpose, so a live library is never touched. */
class Rollback extends Error {}

/** Names nothing else will have, so the fixture is findable among a real library's rows. */
const TAG = 'zzsmoke-sweep';
const BIG_PLUGIN = 'zzsmoke.big';
const SMALL_PLUGIN = 'zzsmoke.small';

/** Comfortably past {@link SWEEP_GUARD_MIN_KNOWN}, so the proportion is what decides. */
const BIG = SWEEP_GUARD_MIN_KNOWN * 5;

/** Under the floor, where a proportion says nothing about a library this size. */
const SMALL = 4;

/** How many of this plugin's `sync` bindings are still on offer. */
async function liveBindings(trx: Kysely<DB>, pluginId: string): Promise<number> {
    const row = await trx
        .selectFrom('deadair.trackSources')
        .select(sql<string>`count(*)`.as('n'))
        .where('pluginId', '=', pluginId)
        .where('missingAt', 'is', null)
        .where('origin', '=', 'sync')
        .executeTakeFirstOrThrow();
    return Number(row.n);
}

/**
 * A plugin with `count` `sync` bindings, built through the ingest path rather than by hand.
 *
 * Writing the rows directly would be a second spelling of what `upsertTrackSource` does, and a
 * fixture that disagrees with the real writer is how a smoke script passes against SQL the station
 * never produces.
 *
 * @returns The provider ids, in the order they were written.
 */
async function seedPlugin(repository: CatalogResolverRepository, pluginId: string, count: number): Promise<string[]> {
    const artistId = await repository.resolveArtist(`${TAG} artist`);
    const ids: string[] = [];

    for (let i = 0; i < count; i++) {
        const identity = { title: `${TAG} ${pluginId} ${i}`, artists: [`${TAG} artist`], durationMs: 180_000 };
        const track = await repository.resolveTrack(artistId, undefined, identity);
        const externalId = `${pluginId}-original-${i}`;
        await repository.upsertTrackSource(track.id, pluginId, { id: externalId, ...identity }, 'sync');
        ids.push(externalId);
    }

    return ids;
}

try {
    // What the guard would say about the library that is actually here, which is the part of this
    // that is about THIS install rather than about the code.
    const live = await db
        .selectFrom('deadair.trackSources')
        .select(['pluginId', sql<string>`count(*)`.as('n')])
        .where('missingAt', 'is', null)
        .where('origin', '=', 'sync')
        .groupBy('pluginId')
        .execute();

    say('the live library, and what a total renumber of it would meet:');
    for (const row of live) {
        const known = Number(row.n);
        const verdict = sweepIsSafe(known, known, DEFAULT_SWEEP_MAX_PERCENT) ? 'SWEPT (under the floor)' : 'refused';
        say(`  ${row.pluginId}: ${known} live sync bindings — ${verdict}`);
    }
    say('');

    await db.transaction().execute(async trx => {
        const repository = new CatalogResolverRepository(trx as never, quiet);
        const big = await seedPlugin(repository, BIG_PLUGIN, BIG);
        await seedPlugin(repository, SMALL_PLUGIN, SMALL);

        check('the fixture is what it says it is', await liveBindings(trx, BIG_PLUGIN), BIG);

        // A renumber: a complete, healthy walk in which not one id matches. This is the input the
        // empty-set refusal cannot see, and the one that used to retire the whole library.
        const renumbered = big.map(id => id.replace('original', 'renumbered'));
        check(
            'a full walk that recognises nothing is refused',
            await repository.markMissingTrackSources(BIG_PLUGIN, renumbered, DEFAULT_SWEEP_MAX_PERCENT),
            {
                kind: 'refused',
                reason: 'too-many',
                known: BIG,
                unseen: BIG,
            },
        );
        check('and it wrote nothing', await liveBindings(trx, BIG_PLUGIN), BIG);

        // The ordinary case has to keep working, or the guard is just an outage with a nicer name.
        const mostOfThem = big.slice(0, BIG - 7);
        check(
            'a walk that recognised nearly everything still sweeps',
            await repository.markMissingTrackSources(BIG_PLUGIN, mostOfThem, DEFAULT_SWEEP_MAX_PERCENT),
            {
                kind: 'swept',
                swept: 7,
            },
        );
        check('and the count and the update agreed about which rows', await liveBindings(trx, BIG_PLUGIN), BIG - 7);

        // The escape hatch, which is the only thing that turns the guard off.
        check('100 retires whatever the walk did not see', await repository.markMissingTrackSources(BIG_PLUGIN, renumbered, 100), {
            kind: 'swept',
            swept: BIG - 7,
        });
        check('which is the whole of what was left', await liveBindings(trx, BIG_PLUGIN), 0);

        // A library too small for a proportion to mean anything.
        check(
            'a small library is left to the empty-walk rule alone',
            await repository.markMissingTrackSources(SMALL_PLUGIN, ['nothing-matches'], DEFAULT_SWEEP_MAX_PERCENT),
            {
                kind: 'swept',
                swept: SMALL,
            },
        );

        // The refusal that was already here, and still is.
        check(
            'an empty walk is refused before anything is read',
            await repository.markMissingTrackSources(SMALL_PLUGIN, [], DEFAULT_SWEEP_MAX_PERCENT),
            {
                kind: 'refused',
                reason: 'nothing-seen',
            },
        );

        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) {
        process.exitCode = 1;
        say(`the smoke script itself failed: ${error instanceof Error ? error.message : String(error)}`);
    }
} finally {
    await db.destroy();
}
