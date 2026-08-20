import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { StationAttentionService } from '#src/modules/station/station.attention.service.js';
import { StationAttention } from '../modules/station/types/station.types.js';

/**
 * generated from [station.ck](file://./../../data/contracts/station/station.ck)
 */
export const StationRouter = ServerKitRouter();

/**
 * Everything wrong or waiting, worst first, each with the console page that can act on it
 * from [station.ck](file://./../../data/contracts/station/station.ck#L24)
 */
StationRouter.get('/station/attention', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(StationAttentionService);
    const result: StationAttention = await service.read();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
