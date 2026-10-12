import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { OwnShowsService } from '#src/modules/podcasts/own.shows.service.js';
import { PodcastsService } from '#src/modules/podcasts/podcasts.service.js';
import {
    OwnEpisodeRequest,
    OwnShow,
    OwnShowInput,
    OwnShowList,
    StationDirectoryPage,
    StationDirectoryQuery,
    StationEpisode,
    StationEpisodePage,
    StationEpisodeQuery,
    StationShowList,
} from '../modules/podcasts/types/podcasts.types.js';
import { Production, ProductionList } from '../modules/productions/types/productions.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck)
 */
export const PodcastsRouter = ServerKitRouter();

/**
 * Every programme every installed podcast plugin carries
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `GET /podcasts/shows`
 */
PodcastsRouter.get('/podcasts/shows', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(PodcastsService);
    const result: StationShowList = await service.readShows();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Looks a show up in the directories the installed podcast plugins can search
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `GET /podcasts/search`
 */
PodcastsRouter.get('/podcasts/search', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const query = await parseAndValidate(ctx.query, StationDirectoryQuery.strict());

    const service = ctx.container.get(PodcastsService);
    const result: StationDirectoryPage = await service.searchDirectory(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The episodes the station knows about, newest first, with what it has done with each
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `GET /podcasts/episodes`
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
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `POST /podcasts/episodes/{id}/fetch`
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
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `POST /podcasts/refresh`
 */
PodcastsRouter.post('/podcasts/refresh', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PodcastsService);
    await service.requestRefresh();

    ctx.status = 204;
});

/**
 * The shows the station makes for itself
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `GET /podcasts/own`
 */
PodcastsRouter.get('/podcasts/own', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(OwnShowsService);
    const result: OwnShowList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Makes a new show. Nothing is made until an episode is asked for
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `POST /podcasts/own`
 */
PodcastsRouter.post('/podcasts/own', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, OwnShowInput);

    const service = ctx.container.get(OwnShowsService);
    const result: OwnShow = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites a show. Episodes already asked for keep what they were asked with
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `PUT /podcasts/own/{id}`
 */
PodcastsRouter.put('/podcasts/own/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, OwnShowInput);

    const service = ctx.container.get(OwnShowsService);
    const result: OwnShow = await service.update(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a show. Its episodes stay on the Productions page, no longer filed under it
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `DELETE /podcasts/own/{id}`
 */
PodcastsRouter.delete('/podcasts/own/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(OwnShowsService);
    await service.remove(id);

    ctx.status = 204;
});

/**
 * A show's episodes, newest first, with how far along each is
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `GET /podcasts/own/{id}/episodes`
 */
PodcastsRouter.get('/podcasts/own/:id/episodes', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(OwnShowsService);
    const result: ProductionList = await service.episodes(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Asks the show for an episode. It is queued, not started, and airs when it is made or at the time given
 * from [podcasts.ck](../../data/contracts/podcasts/podcasts.ck) `POST /podcasts/own/{id}/episodes`
 */
PodcastsRouter.post('/podcasts/own/:id/episodes', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, OwnEpisodeRequest);

    const service = ctx.container.get(OwnShowsService);
    const result: Production = await service.requestEpisode(id, body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});
