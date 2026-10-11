// A record URL is fetched by the app with no headers from us, so the authorization has to survive in
// a query string — and the scheme is the Spotify shim's, unchanged, because it is the same URL doing
// the same job. Three processes now sign or verify it: the app (TypeScript), the shim (Go) and this
// container.
//
// No type system spans those three, and the symptom of a divergence would be every Apple Music fetch
// 401ing on air against a container that looks healthy. So the wire format is pinned here against the
// SAME vector the other two pin (`TestTokenMatchesTheAppsWireFormat` in
// stream/spotify-shim/token_test.go), and a change to any side fails its own suite.

import { describe, expect, it } from 'vitest';

import { signToken, verifyToken } from '../src/token.ts';

const secret = 's3cr3t';
const nowMs = 1_700_000_000_000;

describe('the signed-URL scheme', () => {
    it('matches the vector the app and the Go shim pin', () => {
        expect(signToken(secret, '4PTG3Z6ehGkBFwjybzWkR8', 1_785_247_352_000)).toBe('1785247352.6rV-wqRLfayJubNy9JWlD_tFoTyQXZHcvP7T_ewGdcg');
    });

    it('accepts the token the app would have sent', () => {
        expect(
            verifyToken(secret, '4PTG3Z6ehGkBFwjybzWkR8', '1785247352.6rV-wqRLfayJubNy9JWlD_tFoTyQXZHcvP7T_ewGdcg', 1_785_247_292_000),
        ).toBeUndefined();
    });

    it('accepts what it signed itself, for an Apple catalog id', () => {
        expect(verifyToken(secret, '1440857781', signToken(secret, '1440857781', nowMs + 3_600_000), nowMs)).toBeUndefined();
    });
});

describe('what it refuses', () => {
    it('a token minted for a different record', () => {
        // The signature covers the id, so a URL for one record cannot be pointed at another — which is
        // the only thing stopping one signed URL from being a key to the whole catalog.
        const token = signToken(secret, '1440857781', nowMs + 3_600_000);
        expect(verifyToken(secret, '1440857782', token, nowMs)).toBe('bad token signature');
    });

    it('a token signed with another secret', () => {
        const token = signToken('another-secret', '1440857781', nowMs + 3_600_000);
        expect(verifyToken(secret, '1440857781', token, nowMs)).toBe('bad token signature');
    });

    it('an expired token', () => {
        const token = signToken(secret, '1440857781', nowMs + 60_000);
        expect(verifyToken(secret, '1440857781', token, nowMs + 120_000)).toBe('token expired');
    });

    it('an expiry that was rewritten, because the expiry is signed too', () => {
        const token = signToken(secret, '1440857781', nowMs + 60_000);
        const forged = `99999999999.${token.slice(token.indexOf('.') + 1)}`;
        expect(verifyToken(secret, '1440857781', forged, nowMs)).toBe('bad token signature');
    });

    it('malformed and missing tokens, each named', () => {
        expect(verifyToken(secret, 'x', undefined, nowMs)).toBe('malformed token');
        expect(verifyToken(secret, 'x', '', nowMs)).toBe('malformed token');
        expect(verifyToken(secret, 'x', 'nodot', nowMs)).toBe('malformed token');
        // `Buffer.from(…, 'base64url')` drops what it cannot read rather than throwing, so this case
        // has to be caught by a pattern or it would be reported as a wrong signature instead.
        expect(verifyToken(secret, 'x', '123.not-base64!!', nowMs)).toBe('malformed token signature');
        expect(verifyToken(secret, 'x', '123.', nowMs)).toBe('malformed token signature');
    });

    it('everything, when no secret is configured', () => {
        // Refusing rather than serving is the whole point: a player that skipped verification because
        // it had nothing to verify with would be an open Apple Music proxy.
        expect(verifyToken('', 'x', signToken('', 'x', nowMs + 60_000), nowMs)).toBe('no signing secret configured');
    });
});
