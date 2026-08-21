/**
 * The period a broadcast plays, end to end against the real database.
 *
 * The unit tests mock the repositories, so nothing else runs this SQL, and the SQL is where the one
 * decision the whole feature rests on actually lives: **a record whose year the catalog does not know
 * is eligible for any period.** That is the opposite call to `clean-only` beside it, and getting it
 * backwards has no symptom worth the name — a station narrowed to a decade over a library nothing has
 * enriched would simply run short, which looks exactly like a thin catalogue.
 *
 * Three surfaces, and they have to agree. `CandidatesRepository.sample` narrows the deterministic
 * draw, `yearsFor` is what `PickResolver` judges a model's picks with, and
 * `TracksRepository.searchPlayable` is what the model is offered in the first place. A record
 * eligible for one and not the others is a refill that silently comes back short.
 *
 * It builds its own fixture inside a transaction and rolls it back, so it touches nothing the station
 * owns and can be run against a live library. Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/era.smoke.ts
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
const TAG = 'zzsmoke-era';

try {
    await db.transaction().execute(async trx => {
        const candidates = new CandidatesRepository(trx as never);
        const tracks = new TracksRepository(trx as never);

        const artist = await trx
            .insertInto('deadair.artists')
            .values({ name: `${TAG} artist`, artistKey: normalizeKey(`${TAG} artist`) })
            .returning('id')
            .executeTakeFirstOrThrow();

        /** An album carrying a year, for the case where a provider dated the release and not the track. */
        const album = async (title: string, year: number | null) =>
            (
                await trx
                    .insertInto('deadair.albums')
                    .values({ artistId: artist.id, name: `${TAG} ${title}`, nameKey: normalizeKey(`${TAG} ${title}`), year })
                    .returning('id')
                    .executeTakeFirstOrThrow()
            ).id;

        /** One playable work, dated wherever the case wants it dated. */
        const work = async (title: string, options: { year?: number; albumYear?: number } = {}) => {
            const albumId = options.albumYear === undefined ? undefined : await album(`${title} album`, options.albumYear);
            const track = await trx
                .insertInto('deadair.tracks')
                .values({
                    artistId: artist.id,
                    ...(albumId === undefined ? {} : { albumId }),
                    artists: `${TAG} artist`,
                    title: `${TAG} ${title}`,
                    titleKey: normalizeKey(`${TAG} ${title}`),
                    ...(options.year === undefined ? {} : { year: options.year }),
                })
                .returning('id')
                .executeTakeFirstOrThrow();

            // Everything here has to be a record that could actually air, or the draw would drop it
            // for a reason that has nothing to do with the period.
            await trx
                .insertInto('deadair.trackSources')
                .values({ trackId: track.id, pluginId: `${TAG}.plugin`, externalId: `${TAG}-${title}` })
                .execute();

            return track.id;
        };

        const seventies = await work('seventies', { year: 1975 });
        const nineties = await work('nineties', { year: 1994 });
        // Dated on the RELEASE rather than the recording, which is what every provider that sends a
        // date is actually sending.
        const fromAlbum = await work('from-album', { albumYear: 1979 });
        // The ordinary case on a library nothing has enriched, and the one this whole script exists
        // to pin.
        const undated = await work('undated');
        // Both, disagreeing. The track's is the more specific claim and enrichment is what writes it,
        // so `coalesce` has to take it over the album's.
        const both = await work('both', { year: 1975, albumYear: 2011 });

        const ids = [seventies, nineties, fromAlbum, undated, both];

        // ── sample: what the deterministic draw may even see ──────────────────
        say('narrowing the draw');

        const drawn = async (era?: { from?: number; to?: number }) => {
            const rows = await candidates.sample(SAMPLE_ATTEMPT, 'prefer-explicit', era);
            return new Set(rows.filter(row => row.title.startsWith(TAG)).map(row => row.trackId));
        };

        const seventiesDraw = await drawn({ from: 1970, to: 1979 });
        check('a period keeps a record dated inside it', seventiesDraw.has(seventies), true);
        check('and drops one dated outside it', seventiesDraw.has(nineties), false);
        check("takes the album's year for a track that has none", seventiesDraw.has(fromAlbum), true);
        // The decision the whole feature rests on. Backwards, a station narrowed to a decade over an
        // unenriched library plays nothing and looks like a thin catalogue.
        check('KEEPS a record the catalog has no year for at all', seventiesDraw.has(undated), true);
        check("prefers the track's own year over its album's when they disagree", seventiesDraw.has(both), true);

        check('an open-ended start stands alone', (await drawn({ from: 1990 })).has(seventies), false);
        check('an open-ended end stands alone', (await drawn({ to: 1979 })).has(nineties), false);
        check('an undated record passes an open-ended bound too', (await drawn({ from: 1990 })).has(undated), true);

        const unbounded = await drawn();
        check('no period narrows nothing', unbounded.has(seventies) && unbounded.has(nineties), true);
        check('and neither does a window with no ends set', (await drawn({})).has(nineties), true);

        // ── yearsFor: what the resolver judges a model's picks with ───────────
        say('judging a pick');

        const years = await candidates.yearsFor(ids);
        check('reads a year off the track', years.get(seventies), 1975);
        check("reads it off the album when the track has none", years.get(fromAlbum), 1979);
        check("prefers the track's own where both exist", years.get(both), 1975);
        // Absent rather than a number, which is the distinction `PickResolver` acts on: "the catalog
        // has no year" and "this record is from 1900" are different facts.
        check('answers with NOTHING for a record it has no year for', years.has(undated), false);

        // ── searchPlayable: what the model is offered in the first place ──────
        say('offering the model');

        const offered = async (era: { yearFrom?: number; yearTo?: number }) =>
            new Set((await tracks.searchPlayable(TAG, 100, false, era)).map(row => row.title));

        const shown = await offered({ yearFrom: 1970, yearTo: 1979 });
        check('the search agrees with the draw about what is inside a period', shown.has(`${TAG} seventies`), true);
        check('and about what is outside it', shown.has(`${TAG} nineties`), false);
        // The three surfaces have to agree. A record eligible for the draw and not for the search is
        // a model offered less than the station can play; the other way round is a refill that comes
        // back short with nothing saying why.
        check('and about an undated record', shown.has(`${TAG} undated`), true);

        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) throw error;
} finally {
    await db.destroy();
}

say(process.exitCode ? 'FAILED' : 'all ok');
