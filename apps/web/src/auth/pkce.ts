/**
 * PKCE for factor enrolment.
 *
 * Enrolling an authenticator is two requests: the API mints a secret and answers with a QR code,
 * then the operator sends back the first code the app shows. The `codeChallenge` sent with the
 * first and the `codeVerifier` sent with the second are what tie those two requests to one
 * browser: a registration id alone could be replayed from anywhere the QR was seen. Same shape as
 * OAuth's PKCE (RFC 7636), which is where the names come from.
 *
 * Nothing here may need a SECURE context (HTTPS or localhost), because a station on a home network is
 * opened at `http://<the server's address>:8080` and is neither. `getRandomValues` is available on
 * any page; `crypto.subtle` is not, which is why the hash comes from `@noble/hashes` rather than
 * `crypto.subtle.digest`. Enrolling a factor from a console reached that way used to fail on
 * reading `digest` off `undefined`. The same trap once broke every request, through the SDK's
 * request id (issue #78).
 */

import { sha256 } from '@noble/hashes/sha2.js';

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** A fresh one-time secret: 32 random bytes as base64url, which is 43 characters. */
export function generateCodeVerifier(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return toBase64Url(bytes);
}

/** The SHA-256 of a verifier as base64url, which is what the API is handed first. */
export function generateCodeChallenge(verifier: string): string {
    return toBase64Url(sha256(new TextEncoder().encode(verifier)));
}
