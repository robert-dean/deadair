/**
 * The record cache's cap and its sweep, end to end against the real database and a real store.
 *
 * The unit tests mock the repository, so nothing else runs this SQL: the sum the cap is compared
 * against, the LRU ordering off `track_audio_lru_idx`, the exclusion of what may not be touched, the
 * clear that keeps the row and drops the file columns, and the one that stops a shared file being
 * deleted out from under a second binding. It also drives the real {@link ContentStore}, because
 * "the row says it is gone and the file is still there" is the failure this cannot have.
 *
 * Nothing here touches a record the station actually holds: it writes its own rows against real
 * bindings inside a transaction that is rolled back, and its own files under a temporary directory
 * that is removed. The one thing it needs from the live database is a few `track_sources` rows to
 * hang them off, since `track_audio.source_id` is a foreign key.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/track.cache.smoke.ts
 */

/** The database half of `.env`, read by hand: this script wants a pool, not the app's whole config. */
function env(key: string, fallback: string): string {
    if (process.env[key] !== undefined) return process.env[key];
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
    return line?.[1]?.trim() ?? fallback;
}

import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, sql } from 'kysely';
import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import { TrackAudioRepository } from '../src/modules/playout/audio/track.audio.repository.js';
import { TrackAudioService } from '../src/modules/playout/audio/track.audio.service.js';
import { TrackStore } from '../src/modules/playout/audio/track.store.js';
import { TRACK_CACHE_MAX_BYTES_KEY } from '../src/modules/playout/audio/track.cache.limit.js';
import type { PluginTrackResolver } from '../src/modules/playout/providers/plugin.resolver.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const pool = new KyselyPool({
    host: env('DATABASE_HOST', 'localhost'),
    port: Number(env('DATABASE_PORT', '55432')),
    user: env('DATABASE_USER', 'postgres'),
    password: env('DATABASE_PASSWORD', 'postgres'),
    database: env('DATABASE_NAME', 'deadair'),
    // What turn a timestamptz into a Luxon `DateTime` and an int8 into a `BigInt`, exactly as
    // `DataModule` builds the runtime pool. A script that leaves them off reads different types
    // from the same rows.
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new EmptyUpdateRewriteDialect({ pool }, quiet), plugins: [...KyselyDefaultPlugins] });

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

const MB = 1024 * 1024;

/** Four bindings to hang test rows off. Real ids, because `source_id` is a foreign key. */
const bindings = await db.selectFrom('deadair.trackSources').select('id').orderBy('id').limit(4).execute();
if (bindings.length < 4) {
    say('this smoke needs at least four `track_sources` rows to hang cache rows off; sync a playlist first');
    process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), 'deadair-track-cache-smoke-'));
const store = new TrackStore(root);

/**
 * A file of `bytes` bytes, filed under a checksum this run controls.
 *
 * `fill` is not decoration: the store is content-addressed, so two fixtures of the same size and the
 * same byte are ONE file — which is the case the last section tests deliberately and which would
 * quietly make every earlier assertion about deleting a file untrue.
 */
const write = async (bytes: number, fill: number): Promise<string> => {
    return await store.write(Buffer.alloc(bytes, fill), 'ogg');
};

/** A transaction thrown away on purpose, so the live cache is never actually touched. */
class Rollback extends Error {}

