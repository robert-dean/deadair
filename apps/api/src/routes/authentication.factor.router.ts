import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { AuthenticationRegistrationService } from '#src/modules/authentication/authentication.registration.service.js';
import { AuthenticationService } from '#src/modules/authentication/authentication.service.js';
import {
    AuthenticationFactor,
    AuthenticationFactorMethod,
    AuthenticationTokenOutput,
    FactorChallengeStartRequest,
    FactorChallengeStartResponseOutput,
    StepUpStartRequest,
    StepUpStartResponseOutput,
} from '../modules/authentication/types/authentication.types.js';
import {
    AuthenticationFactorRegistration,
    AuthenticationFactorRegistrationResponse,
    AuthenticationFactorRegistrationVerification,
} from '../modules/authentication/types/registration.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [authentication.factor.ck](../../data/contracts/authentication/authentication.factor.ck)
 */
export const AuthenticationFactorRouter = ServerKitRouter();

/**
 * List authentication factors
 * from [authentication.factor.ck](../../data/contracts/authentication/authentication.factor.ck#L21)
 */
AuthenticationFactorRouter.get('/auth/factors', requirePolicy({ policy: false }), async ctx => {
    const service = ctx.container.get(AuthenticationService);
    const result: AuthenticationFactor[] = await service.listFactors();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Register an authentication factor
 * from [authentication.factor.ck](../../data/contracts/authentication/authentication.factor.ck#L33)
 */
AuthenticationFactorRouter.post('/auth/factors/register', requirePolicy({ policy: false }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, AuthenticationFactorRegistration);

    const service = ctx.container.get(AuthenticationRegistrationService);
    const result: AuthenticationFactorRegistrationResponse = await service.registerFactor(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Verify an authentication factor registration
 * from [authentication.factor.ck](../../data/contracts/authentication/authentication.factor.ck#L48)
 */
AuthenticationFactorRouter.post('/auth/factors/verify', requirePolicy({ policy: false }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, AuthenticationFactorRegistrationVerification);

    const service = ctx.container.get(AuthenticationRegistrationService);
    const result: AuthenticationTokenOutput = await service.verifyFactorRegistration(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Issue a factor verification challenge for a pending MFA round. Authenticated via the short-lived `mfa_challenge_id` in the body, not by session — this is the only /auth/factors/* route that does not require an authenticated session.
 * from [authentication.factor.ck](../../data/contracts/authentication/authentication.factor.ck#L63)
 * anonymous access, no security required
 */
AuthenticationFactorRouter.post('/auth/factors/start', bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, FactorChallengeStartRequest);

    const service = ctx.container.get(AuthenticationService);
    const result: FactorChallengeStartResponseOutput = await service.startFactorChallenge(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Mint a fresh MFA challenge for the *current* authenticated session so the SPA can satisfy a `step_up_required` denial. Optionally filters eligible factors against an inbound `StepUpRequirement` hint. Returns `enrollment_required` when no enrolled factor matches the requirement so the SPA can route the user into enrollment instead of getting stuck.
 * from [authentication.factor.ck](../../data/contracts/authentication/authentication.factor.ck#L79)
 */
AuthenticationFactorRouter.post('/auth/mfa/start', requirePolicy({ policy: false }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, StepUpStartRequest);

    const service = ctx.container.get(AuthenticationService);
    const result: StepUpStartResponseOutput = await service.startStepUpChallenge(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Remove one of the caller's own factors. Answered only for `authenticator` today, and only after a recent strong-factor verification: the same gate enrolment sits behind once a strong factor exists, so a stolen session cannot quietly switch the second factor off. Removing the last authenticator turns the sign-in challenge off for that account.
 * from [authentication.factor.ck](../../data/contracts/authentication/authentication.factor.ck#L98)
 */
AuthenticationFactorRouter.delete('/auth/factors/:method/:methodId', requirePolicy({ policy: false }), async ctx => {
    const { method, methodId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            method: AuthenticationFactorMethod,
            methodId: z.string().max(255),
        }),
    );

    const service = ctx.container.get(AuthenticationRegistrationService);
    await service.removeFactor(method, methodId);

    ctx.status = 204;
});
