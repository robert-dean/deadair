import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { BreakKindsService } from '#src/modules/director/break.kinds.service.js';
import { BreakKindInput, BreakKindList } from '../modules/director/types/break.kinds.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [break.kinds.ck](../../data/contracts/director/break.kinds.ck)
 */
export const BreakKindsRouter = ServerKitRouter();

/**
 * Every kind of break you have written, switched on or not, in your own order
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `GET /breaks/kinds`
 */
BreakKindsRouter.get('/breaks/kinds', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(BreakKindsService);
    const result: BreakKindList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Writes a new kind of break. Nothing airs it until it is switched on and a band on the format clock names it
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `POST /breaks/kinds`
 */
BreakKindsRouter.post('/breaks/kinds', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, BreakKindInput);

    const service = ctx.container.get(BreakKindsService);
    const result: BreakKindList = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites one kind of break. Its key cannot change. A break already written keeps the words it was given
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `PUT /breaks/kinds/{id}`
 */
BreakKindsRouter.put('/breaks/kinds/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, BreakKindInput);

    const service = ctx.container.get(BreakKindsService);
    const result: BreakKindList = await service.update(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a kind of break. Refused while a band on the format clock still names it
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `DELETE /breaks/kinds/{id}`
 */
BreakKindsRouter.delete('/breaks/kinds/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(BreakKindsService);
    const result: BreakKindList = await service.remove(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
