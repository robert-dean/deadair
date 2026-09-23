// A 401 at the MCP endpoint has to say where to find out how to get a token (RFC 9728), or an MCP
// client like Claude's connector has nothing to go on. Nothing else about any response changes.

import { describe, expect, it } from 'vitest';
import { httpError, IsHttpError, unauthorizedError } from '@maroonedsoftware/errors';
import type { ServerKitContext } from '@maroonedsoftware/koa';

import { oauthChallengeMiddleware, withResourceMetadata } from '../../../src/server/middleware/oauth.challenge.middleware.js';
import { settingsConfig } from '../../utils/settings.config.js';

const METADATA = 'https://radio.example.com/.well-known/oauth-protected-resource/api/mcp';

async function run(path: string, thrown: unknown, enabled = 'true') {
    const middleware = oauthChallengeMiddleware(settingsConfig({ APP_BASE_URL: 'https://radio.example.com', 'oauth.enabled': enabled }).config);
    return await middleware({ path } as ServerKitContext, async () => {
        throw thrown;
    }).catch((error: unknown) => error);
}

const challengeOf = (error: unknown) => (IsHttpError(error) ? error.headers?.['WWW-Authenticate'] : undefined);

describe('oauthChallengeMiddleware', () => {
    it('adds the metadata pointer to a Bearer challenge at the MCP endpoint', async () => {
        const error = await run('/mcp', unauthorizedError('Bearer error="invalid_token"'));
        expect(challengeOf(error)).toBe(`Bearer error="invalid_token", resource_metadata="${METADATA}"`);
    });

    it('leaves a 401 anywhere else alone', async () => {
        const error = await run('/settings', unauthorizedError('Bearer error="invalid_token"'));
        expect(challengeOf(error)).toBe('Bearer error="invalid_token"');
    });

    it('leaves other statuses alone', async () => {
        const error = await run('/mcp', httpError(403));
        expect(challengeOf(error)).toBeUndefined();
    });

    it('points nowhere while OAuth is off, since the document would answer 404', async () => {
        const error = await run('/mcp', unauthorizedError('Bearer error="invalid_token"'), 'false');
        expect(challengeOf(error)).toBe('Bearer error="invalid_token"');
    });
});

describe('withResourceMetadata', () => {
    it('makes a Bearer challenge for a 401 that had none', () => {
        expect(challengeOf(withResourceMetadata(httpError(401), METADATA))).toBe(`Bearer resource_metadata="${METADATA}"`);
    });

    it('does not name the document twice', () => {
        const error = unauthorizedError(`Bearer resource_metadata="${METADATA}"`);
        expect(challengeOf(withResourceMetadata(error, METADATA))).toBe(`Bearer resource_metadata="${METADATA}"`);
    });

    it('leaves a challenge of another scheme alone', () => {
        expect(challengeOf(withResourceMetadata(unauthorizedError('Basic realm="x"'), METADATA))).toBe('Basic realm="x"');
    });
});
