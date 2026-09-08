import { ServerKitRouter } from '@maroonedsoftware/koa';
import { HealthService } from '#src/modules/health/health.service.js';
import { Health } from '../modules/health/types/health.types.js';

/**
 * generated from [health.ck](../../data/contracts/health/health.ck)
 */
export const HealthRouter = ServerKitRouter();

/**
 * from [health.ck](../../data/contracts/health/health.ck#L28)
 * anonymous access, no security required
 * @internal
 */
HealthRouter.get('/health', async ctx => {
    const service = ctx.container.get(HealthService);
    const result: Health = await service.liveness();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [health.ck](../../data/contracts/health/health.ck#L41)
 * anonymous access, no security required
 * @internal
 */
HealthRouter.get('/healthcheck', async ctx => {
    const service = ctx.container.get(HealthService);
    const result: Health = await service.liveness();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
