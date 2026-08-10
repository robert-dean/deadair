import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { DirectorConsoleService } from '#src/modules/director/director.console.service.js';
import {
    AddLineupSegmentInput,
    AddStationSegmentInput,
    EditLineupInput,
    ExtendLineupInput,
    ExtendStationInput,
    ImportLineupInput,
    Lineup,
    LineupList,
    MoveLineupItemInput,
    MoveStationItemInput,
    PutOnAirInput,
    SetStationAirInput,
    StationAir,
    StationOrder,
} from '../modules/director/types/director.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [director.ck](file://./../../data/contracts/director/director.ck)
 */
export const DirectorRouter = ServerKitRouter();

/**
 * Every lineup the station holds, without their orders
 * from [director.ck](file://./../../data/contracts/director/director.ck#L21)
 */
DirectorRouter.get('/director/lineups', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(DirectorConsoleService);
    const result: LineupList = await service.listLineups();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Builds a lineup from a plugin playlist. Does not put it on air: importing and airing are separate decisions
 * from [director.ck](file://./../../data/contracts/director/director.ck#L33)
 */
DirectorRouter.post('/director/lineups', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ImportLineupInput);

    const service = ctx.container.get(DirectorConsoleService);
    const result: Lineup = await service.importPlaylist(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * What the station is airing, and whether it is driving at all
 * from [director.ck](file://./../../data/contracts/director/director.ck#L51)
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
 * from [director.ck](file://./../../data/contracts/director/director.ck#L63)
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
 * from [director.ck](file://./../../data/contracts/director/director.ck#L78)
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
 * from [director.ck](file://./../../data/contracts/director/director.ck#L103)
 */
DirectorRouter.get('/director/air/order', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(DirectorConsoleService);
    const result: StationOrder = await service.getOrder();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Queues a refill and returns at once. Generating a set walks the catalog, and an operator pressing a button should not be held open through it
 * from [director.ck](file://./../../data/contracts/director/director.ck#L118)
 */
DirectorRouter.post('/director/air/extend', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ExtendStationInput);

    const service = ctx.container.get(DirectorConsoleService);
    await service.extendOrder(body);

    ctx.status = 202;
});

/**
 * Shuffles everything not yet handed to the player. The head is already in the player's hands and is left alone
 * from [director.ck](file://./../../data/contracts/director/director.ck#L134)
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
 * from [director.ck](file://./../../data/contracts/director/director.ck#L149)
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
 * from [director.ck](file://./../../data/contracts/director/director.ck#L170)
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
 * from [director.ck](file://./../../data/contracts/director/director.ck#L185)
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

/**
 * One lineup and its whole order, with the cursor marking what has already been handed to the player
 * from [director.ck](file://./../../data/contracts/director/director.ck#L203)
 */
DirectorRouter.get('/director/lineups/:lineupId', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { lineupId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            lineupId: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(DirectorConsoleService);
    const result: Lineup = await service.getLineup(lineupId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Deletes a lineup. Answers 409 while it is on air: stop the station or put another one on first
 * from [director.ck](file://./../../data/contracts/director/director.ck#L215)
 */
DirectorRouter.delete('/director/lineups/:lineupId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { lineupId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            lineupId: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(DirectorConsoleService);
    await service.deleteLineup(lineupId);

    ctx.status = 204;
});

/**
 * Queues a refill and returns at once. Generating a set walks the catalog, and an operator pressing a button should not be held open through it
 * from [director.ck](file://./../../data/contracts/director/director.ck#L231)
 */
DirectorRouter.post('/director/lineups/:lineupId/extend', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { lineupId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            lineupId: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, ExtendLineupInput);

    const service = ctx.container.get(DirectorConsoleService);
    await service.extendLineup(lineupId, body);

    ctx.status = 202;
});

/**
 * Shuffles everything not yet committed. The head is already in the player's hands and is left alone
 * from [director.ck](file://./../../data/contracts/director/director.ck#L250)
 */
DirectorRouter.post(
    '/director/lineups/:lineupId/shuffle',
    requirePolicy({ policy: 'platform.manage' }),
    bodyParserMiddleware(['json']),
    async ctx => {
        const { lineupId } = await parseAndValidate(
            ctx.params,
            z.strictObject({
                lineupId: z.string().min(1).max(100),
            }),
        );

        const body = await parseAndValidate(ctx.parsedBody, EditLineupInput);

        const service = ctx.container.get(DirectorConsoleService);
        const result: Lineup = await service.shuffleLineup(lineupId, body);

        ctx.status = 200;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * Puts something the station says into the order at a position. A segment with no audio yet is refused here rather than accepted and skipped at the boundary, so an operator is told why it cannot play
 * from [director.ck](file://./../../data/contracts/director/director.ck#L271)
 */
DirectorRouter.post(
    '/director/lineups/:lineupId/segments',
    requirePolicy({ policy: 'platform.manage' }),
    bodyParserMiddleware(['json']),
    async ctx => {
        const { lineupId } = await parseAndValidate(
            ctx.params,
            z.strictObject({
                lineupId: z.string().min(1).max(100),
            }),
        );

        const body = await parseAndValidate(ctx.parsedBody, AddLineupSegmentInput);

        const service = ctx.container.get(DirectorConsoleService);
        const result: Lineup = await service.addSegment(lineupId, body);

        ctx.status = 200;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * Moves a line. A position at or before the cursor is refused rather than clamped: that part of the order is already committed
 * from [director.ck](file://./../../data/contracts/director/director.ck#L293)
 */
DirectorRouter.patch(
    '/director/lineups/:lineupId/items/:itemId',
    requirePolicy({ policy: 'platform.manage' }),
    bodyParserMiddleware(['json']),
    async ctx => {
        const { lineupId, itemId } = await parseAndValidate(
            ctx.params,
            z.strictObject({
                lineupId: z.string().min(1).max(100),
                itemId: z.string().min(1).max(100),
            }),
        );

        const body = await parseAndValidate(ctx.parsedBody, MoveLineupItemInput);

        const service = ctx.container.get(DirectorConsoleService);
        const result: Lineup = await service.moveItem(lineupId, itemId, body);

        ctx.status = 200;
        ctx.type = 'application/json';
        ctx.body = result;
    },
);

/**
 * Drops a line that has not been committed yet
 * from [director.ck](file://./../../data/contracts/director/director.ck#L308)
 */
DirectorRouter.delete('/director/lineups/:lineupId/items/:itemId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { lineupId, itemId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            lineupId: z.string().min(1).max(100),
            itemId: z.string().min(1).max(100),
        }),
    );

    const query = await parseAndValidate(ctx.query, EditLineupInput.strict());

    const service = ctx.container.get(DirectorConsoleService);
    const result: Lineup = await service.removeItem(lineupId, itemId, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
