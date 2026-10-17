import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { MetricsService } from '#src/modules/metrics/metrics.service.js';
import { MetricNames, MetricSeriesPage, MetricSeriesQuery } from '../modules/metrics/types/metrics.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [metrics.ck](../../data/contracts/metrics/metrics.ck)
 */
export const MetricsRouter = ServerKitRouter();

/**
 * Trends over a range, at minute resolution for two days or less and hourly beyond
 * from [metrics.ck](../../data/contracts/metrics/metrics.ck) `GET /metrics/series`
 */
MetricsRouter.get('/metrics/series', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, MetricSeriesQuery.strict());

    const service = ctx.container.get(MetricsService);
    const result: MetricSeriesPage = await service.readSeries(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every metric the station holds, with its labels and when it was last measured
 * from [metrics.ck](../../data/contracts/metrics/metrics.ck) `GET /metrics/names`
 */
MetricsRouter.get('/metrics/names', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(MetricsService);
    const result: MetricNames = await service.readNames();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
