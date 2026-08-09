import type { ServerKitMiddleware } from '@maroonedsoftware/koa';

/**
 * Rescue Icecast's credential before ServerKit's authentication middleware
 * deletes it.
 *
 * `authenticationMiddleware` does `delete ctx.req.headers.authorization` on
 * every request, so no route can ever read an `Authorization` header for itself.
 * That is right for an API whose only credential is a bearer session, and it is
 * a problem for exactly one caller: Icecast's URL authenticator, which presents
 * the shared secret as HTTP basic because it cannot set a header of its own and
 * cannot be given one.
 *
 * So the credential is moved, before that delete, onto the same
 * `x-playout-secret` header the rest of the playout bridge already uses. The
 * alternatives were worse: putting the secret in the URL writes it into every
 * access log that records an address, and registering a `basic` scheme handler
 * would make it a way of authenticating to the whole API rather than the one
 * gate it belongs to.
 *
 * Scoped to that single path, so nothing else in the app changes shape. It never
 * overwrites a secret the caller sent directly, which keeps the two ways of
 * presenting it equivalent rather than ranked.
 */
export const LISTENER_HOOK_PATH = '/playout/bridge/listener';

export const listenerCredentialMiddleware = (): ServerKitMiddleware => {
    return async (ctx, next) => {
        if (ctx.path === LISTENER_HOOK_PATH) {
            const password = basicPassword(ctx.req.headers.authorization);
            if (password && !ctx.req.headers['x-playout-secret']) ctx.req.headers['x-playout-secret'] = password;
            // Moved, not copied. The authentication middleware behind this would
            // otherwise try to resolve a session from a `basic` scheme it has no handler
            // for, and warn about it once per listener arriving and once per listener
            // leaving — a log line per connection, saying nothing.
            if (password) delete ctx.req.headers.authorization;
        }
        await next();
    };
};

/**
 * The password out of an HTTP basic `Authorization` header, or `''`.
 *
 * The username is ignored: the secret is the whole gate, and there is one
 * caller. Exported for tests.
 */
export function basicPassword(header: string | undefined): string {
    if (!header) return '';

    const [scheme = '', value = ''] = header.split(' ', 2);
    if (scheme.toLowerCase() !== 'basic' || !value) return '';

    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator === -1 ? '' : decoded.slice(separator + 1);
}
