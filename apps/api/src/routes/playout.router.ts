import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PlayoutService } from '#src/modules/playout/playout.service.js';
import {
    PlayoutAiredQuery,
    PlayoutBridgeHeaders,
    PlayoutListenerQuery,
    PlayoutPlaylistInput,
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
 * Notes a listener arriving or leaving, so the station reacts the moment somebody tunes in rather than at the next poll of Icecast's stats. The count itself still comes from the poll, which is what makes a dropped event harmless
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L95)
 * anonymous access, no security required
 * @internal
 */
PlayoutRouter.post('/playout/listener', async ctx => {
    const query = await parseAndValidate(ctx.query, PlayoutListenerQuery.strict());

    const headers = await parseAndValidate(ctx.headers, PlayoutBridgeHeaders.strip());

    const service = ctx.container.get(PlayoutService);
    const result: { body: string; headers: { icecastAuthUser: string } } = await service.noteListener(query, headers);

    ctx.status = 200;
    ctx.set('icecast-auth-user', String(result.headers['icecastAuthUser']));
    ctx.type = 'text/plain';
    ctx.body = result.body;
});

/**
 * Confirms which rundown item actually started playing. An item is pushed, and downloaded, one item AHEAD of air, so this notify is the only thing that knows what the listener is hearing the moment it changes
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L113)
 * anonymous access, no security required
 * @internal
 */
PlayoutRouter.post('/playout/aired', async ctx => {
    const query = await parseAndValidate(ctx.query, PlayoutAiredQuery.strict());

    const headers = await parseAndValidate(ctx.headers, PlayoutBridgeHeaders.strip());

    const service = ctx.container.get(PlayoutService);
    await service.confirmAired(query, headers);

    ctx.status = 204;
});
