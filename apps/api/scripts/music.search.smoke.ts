/**
 * What `search_music` asks the catalog, end to end against the real database.
 *
 * `MusicSearchTool`'s unit tests mock the repository, so nothing else runs this SQL, and the SQL is
 * where the merge can be wrong in a way nothing shows. Two reads are covered:
 *
 * - `TracksRepository.ownership`, which answers whether the station already holds a record a
 *   provider offered. It has to agree with `CandidatesRepository.findByName`, because that is the
 *   comparison `PickResolver.identify` actually makes when the pick comes back — an `owned: true`
 *   the resolver then misses is the tool telling the model a record is free when it is a download,
 *   and an `owned: false` it hits is the opposite. Neither has a symptom.
 * - `TracksRepository.dislikedArtistKeys`, which is the only thing standing between a banned artist
 *   and a provider row, since a record the station never catalogued joins to no track and the
 *   ownership read cannot see it at all.
 *
 * A fixture inside a transaction that is rolled back, so a live library is never touched.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/music.search.smoke.ts
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
import { CandidatesRepository } from '../src/modules/director/candidates.repository.js';
import { catalogKey, normalizeKey } from '../src/modules/catalog/catalog.keys.js';

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
const TAG = 'zzsmoke-music';

try {
    await db.transaction().execute(async trx => {
        const tracks = new TracksRepository(trx as never);
        const candidates = new CandidatesRepository(trx as never);

        const artist = async (name: string, rating?: number): Promise<{ id: string; name: string }> => {
            const full = `${TAG} ${name}`;
            const row = await trx
                .insertInto('deadair.artists')
                .values({ name: full, artistKey: normalizeKey(full), ...(rating === undefined ? {} : { rating }) })
                .returning('id')
                .executeTakeFirstOrThrow();
            return { id: row.id, name: full };
        };

        const album = async (artistId: string, name: string, rating: number): Promise<string> => {
            const row = await trx
                .insertInto('deadair.albums')
                .values({ artistId, name: `${TAG} ${name}`, nameKey: normalizeKey(`${TAG} ${name}`), rating })
                .returning('id')
                .executeTakeFirstOrThrow();
            return row.id;
        };

        const track = async (
            artistId: string,
            title: string,
            options: { rating?: number; albumId?: string; merged?: string } = {},
        ): Promise<string> => {
            const full = `${TAG} ${title}`;
            const row = await trx
                .insertInto('deadair.tracks')
                .values({
                    artistId,
                    artists: `${TAG} artist`,
                    title: full,
                    titleKey: normalizeKey(full),
                    ...(options.rating === undefined ? {} : { rating: options.rating }),
                    ...(options.albumId === undefined ? {} : { albumId: options.albumId }),
                    ...(options.merged === undefined ? {} : { mergedIntoId: options.merged }),
                })
                .returning('id')
                .executeTakeFirstOrThrow();
            return row.id;
        };

        const key = (title: string, name: string) => catalogKey(normalizeKey(`${TAG} ${title}`), normalizeKey(name));

        // ── owned means what the resolver will find ───────────────────────────
        say('what the station already has');

        const held = await artist('held');
        await track(held.id, 'a-record');

        const ownership = await tracks.ownership([{ title: `${TAG} a-record`, artist: held.name }]);
        check('a record the catalog holds comes back owned', ownership.owned.has(key('a-record', held.name)), true);
        check('nothing about it is banned', ownership.banned.size, 0);

        // The agreement that matters: this is the comparison `PickResolver.identify` makes when the
        // model names the record back, so a disagreement means the flag describes a different world
        // from the one the pick lands in.
        const byName = await candidates.findByName(`${TAG} a-record`, held.name);
        check('the batch read agrees with the one findByName does per record', byName !== undefined, true);

        const missing = await tracks.ownership([{ title: `${TAG} never-catalogued`, artist: held.name }]);
        check('a record the catalog has never seen is not owned', missing.owned.size, 0);

        // Both halves are normalized, so the spelling a provider happens to use still resolves.
        const spelled = await tracks.ownership([{ title: `${TAG.toUpperCase()} A-RECORD`, artist: held.name.toUpperCase() }]);
        check('a different spelling of the same record still resolves', spelled.owned.has(key('a-record', held.name)), true);

        const merged = await artist('merged-into');
        const survivor = await track(merged.id, 'survivor');
        await track(merged.id, 'duplicate', { merged: survivor });
        const mergedRead = await tracks.ownership([{ title: `${TAG} duplicate`, artist: merged.name }]);
        check('a row merged into another is not offered as owned', mergedRead.owned.size, 0);

        // ── what the answer must not carry ────────────────────────────────────
        say('what a ban reaches');

        const rated = await artist('rated');
        await track(rated.id, 'disliked-track', { rating: -1 });
        const hatedAlbum = await album(rated.id, 'disliked-album', -1);
        await track(rated.id, 'on-a-disliked-album', { albumId: hatedAlbum });

        const banned = await tracks.ownership([
            { title: `${TAG} disliked-track`, artist: rated.name },
            { title: `${TAG} on-a-disliked-album`, artist: rated.name },
        ]);
        check('a disliked record is banned', banned.banned.has(key('disliked-track', rated.name)), true);
        check('a record on a disliked album is banned', banned.banned.has(key('on-a-disliked-album', rated.name)), true);

        const hated = await artist('hated', -1);
        const liked = await artist('liked', 1);
        const keys = await tracks.dislikedArtistKeys([hated.name, liked.name, `${TAG} nobody-has-heard-of`]);
        check('a disliked artist is named', keys.has(normalizeKey(hated.name)), true);
        check('a liked artist is not', keys.has(normalizeKey(liked.name)), false);
        check('an artist the catalog never heard of is not', keys.size, 1);

        // ── the empty cases, which run on every search that finds nothing ─────
        say('nothing to ask about');

        check('no pairs is no query', (await tracks.ownership([])).owned.size, 0);
        check('no names is no query', (await tracks.dislikedArtistKeys([])).size, 0);
        check('a pair with no usable key is skipped', (await tracks.ownership([{ title: '!!!', artist: '???' }])).owned.size, 0);

        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) throw error;
}

await db.destroy();
