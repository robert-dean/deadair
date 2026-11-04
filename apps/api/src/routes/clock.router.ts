import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { ClockService } from '#src/modules/director/clock.service.js';
import { ClockBandInput, ClockBandList, ClockImportResult, ClockPack } from '../modules/director/types/clock.types.js';
import { PackImportPlan } from '../modules/topics/types/topics.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [clock.ck](../../data/contracts/director/clock.ck)
 */
export const ClockRouter = ServerKitRouter();

/**
 * This station's format clock as one file, to hand to another station
 * from [clock.ck](../../data/contracts/director/clock.ck) `GET /clock/export`
 */
ClockRouter.get('/clock/export', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(ClockService);
    const result: ClockPack = await service.exportPack();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Reads a file and reports what importing it would add, skip and leave out. Writes nothing
 * from [clock.ck](../../data/contracts/director/clock.ck) `POST /clock/import/preview`
 */
ClockRouter.post('/clock/import/preview', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ClockPack);

    const service = ctx.container.get(ClockService);
    const result: PackImportPlan = await service.previewImport(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Adds the bands in a file after this station's own, switched off, with any subject they need. Changes nothing the station already has
 * from [clock.ck](../../data/contracts/director/clock.ck) `POST /clock/import`
 */
ClockRouter.post('/clock/import', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ClockPack);

    const service = ctx.container.get(ClockService);
    const result: ClockImportResult = await service.importPack(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every band on this station's clock, including the ones switched off, in the operator's own order
 * from [clock.ck](../../data/contracts/director/clock.ck) `GET /clock/bands`
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
 * from [clock.ck](../../data/contracts/director/clock.ck) `POST /clock/bands`
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
 * from [clock.ck](../../data/contracts/director/clock.ck) `PUT /clock/bands/{id}`
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
 * from [clock.ck](../../data/contracts/director/clock.ck) `DELETE /clock/bands/{id}`
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
