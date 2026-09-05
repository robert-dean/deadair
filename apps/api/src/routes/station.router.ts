import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { StationAttentionService } from '#src/modules/station/station.attention.service.js';
import { StationCheckupService } from '#src/modules/station/station.checkup.service.js';
import { StationAttention, StationCheckup } from '../modules/station/types/station.types.js';

/**
 * generated from [station.ck](../../data/contracts/station/station.ck)
 */
export const StationRouter = ServerKitRouter();

/**
 * Everything wrong or waiting, worst first, each with the console page that can act on it
 * from [station.ck](../../data/contracts/station/station.ck#L25)
 */
StationRouter.get('/station/attention', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(StationAttentionService);
    const result: StationAttention = await service.read();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The loops the station runs and how much of the library it has looked at
 * from [station.ck](../../data/contracts/station/station.ck#L48)
 */
StationRouter.get('/station/checkup', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(StationCheckupService);
    const result: StationCheckup = await service.read();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
