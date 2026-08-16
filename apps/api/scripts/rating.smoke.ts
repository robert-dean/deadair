/**
 * Rating, end to end against the real database.
 *
 * The unit tests mock the repositories, so nothing else runs this SQL: the update narrowed by
 * `merged_into_id`, the single-track read behind the answer, the batched read the running order
 * draws its controls from, and — the part that was silently wrong for as long as it existed — the
 * expression that turns three rating columns into one opinion. This drives the actual service and
 * repository classes over the actual pool, in the order an operator would: read what is there, rate
 * it, read it back, clear it.
 *
 * It restores every row it touches. Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/rating.smoke.ts
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
import { AlbumsRepository } from '../src/modules/catalog/albums.repository.js';
import { TracksRepository } from '../src/modules/catalog/tracks.repository.js';
import { ArtistsService } from '../src/modules/catalog/artists.service.js';
import { AlbumsService } from '../src/modules/catalog/albums.service.js';
import { TracksService } from '../src/modules/catalog/tracks.service.js';
import { CandidatesRepository } from '../src/modules/director/candidates.repository.js';
import { PlayHistoryRepository } from '../src/modules/director/play.history.repository.js';
import { TrackAudioRepository } from '../src/modules/playout/audio/track.audio.repository.js';
import { AnalysisRepository } from '../src/modules/analysis/analysis.repository.js';
import { EnrichmentRepository } from '../src/modules/enrichment/enrichment.repository.js';
import { artistKey, songKey } from '../src/modules/director/rotation.keys.js';
import { weightOf } from '../src/modules/director/rotation.rules.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const pool = new KyselyPool({
    host: env('DATABASE_HOST', 'localhost'),
    port: Number(env('DATABASE_PORT', '55432')),
    user: env('DATABASE_USER', 'postgres'),
    password: env('DATABASE_PASSWORD', 'postgres'),
    database: env('DATABASE_NAME', 'deadair'),
    // Not optional garnish. These are what turn a timestamptz into a Luxon `DateTime` and an int8
    // into a `BigInt`, exactly as `DataModule` builds the runtime pool — a script that leaves them
    // off is reading different types from the same rows, which is how a repro can invent a failure
    // the app does not have.
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new EmptyUpdateRewriteDialect({ pool }, quiet), plugins: [...KyselyDefaultPlugins] });

const artists = new ArtistsRepository(db);
const albums = new AlbumsRepository(db);
const tracks = new TracksRepository(db);
const artistsService = new ArtistsService(artists);
const albumsService = new AlbumsService(albums);
// The readers behind `getTrack` are real here, because this script drives real SQL and there is no
// reason to hand it fakes. The last three are not: this file rates records and never clears one, and
// a real `TrackAudioService` would want a container and a store to build. They are stubbed to
// something that would fail loudly rather than to something that would quietly do nothing.
const unused = new Proxy(
    {},
    {
        get: (_target, property) => {
            throw new Error(`rating.smoke does not clear anything, so nothing here should reach ${String(property)}`);
        },
    },
);
const tracksService = new TracksService(
    tracks,
    new TrackAudioRepository(db),
    new AnalysisRepository(db),
    new PlayHistoryRepository(db),
    new EnrichmentRepository(db),
    unused as never,
    unused as never,
    unused as never,
);
const candidates = new CandidatesRepository(db);

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

const stamp = async (table: 'artists' | 'albums' | 'tracks', id: string) =>
    (await db.selectFrom(`deadair.${table}`).select('updatedAt').where('id', '=', id).executeTakeFirstOrThrow()).updatedAt;

/** The one work this run experiments on: a track that has both a record and an artist to inherit from. */
const track = await db
    .selectFrom('deadair.tracks')
    .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
    .select(['deadair.tracks.id as trackId', 'deadair.tracks.title', 'deadair.tracks.albumId', 'deadair.artists.id as artistId'])
    .where('deadair.tracks.mergedIntoId', 'is', null)
    .where('deadair.tracks.albumId', 'is not', null)
    .limit(1)
    .executeTakeFirstOrThrow();

