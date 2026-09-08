import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { NewsService } from '#src/modules/news/news.service.js';
import { NewsPage, NewsQuery, StationFeedList } from '../modules/news/types/news.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [news.ck](../../data/contracts/news/news.ck)
 */
export const NewsRouter = ServerKitRouter();

/**
 * Every feed every installed news plugin currently offers
 * from [news.ck](../../data/contracts/news/news.ck#L22)
 */
NewsRouter.get('/news/feeds', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(NewsService);
    const result: StationFeedList = await service.readFeeds();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Published entries, newest first
 * from [news.ck](../../data/contracts/news/news.ck#L34)
 */
NewsRouter.get('/news', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, NewsQuery.strict());

    const service = ctx.container.get(NewsService);
    const result: NewsPage = await service.readNews(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
