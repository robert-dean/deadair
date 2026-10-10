import type { ScopedContainer } from 'injectkit';
import { ServerKitMiddleware, firstQueryValue } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { PolicyService } from '@maroonedsoftware/policies';
import { LiquidsoapEndpoint } from '#modules/playout/liquidsoap.endpoint.js';
import { AUDIO_TOKEN_PARAM, verifyAudioToken } from '#modules/playout/playout.audio.token.js';

/**
 * The gate on the audio the player fetches: a signed URL, or a session that holds the read floor.
 *
 * Three routes are fetched by processes that cannot hold a session and cannot present a header —
 * Liquidsoap pulling a segment or the station's copy of a record, the mixer joining takes and pads,
 * the analysis sidecar measuring a beat — and the same three are fetched by the console through the
 * SDK, with its bearer token, to play a segment back. They were `security: none` for the first set
 * of callers and open to everyone as a result: `/playout/audio/{sourceId}` is a full-length copy of
 * a licensed record, pulled from the provider through the operator's own credentials on a miss, and
 * a uuid the console prints in its own JSON is not a secret.
 *
 * So the routes stay `security: none` in the contract, for the reason the bridge's do — a policy
 * evaluates against a session these callers do not have — and this is the policy instead. A token
 * in the query that signs the path with the bridge secret gets in (see `playout.audio.token.ts`);
 * anything else is held to exactly what the file's floor would have asked of it: the two steps
 * `requirePolicy` takes in a generated router, taken here because that helper is typed for a route
 * and this is not one. Listed by path rather than by prefix because the three live in two areas,
 * and the contract test beside this is what keeps the list and the contracts' `security: none`
 * operations the same set.
 *
 * After the authorization context, unlike the bridge gate: the second branch needs the session the
 * authentication middleware resolved, and a headerless fetch costs that middleware nothing.
 */

/**
 * The routes this gates, as the paths they are served at. Ids are uuids; a stored blob is a sha256 and an extension.
 *
 * **Matched the way the ROUTER matches, not the way the contract spells them.** `@koa/router` is
 * case-insensitive and serves a path with a trailing slash as the path without one, and the generated
 * routers cannot be told otherwise. A gate stricter than the router is a hole: `/SEGMENTS/<id>/audio`
 * or `/playout/audio/<id>/` used to miss every pattern here and reach the route ungated. So every
 * pattern is `/i` and tolerates one trailing slash. Being looser than the router costs nothing, since
 * a path the router would not serve is a 404 behind a gate either way.
 */
export const SIGNED_AUDIO_PATHS: readonly RegExp[] = [
    /^\/segments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/audio\/?$/i,
    /^\/audio\/[0-9a-f]{64}\/[A-Za-z0-9]{1,8}\/?$/i,
    /^\/playout\/audio\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i,
];

export const isSignedAudioPath = (path: string): boolean => SIGNED_AUDIO_PATHS.some(pattern => pattern.test(path));

/** The floor the render area declares, which is what these routes would carry had they a policy. */
const FLOOR = 'platform.view';

export const signedAudioMiddleware = (): ServerKitMiddleware => {
    return async (ctx, next) => {
        if (!isSignedAudioPath(ctx.path)) {
            await next();
            return;
        }

        const container = ctx.container as ScopedContainer;
        const token = firstQueryValue(ctx.query[AUDIO_TOKEN_PARAM]);
        if (token === undefined || token.length === 0) {
            // No token: the console, or anyone else, and the read floor applies exactly as it
            // would had the route been generated with it.
            const session = ctx.authenticationSession;
            if (session === invalidAuthenticationSession) {
                throw httpError(401).withDetails({ message: 'a session or a signed URL is required for audio' });
            }
            await container.get(PolicyService).assert(FLOOR, { session });
            await next();
            return;
        }

        const secret = container.get(LiquidsoapEndpoint).secret();
        // Verified against the path as it arrived, less a trailing slash the router ignores too. Its
        // CASE is kept: a token signs the path the station minted, so a case-varied copy of a signed
        // URL fails here with a 401, which is the closed way to be wrong.
        if (!verifyAudioToken(secret, ctx.path.replace(/\/+$/, ''), token, Date.now())) {
            // One answer for a bad signature, an expired one and an unseeded secret: a caller
            // presenting a token is the player, and the operator's fix is the same setting either
            // way.
            throw httpError(401).withDetails({ message: 'invalid or expired audio token' });
        }

        // Spent, so taken off the query before the route sees it. The token is this gate's business
        // and no contract declares it, and a route that validates its query strictly (the segment
        // audio route does, for `rendition`) would otherwise answer every signed fetch with a 400:
        // which is every break Liquidsoap ever pulls.
        const { [AUDIO_TOKEN_PARAM]: _spent, ...rest } = ctx.query;
        ctx.query = rest;
        await next();
    };
};
