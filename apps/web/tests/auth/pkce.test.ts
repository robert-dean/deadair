import { describe, expect, it } from 'vitest';

import { generateCodeChallenge, generateCodeVerifier } from '../../src/auth/pkce';

describe('PKCE', () => {
    it('mints a verifier the API will accept: 43 base64url characters, fresh every time', () => {
        const a = generateCodeVerifier();
        const b = generateCodeVerifier();

        // The contract bounds `codeVerifier` at 43..128; 32 bytes of base64url is exactly 43.
        expect(a).toHaveLength(43);
        expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(a).not.toBe(b);
    });

    it('derives the challenge as the base64url SHA-256 of the verifier', async () => {
        // The worked example from RFC 7636 appendix B.
        const challenge = await generateCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');

        expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });
});
