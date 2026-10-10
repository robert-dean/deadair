import { z } from 'zod';
import { ServerKitRouter } from '@maroonedsoftware/koa';
import { ArtService } from '#src/modules/art/art.service.js';
import { ArtSourceService } from '#src/modules/art/art.source.service.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [art.ck](../../data/contracts/art/art.ck)
 */
export const ArtRouter = ServerKitRouter();

/**
 * The bytes of a cover the station fetches on first ask, addressed by its sealed source
 * from [art.ck](../../data/contracts/art/art.ck) `GET /art/source/{token}`
 * anonymous access, no security required
 */
ArtRouter.get('/art/source/:token', async ctx => {
    const { token } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            token: z.string().min(24).max(4096),
        }),
    );

    const service = ctx.container.get(ArtSourceService);
    const result: {
        contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
        body: Buffer;
        headers: { cacheControl?: string; etag?: string };
    } = await service.getSourceArt(token);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = result.contentType;
    ctx.body = result.body;
});

/**
 * The bytes of a cover the station fetches on first ask, under any filename
 * from [art.ck](../../data/contracts/art/art.ck) `GET /art/source/{token}/{filename}`
 * anonymous access, no security required
 */
ArtRouter.get('/art/source/:token/:filename', async ctx => {
    const { token, filename } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            token: z.string().min(24).max(4096),
            filename: z.string().min(3).max(64),
        }),
    );

    const service = ctx.container.get(ArtSourceService);
    const result: {
        contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
        body: Buffer;
        headers: { cacheControl?: string; etag?: string };
    } = await service.getSourceArtFile(token, filename);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = result.contentType;
    ctx.body = result.body;
});

/**
 * The bytes of one cached image, addressed by its id alone
 * from [art.ck](../../data/contracts/art/art.ck) `GET /art/{id}`
 * anonymous access, no security required
 */
ArtRouter.get('/art/:id', async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(ArtService);
    const result: {
        contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
        body: Buffer;
        headers: { cacheControl?: string; etag?: string };
    } = await service.getArt(id);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = result.contentType;
    ctx.body = result.body;
});

/**
 * The bytes of one cached image, under any filename
 * from [art.ck](../../data/contracts/art/art.ck) `GET /art/{id}/{filename}`
 * anonymous access, no security required
 */
ArtRouter.get('/art/:id/:filename', async ctx => {
    const { id, filename } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
            filename: z.string().min(3).max(64),
        }),
    );

    const service = ctx.container.get(ArtService);
    const result: {
        contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
        body: Buffer;
        headers: { cacheControl?: string; etag?: string };
    } = await service.getArtFile(id, filename);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = result.contentType;
    ctx.body = result.body;
});