try {
    await db
        .transaction()
        .execute(async trx => {
            const repository = new TrackAudioRepository(trx);

            // A service over the transaction's repository. The container is the one seam a script has
            // to fake: `TrackAudioService` opens its own scope per call because it is a singleton, and
            // here every scope is the same transaction.
            const container = {
                createScopedContainer: () => ({
                    get: (token: unknown) => (token === TrackAudioRepository ? repository : undefined),
                    disposeAsync: async () => {},
                }),
            } as unknown as Container;

            let capBytes = 0;
            const config = { get: (key: string, fallback: unknown) => (key === TRACK_CACHE_MAX_BYTES_KEY ? capBytes : fallback) } as unknown as AppConfig;
            const resolver = { resolveBinding: async () => undefined } as unknown as PluginTrackResolver;
            const service = new TrackAudioService(container, store, resolver, config, quiet);

            // The station holds nothing this run did not put here: the rows below are the whole of
            // what the sum and the walk can see, because the transaction starts by clearing the rest.
            await sql`delete from deadair.track_audio`.execute(trx);

            // Four records of 10MB, oldest served first. Written through the repository so the
            // insert is the app's own, then aged by hand — `last_served_at` has no setter but
            // `markServed`, which always means now.
            const files: { sourceId: string; checksum: string }[] = [];
            for (const [index, binding] of bindings.entries()) {
                const checksum = await write(10 * MB, index + 1);
                await repository.recordSuccess(binding.id, { checksum, ext: 'ogg', contentType: 'audio/ogg', byteSize: 10 * MB });
                // `created_at` goes back with it, because the row carries
                // `check (last_served_at >= created_at)`: a record cannot have been served before it
                // existed, and a fixture pretending otherwise is testing a state the station cannot
                // reach.
                await sql`update deadair.track_audio
                             set created_at = now() - make_interval(days => ${sql.val(bindings.length - index + 1)}),
                                 last_served_at = now() - make_interval(days => ${sql.val(bindings.length - index)})
                           where source_id = ${sql.val(binding.id)}`.execute(trx);
                files.push({ sourceId: binding.id, checksum });
            }

            check('the sum is what the rows claim', await repository.totalCachedBytes(), 40 * MB);

            // ── the cap is the trigger ────────────────────────────────────────
            capBytes = 0;
            check('no cap means no sweep', (await service.sweep()).evicted, 0);

            capBytes = 100 * MB;
            check('under the cap means no sweep', (await service.sweep()).evicted, 0);

            // ── the order is the LRU ──────────────────────────────────────────
            const oldest = await repository.leastRecentlyServed(2, []);
            check('the walk answers oldest first', oldest.map(row => row.sourceId), [files[0]!.sourceId, files[1]!.sourceId]);
            check(
                'and skips what it is told to',
                (await repository.leastRecentlyServed(1, [files[0]!.sourceId])).map(row => row.sourceId),
                [files[1]!.sourceId],
            );

            // ── the sweep itself ──────────────────────────────────────────────
            capBytes = 25 * MB;
            service.protect([files[1]!.sourceId]);
            const swept = await service.sweep();

            check('it dropped only as many as it had to', swept.evicted, 2);
            check('and says what that freed', swept.freedBytes, 20 * MB);
            check('leaving the station under its cap', swept.heldBytes <= capBytes, true);
            check('it did not take the protected record', await store.exists(files[1]!.checksum, 'ogg'), true);
            check('it took the coldest one it was allowed', await store.exists(files[0]!.checksum, 'ogg'), false);

            // The row is the record of a BINDING, not of a file: it survives, minus everything about
            // the bytes, which is the same shape a failed fetch leaves.
            const cleared = await trx
                .selectFrom('deadair.trackAudio')
                .select(['checksum', 'ext', 'byteSize', 'lastServedAt'])
                .where('sourceId', '=', files[0]!.sourceId)
                .executeTakeFirstOrThrow();
            // `== null` rather than `=== null`: a SQL NULL reads back as `undefined` here even
            // though `db.ts` types it `T | null`. See the note in CLAUDE.md.
            check('the row stayed', cleared.checksum == null && cleared.ext == null && cleared.byteSize == null, true);
            check('and kept when it was last wanted', cleared.lastServedAt !== null, true);

            // ── one file, two bindings ────────────────────────────────────────
            // Content addressing makes two identical records one file. Dropping one row must not
            // delete the bytes the other still claims.
            await sql`delete from deadair.track_audio`.execute(trx);
            const shared = await write(10 * MB, 99);
            for (const binding of bindings.slice(0, 2)) {
                await repository.recordSuccess(binding.id, { checksum: shared, ext: 'ogg', contentType: 'audio/ogg', byteSize: 10 * MB });
            }
            await sql`update deadair.track_audio
                         set created_at = now() - interval '2 days',
                             last_served_at = now() - interval '1 day'
                       where source_id = ${sql.val(bindings[0]!.id)}`.execute(trx);

            check(
                'a checksum another row still claims is reported as claimed',
                [...(await repository.checksumsReferenced([shared], [bindings[0]!.id]))],
                [shared],
            );

            capBytes = 15 * MB;
            service.protect([]);
            await service.sweep();
            check('so the shared file survives the eviction of one of its rows', await store.exists(shared, 'ogg'), true);

            throw new Rollback();
        })
        .catch(error => {
            if (!(error instanceof Rollback)) throw error;
        });

    say('nothing was kept: every row this wrote went back with the transaction');
} finally {
    await rm(root, { recursive: true, force: true });
    await db.destroy();
}
