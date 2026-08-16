/**
 * The advisory policy, end to end against the real database.
 *
 * The unit tests mock the repositories, so nothing else runs this SQL, and the SQL is the whole
 * feature: the `clean-only` predicate on `sample`'s live-binding test and on `bindingsFor`, and the
 * ranking that decides WHICH copy a work resolves to. Two of those have no symptom when they are
 * wrong. A policy that quietly narrowed nothing sounds like a station that was never told; a rank
 * applied in the wrong order plays the explicit copy on a station set to prefer clean, and the only
 * evidence is what comes out of the speakers.
 *
 * It builds its own fixture inside a transaction and rolls it back, so it touches nothing the
 * station owns and can be run against a live library. Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/advisory.smoke.ts
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
import { CandidatesRepository } from '../src/modules/director/candidates.repository.js';
import { TracksRepository } from '../src/modules/catalog/tracks.repository.js';
import { normalizeKey } from '../src/modules/catalog/catalog.keys.js';

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

/**
 * What to ask a draw for. Larger than any real library so the sample is bounded by its own ceiling
 * rather than by this number: the point is to see the whole candidate set.
 */
const SAMPLE_ATTEMPT = 5_000;

/** A name nothing else will have, so the fixture is findable among a real library's rows. */
const TAG = 'zzsmoke-advisory';

