import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The same signed-URL scheme as the Spotify shim, because it is the same URL doing the same job.
 *
 * MUST match `signTrackToken` in `apps/api/src/modules/stream/spotify.shim.client.ts` and
 * `verifyToken` in `stream/spotify-shim/token.go` byte for byte, including the length-prefixed MAC
 * input — that prefixing is what stops one `(id, expiry)` pair being re-cut into another that signs
 * the same bytes. All three sides pin the SAME test vector (`tests/token.test.ts` here,
 * `token_test.go` there), so changing the wire format in one place fails a suite rather than
 * silently 401ing every fetch on air.
 *
 * Signed rather than one-time for the shim's reason: the app and this container are separate
 * processes, so a random per-item token would need shared state between them, where an HMAC needs
 * only the secret both already hold. It rides in the query string because the fetch arrives with no
 * headers from us.
 */
export const TOKEN_PARAM = 't';

export function signToken(secret: string, trackId: string, expiresAtMs: number): string {
    const expiry = String(Math.floor(expiresAtMs / 1000));
    return `${expiry}.${mac(secret, trackId, expiry)}`;
}

/** Why a token was refused, or `undefined` when it was not. */
export type TokenRefusal =
    | 'no signing secret configured'
    | 'malformed token'
    | 'malformed token signature'
    | 'bad token signature'
    | 'malformed token expiry'
    | 'token expired';

export function verifyToken(secret: string, trackId: string, token: string | undefined, nowMs: number): TokenRefusal | undefined {
    // Refuse rather than serve: an unset secret would otherwise make every fetch public.
    if (secret === '') return 'no signing secret configured';
    if (token === undefined) return 'malformed token';

    const separator = token.indexOf('.');
    if (separator < 0) return 'malformed token';
    const expiry = token.slice(0, separator);
    const signature = token.slice(separator + 1);

    // Checked with a pattern rather than by catching a throw: `Buffer.from(…, 'base64url')` does not
    // reject an invalid string, it silently drops what it cannot read — which would turn a malformed
    // signature into a wrong one and report the less accurate of the two reasons.
    if (!/^[A-Za-z0-9_-]+$/.test(signature)) return 'malformed token signature';
    const sent = Buffer.from(signature, 'base64url');

    // Compared before the expiry is read, as in the Go: an unsigned token's claims are not worth
    // parsing. `timingSafeEqual` throws on a length mismatch, which is itself a failed comparison.
    const expected = Buffer.from(mac(secret, trackId, expiry), 'base64url');
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return 'bad token signature';

    const seconds = Number(expiry);
    if (!Number.isInteger(seconds)) return 'malformed token expiry';
    if (nowMs > seconds * 1000) return 'token expired';

    return undefined;
}

function mac(secret: string, trackId: string, expiry: string): string {
    return createHmac('sha256', secret).update(`${trackId.length}:${trackId}:${expiry.length}:${expiry}`).digest('base64url');
}
