import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { ActivityService } from '#src/modules/activity/activity.service.js';
import { ActivityPage, ActivityQuery } from '../modules/activity/types/activity.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [activity.ck](file://./../../data/contracts/activity/activity.ck)
 */
export const ActivityRouter = ServerKitRouter();

/**
 * The feed, newest first, one page at a time
 * from [activity.ck](file://./../../data/contracts/activity/activity.ck#L25)
 */
ActivityRouter.get('/activity', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, ActivityQuery.strict());

    const service = ctx.container.get(ActivityService);
    const result: ActivityPage = await service.readActivity(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
