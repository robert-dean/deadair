/**
 * The session signing key, however the deployment was able to spell it.
 *
 * It is an RSA private key in PEM, which is several lines, and most of the places an operator
 * actually sets it hold one: a container template's variable field is a single-line input, a
 * compose `.env` carries a newline only inside quotes, and a secret pasted into a web form loses
 * its line breaks on the way through. So the same key arrives in three shapes and only one of
 * them is what the signer wants.
 *
 * All three are accepted, because the alternative is a station that boots, looks healthy, and
 * fails at the first sign-in with a library error naming no variable — and the operator has no
 * way to tell a mistyped key from an unsupported one.
 *
 * Nothing here validates the key. A wrong one still fails, and should: this only undoes the
 * transformations a text field applies, and a caller that gets something which is not a key at all
 * gets it back unchanged, to fail where it would have failed anyway.
 */
export function readSessionKey(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return trimmed;

    // The PEM as it comes out of `openssl`, or that same PEM with its line breaks written as the
    // two characters a shell would have turned into one. The second is what `.env` files carry.
    if (trimmed.includes('-----BEGIN')) {
        return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed;
    }

    // A PEM somebody base64'd to get it through a field that mangles everything else. Decoded
    // only when what comes out is recognisably a key, so a corrupted value is not silently
    // replaced by whichever bytes it happened to decode to.
    try {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
        if (decoded.includes('-----BEGIN')) return decoded.trim();
    } catch {
        // Not base64. Hand back what we were given.
    }

    return trimmed;
}
