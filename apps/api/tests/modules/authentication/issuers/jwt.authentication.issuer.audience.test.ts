// A token an app was granted for the MCP endpoint is bound to that resource, and the session service
// refuses it wherever a different audience is asked for. What decides which audience is asked for is
// this issuer, by path: the MCP resource at the MCP endpoint and the station's own everywhere else.

import { describe, expect, it, vi } from 'vitest';
import { invalidAuthenticationSession, type AuthenticationSessionService } from '@maroonedsoftware/authentication';
import { unauthorizedError } from '@maroonedsoftware/errors';
import type { ServerKitContext } from '@maroonedsoftware/koa';

import { DeadairJwtAuthenticationIssuer } from '../../../../src/modules/authentication/issuers/jwt.authentication.issuer.js';
import { OAuthOptions } from '../../../../src/modules/oauth/oauth.options.js';
import { settingsConfig } from '../../../utils/settings.config.js';

const oauth = OAuthOptions.fromConfig(settingsConfig({ APP_BASE_URL: 'https://radio.example.com' }).config);
const SESSION = { sessionToken: 's', subject: 'actor' };

function issuerAt(path: string, withOAuth = true) {
    const options = withOAuth ? oauth : undefined;
    const lookupSessionFromJwt = vi.fn(async () => ({ session: SESSION, jwtPayload: {} }));
    const issuer = new DeadairJwtAuthenticationIssuer(
        { lookupSessionFromJwt } as unknown as AuthenticationSessionService,
        { path } as unknown as ServerKitContext,
        options,
    );
    return { parse: () => issuer.parse('token', {}), lookupSessionFromJwt };
}

describe('DeadairJwtAuthenticationIssuer audience', () => {
    it('asks for the MCP resource at the MCP endpoint', async () => {
        const h = issuerAt('/mcp');
        await h.parse();
        expect(h.lookupSessionFromJwt).toHaveBeenCalledWith('token', undefined, 'https://radio.example.com/api/mcp');
    });

    it("asks for the station's own audience everywhere else", async () => {
        const h = issuerAt('/settings');
        await h.parse();
        expect(h.lookupSessionFromJwt).toHaveBeenCalledWith('token', undefined, undefined);
    });

    it('asks for the station audience on a station with no public address, which has no MCP resource', async () => {
        const h = issuerAt('/mcp', false);
        await h.parse();
        expect(h.lookupSessionFromJwt).toHaveBeenCalledWith('token', undefined, undefined);
    });

    it('turns a token for the wrong audience into the unauthenticated sentinel', async () => {
        const h = issuerAt('/settings');
        h.lookupSessionFromJwt.mockRejectedValueOnce(unauthorizedError('Bearer error="invalid_token"'));
        await expect(h.parse()).resolves.toBe(invalidAuthenticationSession);
    });
});
