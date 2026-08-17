/**
 * What a style search reaches, end to end against the real database.
 *
 * The unit tests mock the repository, so nothing else runs this SQL, and the SQL is the whole
 * feature: `searchPlayable` matching a style against the genre TAGS a plugin found rather than only
 * the one genre promoted onto the row. It has no symptom when it is wrong. A style that reaches a
 * third of the records it should reads exactly like a thin library from the outside, which is what
 * it did read as — a briefed hour of `heavy metal hits` searched the library, was answered
 * `{"tracks":[]}`, and quietly fell through to ordinary rotation.
 *
 * Two halves, and the second is the one that catches a regression:
 *
 * - a fixture built inside a transaction and rolled back, covering the cases a real library cannot
 *   be relied on to contain (a tag only on the artist, a tag only on the track, a payload whose
 *   `genres` is not an array, a disliked record that must stay hidden however it is tagged);
 * - a read-only count against the live catalog, which is what says whether the widening actually
 *   bought anything HERE rather than only in a fixture.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/library.search.smoke.ts
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

/** Larger than the fixture, so a result is bounded by what matched rather than by the ceiling. */
const LIMIT = 100;

/** A name nothing else will have, so the fixture is findable among a real library's rows. */
const TAG = 'zzsmoke-search';

/** A style no real record is tagged with, so a fixture match is provably the fixture's. */
const STYLE = 'zzsmokecore';

try {
    await db.transaction().execute(async trx => {
        const tracks = new TracksRepository(trx as never);

        /** One artist, with whatever a plugin is pretending to have found about them. */
        const artist = async (name: string, genres: unknown, rating?: number): Promise<string> => {
            const row = await trx
                .insertInto('deadair.artists')
                .values({
                    name: `${TAG} ${name}`,
                    artistKey: normalizeKey(`${TAG} ${name}`),
                    ...(rating === undefined ? {} : { rating }),
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            if (genres !== undefined) {
                await trx
                    .insertInto('deadair.artistEnrichment')
                    .values({ artistId: row.id, provider: `${TAG}.plugin`, data: JSON.stringify({ genres }) as never })
                    .execute();
            }
            return row.id;
        };

        /** One playable record by them, with its own payload and its own promoted genre. */
        const track = async (
            artistId: string,
            title: string,
            options: { genre?: string; genres?: unknown; rating?: number; playable?: boolean } = {},
        ): Promise<string> => {
            const row = await trx
                .insertInto('deadair.tracks')
                .values({
                    artistId,
                    artists: `${TAG} artist`,
                    title: `${TAG} ${title}`,
                    titleKey: normalizeKey(`${TAG} ${title}`),
                    ...(options.genre === undefined ? {} : { genre: options.genre }),
                    ...(options.rating === undefined ? {} : { rating: options.rating }),
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            // A live binding, since everything here has to be a record that could actually air.
            if (options.playable !== false) {
                await trx
                    .insertInto('deadair.trackSources')
                    .values({ trackId: row.id, pluginId: `${TAG}.plugin`, externalId: `${TAG}-${title}` })
                    .execute();
            }

            if (options.genres !== undefined) {
                await trx
                    .insertInto('deadair.trackEnrichment')
                    .values({ trackId: row.id, provider: `${TAG}.plugin`, data: JSON.stringify({ genres: options.genres }) as never })
                    .execute();
            }
            return row.id;
        };

        /** The fixture's titles that a search found, without the tag prefix, sorted. */
        const found = async (query: string): Promise<string[]> =>
            (await tracks.searchPlayable(query, LIMIT))
                .filter(row => row.title.startsWith(TAG))
                .map(row => row.title.slice(TAG.length + 1))
                .sort();

        // ── the tag reaches what the promoted column cannot ───────────────────
        say('finding a record by a style');

        // The shape that motivated all of this: four tags on the artist, one of which is promoted
        // onto every record. Under the old query only `promoted` was findable.
        const tagged = await artist('tagged', ['promoted', STYLE, `${STYLE} revival`]);
        await track(tagged, 'from-artist-tag', { genre: 'promoted' });

        check('a style promoted onto the row is still found', await found('promoted'), ['from-artist-tag']);
        check("a style only in the artist's payload is found", await found(STYLE), ['from-artist-tag']);
        check('a longer style containing the search is found too', await found(`${STYLE} rev`), ['from-artist-tag']);

        // A record tagged under a style its artist is not known for. This is the half that would be
        // lost if the exists only looked at the artist.
        const plain = await artist('plain', ['promoted']);
        await track(plain, 'from-track-tag', { genres: [STYLE] });
        check("a style only in the record's own payload is found", await found(STYLE), ['from-artist-tag', 'from-track-tag']);

        // ── what a style must NOT reach ───────────────────────────────────────
        say('what a tag cannot buy');

        const disliked = await artist('disliked', [STYLE], -1);
        await track(disliked, 'disliked-artist');
        await track(tagged, 'disliked-track', { rating: -1 });
        await track(tagged, 'no-binding', { playable: false });

        check('a tagged record by a disliked artist stays hidden', (await found(STYLE)).includes('disliked-artist'), false);
        check('a tagged record the operator disliked stays hidden', (await found(STYLE)).includes('disliked-track'), false);
        check('a tagged record with no live copy stays hidden', (await found(STYLE)).includes('no-binding'), false);

        // ── payloads written by plugins ───────────────────────────────────────
        say('a payload that is not what it should be');

        // `genres` as a bare string rather than a list. Postgres expands a set-returning function in
        // FROM before WHERE runs, so a guard written as a coalesce would throw here rather than skip
        // it — and one plugin writing this would take down every library search the station makes.
        const malformed = await artist('malformed', STYLE);
        await track(malformed, 'malformed-payload');
        check('a payload whose genres is not a list is skipped, not thrown over', (await found(STYLE)).includes('malformed-payload'), false);

        const missing = await artist('missing', undefined);
        await track(missing, 'no-payload');
        check('a record nothing enriched is unaffected', await found('no-payload'), ['no-payload']);

        // Titles and artists still work, which is the thing a fourth `or` arm could quietly break.
        check('a title still matches', await found('from-artist-tag'), ['from-artist-tag']);
        check('an artist still matches', (await found(`${TAG} plain`)).includes('from-track-tag'), true);
        check('a style nothing carries finds nothing', await found('zzzznope'), []);

        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) throw error;
}

// ── the live library, read only ───────────────────────────────────────────────
//
// The fixture proves the SQL; this says what it is WORTH on the catalog the station actually has.
// Read-only and never asserted against a fixed number, because the answer moves with the library.
try {
    const tracks = new TracksRepository(db);
    say('');
    say('what the live library answers to');

    for (const style of ['heavy metal', 'thrash metal', 'grunge', 'hip hop']) {
        const hits = await tracks.searchPlayable(style, 1_000);
        const promoted = hits.filter(row => row.genre !== null && row.genre?.toLowerCase().includes(style)).length;
        say(`        ${style}: ${hits.length} records, ${promoted} of them findable by the promoted genre alone`);
    }

    // The exact query that started this. It is expected to find NOTHING and that is not a failure:
    // no tag contains the word "hits", and whole-phrase matching is deliberate. What fixes it is the
    // model being shown the station's real vocabulary so it searches `heavy metal`; see
    // `set.prompt.ts`. Printed rather than checked so the day it starts matching is visible.
    const literal = await tracks.searchPlayable('heavy metal hits', 1_000);
    say(`        "heavy metal hits" (the operator's own words): ${literal.length} records`);
} finally {
    await db.destroy();
}
