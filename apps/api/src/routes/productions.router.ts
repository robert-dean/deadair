import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { ProductionsService } from '#src/modules/productions/productions.service.js';
import { Production, ProductionList, ProductionRequest } from '../modules/productions/types/productions.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [productions.ck](file://./../../data/contracts/productions/productions.ck)
 */
export const ProductionsRouter = ServerKitRouter();

/**
 * Everything the station has made or is making, newest first
 * from [productions.ck](file://./../../data/contracts/productions/productions.ck#L29)
 */
ProductionsRouter.get('/productions', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(ProductionsService);
    const result: ProductionList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Asks the station to make one. It is queued, not started
 * from [productions.ck](file://./../../data/contracts/productions/productions.ck#L42)
 */
ProductionsRouter.post('/productions', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ProductionRequest);

    const service = ctx.container.get(ProductionsService);
    const result: Production = await service.request(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Stops a production being made, for good
 * from [productions.ck](file://./../../data/contracts/productions/productions.ck#L67)
 */
ProductionsRouter.post('/productions/:id/cancel', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(ProductionsService);
    const result: Production = await service.cancel(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
