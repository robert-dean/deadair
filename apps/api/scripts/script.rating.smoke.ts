/**
 * What the operator thought of a break, end to end against the real database.
 *
 * The unit tests mock the repositories, so nothing else runs this SQL, and there are three things in
 * it that only a real Postgres will answer. The upsert has to REPLACE rather than accumulate, which
 * is the primary key doing its job. The join that carries a rating onto a page of history has to be
 * a left one that cannot multiply rows. And the cascade has to take a rating with its script, which
 * is the one thing here that is deliberately not `set null`: a rating whose attempt is gone is an
 * orphan rather than a fact that outlived its subject.
 *
 * The fourth thing it pins is the distinction the whole feature rests on: NEUTRAL IS A REAL ANSWER.
 * Rating something back to nothing has to survive being read back, and read differently from never
 * having listened, which is the absence of a row.
 *
 * It builds its own fixture inside a transaction and rolls it back, so it touches nothing the
 * station owns. Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/script.rating.smoke.ts
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
import { ScriptHistoryRepository } from '../src/modules/render/script.history.repository.js';
import { ScriptRatingsRepository } from '../src/modules/render/script.ratings.repository.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

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

/** A transaction thrown away on purpose, so a live history is never touched. */
class Rollback extends Error {}

/** A label nothing else will have, so the fixture is findable among a real station's writing. */
const TAG = 'zzsmoke-rating';

try {
    await db.transaction().execute(async trx => {
        // Enough of the real thing for these reads: the station key every row is scoped by, and a
        // broadcast id that is deliberately absent, since a fixture attempt belongs to no programme.
        const identity = { stationKey: 'main', current: () => undefined } as unknown as StationIdentity;
        const history = new ScriptHistoryRepository(trx as never, identity);
        const ratings = new ScriptRatingsRepository(trx as never, identity);

        /** One attempt, as a writer would have recorded it. */
        const attempt = async (label: string) => {
            await history.record({ kind: 'talkbreak', writer: 'model', outcome: 'written', label: `${TAG} ${label}`, script: `${TAG} ${label}` });
            const row = await trx.selectFrom('deadair.scriptHistory').select('id').where('label', '=', `${TAG} ${label}`).executeTakeFirstOrThrow();
            return row.id;
        };

        const good = await attempt('good');
        const bad = await attempt('bad');
        const unrated = await attempt('unrated');

        /** The rating this page carries for one attempt, read back the way the console reads it. */
        const ratingOf = async (id: string) => (await history.page({ limit: 1, scriptId: id })).at(0)?.rating;

        say('an opinion, and changing it');

        check('an attempt nobody has judged carries no rating at all', await ratingOf(unrated), undefined);

        check('rating an attempt that exists is accepted', await ratings.rate(good, 1), true);
        check('and the page carries it', await ratingOf(good), 1);

        // The primary key is one row per station per attempt, so this replaces rather than adds.
        check('changing an opinion replaces it', await ratings.rate(good, -1), true);
        check('and the page carries the new one', await ratingOf(good), -1);

        // The distinction the feature rests on: rating something back to nothing is an answer.
        check('rating something back to neutral is a real answer', await ratings.rate(good, 0), true);
        check('and reads as 0 rather than as absent', await ratingOf(good), 0);

        say('what it refuses');

        check('rating an attempt that does not exist is refused', await ratings.rate('11111111-1111-4111-8111-111111111111', 1), false);

        say('the join, and the page it rides on');

        await ratings.rate(bad, -1);
        const page = await history.page({ limit: 50 });
        const mine = page.filter(row => row.label?.startsWith(TAG));

        // A left join against a table with one row per attempt cannot multiply, and if it could the
        // page would silently report the same break twice.
        check('three attempts come back as three rows', mine.length, 3);
        check('each carrying its own answer', mine.map(row => row.rating ?? 'none').sort(), [-1, 0, 'none']);

        say('what happens when the sweep takes the script');

        await trx.deleteFrom('deadair.scriptHistory').where('id', '=', bad).execute();
        const left = await trx.selectFrom('deadair.scriptRatings').select('scriptId').where('scriptId', '=', bad).executeTakeFirst();
        check('a rating goes with the attempt it was about', left, undefined);

        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) throw error;
} finally {
    await db.destroy();
}

say(process.exitCode === 1 ? '\nsomething is wrong' : '\nan opinion is held, replaced and swept with its subject');
