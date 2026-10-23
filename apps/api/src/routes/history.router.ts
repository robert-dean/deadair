import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { HistoryService } from '#src/modules/history/history.service.js';
import { AsRunPage, AsRunQuery, HistoryPage, HistoryQuery } from '../modules/history/types/history.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [history.ck](../../data/contracts/history/history.ck)
 */
export const HistoryRouter = ServerKitRouter();

/**
 * What the station played, newest first, one page at a time
 * from [history.ck](../../data/contracts/history/history.ck) `GET /history`
 */
HistoryRouter.get('/history', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, HistoryQuery.strict());

    const service = ctx.container.get(HistoryService);
    const result: HistoryPage = await service.readHistory(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The as-run log, newest first, one page at a time
 * from [history.ck](../../data/contracts/history/history.ck) `GET /history/as-run`
 */
HistoryRouter.get('/history/as-run', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, AsRunQuery.strict());

    const service = ctx.container.get(HistoryService);
    const result: AsRunPage = await service.readAsRun(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
