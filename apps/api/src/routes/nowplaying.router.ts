import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { LyricsReadService } from '#src/modules/lyrics/lyrics.read.service.js';
import { NowPlayingService } from '#src/modules/nowplaying/nowplaying.service.js';
import { NowPlaying, NowPlayingLyrics } from '../modules/nowplaying/types/nowplaying.types.js';

/**
 * generated from [nowplaying.ck](../../data/contracts/nowplaying/nowplaying.ck)
 */
export const NowplayingRouter = ServerKitRouter();

/**
 * What is on air right now. Answers 200 with `onAir: false` when the station is quiet, so a device polling this treats silence as an answer rather than an error
 * from [nowplaying.ck](../../data/contracts/nowplaying/nowplaying.ck) `GET /nowplaying`
 * anonymous access, no security required
 */
NowplayingRouter.get('/nowplaying', async ctx => {
    const service = ctx.container.get(NowPlayingService);
    const result: NowPlaying = await service.getNowPlaying();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The words of the record on air, with what a player needs to follow along line by line
 * from [nowplaying.ck](../../data/contracts/nowplaying/nowplaying.ck) `GET /nowplaying/lyrics`
 */
NowplayingRouter.get('/nowplaying/lyrics', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(LyricsReadService);
    const result: NowPlayingLyrics = await service.getNowPlayingLyrics();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
