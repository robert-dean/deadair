import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { StreamListenersService } from '#src/modules/stream/stream.listeners.service.js';
import { StreamListeners } from '../modules/stream/types/stream.listeners.types.js';

/**
 * generated from [stream.listeners.ck](../../data/contracts/stream/stream.listeners.ck)
 */
export const StreamListenersRouter = ServerKitRouter();

/**
 * Who is connected to the station's stream right now, over Icecast and over HLS
 * from [stream.listeners.ck](../../data/contracts/stream/stream.listeners.ck) `GET /stream/listeners`
 */
StreamListenersRouter.get('/stream/listeners', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(StreamListenersService);
    const result: StreamListeners = await service.listListeners();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
