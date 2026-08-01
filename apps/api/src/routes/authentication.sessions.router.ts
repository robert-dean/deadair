import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { SessionsService } from '#src/modules/authentication/sessions.service.js';

/**
 * generated from [authentication.sessions.ck](file://./../../data/contracts/authentication/authentication.sessions.ck)
 */
export const AuthenticationSessionsRouter = ServerKitRouter();

/**
 * revoke the caller's current session (self sign-out)
 * from [authentication.sessions.ck](file://./../../data/contracts/authentication/authentication.sessions.ck#L14)
 */
AuthenticationSessionsRouter.post('/auth/logout', requirePolicy(), async ctx => {
    const service = ctx.container.get(SessionsService);
    await service.revokeMySession(ctx.state.sessionToken);

    ctx.status = 204;
});
