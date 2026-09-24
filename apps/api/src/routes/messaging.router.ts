import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { MessagingLinksService } from '#src/modules/messaging/messaging.links.service.js';
import { MessagingLinkCode, MessagingLinkList } from '../modules/messaging/types/messaging.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [messaging.ck](../../data/contracts/messaging/messaging.ck)
 */
export const MessagingRouter = ServerKitRouter();

/**
 * The chat accounts linked to the signed-in account
 * from [messaging.ck](../../data/contracts/messaging/messaging.ck#L18)
 */
MessagingRouter.get('/messaging/links', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(MessagingLinksService);
    const result: MessagingLinkList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * A new one-time code for linking a chat account. It replaces any earlier code and stops working after ten minutes
 * from [messaging.ck](../../data/contracts/messaging/messaging.ck#L30)
 */
MessagingRouter.post('/messaging/links/code', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(MessagingLinksService);
    const result: MessagingLinkCode = await service.createCode();

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Unlink a chat account. Its operator commands are refused from the next one on
 * from [messaging.ck](../../data/contracts/messaging/messaging.ck#L46)
 */
MessagingRouter.delete('/messaging/links/:pluginId/:platformUserId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { pluginId, platformUserId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            pluginId: z.string().max(200),
            platformUserId: z.string().max(200),
        }),
    );

    const service = ctx.container.get(MessagingLinksService);
    await service.remove(pluginId, platformUserId);

    ctx.status = 204;
});
