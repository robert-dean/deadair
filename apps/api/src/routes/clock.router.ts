import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { ClockService } from '#src/modules/director/clock.service.js';
import { ClockBandInput, ClockBandList } from '../modules/director/types/clock.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [clock.ck](../../data/contracts/director/clock.ck)
 */
export const ClockRouter = ServerKitRouter();

/**
 * Every band on this station's clock, including the ones switched off, in the operator's own order
 * from [clock.ck](../../data/contracts/director/clock.ck#L27)
 */
ClockRouter.get('/clock/bands', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(ClockService);
    const result: ClockBandList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Adds a band. It claims its first boundary on the next commit pass
 * from [clock.ck](../../data/contracts/director/clock.ck#L40)
 */
ClockRouter.post('/clock/bands', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ClockBandInput);

    const service = ctx.container.get(ClockService);
    const result: ClockBandList = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites one band. Breaks it has already planted stay where they are: the running order is the memory
 * from [clock.ck](../../data/contracts/director/clock.ck#L58)
 */
ClockRouter.put('/clock/bands/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, ClockBandInput);

    const service = ctx.container.get(ClockService);
    const result: ClockBandList = await service.update(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a band, which costs it the boundaries it had not claimed yet and nothing else
 * from [clock.ck](../../data/contracts/director/clock.ck#L70)
 */
ClockRouter.delete('/clock/bands/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(ClockService);
    const result: ClockBandList = await service.remove(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
