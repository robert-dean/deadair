import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { HistoryService } from '#src/modules/history/history.service.js';
import { HistoryPage, HistoryQuery } from '../modules/history/types/history.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [history.ck](../../data/contracts/history/history.ck)
 */
export const HistoryRouter = ServerKitRouter();

/**
 * What the station played, newest first, one page at a time
 * from [history.ck](../../data/contracts/history/history.ck#L23)
 */
HistoryRouter.get('/history', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, HistoryQuery.strict());

    const service = ctx.container.get(HistoryService);
    const result: HistoryPage = await service.readHistory(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
