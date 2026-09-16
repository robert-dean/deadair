import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { NarrationsService } from '#src/modules/narrations/narrations.service.js';
import { StationPiecePage, StationPieceQuery, StationSeriesList } from '../modules/narrations/types/narrations.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [narrations.ck](../../data/contracts/narrations/narrations.ck)
 */
export const NarrationsRouter = ServerKitRouter();

/**
 * Every series every installed narration plugin offers
 * from [narrations.ck](../../data/contracts/narrations/narrations.ck#L20)
 */
NarrationsRouter.get('/narrations/series', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(NarrationsService);
    const result: StationSeriesList = await service.readSeries();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The pieces the station knows about, in their series' own order, with what it has done with each
 * from [narrations.ck](../../data/contracts/narrations/narrations.ck#L32)
 */
NarrationsRouter.get('/narrations/pieces', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, StationPieceQuery.strict());

    const service = ctx.container.get(NarrationsService);
    const result: StationPiecePage = await service.readPieces(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Reads every series again, in the background, rather than waiting for the next scheduled refresh
 * from [narrations.ck](../../data/contracts/narrations/narrations.ck#L45)
 */
NarrationsRouter.post('/narrations/refresh', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(NarrationsService);
    await service.requestRefresh();

    ctx.status = 204;
});
