import { z } from 'zod';
import { ServerKitRouter } from '@maroonedsoftware/koa';
import { ArtService } from '#src/modules/art/art.service.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [art.ck](file://./../../data/contracts/art/art.ck)
 */
export const ArtRouter = ServerKitRouter();

/**
 * The bytes of one cached image
 * from [art.ck](file://./../../data/contracts/art/art.ck#L25)
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
