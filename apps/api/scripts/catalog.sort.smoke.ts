/**
 * What the catalog lists are ordered BY, end to end against the real database.
 *
 * The unit tests cover `columnFor`, which is the mapping and nothing else, so nothing else runs the
 * SQL that mapping feeds. That SQL is where two of the three orderings actually live: an artist's
 * album and track counts are correlated subqueries ordered by their own aliases, and a track's
 * artist and album are ordered by a JOINED name rather than by the foreign key sitting on the row.
 * Both are the kind of thing that returns a plausible page in the wrong order rather than failing,
 * which is exactly the failure a console cannot show.
 *
 * The tiebreak is the other half and is the reason a paged list can be trusted at all: `order by
 * count` alone leaves rows with equal counts in whatever order the planner liked this time, so a
 * record can appear on page one and again on page two while another is never shown. Every list here
 * therefore orders by its key and then by its id, and this script pins that on the key that ties
 * hardest, which is a count.
 *
 * It builds its own fixture inside a transaction and rolls it back, so it touches nothing the
 * station owns and can be run against a live library. Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/catalog.sort.smoke.ts
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
import { ArtistsRepository } from '../src/modules/catalog/artists.repository.js';
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

/** A name nothing else will have, so the fixture is findable among a real library's rows. */
const TAG = 'zzsmoke-sort';

/** The measurement schema a track list asks about. Nothing here is measured, so the value is inert. */
const SCHEMA_VERSION = 1;

/**
 * Every read is NARROWED to the fixture by the search box rather than paged over the whole library.
 *
 * The first shape of this script paged the real catalog and filtered the rows afterwards, which
 * passed on the artist lists and failed on the tracks for a reason that had nothing to do with
 * ordering: a tag beginning `zz` sorts to the end of several thousand titles, so the fixture was
 * simply not on the page. Narrowing first makes the assertions read the whole fixture and only the
 * fixture, whatever else the station holds.
 */
const PAGE = { limit: 500, offset: 0, search: TAG } as const;

try {
    await db.transaction().execute(async trx => {
        const artists = new ArtistsRepository(trx as never);
        const tracks = new TracksRepository(trx as never);

        /** One artist, with however many albums and loose tracks the case wants counted. */
        const artist = async (name: string, albums: number, looseTracks: number) => {
            const row = await trx
                .insertInto('deadair.artists')
                .values({ name: `${TAG} ${name}`, artistKey: normalizeKey(`${TAG} ${name}`) })
                .returning('id')
                .executeTakeFirstOrThrow();

            for (let index = 0; index < albums; index += 1) {
                await trx
                    .insertInto('deadair.albums')
                    .values({
                        artistId: row.id,
                        name: `${TAG} ${name} album ${index}`,
                        nameKey: normalizeKey(`${TAG} ${name} album ${index}`),
                    })
                    .execute();
            }

            for (let index = 0; index < looseTracks; index += 1) {
                await trx
                    .insertInto('deadair.tracks')
                    .values({
                        artistId: row.id,
                        artists: `${TAG} ${name}`,
                        title: `${TAG} ${name} track ${index}`,
                        titleKey: normalizeKey(`${TAG} ${name} track ${index}`),
                    })
                    .execute();
            }

            return row.id;
        };

        // Named so that alphabetical order and count order DISAGREE. An assertion that passes under
        // both proves nothing, which is the trap a fixture like this exists to avoid.
        const alpha = await artist('alpha', 1, 3);
        const bravo = await artist('bravo', 3, 1);
        const charlie = await artist('charlie', 2, 2);

        const artistOrder = async (sortBy: string | undefined, sort: 'asc' | 'desc') => {
            const { data } = await artists.listArtists({ ...PAGE, sort, sortBy });
            return data.filter(row => row.name.startsWith(TAG)).map(row => row.name.replace(`${TAG} `, ''));
        };

        // ── artists: the two orderings that are correlated subqueries ─────────
        say('ordering artists');

        check('no key asked for is name order, which is what every list opens in', await artistOrder(undefined, 'asc'), [
            'alpha',
            'bravo',
            'charlie',
        ]);
        check('albums orders by the album count subquery, not by name', await artistOrder('albums', 'asc'), ['alpha', 'charlie', 'bravo']);
        check('tracks orders by the track count subquery', await artistOrder('tracks', 'desc'), ['alpha', 'charlie', 'bravo']);
        check('a key an artist has no column for falls back to name order', await artistOrder('year', 'asc'), ['alpha', 'bravo', 'charlie']);

        // ── artists: the tiebreak, on the key that ties hardest ───────────────
        say('breaking ties');

        // Three artists on the same count. Without the id tiebreak their order between pages is
        // whatever the planner chose, which is how a paged list drops one row and repeats another.
        const tied = ['tied-a', 'tied-b', 'tied-c'];
        for (const name of tied) await artist(name, 1, 1);

        const firstPass = await artistOrder('albums', 'asc');
        const secondPass = await artistOrder('albums', 'asc');
        check('the same query twice answers the same order', firstPass, secondPass);

        // ── tracks: the two orderings that are joined names ───────────────────
        say('ordering tracks');

        const trackOrder = async (sortBy: string | undefined, sort: 'asc' | 'desc') => {
            const { data } = await tracks.listTracks({ ...PAGE, sort, sortBy, schemaVersion: SCHEMA_VERSION });
            return data.filter(row => row.title.startsWith(TAG)).map(row => row.title.replace(`${TAG} `, ''));
        };

        // One artist whose name sorts LAST owning a track whose title sorts FIRST, so ordering by
        // the joined artist name and ordering by the title cannot agree.
        const zulu = await artist('zulu', 0, 0);
        await trx
            .insertInto('deadair.tracks')
            .values({
                artistId: zulu,
                artists: `${TAG} zulu`,
                title: `${TAG} aaa-first`,
                titleKey: normalizeKey(`${TAG} aaa-first`),
                durationMs: 600_000,
                year: 1969,
            })
            .execute();

        const byTitle = await trackOrder(undefined, 'asc');
        const byArtist = await trackOrder('artist', 'asc');
        check('title order opens with the title that sorts first', byTitle.at(0), 'aaa-first');
        check('artist order puts that same track last, because its artist sorts last', byArtist.at(-1), 'aaa-first');

        // The longest and the oldest, both plain columns, both null on every other row in the
        // fixture. This is what `directionFor` is for: Postgres puts nulls FIRST descending, so
        // before it "longest first" opened on a screenful of records with no duration at all and
        // the one row that answered the question was underneath them. Unknown goes to the end
        // whichever way the list is pointed, so the same row leads both directions here.
        check('duration orders by the column, longest first', (await trackOrder('duration', 'desc')).at(0), 'aaa-first');
        check('year orders by the column, newest first', (await trackOrder('year', 'desc')).at(0), 'aaa-first');
        check('and what the station does not know stays at the end ascending too', (await trackOrder('duration', 'asc')).at(0), 'aaa-first');
        check('a word the vocabulary does not contain falls back to title order', (await trackOrder('lastPlayed', 'asc')).at(0), 'aaa-first');

        void [alpha, bravo, charlie];
        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) throw error;
} finally {
    await db.destroy();
}

say(process.exitCode === 1 ? '\nsomething is wrong' : '\nthe catalog sorts as it says it does');
