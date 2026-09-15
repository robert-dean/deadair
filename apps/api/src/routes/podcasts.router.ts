import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { PodcastsService } from '#src/modules/podcasts/podcasts.service.js';
import { StationEpisode, StationEpisodePage, StationEpisodeQuery, StationShowList } from '../modules/podcasts/types/podcasts.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck)
 */
export const PodcastsRouter = ServerKitRouter();

/**
 * Every programme every installed podcast plugin carries
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck#L20)
 */
PodcastsRouter.get('/podcasts/shows', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(PodcastsService);
    const result: StationShowList = await service.readShows();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The episodes the station knows about, newest first, with what it has done with each
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck#L32)
 */
PodcastsRouter.get('/podcasts/episodes', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, StationEpisodeQuery.strict());

    const service = ctx.container.get(PodcastsService);
    const result: StationEpisodePage = await service.readEpisodes(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Fetches one episode's audio into the station's store now, rather than waiting for its slot to come near
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck#L48)
 */
PodcastsRouter.post('/podcasts/episodes/:id/fetch', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PodcastsService);
    const result: StationEpisode = await service.requestFetch(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Reads every show's feed again, in the background, rather than waiting for the next scheduled refresh
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck#L64)
 */
PodcastsRouter.post('/podcasts/refresh', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PodcastsService);
    await service.requestRefresh();

    ctx.status = 204;
});
