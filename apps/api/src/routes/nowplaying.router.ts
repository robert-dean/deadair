import { ServerKitRouter } from '@maroonedsoftware/koa';
import { NowPlayingService } from '#src/modules/nowplaying/nowplaying.service.js';
import { NowPlaying } from '../modules/nowplaying/types/nowplaying.types.js';

/**
 * generated from [nowplaying.ck](file://./../../data/contracts/nowplaying/nowplaying.ck)
 */
export const NowplayingRouter = ServerKitRouter();

/**
 * What is on air right now. Answers 200 with `onAir: false` when the station is quiet, so a device polling this treats silence as an answer rather than an error
 * from [nowplaying.ck](file://./../../data/contracts/nowplaying/nowplaying.ck#L20)
 * anonymous access, no security required
 */
NowplayingRouter.get('/nowplaying', async ctx => {
    const service = ctx.container.get(NowPlayingService);
    const result: NowPlaying = await service.getNowPlaying();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
