import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { AuthenticationRegistrationService } from '#src/modules/authentication/authentication.registration.service.js';
import { AuthenticationService } from '#src/modules/authentication/authentication.service.js';
import {
    AuthenticationLoginStart,
    AuthenticationLoginStartResponse,
    AuthenticationRegistration,
    AuthenticationRegistrationInput,
    AuthenticationRegistrationVerification,
    AuthenticationRequest,
    AuthenticationToken,
    AuthenticationTokenOutput,
    AuthenticationTokenResponse,
    AuthenticationTokenResponseOutput,
    OidcLoginCallback,
} from '../modules/authentication/types/authentication.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [authentication.ck](file://./../../data/contracts/authentication/authentication.ck)
 */
export const AuthenticationRouter = ServerKitRouter();

/**
 * Request authenticated token
 * from [authentication.ck](file://./../../data/contracts/authentication/authentication.ck#L12)
 * anonymous access, no security required
 */
AuthenticationRouter.post('/auth/token', bodyParserMiddleware(['urlencoded', 'json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, AuthenticationRequest);

    const service = ctx.container.get(AuthenticationService);
    const result: AuthenticationTokenResponseOutput = await service.requestToken(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Register a new login
 * from [authentication.ck](file://./../../data/contracts/authentication/authentication.ck#L29)
 * anonymous access, no security required
 */
AuthenticationRouter.post('/auth/login/register', bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, AuthenticationRegistrationInput);

    const service = ctx.container.get(AuthenticationRegistrationService);
    const result: AuthenticationRegistration = await service.registerLogin(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Verify a login registration
 * from [authentication.ck](file://./../../data/contracts/authentication/authentication.ck#L45)
 * anonymous access, no security required
 */
AuthenticationRouter.post('/auth/login/verify', bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, AuthenticationRegistrationVerification);

    const service = ctx.container.get(AuthenticationRegistrationService);
    const result: AuthenticationTokenOutput = await service.verifyLoginRegistration(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Start a password-less login process
 * from [authentication.ck](file://./../../data/contracts/authentication/authentication.ck#L61)
 * anonymous access, no security required
 */
AuthenticationRouter.post('/auth/login/start', bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, AuthenticationLoginStart);

    const service = ctx.container.get(AuthenticationService);
    const result: AuthenticationLoginStartResponse = await service.startLogin(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * OIDC callback endpoint. The IdP redirects the user-agent here with `code` and `state`. Server completes the authorization, issues a session, and returns an HTML page that hands the token back to the SPA.
 * from [authentication.ck](file://./../../data/contracts/authentication/authentication.ck#L77)
 * anonymous access, no security required
 * @internal
 */
AuthenticationRouter.get('/auth/login/oidc/callback', async ctx => {
    const query = await parseAndValidate(ctx.query, OidcLoginCallback.strict());

    const service = ctx.container.get(AuthenticationService);
    const result: string = await service.handleOidcCallback(query);

    ctx.status = 200;
    ctx.type = 'text/html';
    ctx.body = result;
});

/**
 * This is an internal endpoint handling the redirect routing for magic links. When the user follows the link the browser will direct the user to this endpoint which renders as a blank page, and then the user will be redirected to the provided magic link url.
 * from [authentication.ck](file://./../../data/contracts/authentication/authentication.ck#L91)
 * @internal
 */
AuthenticationRouter.get('/auth/login/link/redirect', requirePolicy(), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            token: z.string().max(100),
            token_type: z.string().max(100),
        }),
    );

    const service = ctx.container.get(AuthenticationService);
    const result: string = await service.magicLinkRedirect(query);

    ctx.status = 200;
    ctx.type = 'text/html';
    ctx.body = result;
});
