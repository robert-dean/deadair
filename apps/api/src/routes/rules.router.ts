import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { BlockRulesService } from '#src/modules/director/block.rules.service.js';
import { BlockRuleInput, BlockRuleList, GenreSteerInput, GenreSteerReading } from '../modules/director/types/rules.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [rules.ck](../../data/contracts/director/rules.ck)
 */
export const RulesRouter = ServerKitRouter();

/**
 * Every never-play rule on this station, newest first, each saying whether it holds right now
 * from [rules.ck](../../data/contracts/director/rules.ck#L19)
 */
RulesRouter.get('/rules', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(BlockRulesService);
    const result: BlockRuleList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Adds a rule. It holds from the next record the station chooses
 * from [rules.ck](../../data/contracts/director/rules.ck#L31)
 */
RulesRouter.post('/rules', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, BlockRuleInput);

    const service = ctx.container.get(BlockRulesService);
    const result: BlockRuleList = await service.add(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The lean in force, if any
 * from [rules.ck](../../data/contracts/director/rules.ck#L49)
 */
RulesRouter.get('/rules/steer', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(BlockRulesService);
    const result: GenreSteerReading = await service.readSteer();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Leans the station toward some genres for a number of hours, replacing any lean already in force
 * from [rules.ck](../../data/contracts/director/rules.ck#L61)
 */
RulesRouter.put('/rules/steer', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, GenreSteerInput);

    const service = ctx.container.get(BlockRulesService);
    const result: GenreSteerReading = await service.steer(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Ends the lean now
 * from [rules.ck](../../data/contracts/director/rules.ck#L73)
 */
RulesRouter.delete('/rules/steer', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(BlockRulesService);
    const result: GenreSteerReading = await service.stopSteering();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Replaces a rule
 * from [rules.ck](../../data/contracts/director/rules.ck#L89)
 */
RulesRouter.put('/rules/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, BlockRuleInput);

    const service = ctx.container.get(BlockRulesService);
    const result: BlockRuleList = await service.change(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a rule
 * from [rules.ck](../../data/contracts/director/rules.ck#L103)
 */
RulesRouter.delete('/rules/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(BlockRulesService);
    const result: BlockRuleList = await service.remove(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
