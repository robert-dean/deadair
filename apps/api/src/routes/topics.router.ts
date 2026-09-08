import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { TopicsService } from '#src/modules/topics/topics.service.js';
import { TopicInput, TopicKindList, TopicList, TopicQuery } from '../modules/topics/types/topics.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [topics.ck](../../data/contracts/topics/topics.ck)
 */
export const TopicsRouter = ServerKitRouter();

/**
 * Every subject this station has named, for one sort of break or for all of them
 * from [topics.ck](../../data/contracts/topics/topics.ck#L25)
 */
TopicsRouter.get('/topics', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, TopicQuery.strict());

    const service = ctx.container.get(TopicsService);
    const result: TopicList = await service.list(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Names a new subject. Nothing uses it until something points at it
 * from [topics.ck](../../data/contracts/topics/topics.ck#L39)
 */
TopicsRouter.post('/topics', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, TopicInput);

    const service = ctx.container.get(TopicsService);
    const result: TopicList = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Which sorts of break have subjects, and the form each one's settings are edited with
 * from [topics.ck](../../data/contracts/topics/topics.ck#L59)
 */
TopicsRouter.get('/topics/kinds', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(TopicsService);
    const result: TopicKindList = await service.kinds();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites one subject. A break already written keeps the words it was given
 * from [topics.ck](../../data/contracts/topics/topics.ck#L77)
 */
TopicsRouter.put('/topics/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, TopicInput);

    const service = ctx.container.get(TopicsService);
    const result: TopicList = await service.update(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a subject, and any band on the format clock that asked for it
 * from [topics.ck](../../data/contracts/topics/topics.ck#L89)
 */
TopicsRouter.delete('/topics/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(TopicsService);
    const result: TopicList = await service.remove(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
