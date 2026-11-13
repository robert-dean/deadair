import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { FestivalService } from '#src/modules/schedule/festival.service.js';
import { FestivalInput, FestivalList } from '../modules/schedule/types/festivals.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [festivals.ck](../../data/contracts/schedule/festivals.ck)
 */
export const FestivalsRouter = ServerKitRouter();

/**
 * Every festival on this station, soonest first, each saying whether it is still to come, on now or over
 * from [festivals.ck](../../data/contracts/schedule/festivals.ck) `GET /festivals`
 */
FestivalsRouter.get('/festivals', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(FestivalService);
    const result: FestivalList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Adds a festival. A show names it from the schedule, and nothing is said about it until one does
 * from [festivals.ck](../../data/contracts/schedule/festivals.ck) `POST /festivals`
 */
FestivalsRouter.post('/festivals', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, FestivalInput);

    const service = ctx.container.get(FestivalService);
    const result: FestivalList = await service.add(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Replaces a festival and its whole bill. A show naming it plays and talks about the new one from its next refill and its next break
 * from [festivals.ck](../../data/contracts/schedule/festivals.ck) `PUT /festivals/{id}`
 */
FestivalsRouter.put('/festivals/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, FestivalInput);

    const service = ctx.container.get(FestivalService);
    const result: FestivalList = await service.change(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a festival. A show that named it carries on as the show it otherwise is
 * from [festivals.ck](../../data/contracts/schedule/festivals.ck) `DELETE /festivals/{id}`
 */
FestivalsRouter.delete('/festivals/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(FestivalService);
    const result: FestivalList = await service.remove(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
