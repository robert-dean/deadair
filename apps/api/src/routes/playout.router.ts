import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PlayoutService } from '#src/modules/playout/playout.service.js';
import {
    PlayoutAiredQuery,
    PlayoutListenerQuery,
    PlayoutPlaylistInput,
    PlayoutStarveQuery,
    PlayoutStatus,
} from '../modules/playout/types/playout.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [playout.ck](file://./../../data/contracts/playout/playout.ck)
 */
export const PlayoutRouter = ServerKitRouter();

/**
 * What the station is playing and what is queued behind it. The console polls this
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L17)
 */
PlayoutRouter.get('/playout/status', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(PlayoutService);
    const result: PlayoutStatus = await service.getStatus();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Loads a plugin playlist into the running order and starts handing it to the player. Replaces whatever was queued; what is on air finishes rather than being cut off
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L32)
 */
PlayoutRouter.post('/playout/playlist', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PlayoutPlaylistInput);

    const service = ctx.container.get(PlayoutService);
    const result: PlayoutStatus = await service.playPlaylist(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Ends the item on air so the next one starts immediately. The station owns the decoder, so this lands at once rather than waiting out audio already committed to a player
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L50)
 */
PlayoutRouter.post('/playout/skip', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PlayoutService);
    const result: PlayoutStatus = await service.skip();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Stands the station down: drops the running order, stops what is on air, and hands the mount back. deadair holds the mount on a lease it renews while it has something to play, so stopping goes quiet rather than falling through to a bed nobody programmed
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L65)
 */
PlayoutRouter.post('/playout/stop', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PlayoutService);
    const result: PlayoutStatus = await service.stop();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The station's own copy of one record, by the provider binding it was cached for
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L98)
 * anonymous access, no security required
 * @internal
 */
PlayoutRouter.get('/playout/audio/:sourceId', async ctx => {
    const { sourceId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            sourceId: z.uuid(),
        }),
    );

    const service = ctx.container.get(PlayoutService);
    const result: {
        contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/flac' | 'audio/mp4';
        body: Buffer;
        headers: { cacheControl?: string; etag?: string };
    } = await service.getTrackAudio(sourceId);

    ctx.status = 200;
    if (result.headers['cacheControl'] !== undefined) ctx.set('cache-control', String(result.headers['cacheControl']));
    if (result.headers['etag'] !== undefined) ctx.set('etag', String(result.headers['etag']));
    ctx.type = result.contentType;
    ctx.body = result.body;
});

/**
 * Notes a listener arriving or leaving, so the station reacts the moment somebody tunes in rather than at the next poll of Icecast's stats. The count itself still comes from the poll, which is what makes a dropped event harmless
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L154)
 * anonymous access, no security required
 * @internal
 */
PlayoutRouter.post('/playout/bridge/listener', async ctx => {
    const query = await parseAndValidate(ctx.query, PlayoutListenerQuery.strict());

    const service = ctx.container.get(PlayoutService);
    const result: { body: string; headers: { icecastAuthUser: string } } = await service.noteListener(query);

    ctx.status = 200;
    ctx.set('icecast-auth-user', String(result.headers['icecastAuthUser']));
    ctx.type = 'text/plain';
    ctx.body = result.body;
});

/**
 * Confirms which rundown item actually started playing. An item is pushed, and downloaded, one item AHEAD of air, so this notify is the only thing that knows what the listener is hearing the moment it changes
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L173)
 * anonymous access, no security required
 * @internal
 */
PlayoutRouter.post('/playout/bridge/aired', async ctx => {
    const query = await parseAndValidate(ctx.query, PlayoutAiredQuery.strict());

    const service = ctx.container.get(PlayoutService);
    await service.confirmAired(query);

    ctx.status = 204;
});

/**
 * Reports that the running order stopped producing audio, or started again. The mount has fallen through to the local bed in between, so nothing deadair programmed is being heard
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L193)
 * anonymous access, no security required
 * @internal
 */
PlayoutRouter.post('/playout/bridge/starve', async ctx => {
    const query = await parseAndValidate(ctx.query, PlayoutStarveQuery.strict());

    const service = ctx.container.get(PlayoutService);
    await service.noteStarve(query);

    ctx.status = 204;
});