try {
    await db.transaction().execute(async trx => {
        const candidates = new CandidatesRepository(trx as never);
        const tracks = new TracksRepository(trx as never);

        const artist = await trx
            .insertInto('deadair.artists')
            .values({ name: `${TAG} artist`, artistKey: normalizeKey(`${TAG} artist`) })
            .returning('id')
            .executeTakeFirstOrThrow();

        /** One work, plus the copies of it this run wants to choose between. */
        const work = async (title: string, copies: { plugin: string; advisory: 'explicit' | 'clean' | null }[]) => {
            const track = await trx
                .insertInto('deadair.tracks')
                .values({
                    artistId: artist.id,
                    artists: `${TAG} artist`,
                    title: `${TAG} ${title}`,
                    titleKey: normalizeKey(`${TAG} ${title}`),
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            for (const copy of copies) {
                await trx
                    .insertInto('deadair.trackSources')
                    .values({
                        trackId: track.id,
                        pluginId: copy.plugin,
                        externalId: `${TAG}-${title}-${copy.plugin}-${copy.advisory ?? 'unknown'}`,
                        advisory: copy.advisory,
                    })
                    .execute();
            }
            return track.id;
        };

        // Four works, each one a case the policy has to get right.
        const both = await work('both', [
            { plugin: 'a', advisory: 'explicit' },
            { plugin: 'a', advisory: 'clean' },
        ]);
        const explicitOnly = await work('explicit-only', [{ plugin: 'a', advisory: 'explicit' }]);
        const unknownOnly = await work('unknown-only', [{ plugin: 'a', advisory: null }]);
        // The ordering case: the clean copy is on the SECOND-choice provider and the explicit one on
        // the first. This is the whole reason the advisory rank sits ahead of the provider rank.
        const split = await work('split', [
            { plugin: 'first', advisory: 'explicit' },
            { plugin: 'second', advisory: 'clean' },
        ]);

        const ids = [both, explicitOnly, unknownOnly, split];
        const advisoryOf = async (trackId: string, binding: { pluginId: string; externalId: string } | undefined) =>
            binding === undefined
                ? undefined
                : ((
                      await trx
                          .selectFrom('deadair.trackSources')
                          .select('advisory')
                          .where('pluginId', '=', binding.pluginId)
                          .where('externalId', '=', binding.externalId)
                          .where('trackId', '=', trackId)
                          .executeTakeFirstOrThrow()
                  ).advisory ?? 'unknown');

        // ── bindingsFor: which copy a work resolves to ────────────────────────
        say('choosing a copy');

        const preferExplicit = await candidates.bindingsFor(ids, [], 'prefer-explicit');
        check('prefer-explicit takes the explicit copy', await advisoryOf(both, preferExplicit.get(both)), 'explicit');

        const preferClean = await candidates.bindingsFor(ids, [], 'prefer-clean');
        check('prefer-clean takes the clean copy', await advisoryOf(both, preferClean.get(both)), 'clean');
        check('prefer-clean still plays a work that only exists explicit', await advisoryOf(explicitOnly, preferClean.get(explicitOnly)), 'explicit');
        check('prefer-clean still plays an unmarked work', await advisoryOf(unknownOnly, preferClean.get(unknownOnly)), 'unknown');
        // Which is also what makes the clean-only drops below mean something: these two works ARE
        // playable, so refusing them there is the policy and not an absent binding.
        check('both are playable in the first place', preferExplicit.has(explicitOnly) && preferExplicit.has(unknownOnly), true);

        // The ordering decision, stated twice: with the operator preferring `first`, a clean-leaning
        // station must still cross to `second` for the clean copy, and an explicit-leaning one must
        // stay on `first`. If the two ranks were swapped, both lines would answer `first`.
        const split1 = await candidates.bindingsFor(ids, ['first', 'second'], 'prefer-clean');
        check('the advisory outranks the provider preference', split1.get(split)?.pluginId, 'second');
        const split2 = await candidates.bindingsFor(ids, ['first', 'second'], 'prefer-explicit');
        check('and the provider preference still decides when the advisory cannot', split2.get(split)?.pluginId, 'first');

        // ── clean-only: which works may air at all ────────────────────────────
        say('refusing what is not vouched for');

        const cleanOnly = await candidates.bindingsFor(ids, [], 'clean-only');
        check('clean-only plays the work that has a clean copy', await advisoryOf(both, cleanOnly.get(both)), 'clean');
        check('clean-only refuses a work that is only explicit', cleanOnly.has(explicitOnly), false);
        // The rule the whole strict reading rests on: silence is not consent.
        check('clean-only refuses an UNMARKED work rather than assuming it is clean', cleanOnly.has(unknownOnly), false);
        // A work whose ONLY clean copy is on the operator's second-choice provider still airs, and
        // airs from that provider. Under clean-only the preference cannot win, because the copy it
        // prefers is not eligible at all.
        check(
            'clean-only crosses to another provider for the only clean copy',
            (await candidates.bindingsFor(ids, ['first', 'second'], 'clean-only')).get(split)?.pluginId,
            'second',
        );

        // ── sample: what the draw may even see ────────────────────────────────
        say('drawing');

        const drawn = async (policy: 'prefer-explicit' | 'clean-only') => {
            const rows = await candidates.sample(SAMPLE_ATTEMPT, policy);
            return new Set(rows.filter(row => row.title.startsWith(TAG)).map(row => row.trackId));
        };

        // Deliberately NOT "an unconstrained draw sees all four". `sample` is `order by random()`
        // under a 500-row ceiling, so against a real library that assertion is a coin toss and a
        // flaky check is worse than none. What matters is that the works clean-only drops are
        // otherwise perfectly playable, and `bindingsFor` above has already established that for
        // each of them by handing back a binding.
        const cleanDraw = await drawn('clean-only');
        check('a clean-only draw keeps a work with a clean copy', cleanDraw.has(both), true);
        // Kept because it HAS a clean copy, wherever that copy lives. The draw asks whether the work
        // can air at all; which provider serves it is `bindingsFor`'s question.
        check('a clean-only draw keeps a work whose clean copy is elsewhere', cleanDraw.has(split), true);
        check('a clean-only draw drops a work that is only explicit', cleanDraw.has(explicitOnly), false);
        check('a clean-only draw drops an unmarked work', cleanDraw.has(unknownOnly), false);

        // ── searchPlayable: what the model is even offered ────────────────────
        say('offering the model');

        const offered = async (cleanOnlyFlag: boolean) => new Set((await tracks.searchPlayable(TAG, 100, cleanOnlyFlag)).map(row => row.title));
        const all = await offered(false);
        check('the tool offers every work when the station has no such rule', all.size, 4);
        const narrowed = await offered(true);
        check('and under clean-only offers exactly the ones with a clean copy', [...narrowed], [`${TAG} both`, `${TAG} split`]);

        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) throw error;
} finally {
    await db.destroy();
}

say(process.exitCode ? 'FAILED' : 'all ok');
