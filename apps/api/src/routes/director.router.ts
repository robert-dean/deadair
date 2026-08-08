import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { DirectorConsoleService } from '#src/modules/director/director.console.service.js';
import {
    EditLineupInput,
    ExtendLineupInput,
    ImportLineupInput,
    Lineup,
    LineupList,
    MoveLineupItemInput,
    PutOnAirInput,
    StationAir,
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
 * Puts a lineup on air from the top. What is playing finishes: changing the programming is not a reason to cut a listener off mid-track
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
 * One lineup and its whole order, with the cursor marking what has already been handed to the player
 * from [director.ck](file://./../../data/contracts/director/director.ck#L84)
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
 * from [director.ck](file://./../../data/contracts/director/director.ck#L96)
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
 * from [director.ck](file://./../../data/contracts/director/director.ck#L112)
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
 * from [director.ck](file://./../../data/contracts/director/director.ck#L131)
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
 * Moves a line. A position at or before the cursor is refused rather than clamped: that part of the order is already committed
 * from [director.ck](file://./../../data/contracts/director/director.ck#L153)
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
 * from [director.ck](file://./../../data/contracts/director/director.ck#L168)
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
