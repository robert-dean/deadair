import { describe, expect, it } from 'vitest';
import { SdkError } from '@deadair/sdk';

import {
    apiErrorDetails,
    apiErrorMessage,
    authChallenge,
    isClientError,
    isInsufficientScope,
    isInvalidToken,
    isStepUpRequired,
    sdkError,
} from '../../src/api/sdk.error';

function failure(status: number, headers: Record<string, string> = {}, body: unknown = {}): SdkError {
    return new SdkError(status, 'Error', body, new Headers(headers));
}

/** The exact header the API sends for a dead token. */
function invalidToken(status = 401): SdkError {
    return failure(status, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
}

describe('sdkError', () => {
    it('narrows an SdkError and rejects anything else', () => {
        const error = failure(500);
        expect(sdkError(error)).toBe(error);
        expect(sdkError(new TypeError('network down'))).toBeUndefined();
        expect(sdkError('not an error at all')).toBeUndefined();
    });
});

describe('isClientError', () => {
    it.each([
        [399, false],
        [400, true],
        [404, true],
        [499, true],
        [500, false],
        [503, false],
    ])('treats %i as a client error: %s', (status, expected) => {
        expect(isClientError(failure(status))).toBe(expected);
    });

    it('is false for a rejection that never reached the server', () => {
        expect(isClientError(new TypeError('offline'))).toBe(false);
    });
});

describe('authChallenge', () => {
    it('reads the error out of the API 401 challenge', () => {
        expect(authChallenge(invalidToken())).toEqual({ scheme: 'Bearer', error: 'invalid_token' });
    });

    it('reads the error out of the API 403 policy denial', () => {
        const challenge = authChallenge(failure(403, { 'WWW-Authenticate': 'Bearer error="mfa_required"' }));
        expect(challenge).toEqual({ scheme: 'Bearer', error: 'mfa_required' });
    });

    it('accepts a bare scheme with no parameters', () => {
        expect(authChallenge(failure(401, { 'WWW-Authenticate': 'Bearer' }))).toEqual({ scheme: 'Bearer' });
    });

    it('parses realm, scope and error_description alongside error', () => {
        const header = 'Bearer realm="api", error="insufficient_scope", error_description="needs station:write", scope="station:write"';
        expect(authChallenge(failure(403, { 'WWW-Authenticate': header }))).toEqual({
            scheme: 'Bearer',
            realm: 'api',
            error: 'insufficient_scope',
            errorDescription: 'needs station:write',
            scope: 'station:write',
        });
    });

    it('accepts unquoted parameter values', () => {
        expect(authChallenge(failure(401, { 'WWW-Authenticate': 'Bearer error=invalid_token' }))).toEqual({
            scheme: 'Bearer',
            error: 'invalid_token',
        });
    });

    it('tolerates leading whitespace around the scheme', () => {
        expect(authChallenge(failure(401, { 'WWW-Authenticate': '  Bearer  error="invalid_token"  ' }))).toEqual({
            scheme: 'Bearer',
            error: 'invalid_token',
        });
    });

    it('is undefined when the header is absent or the error is not from the SDK', () => {
        expect(authChallenge(failure(401))).toBeUndefined();
        expect(authChallenge(new TypeError('offline'))).toBeUndefined();
    });
});

describe('challenge predicates', () => {
    it('treats any 401 as an invalid token, challenge or not', () => {
        expect(isInvalidToken(invalidToken())).toBe(true);
        // A proxy may strip the header; the status still means the token is dead.
        expect(isInvalidToken(failure(401))).toBe(true);
        expect(isInvalidToken(failure(403))).toBe(false);
    });

    it('detects a step-up requirement only on a 403 that says so', () => {
        expect(isStepUpRequired(failure(403, { 'WWW-Authenticate': 'Bearer error="mfa_required"' }))).toBe(true);
        // Same challenge on a 401 is a sign-in problem, not a step-up.
        expect(isStepUpRequired(invalidToken())).toBe(false);
        expect(isStepUpRequired(failure(403))).toBe(false);
    });

    it('detects insufficient scope', () => {
        expect(isInsufficientScope(failure(403, { 'WWW-Authenticate': 'Bearer error="insufficient_scope"' }))).toBe(true);
        expect(isInsufficientScope(failure(403, { 'WWW-Authenticate': 'Bearer error="mfa_required"' }))).toBe(false);
    });
});

describe('error envelope', () => {
    it('still reads details and messages off the API envelope', () => {
        const error = failure(422, {}, { statusCode: 422, message: 'Validation failed', details: { email: 'Already taken' } });
        expect(apiErrorDetails(error)).toEqual({ email: 'Already taken' });
        expect(apiErrorMessage(error, 'fallback')).toBe('Validation failed');
    });

    it('falls back when there is no envelope', () => {
        expect(apiErrorDetails(failure(500, {}, 'gateway exploded'))).toBeUndefined();
        expect(apiErrorMessage(new TypeError('offline'), 'fallback')).toBe('fallback');
    });
});
