import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { OccasionService } from '#src/modules/schedule/occasion.service.js';
import { OccasionInput, OccasionList, OccasionOrder } from '../modules/schedule/types/occasions.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [occasions.ck](../../data/contracts/schedule/occasions.ck)
 */
export const OccasionsRouter = ServerKitRouter();

/**
 * Every occasion on this station, in the order a date is matched against them, each saying when it next falls
 * from [occasions.ck](../../data/contracts/schedule/occasions.ck) `GET /occasions`
 */
OccasionsRouter.get('/occasions', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(OccasionService);
    const result: OccasionList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Adds an occasion at the end of the list. Presenters hear of it from the next break written for its day
 * from [occasions.ck](../../data/contracts/schedule/occasions.ck) `POST /occasions`
 */
OccasionsRouter.post('/occasions', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, OccasionInput);

    const service = ctx.container.get(OccasionService);
    const result: OccasionList = await service.add(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Puts the list in a new order, which decides who wins when two fall on one date
 * from [occasions.ck](../../data/contracts/schedule/occasions.ck) `PUT /occasions/order`
 */
OccasionsRouter.put('/occasions/order', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, OccasionOrder);

    const service = ctx.container.get(OccasionService);
    const result: OccasionList = await service.reorder(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Replaces an occasion, keeping its place in the list
 * from [occasions.ck](../../data/contracts/schedule/occasions.ck) `PUT /occasions/{id}`
 */
OccasionsRouter.put('/occasions/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, OccasionInput);

    const service = ctx.container.get(OccasionService);
    const result: OccasionList = await service.change(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes an occasion
 * from [occasions.ck](../../data/contracts/schedule/occasions.ck) `DELETE /occasions/{id}`
 */
OccasionsRouter.delete('/occasions/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(OccasionService);
    const result: OccasionList = await service.remove(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
