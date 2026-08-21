import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { DirectorConsoleService } from '#src/modules/director/director.console.service.js';
import {
    AddStationSegmentInput,
    ExtendStationInput,
    MoveStationItemInput,
    PutOnAirInput,
    ReplanStationInput,
    SetStationAirInput,
    SetStationHostInput,
    StationAir,
    StationOrder,
} from '../modules/director/types/director.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [director.ck](file://./../../data/contracts/director/director.ck)
 */
export const DirectorRouter = ServerKitRouter();

/**
 * What the station is airing, and whether it is driving at all
 * from [director.ck](file://./../../data/contracts/director/director.ck#L21)
 */
DirectorRouter.get('/director/air', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(DirectorConsoleService);
    const result: StationAir = await service.getAir();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Puts the station on air, building the running order from a playlist read at this moment. What is playing finishes: changing the programming is not a reason to cut a listener off mid-track
 * from [director.ck](file://./../../data/contracts/director/director.ck#L33)
 */
DirectorRouter.post('/director/air', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PutOnAirInput);

    const service = ctx.container.get(DirectorConsoleService);
    const result: StationAir = await service.putOnAir(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Changes what puts the station on air: only while somebody is listening, or whenever there is a programme. Takes effect at once rather than at the next boundary
 * from [director.ck](file://./../../data/contracts/director/director.ck#L48)
 */
DirectorRouter.patch('/director/air', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, SetStationAirInput);

    const service = ctx.container.get(DirectorConsoleService);
    const result: StationAir = await service.setAirMode(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The live running order, item by item, each saying where it has got to
 * from [director.ck](file://./../../data/contracts/director/director.ck#L73)
 */
DirectorRouter.get('/director/air/order', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(DirectorConsoleService);
    const result: StationOrder = await service.getOrder();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Changes who is presenting this broadcast. Breaks already written for it in the outgoing character are written again in the new one
 * from [director.ck](file://./../../data/contracts/director/director.ck#L88)
 */
DirectorRouter.put('/director/air/persona', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, SetStationHostInput);

    const service = ctx.container.get(DirectorConsoleService);
    const result: StationOrder = await service.recast(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Queues a refill and returns at once. Generating a set walks the catalog, and an operator pressing a button should not be held open through it
 * from [director.ck](file://./../../data/contracts/director/director.ck#L106)
 */
DirectorRouter.post('/director/air/extend', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ExtendStationInput);

    const service = ctx.container.get(DirectorConsoleService);
    await service.extendOrder(body);

    ctx.status = 202;
});

/**
 * Queues a fresh set for everything the player is not already holding, and swaps it in once it exists. The old tail keeps playing until then, because emptying the running order first would take the station off air while the model was still choosing
 * from [director.ck](file://./../../data/contracts/director/director.ck#L122)
 */
DirectorRouter.post('/director/air/replan', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ReplanStationInput);

    const service = ctx.container.get(DirectorConsoleService);
    await service.replanOrder(body);

    ctx.status = 202;
});

/**
 * Shuffles the records not yet handed to the player, and plants the breaks again around the new sequence. The head is already in the player's hands and is left alone
 * from [director.ck](file://./../../data/contracts/director/director.ck#L138)
 */
DirectorRouter.post('/director/air/shuffle', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(DirectorConsoleService);
    const result: StationOrder = await service.shuffleOrder();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Puts something the station says into the running order. A segment with no audio yet is refused here rather than accepted and skipped when it comes round, so an operator is told why it cannot play
 * from [director.ck](file://./../../data/contracts/director/director.ck#L153)
 */
DirectorRouter.post('/director/air/segments', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, AddStationSegmentInput);

    const service = ctx.container.get(DirectorConsoleService);
    const result: StationOrder = await service.addSegmentToOrder(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Moves an item. A position already handed to the player is refused rather than clamped
 * from [director.ck](file://./../../data/contracts/director/director.ck#L174)
 */
DirectorRouter.patch('/director/air/items/:itemId', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { itemId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            itemId: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, MoveStationItemInput);

    const service = ctx.container.get(DirectorConsoleService);
    const result: StationOrder = await service.moveOrderItem(itemId, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Drops an item that has not been handed to the player yet
 * from [director.ck](file://./../../data/contracts/director/director.ck#L189)
 */
DirectorRouter.delete('/director/air/items/:itemId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { itemId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            itemId: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(DirectorConsoleService);
    const result: StationOrder = await service.removeOrderItem(itemId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
