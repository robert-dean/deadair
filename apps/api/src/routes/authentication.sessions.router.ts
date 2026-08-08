import { ServerKitRouter } from '@maroonedsoftware/koa';
import { SessionsService } from '#src/modules/authentication/sessions.service.js';

/**
 * generated from [authentication.sessions.ck](file://./../../data/contracts/authentication/authentication.sessions.ck)
 */
export const AuthenticationSessionsRouter = ServerKitRouter();

/**
 * revoke the caller's current session (self sign-out). Deliberately carries no policy gate: signing out must always clear the browser's httpOnly refresh cookie, including for a caller whose access token has already expired. A 401 here would leave a 30-day refresh cookie behind that silently signs the user back in on the next page load. SessionsService revokes the session only when the caller is actually authenticated; an anonymous caller still gets 204 and a cleared cookie.
 * from [authentication.sessions.ck](file://./../../data/contracts/authentication/authentication.sessions.ck#L14)
 * anonymous access, no security required
 */
AuthenticationSessionsRouter.post('/auth/logout', async ctx => {
    const service = ctx.container.get(SessionsService);
    await service.revokeCurrentSession();

    ctx.status = 204;
});
