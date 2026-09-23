import {
    AuthenticationSession,
    AuthenticationSessionService,
    JwtAuthenticationIssuer,
    invalidAuthenticationSession,
} from '@maroonedsoftware/authentication';
import { Injectable } from 'injectkit';
import { IsHttpError } from '@maroonedsoftware/errors';
import { ServerKitContext } from '@maroonedsoftware/koa';
import { OAuthOptions } from '#modules/oauth/oauth.options.js';

@Injectable()
export class DeadairJwtAuthenticationIssuer extends JwtAuthenticationIssuer {
    constructor(
        private readonly sessionService: AuthenticationSessionService,
        private readonly context: ServerKitContext,
        // Absent on a station with no public address, which therefore has no MCP resource.
        private readonly oauth: OAuthOptions | undefined,
    ) {
        super();
    }

    /**
     * The audience a token must carry on this request: the MCP resource at the MCP endpoint, and the
     * station's own everywhere else (`undefined` lets the session service use its configured one).
     *
     * This is what keeps a token an app was granted for the MCP endpoint off every other route, and
     * a console session off the MCP endpoint, with no route having to ask. A token for the wrong
     * audience is refused before its session is read, and comes back here as the sentinel.
     */
    private expectedAudience(): string | undefined {
        return this.oauth?.isMcpPath(this.context.path) ? this.oauth.resource : undefined;
    }

    /**
     * Resolve a bearer token into its stored session.
     *
     * A well-formed JWT that no longer resolves to a live session (expired token, revoked or
     * expired session, subject mismatch) yields the `invalidAuthenticationSession` sentinel
     * instead of throwing. Throwing here aborts the global middleware chain before `next()`,
     * taking down every downstream middleware and the route handler with it — including
     * `security: none` routes that exist precisely to tolerate a dead token. `POST /auth/logout`
     * is the case that matters: `SessionsService.revokeCurrentSession` sets the cookie clear-flag
     * from inside the handler, so if the handler never runs the browser keeps its 30-day httpOnly
     * refresh cookie and silently signs back in on the next page load.
     *
     * Gated routes are unaffected. `requirePolicy` in `@maroonedsoftware/koa` checks
     * `session === invalidAuthenticationSession` and throws the identical
     * `unauthorizedError('Bearer error="invalid_token"')` this method used to throw, so those
     * routes still answer 401 with the same `WWW-Authenticate` challenge.
     *
     * That identity comparison is a contract: return the exported sentinel instance itself.
     * A structurally equal copy would compare unequal and read as a valid session.
     */
    override async parse(token: string, _payload: unknown): Promise<AuthenticationSession> {
        try {
            const { session } = await this.sessionService.lookupSessionFromJwt(token, undefined, this.expectedAudience());
            return session ?? invalidAuthenticationSession;
        } catch (error) {
            // `lookupSessionFromJwt` reports every authentication failure by throwing 401
            // `Bearer error="invalid_token"` — failed JWT verification, missing session, and
            // subject mismatch alike. Those are "not authenticated", which the sentinel already
            // expresses, so they are converted rather than propagated.
            if (IsHttpError(error) && error.statusCode === 401) {
                return invalidAuthenticationSession;
            }
            // Anything else is infrastructure (e.g. the session cache is unreachable). That is a
            // 500, not an anonymous request: swallowing it would silently downgrade an outage
            // into "signed out" for every caller.
            throw error;
        }
    }
}
