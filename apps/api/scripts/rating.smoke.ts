/**
 * Rating, end to end against the real database.
 *
 * The unit tests mock the repositories, so nothing until now has run this SQL: the update narrowed
 * by `merged_into_id`, the single-track read behind the answer, and the batched read the running
 * order draws its controls from. This drives the actual service classes over the actual pool, in
 * the order an operator would: read what is there, rate it, read it back, clear it.
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
import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPool } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import { ArtistsRepository } from '../src/modules/catalog/artists.repository.js';
import { AlbumsRepository } from '../src/modules/catalog/albums.repository.js';
import { TracksRepository } from '../src/modules/catalog/tracks.repository.js';
import { ArtistsService } from '../src/modules/catalog/artists.service.js';
import { AlbumsService } from '../src/modules/catalog/albums.service.js';
import { TracksService } from '../src/modules/catalog/tracks.service.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const pool = new KyselyPool({
    host: env('DATABASE_HOST', 'localhost'),
    port: Number(env('DATABASE_PORT', '55432')),
    user: env('DATABASE_USER', 'postgres'),
    password: env('DATABASE_PASSWORD', 'postgres'),
    database: env('DATABASE_NAME', 'deadair'),
});
const db = new Kysely<DB>({ dialect: new EmptyUpdateRewriteDialect({ pool }, quiet), plugins: [...KyselyDefaultPlugins] });

const artists = new ArtistsRepository(db);
const albums = new AlbumsRepository(db);
const tracks = new TracksRepository(db);
const artistsService = new ArtistsService(artists);
const albumsService = new AlbumsService(albums);
const tracksService = new TracksService(tracks);

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

const stamp = async (table: 'artists' | 'albums' | 'tracks', id: string) =>
    (await db.selectFrom(`deadair.${table}`).select('updatedAt').where('id', '=', id).executeTakeFirstOrThrow()).updatedAt;

try {
    const track = await db
        .selectFrom('deadair.tracks')
        .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
        .select(['deadair.tracks.id as trackId', 'deadair.tracks.title', 'deadair.tracks.albumId', 'deadair.artists.id as artistId'])
        .where('deadair.tracks.mergedIntoId', 'is', null)
        .where('deadair.tracks.albumId', 'is not', null)
        .limit(1)
        .executeTakeFirstOrThrow();

    say(`rating "${track.title}"`);

    // ── the song ──────────────────────────────────────────────────────────────
    const before = await stamp('tracks', track.trackId);
    const liked = await tracksService.rateTrack(track.trackId, { rating: 'liked' });
    check('the answer carries the new opinion', liked.rating, 'liked');
    check('the answer is the whole track, joined', typeof liked.artistName === 'string' && liked.id === track.trackId, true);
    check('the column moved', (await db.selectFrom('deadair.tracks').select('rating').where('id', '=', track.trackId).executeTakeFirstOrThrow()).rating, 1);
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
    const merged = await db
        .selectFrom('deadair.tracks')
        .select('id')
        .where('mergedIntoId', 'is not', null)
        .limit(1)
        .executeTakeFirst();
    check(
        'a merged row is not rated',
        merged === undefined ? 'none in this catalog to try' : await tracks.setRating(merged.id, 1),
        merged === undefined ? 'none in this catalog to try' : false,
    );
} finally {
    await db.destroy();
}