/** What those three rows held before any of this, so the run can hand them back unchanged. */
const held = {
    track: (await db.selectFrom('deadair.tracks').select('rating').where('id', '=', track.trackId).executeTakeFirstOrThrow()).rating,
    album: (await db.selectFrom('deadair.albums').select('rating').where('id', '=', track.albumId!).executeTakeFirstOrThrow()).rating,
    artist: (await db.selectFrom('deadair.artists').select('rating').where('id', '=', track.artistId).executeTakeFirstOrThrow()).rating,
};

const restore = async () => {
    await db.updateTable('deadair.tracks').set({ rating: held.track }).where('id', '=', track.trackId).execute();
    await db.updateTable('deadair.albums').set({ rating: held.album }).where('id', '=', track.albumId!).execute();
    await db.updateTable('deadair.artists').set({ rating: held.artist }).where('id', '=', track.artistId).execute();
};

/** A transaction thrown away on purpose. */
class Rollback extends Error {}

/**
 * What to ask a draw for.
 *
 * Larger than any real library so the sample is bounded by its own ceiling rather than by this
 * number — the point is to see the whole candidate set, not to size a batch.
 */
const SAMPLE_ATTEMPT = 5_000;

try {
    say(`rating "${track.title}"`);

    // ── the song ──────────────────────────────────────────────────────────────
    const before = await stamp('tracks', track.trackId);
    const liked = await tracksService.rateTrack(track.trackId, { rating: 'liked' });
    check('the answer carries the new opinion', liked.rating, 'liked');
    check('the answer is the whole track, joined', typeof liked.artistName === 'string' && liked.id === track.trackId, true);
    check(
        'the column moved',
        (await db.selectFrom('deadair.tracks').select('rating').where('id', '=', track.trackId).executeTakeFirstOrThrow()).rating,
        1,
    );
    check('updated_at advanced through the trigger', (await stamp('tracks', track.trackId)) > before, true);

    const listed = await tracksService.listTracks({ page: 0, pageSize: 100, sort: 'asc', search: track.title });
    check('a list read spells the opinion the same way', listed.data.find(row => row.id === track.trackId)?.rating, 'liked');

    check('the running order reads it in one batch', (await tracks.ratingsByTrackId([track.trackId])).get(track.trackId), 'liked');
    check('an id the catalog has never seen is simply absent', (await tracks.ratingsByTrackId(['00000000-0000-4000-8000-000000000000'])).size, 0);
    check('no ids is no query and no answer', (await tracks.ratingsByTrackId([])).size, 0);

    check('clearing puts it back to no opinion', (await tracksService.rateTrack(track.trackId, { rating: 'neutral' })).rating, 'neutral');

    // ── the record and the artist ─────────────────────────────────────────────
    check('a record takes an opinion too', (await albumsService.rateAlbum(track.albumId!, { rating: 'disliked' })).rating, 'disliked');
    check('and gives it back', (await albumsService.getAlbum(track.albumId!)).rating, 'disliked');
    await albumsService.rateAlbum(track.albumId!, { rating: 'neutral' });

    check('an artist takes one', (await artistsService.rateArtist(track.artistId, { rating: 'liked' })).rating, 'liked');
    check('and the counts survive the write', (await artistsService.getArtist(track.artistId)).trackCount >= 1, true);
    await artistsService.rateArtist(track.artistId, { rating: 'neutral' });

    // ── what is not there ─────────────────────────────────────────────────────
    const missing = '11111111-1111-4111-8111-111111111111';
    for (const [what, run] of [
        ['artist', () => artistsService.rateArtist(missing, { rating: 'liked' })],
        ['album', () => albumsService.rateAlbum(missing, { rating: 'liked' })],
        ['track', () => tracksService.rateTrack(missing, { rating: 'liked' })],
    ] as const) {
        const status = await run().then(
            () => 200,
            (error: { statusCode?: number }) => error.statusCode,
        );
        check(`rating a ${what} that is not there is a 404`, status, 404);
    }

    // A merged row is never read out, so it is never rated either.
    const merged = await db.selectFrom('deadair.tracks').select('id').where('mergedIntoId', 'is not', null).limit(1).executeTakeFirst();
    check(
        'a merged row is not rated',
        merged === undefined ? 'none in this catalog to try' : await tracks.setRating(merged.id, 1),
        merged === undefined ? 'none in this catalog to try' : false,
    );

    // ── what the three levels add up to ───────────────────────────────────────
    //
    // The half that decides what the station actually plays, and the half no unit test can reach:
    // it is one SQL expression. A dislike at any level has to win outright, and a like at any level
    // has to count for something — an operator who likes a record and watches nothing change has
    // been given a control that does not work.
    say('');
    say(`judging "${track.title}" at each level`);

    const level = async (table: 'tracks' | 'albums' | 'artists', id: string, rating: number) =>
        void (await db.updateTable(`deadair.${table}`).set({ rating }).where('id', '=', id).execute());
    const unrated = async () => {
        await level('tracks', track.trackId, 0);
        await level('albums', track.albumId!, 0);
        await level('artists', track.artistId, 0);
    };
    const effective = async () => (await candidates.ratingsFor([track.trackId])).get(track.trackId);
    /**
     * The candidate as the DRAW sees it, or `not offered`.
     *
     * Sampled repeatedly because the sample is capped below the size of a real library, so one draw
     * legitimately misses a given track. Coming back empty every time means the query excludes it
     * rather than that the dice were unkind.
     */
    const weight = async () => {
        for (let attempt = 0; attempt < 15; attempt += 1) {
            const hit = (await candidates.sample(SAMPLE_ATTEMPT)).find(candidate => candidate.trackId === track.trackId);
            // Keyed the way `CatalogSetGenerator` keys the same draw, rather than cast past the
            // type. `weightOf` reads only the rating today, and the keys are what every other rule
            // in that file judges a candidate on — so a script that faked them would be exercising
            // a candidate the generator could not produce.
            if (hit) return weightOf({ songKey: songKey(hit.title, [hit.artist]), artistKey: artistKey([hit.artist]), rating: hit.rating });
        }
        return 'not offered';
    };

    await unrated();
    check('nothing rated is no opinion, at an ordinary weight', [await effective(), await weight()], [0, 1]);

    for (const [what, table, id] of [
        ['song', 'tracks', track.trackId],
        ['record', 'albums', track.albumId!],
        ['artist', 'artists', track.artistId],
    ] as const) {
        await unrated();
        await level(table, id, 1);
        check(`liking the ${what} alone counts, and doubles the draw weight`, [await effective(), await weight()], [1, 2]);
    }

    for (const [what, table, id, alsoLiked] of [
        ['artist', 'artists', track.artistId, 'tracks'],
        ['record', 'albums', track.albumId!, 'artists'],
        ['song', 'tracks', track.trackId, 'albums'],
    ] as const) {
        await unrated();
        await level(alsoLiked, alsoLiked === 'tracks' ? track.trackId : alsoLiked === 'albums' ? track.albumId! : track.artistId, 1);
        await level(table, id, -1);
        check(`disliking the ${what} beats a like anywhere else`, await effective(), -1);
    }

    // The one case this catalog may not contain: `tracks.album_id` is nullable, and a single with no
    // record must not read as "the missing album has no opinion, so nothing does". Done inside a
    // transaction that is thrown away, since it is the shape rather than any row that is in question.
    await unrated();
    await db
        .transaction()
        .execute(async trx => {
            const scoped = new CandidatesRepository(trx);
            await trx.updateTable('deadair.tracks').set({ albumId: null, rating: 1 }).where('id', '=', track.trackId).execute();
            check('a liked single filed outside any release still counts', (await scoped.ratingsFor([track.trackId])).get(track.trackId), 1);
            throw new Rollback();
        })
        .catch((error: unknown) => {
            if (!(error instanceof Rollback)) throw error;
        });
} finally {
    // Only the three rows this touched, and back to what they held rather than to zero: these are
    // the operator's own opinions, and a smoke run must not be able to erase one. It runs even when
    // a check threw part way through, which is the case that would otherwise leave a rating on the
    // catalog that nobody expressed.
    await restore();
    await db.destroy();
}
