import { AppConfig } from '@maroonedsoftware/appconfig';
import { IsHttpError, type HttpError } from '@maroonedsoftware/errors';
import type { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { OAuthOptions } from '#modules/oauth/oauth.options.js';
import { oauthIsEnabled } from '#modules/oauth/oauth.settings.js';

/**
 * Points every 401 at the MCP endpoint to the document that says how to get a token for it.
 *
 * RFC 9728 has a protected resource name its metadata in the `WWW-Authenticate` challenge, and that
 * parameter is what turns a bare 401 into something an MCP client can act on: Claude reads it,
 * fetches the metadata, learns the station is its own authorization server, and runs the flow. A
 * 401 without it leaves a connector that says only that it could not connect. Claude honours the
 * pointer only on a 401, so this edits nothing else.
 *
 * It catches and rethrows rather than editing a response on the way out, because a 401 here is
 * thrown, by `requirePolicy` or by the authorization context, and turned into a response by the
 * error middleware; which is why this sits immediately inside that middleware, wrapping everything
 * else, so a 401 from any layer is covered. A challenge that already names its metadata is left as
 * it is, and one of another scheme is not touched.
 *
 * Only while OAuth is on: until then the metadata document answers 404, and a challenge pointing at
 * it would send a client somewhere that says nothing.
 */
export const oauthChallengeMiddleware = (config: AppConfig): ServerKitMiddleware => {
    const oauth = OAuthOptions.fromConfig(config);

    return async (ctx, next) => {
        if (oauth === undefined || !oauth.isMcpPath(ctx.path)) {
            await next();
            return;
        }
        try {
            await next();
        } catch (error) {
            if (IsHttpError(error) && error.statusCode === 401 && oauthIsEnabled(config)) {
                throw withResourceMetadata(error, oauth.resourceMetadataUrl);
            }
            throw error;
        }
    };
};

/** The error with `resource_metadata="<url>"` added to its Bearer challenge, or a challenge made for it. */
export function withResourceMetadata(error: HttpError, metadataUrl: string): HttpError {
    const headers = error.headers ?? {};
    const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === 'www-authenticate');
    const challenge = key === undefined ? undefined : headers[key];
    const parameter = `resource_metadata="${metadataUrl}"`;

    if (challenge !== undefined && (challenge.includes('resource_metadata=') || !/^bearer\b/i.test(challenge))) return error;

    if (key !== undefined && key !== 'WWW-Authenticate') delete headers[key];
    return error.withHeaders({ 'WWW-Authenticate': challenge === undefined ? `Bearer ${parameter}` : `${challenge}, ${parameter}` });
}
