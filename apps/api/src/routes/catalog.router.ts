import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { AlbumsService } from '#src/modules/catalog/albums.service.js';
import { ArtistsService } from '#src/modules/catalog/artists.service.js';
import { TracksService } from '#src/modules/catalog/tracks.service.js';
import { Album, Artist, CatalogQuery, CatalogQueryInput, Track } from '../modules/catalog/types/catalog.types.js';
import { Pagination } from '../modules/shared/types/pagination.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck)
 */
export const CatalogRouter = ServerKitRouter();

/**
 * Every artist the station has ingested, ordered by name
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L16)
 */
CatalogRouter.get('/catalog/artists', requirePolicy({ policy: false }), async ctx => {
    const query = await parseAndValidate(ctx.query, CatalogQueryInput.strict());

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
 * One artist. 404s on an id that was merged away, since reads never return merged rows
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L38)
 */
CatalogRouter.get('/catalog/artists/:id', requirePolicy({ policy: false }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(ArtistsService);
    const result: Artist = await service.getArtist(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The albums credited to one artist
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L56)
 */
CatalogRouter.get('/catalog/artists/:id/albums', requirePolicy({ policy: false }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const query = await parseAndValidate(ctx.query, CatalogQueryInput.strict());

    const resultType = z.strictObject({
        meta: Pagination,
        data: z.array(Album),
    });
    const service = ctx.container.get(AlbumsService);
    const result: z.infer<typeof resultType> = await service.listAlbumsByArtist(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L75)
 */
CatalogRouter.get('/catalog/albums', requirePolicy({ policy: false }), async ctx => {
    const query = await parseAndValidate(ctx.query, CatalogQueryInput.strict());

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
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L97)
 */
CatalogRouter.get('/catalog/albums/:id', requirePolicy({ policy: false }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(AlbumsService);
    const result: Album = await service.getAlbum(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One album's tracks
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L115)
 */
CatalogRouter.get('/catalog/albums/:id/tracks', requirePolicy({ policy: false }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const query = await parseAndValidate(ctx.query, CatalogQueryInput.strict());

    const resultType = z.strictObject({
        meta: Pagination,
        data: z.array(Track),
    });
    const service = ctx.container.get(TracksService);
    const result: z.infer<typeof resultType> = await service.listTracksByAlbum(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every track, flat. The only way to answer "do we have this song?" without knowing its artist
 * from [catalog.ck](file://./../../data/contracts/catalog/catalog.ck#L134)
 */
CatalogRouter.get('/catalog/tracks', requirePolicy({ policy: false }), async ctx => {
    const query = await parseAndValidate(ctx.query, CatalogQueryInput.strict());

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
