import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { ChartsService } from '#src/modules/charts/charts.service.js';
import { ChartPage, ChartQuery, StationChartList } from '../modules/charts/types/charts.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [charts.ck](file://./../../data/contracts/charts/charts.ck)
 */
export const ChartsRouter = ServerKitRouter();

/**
 * Every chart every installed chart plugin currently offers
 * from [charts.ck](file://./../../data/contracts/charts/charts.ck#L22)
 */
ChartsRouter.get('/charts', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(ChartsService);
    const result: StationChartList = await service.readCharts();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One chart's records, ranked
 * from [charts.ck](file://./../../data/contracts/charts/charts.ck#L37)
 */
ChartsRouter.get('/charts/:id', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(400),
        }),
    );

    const query = await parseAndValidate(ctx.query, ChartQuery.strict());

    const service = ctx.container.get(ChartsService);
    const result: ChartPage = await service.readChart(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
