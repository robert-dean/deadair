import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { PlayoutService } from '#src/modules/playout/playout.service.js';
import { PlayoutAiredQuery, PlayoutBridgeHeaders, SpotifyLoginHeaders, SpotifySessionLogin } from '../modules/playout/types/playout.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [playout.ck](file://./../../data/contracts/playout/playout.ck)
 */
export const PlayoutRouter = ServerKitRouter();

/**
 * Mints a login for the station-side track shim from the connected Spotify plugin
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L26)
 * anonymous access, no security required
 * @internal
 */
PlayoutRouter.get('/playout/spotify/session-login', async ctx => {
    const headers = await parseAndValidate(ctx.headers, SpotifyLoginHeaders.strip());

    const service = ctx.container.get(PlayoutService);
    const result: SpotifySessionLogin = await service.spotifySessionLogin(headers);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Confirms which rundown item actually started playing. An item is pushed, and downloaded, one item AHEAD of air, so this notify is the only thing that knows what the listener is hearing the moment it changes
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L40)
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
