import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { AlbumsService } from '#src/modules/music/albums.service.js';
import { ArtistsService } from '#src/modules/music/artists.service.js';
import { TracksService } from '#src/modules/music/tracks.service.js';
import { Album, Artist, Track } from '../modules/music/types/music.types.js';
import { Pagination, PaginationInput } from '../modules/shared/types/pagination.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [music.ck](file://./../../data/contracts/music/music.ck)
 */
export const MusicRouter = ServerKitRouter();

/**
 * from [music.ck](file://./../../data/contracts/music/music.ck#L13)
 * anonymous access, no security required
 */
MusicRouter.get('/music/artists', async ctx => {
    const query = await parseAndValidate(ctx.query, PaginationInput.strict());

    const resultType = z.strictObject({
        meta: Pagination,
        data: z.array(Artist),
    });
    const service = ctx.container.get(ArtistsService);
    const result: z.infer<typeof resultType> = await service.listArtists(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [music.ck](file://./../../data/contracts/music/music.ck#L30)
 * anonymous access, no security required
 */
MusicRouter.get('/music/albums', async ctx => {
    const query = await parseAndValidate(ctx.query, PaginationInput.strict());

    const resultType = z.strictObject({
        meta: Pagination,
        data: z.array(Album),
    });
    const service = ctx.container.get(AlbumsService);
    const result: z.infer<typeof resultType> = await service.listAlbums(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [music.ck](file://./../../data/contracts/music/music.ck#L47)
 * anonymous access, no security required
 */
MusicRouter.get('/music/tracks', async ctx => {
    const query = await parseAndValidate(ctx.query, PaginationInput.strict());

    const resultType = z.strictObject({
        meta: Pagination,
        data: z.array(Track),
    });
    const service = ctx.container.get(TracksService);
    const result: z.infer<typeof resultType> = await service.listTracks(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
