import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { OAuthClientsService } from '#src/modules/oauth/oauth.clients.service.js';
import { OAuthConsentService } from '#src/modules/oauth/oauth.consent.service.js';
import { OAuthGrantsService } from '#src/modules/oauth/oauth.grants.service.js';
import {
    OAuthAuthorizationContextResult,
    OAuthAuthorizationDecision,
    OAuthAuthorizationOutcome,
    OAuthAuthorizationQuery,
    OAuthClientCreate,
    OAuthClientIssued,
    OAuthClientList,
    OAuthGrantList,
} from '../modules/oauth/types/oauth.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [oauth.ck](../../data/contracts/oauth/oauth.ck)
 */
export const OauthRouter = ServerKitRouter();

/**
 * Validate an app's authorization request for the consent page, and stash it for the signed-in person. A POST because it stashes: what is approved is exactly what was validated here
 * from [oauth.ck](../../data/contracts/oauth/oauth.ck#L21)
 */
OauthRouter.post('/auth/oauth/authorize/context', requirePolicy({ policy: 'platform.view' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, OAuthAuthorizationQuery);

    const service = ctx.container.get(OAuthConsentService);
    const result: OAuthAuthorizationContextResult = await service.describe(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Let the app act as the signed-in person. Once the account has a strong second factor, this needs one verified in the last five minutes
 * from [oauth.ck](../../data/contracts/oauth/oauth.ck#L36)
 */
OauthRouter.post('/auth/oauth/authorize/approve', requirePolicy({ policy: 'platform.view' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, OAuthAuthorizationDecision);

    const service = ctx.container.get(OAuthConsentService);
    const result: OAuthAuthorizationOutcome = await service.approve(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Turn the app away. It is told the person said no
 * from [oauth.ck](../../data/contracts/oauth/oauth.ck#L51)
 */
OauthRouter.post('/auth/oauth/authorize/deny', requirePolicy({ policy: 'platform.view' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, OAuthAuthorizationDecision);

    const service = ctx.container.get(OAuthConsentService);
    const result: OAuthAuthorizationOutcome = await service.deny(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every app registered with the station, by an operator or by itself
 * from [oauth.ck](../../data/contracts/oauth/oauth.ck#L66)
 */
OauthRouter.get('/auth/oauth/clients', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(OAuthClientsService);
    const result: OAuthClientList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Register an app by hand. The secret, for an app that keeps one, is in this response and nowhere else
 * from [oauth.ck](../../data/contracts/oauth/oauth.ck#L78)
 */
OauthRouter.post('/auth/oauth/clients', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, OAuthClientCreate);

    const service = ctx.container.get(OAuthClientsService);
    const result: OAuthClientIssued = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Withdraw an app. Every person's approval of it ends, and so does every token it holds
 * from [oauth.ck](../../data/contracts/oauth/oauth.ck#L99)
 */
OauthRouter.delete('/auth/oauth/clients/:clientId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { clientId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            clientId: z.string().max(200),
        }),
    );

    const service = ctx.container.get(OAuthClientsService);
    await service.revoke(clientId);

    ctx.status = 204;
});

/**
 * The apps the signed-in person has let act as them
 * from [oauth.ck](../../data/contracts/oauth/oauth.ck#L112)
 */
OauthRouter.get('/auth/oauth/grants', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(OAuthGrantsService);
    const result: OAuthGrantList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Disconnect an app. Every token it holds for this person stops working at once
 * from [oauth.ck](../../data/contracts/oauth/oauth.ck#L127)
 */
OauthRouter.delete('/auth/oauth/grants/:id', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(OAuthGrantsService);
    await service.revoke(id);

    ctx.status = 204;
});
