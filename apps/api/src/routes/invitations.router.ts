import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { InvitationsService } from '#src/modules/users/invitations.service.js';
import { Invitation, InvitationCreate, InvitationList } from '../modules/users/types/invitations.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [invitations.ck](../../data/contracts/users/invitations.ck)
 */
export const InvitationsRouter = ServerKitRouter();

/**
 * Every invitation, newest first, with the link of each one still open
 * from [invitations.ck](../../data/contracts/users/invitations.ck) `GET /invitations`
 */
InvitationsRouter.get('/invitations', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(InvitationsService);
    const result: InvitationList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Invite somebody into a role. An open invitation to the same address is withdrawn first, so this is also how one is sent again. Refused for an address that already has an account
 * from [invitations.ck](../../data/contracts/users/invitations.ck) `POST /invitations`
 */
InvitationsRouter.post('/invitations', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, InvitationCreate);

    const service = ctx.container.get(InvitationsService);
    const result: Invitation = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Withdraw an invitation. Its link stops working at once. Nothing is deleted: it stays in the list as withdrawn
 * from [invitations.ck](../../data/contracts/users/invitations.ck) `DELETE /invitations/{id}`
 */
InvitationsRouter.delete('/invitations/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(InvitationsService);
    const result: Invitation = await service.revoke(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
