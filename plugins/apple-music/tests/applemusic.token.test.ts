// The developer token is signed by hand rather than by a JWT library, so the parts a library would
// have got right are the parts that need a test. One of them — the signature encoding — is wrong in a
// way that produces a perfectly valid ECDSA signature that Apple rejects with 401 and no explanation,
// which is exactly the failure a test is worth having for.

import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { TOKEN_LIFETIME_S } from '../src/applemusic.manifest.js';
import { DeveloperTokenSource, signDeveloperToken } from '../src/applemusic.token.js';

/** A throwaway P-256 key, which is the curve Apple requires. */
const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const key = { teamId: 'DEF123GHIJ', keyId: 'ABC123DEFG', privateKey };
const now = 1_760_000_000_000;

const decode = (part: string): Record<string, unknown> => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('signDeveloperToken', () => {
    it('declares ES256 and the key id in the header, which is all Apple accepts', () => {
        const [header] = signDeveloperToken(key, now).token.split('.');

        // Apple rejects an unsecured token or any other algorithm, so these two are not decoration.
        expect(decode(header!)).toMatchObject({ alg: 'ES256', kid: 'ABC123DEFG' });
    });

    it('claims the team as the issuer, with an expiry at Apple own ceiling', () => {
        const [, payload] = signDeveloperToken(key, now).token.split('.');

        const claims = decode(payload!);
        expect(claims.iss).toBe('DEF123GHIJ');
        expect(claims.iat).toBe(Math.floor(now / 1000));
        // Six months is the documented maximum and there is nothing to gain from asking for less.
        expect(claims.exp).toBe(Math.floor(now / 1000) + TOKEN_LIFETIME_S);
    });

    it('signs with a 64-byte raw signature rather than DER, which is the whole trick', () => {
        // THE test in this file. `createSign(...).sign(key)` defaults to DER, which is a valid ECDSA
        // signature of variable length that Apple answers 401 for on every request. A JWS wants the raw
        // `r||s` pair — 32 bytes each on P-256 — which is what `dsaEncoding: 'ieee-p1363'` produces.
        const [, , signature] = signDeveloperToken(key, now).token.split('.');

        expect(Buffer.from(signature!, 'base64url')).toHaveLength(64);
    });

    it('produces a signature that verifies against the public half', () => {
        const token = signDeveloperToken(key, now).token;
        const [header, payload, signature] = token.split('.');

        const verified = createVerify('SHA256')
            .update(`${header}.${payload}`)
            .verify({ key: createPublicKey(publicKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'));

        expect(verified).toBe(true);
    });

    it('reports when the token stops being usable, in millis', () => {
        expect(signDeveloperToken(key, now).expiresAt).toBe((Math.floor(now / 1000) + TOKEN_LIFETIME_S) * 1000);
    });
});

describe('DeveloperTokenSource', () => {
    it('mints once and reuses, so signing is paid about twice a year', () => {
        let clock = now;
        const source = new DeveloperTokenSource(key, () => clock);

        const first = source.get();
        clock += 60_000;
        expect(source.get()).toBe(first);
    });

    it('re-mints before the expiry rather than after it, so no request races the clock', () => {
        let clock = now;
        const source = new DeveloperTokenSource(key, () => clock);
        const first = source.get();

        // Inside the skew window: still valid, but close enough that a request in flight could outlive it.
        clock = now + TOKEN_LIFETIME_S * 1000 - 30 * 60_000;
        expect(source.get()).not.toBe(first);
    });

    it('throws on a key the operator pasted wrong rather than reporting an empty catalog', () => {
        // A swallowed error here would present as Apple Music having no records in it, which is the
        // single most misleading thing this plugin could do.
        const broken = new DeveloperTokenSource({ ...key, privateKey: 'not a key' });
        expect(() => broken.get()).toThrow();
    });
});
