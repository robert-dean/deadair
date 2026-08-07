import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { ArtService } from '#src/modules/art/art.service.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

const _ZodBinary = z.custom<Buffer>(val => Buffer.isBuffer(val), { error: 'Must be binary data' });

/**
 * generated from [art.ck](file://./../../data/contracts/art/art.ck)
 */
export const ArtRouter = ServerKitRouter();

/**
 * The bytes of one cached image
 * from [art.ck](file://./../../data/contracts/art/art.ck#L18)
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
    const result: { body: Buffer; headers: { cacheControl?: string; etag?: string } } = await service.getArt(id);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = 'application/octet-stream';
    ctx.body = result.body;
});
