import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { StreamService } from '#src/modules/stream/stream.service.js';
import {
    FetcherAuthorization,
    FetcherAuthorizationFinished,
    FetcherAuthorizationInput,
    FetcherAuthorizationStart,
} from '../modules/stream/types/stream.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [stream.ck](file://./../../data/contracts/stream/stream.ck)
 */
export const StreamRouter = ServerKitRouter();

/**
 * One HLS playlist, and the tick that says somebody is still listening to it
 * from [stream.ck](file://./../../data/contracts/stream/stream.ck#L57)
 * anonymous access, no security required
 */
StreamRouter.get('/hls/:name', async ctx => {
    const { name } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            name: z.string().min(1).max(120),
        }),
    );

    const service = ctx.container.get(StreamService);
    const result: { body: Buffer; headers: { cacheControl?: string } } = await service.getHlsPlaylist(name);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    ctx.type = 'application/vnd.apple.mpegurl';
    ctx.body = result.body;
});

/**
 * What the track fetcher holds by way of a Spotify login, and whether an authorization is already waiting to be finished
 * from [stream.ck](file://./../../data/contracts/stream/stream.ck#L76)
 */
StreamRouter.get('/stream/authorization', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(StreamService);
    const result: FetcherAuthorization = await service.readAuthorization();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Starts the fetcher's one-time authorization and answers with the URL to open. Starting another replaces whichever was pending
 * from [stream.ck](file://./../../data/contracts/stream/stream.ck#L85)
 */
StreamRouter.post('/stream/authorization', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(StreamService);
    const result: FetcherAuthorizationStart = await service.startAuthorization();

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Finishes an authorization from the address the operator's browser ended up at
 * from [stream.ck](file://./../../data/contracts/stream/stream.ck#L97)
 */
StreamRouter.post('/stream/authorization/complete', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, FetcherAuthorizationInput);

    const service = ctx.container.get(StreamService);
    const result: FetcherAuthorizationFinished = await service.finishAuthorization(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
