import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { OtlpReceiveService } from '#src/modules/metrics/otlp.receive.service.js';
import { OtlpExportResponse, OtlpMetricsExport } from '../modules/metrics/types/metrics.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [metrics.otlp.ck](../../data/contracts/metrics/metrics.otlp.ck)
 */
export const MetricsOtlpRouter = ServerKitRouter();

/**
 * Take an OTLP/HTTP metrics export, sent as JSON
 * from [metrics.otlp.ck](../../data/contracts/metrics/metrics.otlp.ck) `POST /otlp/v1/metrics`
 * @internal
 */
MetricsOtlpRouter.post('/otlp/v1/metrics', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, OtlpMetricsExport);

    const service = ctx.container.get(OtlpReceiveService);
    const result: OtlpExportResponse = await service.receive(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
