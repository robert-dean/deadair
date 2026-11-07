import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { TalkDirectionService } from '#src/modules/director/talk.direction.service.js';
import { TalkDirectionInput, TalkDirectionReading } from '../modules/director/types/direction.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [direction.ck](../../data/contracts/director/direction.ck)
 */
export const DirectionRouter = ServerKitRouter();

/**
 * The direction in force, if any
 * from [direction.ck](../../data/contracts/director/direction.ck) `GET /direction`
 */
DirectionRouter.get('/direction', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(TalkDirectionService);
    const result: TalkDirectionReading = await service.read();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Gives the presenters a line to lean on for a number of hours, replacing any direction already in force. Breaks already written are not rewritten
 * from [direction.ck](../../data/contracts/director/direction.ck) `PUT /direction`
 */
DirectionRouter.put('/direction', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, TalkDirectionInput);

    const service = ctx.container.get(TalkDirectionService);
    const result: TalkDirectionReading = await service.direct(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Ends the direction now. Breaks already written are not rewritten
 * from [direction.ck](../../data/contracts/director/direction.ck) `DELETE /direction`
 */
DirectionRouter.delete('/direction', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(TalkDirectionService);
    const result: TalkDirectionReading = await service.stop();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
