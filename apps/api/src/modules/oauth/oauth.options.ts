import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { protectedResourceMetadataUrl } from '@maroonedsoftware/authentication';

/** Where the MCP endpoint is on the API, which is `/api/mcp` on the station's origin. */
export const MCP_PATH = '/mcp';

/**
 * The addresses the station's OAuth authorization server is known by, worked out once from
 * `APP_BASE_URL` and `SPA_BASE_URL`.
 *
 * **The issuer is the ORIGIN**, with no path, so RFC 8414 discovery is exactly
 * `<origin>/.well-known/oauth-authorization-server`, which every edge forwards to the API. An issuer
 * under `/api` would be found only by a client's third guess, and whether a client guesses a third
 * time is the client's business. The protected resource, the MCP endpoint, is `<origin>/api/mcp`,
 * which is what an operator types into Claude; its metadata is the path-inserted
 * `<origin>/.well-known/oauth-protected-resource/api/mcp`. The consent page is the console's
 * `/oauth/authorize`, because signing in lives in the console; the token and registration
 * endpoints are the API's.
 *
 * A station with no `APP_BASE_URL` has no address to be an issuer at, and answers `undefined` from
 * {@link OAuthOptions.fromConfig}; everything that needs one then behaves as if OAuth were off.
 */
@Injectable()
export class OAuthOptions {
    constructor(
        readonly issuer: string,
        readonly resource: string,
        readonly resourceMetadataUrl: string,
        readonly authorizationEndpoint: string,
        readonly tokenEndpoint: string,
        readonly registrationEndpoint: string,
        readonly mcpPath: string = MCP_PATH,
    ) {}

    static fromConfig(config: AppConfig): OAuthOptions | undefined {
        const origin = originOf(String(config.get('APP_BASE_URL', '')));
        if (origin === undefined) return undefined;
        const console = originOf(String(config.get('SPA_BASE_URL', ''))) ?? origin;
        const resource = `${origin}/api${MCP_PATH}`;
        return new OAuthOptions(
            origin,
            resource,
            protectedResourceMetadataUrl(resource),
            `${console}/oauth/authorize`,
            `${origin}/api/auth/oauth/token`,
            `${origin}/api/auth/oauth/register`,
        );
    }

    /**
     * Whether a request path is the MCP endpoint. Koa's router matches without regard to case or a
     * trailing slash, so this does too: anything the router would hand to the MCP route has to be
     * judged by the MCP route's audience.
     */
    isMcpPath(path: string): boolean {
        return path.replace(/\/+$/, '').toLowerCase() === this.mcpPath;
    }
}

/** `https://radio.example.com/` as `https://radio.example.com`, or nothing for a blank or bad value. */
function originOf(raw: string): string | undefined {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    try {
        return new URL(trimmed).origin;
    } catch {
        return undefined;
    }
}
