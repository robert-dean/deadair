import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PlayoutService } from '#src/modules/playout/playout.service.js';
import {
    PlayoutAiredQuery,
    PlayoutChartInput,
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
 * Builds the running order from a published chart and starts handing it to the player. The same replacement a playlist makes, from a document somebody else ranked
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L50)
 */
PlayoutRouter.post('/playout/chart', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PlayoutChartInput);

    const service = ctx.container.get(PlayoutService);
    const result: PlayoutStatus = await service.playChart(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Ends the item on air so the next one starts immediately. The station owns the decoder, so this lands at once rather than waiting out audio already committed to a player
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L68)
 */
PlayoutRouter.post('/playout/skip', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PlayoutService);
    const result: PlayoutStatus = await service.skip();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Puts the station back on air with the running order it already has, picking it up where Stop left it. Distinct from putting a playlist on air, which builds a new broadcast and throws away what was there. Refused when there is nothing left to resume
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L83)
 */
PlayoutRouter.post('/playout/start', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PlayoutService);
    const result: PlayoutStatus = await service.start();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Stands the station down: stops what is on air at once and hands the mount back. The running order is LEFT as it is, so `/playout/start` can pick it up where this stopped it. deadair holds the mount on a lease it renews while it has something to play, so stopping goes quiet rather than falling through to a bed nobody programmed
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L98)
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
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L134)
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
 * Confirms which rundown item actually started playing. An item is pushed, and downloaded, one item AHEAD of air, so this notify is the only thing that knows what the listener is hearing the moment it changes
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L186)
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
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L206)
 * anonymous access, no security required
 * @internal
 */
PlayoutRouter.post('/playout/bridge/starve', async ctx => {
    const query = await parseAndValidate(ctx.query, PlayoutStarveQuery.strict());

    const service = ctx.container.get(PlayoutService);
    await service.noteStarve(query);

    ctx.status = 204;
});
