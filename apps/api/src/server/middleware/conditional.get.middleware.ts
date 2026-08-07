import { ServerKitMiddleware } from '@maroonedsoftware/koa';

/**
 * Turns a fresh 200 that carries an `ETag` into a 304.
 *
 * Koa does not do this by itself: `ctx.fresh` compares the request's `If-None-Match` against the
 * response's `ETag` but acting on it is the application's job. Neither can the route do it, because
 * ContractKit's generated routers pin `ctx.status` to the status declared on the first response
 * with a body, so a service has no way to answer 304 by returning.
 *
 * Written against the ETag rather than against any particular route: a handler opts in simply by
 * setting one, which today means the art route and tomorrow whatever else wants revalidation.
 * `GET`/`HEAD` only, and only on a 200, so a freshly created or redirected response is left alone.
 */
export const conditionalGetMiddleware: () => ServerKitMiddleware = () => {
    return async (ctx, next) => {
        await next();

        if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return;
        if (ctx.status !== 200 || !ctx.response.get('ETag')) return;
        if (!ctx.fresh) return;

        // Assigning the status is what drops the body: Koa strips the payload and the
        // content-length/content-type headers for a 304, which is exactly the response a
        // revalidation wants.
        ctx.status = 304;
    };
};
