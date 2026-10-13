import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { InvitationAcceptService } from '#src/modules/users/invitation.accept.service.js';
import { InvitationsService } from '#src/modules/users/invitations.service.js';
import {
    Invitation,
    InvitationAccept,
    InvitationAcceptStart,
    InvitationAcceptStartResponse,
    InvitationAccepted,
    InvitationCreate,
    InvitationDetails,
    InvitationList,
    InvitationToken,
} from '../modules/users/types/invitations.types.js';
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

/**
 * What an open invitation is for: the address, the role and the station. Changes nothing
 * from [invitations.ck](../../data/contracts/users/invitations.ck) `POST /invitations/accept/details`
 * anonymous access, no security required
 */
InvitationsRouter.post('/invitations/accept/details', bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, InvitationToken);

    const service = ctx.container.get(InvitationAcceptService);
    const result: InvitationDetails = await service.details(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Check the password and start setting up the second step. Nothing is saved, and starting again replaces the setup
 * from [invitations.ck](../../data/contracts/users/invitations.ck) `POST /invitations/accept/start`
 * anonymous access, no security required
 */
InvitationsRouter.post('/invitations/accept/start', bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, InvitationAcceptStart);

    const service = ctx.container.get(InvitationAcceptService);
    const result: InvitationAcceptStartResponse = await service.start(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Accept: make the account with its password, its second step and its role, all at once, and spend the invitation
 * from [invitations.ck](../../data/contracts/users/invitations.ck) `POST /invitations/accept`
 * anonymous access, no security required
 */
InvitationsRouter.post('/invitations/accept', bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, InvitationAccept);

    const service = ctx.container.get(InvitationAcceptService);
    const result: InvitationAccepted = await service.accept(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});
