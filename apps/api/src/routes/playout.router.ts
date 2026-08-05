import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { PlayoutService } from '#src/modules/playout/playout.service.js';
import { PlayoutAiredQuery, PlayoutBridgeHeaders } from '../modules/playout/types/playout.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [playout.ck](file://./../../data/contracts/playout/playout.ck)
 */
export const PlayoutRouter = ServerKitRouter();

/**
 * Confirms which rundown item actually started playing. An item is pushed, and downloaded, one item AHEAD of air, so this notify is the only thing that knows what the listener is hearing the moment it changes
 * from [playout.ck](file://./../../data/contracts/playout/playout.ck#L19)
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
