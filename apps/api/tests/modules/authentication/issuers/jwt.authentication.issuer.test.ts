import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { AuthenticationSession, AuthenticationSessionService, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';

import { DeadairJwtAuthenticationIssuer } from '../../../../src/modules/authentication/issuers/jwt.authentication.issuer.js';

// No database, no cache: the issuer's only collaborator is stubbed. `lookupSessionFromJwt` is the
// single method under exercise, so the stub is cast rather than fully implemented.
const issuerWithLookup = (lookup: AuthenticationSessionService['lookupSessionFromJwt']): DeadairJwtAuthenticationIssuer =>
    new DeadairJwtAuthenticationIssuer({ lookupSessionFromJwt: lookup } as unknown as AuthenticationSessionService);

const liveSession = (): AuthenticationSession => ({
    subject: 'actor-1',
    sessionToken: 'session-token-1',
    issuedAt: DateTime.utc(),
    lastAccessedAt: DateTime.utc(),
    expiresAt: DateTime.utc().plus({ hours: 1 }),
    factors: [],
    claims: { actorType: 'user' },
    familyId: undefined,
});

describe('DeadairJwtAuthenticationIssuer.parse', () => {
    it('returns the session unchanged when the lookup succeeds', async () => {
        const session = liveSession();
        const issuer = issuerWithLookup(vi.fn().mockResolvedValue({ session, jwtPayload: {} }));

        await expect(issuer.parse('jwt', {})).resolves.toBe(session);
    });

    it('resolves to the sentinel, rather than throwing, when the lookup yields no session', async () => {
        const issuer = issuerWithLookup(vi.fn().mockResolvedValue({ session: undefined, jwtPayload: {} }));

        // Identity, not shape: `requirePolicy` gates on `session === invalidAuthenticationSession`,
        // so a structurally equal copy would read as an authenticated session.
        await expect(issuer.parse('jwt', {})).resolves.toBe(invalidAuthenticationSession);
    });

    it('resolves to the sentinel when the lookup rejects with 401 (expired or revoked session)', async () => {
        // This is how the real service reports failure — it throws rather than returning an empty
        // session. Letting that escape would abort the middleware chain before `security: none`
        // routes such as POST /auth/logout could run.
        const issuer = issuerWithLookup(vi.fn().mockRejectedValue(unauthorizedError('Bearer error="invalid_token"')));

        await expect(issuer.parse('expired-jwt', {})).resolves.toBe(invalidAuthenticationSession);
    });

    it('propagates non-401 failures instead of downgrading them to anonymous', async () => {
        // A session cache outage is a 500. Converting it to the sentinel would sign every caller
        // out and answer 401 across the API.
        const outage = httpError(503);
        const issuer = issuerWithLookup(vi.fn().mockRejectedValue(outage));

        await expect(issuer.parse('jwt', {})).rejects.toBe(outage);
    });

    it('propagates a plain Error thrown by the session lookup', async () => {
        const boom = new Error('redis connection reset');
        const issuer = issuerWithLookup(vi.fn().mockRejectedValue(boom));

        await expect(issuer.parse('jwt', {})).rejects.toBe(boom);
    });
});
