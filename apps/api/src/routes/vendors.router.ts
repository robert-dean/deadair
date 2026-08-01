import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { VendorsService } from '#src/modules/vendors/vendors.service.js';
import { SpotifyCallbackQuery } from '../modules/vendors/types/vendors.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [vendors.ck](file://./../../data/contracts/vendors/vendors.ck)
 */
export const VendorsRouter = ServerKitRouter();

/**
 * from [vendors.ck](file://./../../data/contracts/vendors/vendors.ck#L11)
 * anonymous access, no security required
 */
VendorsRouter.get('/vendors/spotify/test', async ctx => {
    const service = ctx.container.get(VendorsService);
    await service.spotifyTest();

    ctx.status = 200;
});

/**
 * from [vendors.ck](file://./../../data/contracts/vendors/vendors.ck#L22)
 * anonymous access, no security required
 */
VendorsRouter.get('/vendors/spotify/callback', async ctx => {
    const query = await parseAndValidate(ctx.query, SpotifyCallbackQuery.strict());

    const service = ctx.container.get(VendorsService);
    await service.spotifyCallback(query);

    ctx.status = 200;
});
