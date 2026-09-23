import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { StationAttentionService } from '#src/modules/station/station.attention.service.js';
import { StationCheckupService } from '#src/modules/station/station.checkup.service.js';
import { StationReleasesService } from '#src/modules/station/station.releases.service.js';
import { StationAttention, StationCheckup, StationReleases, serializeStationReleases } from '../modules/station/types/station.types.js';

/**
 * generated from [station.ck](../../data/contracts/station/station.ck)
 */
export const StationRouter = ServerKitRouter();

/**
 * Everything wrong or waiting, worst first, each with the console page that can act on it
 * from [station.ck](../../data/contracts/station/station.ck#L27)
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
 * from [station.ck](../../data/contracts/station/station.ck#L50)
 */
StationRouter.get('/station/checkup', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(StationCheckupService);
    const result: StationCheckup = await service.read();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The releases this build contains and what each one changed, newest first
 * from [station.ck](../../data/contracts/station/station.ck#L65)
 */
StationRouter.get('/station/releases', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(StationReleasesService);
    const result: StationReleases = await service.read();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = serializeStationReleases(result);
});

/**
 * Asks GitHub for newer releases now, and answers with what the station then knows
 * from [station.ck](../../data/contracts/station/station.ck#L80)
 */
StationRouter.post('/station/releases/check', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(StationReleasesService);
    const result: StationReleases = await service.check();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = serializeStationReleases(result);
});
