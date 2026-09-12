import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateCodeChallenge, generateCodeVerifier } from '../../src/auth/pkce';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('PKCE', () => {
    it('mints a verifier the API will accept: 43 base64url characters, fresh every time', () => {
        const a = generateCodeVerifier();
        const b = generateCodeVerifier();

        // The contract bounds `codeVerifier` at 43..128; 32 bytes of base64url is exactly 43.
        expect(a).toHaveLength(43);
        expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(a).not.toBe(b);
    });

    it('derives the challenge as the base64url SHA-256 of the verifier', () => {
        // The worked example from RFC 7636 appendix B.
        const challenge = generateCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');

        expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('needs nothing a plain-HTTP page lacks', () => {
        // A console opened at http://<its LAN address>:8080 has `getRandomValues` and no `subtle`,
        // and enrolling a factor there used to fail on reading `digest` off undefined. Issue #78.
        const real = globalThis.crypto;
        vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });

        const verifier = generateCodeVerifier();

        expect(verifier).toHaveLength(43);
        expect(generateCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });
});
