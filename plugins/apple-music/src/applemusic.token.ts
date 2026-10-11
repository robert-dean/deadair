import { createSign } from 'node:crypto';
import { TOKEN_LIFETIME_S, TOKEN_SKEW_MS } from './applemusic.manifest.js';

/**
 * The Apple Music developer token: a JWT signed ES256 with the operator's MusicKit key.
 *
 * Minted here rather than taken as a dependency, and that is the one decision in this file worth
 * arguing. Node signs ES256 natively — `createSign('SHA256')` with `dsaEncoding: 'ieee-p1363'` produces
 * exactly the raw `r||s` a JWS wants, where the default DER encoding produces something Apple rejects —
 * so a JWT library would be a supply-chain edge for about forty lines of work. The `ieee-p1363` flag is
 * the whole trick and the thing that is silently wrong without it: a DER-encoded signature is a
 * perfectly valid ECDSA signature and Apple answers 401 for every request made with it.
 *
 * Apple's requirements, from the documented spec:
 *   * header: `alg: ES256` (nothing else is accepted) and `kid`, the 10-character key id
 *   * claims: `iss` the 10-character Team ID, `iat` now, `exp` no more than six months ahead
 *
 * **This plugin never bundles a token.** Music Assistant ships one, which makes their provider
 * installable by anyone and makes every install share one rate-limit bucket and one revocation. deadair
 * ships one container per operator and has no fleet secret to put a token in, so this takes the
 * operator's own key or the plugin runs on the keyless Search API instead.
 */
export interface DeveloperKey {
    teamId: string;
    keyId: string;
    /** The .p8 contents, BEGIN and END lines included. */
    privateKey: string;
}

export interface MintedToken {
    token: string;
    /** Unix epoch millis at which this stops being usable. */
    expiresAt: number;
}

const base64url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

/**
 * Sign one token. Exported for the tests, which decode it rather than trusting it.
 *
 * `now` is a parameter for the same reason it is everywhere else in this tree: a test that has to wait
 * six months to check an expiry is not a test.
 */
export function signDeveloperToken(key: DeveloperKey, nowMs: number = Date.now()): MintedToken {
    const issuedAt = Math.floor(nowMs / 1000);
    const expiry = issuedAt + TOKEN_LIFETIME_S;

    const header = base64url(JSON.stringify({ alg: 'ES256', kid: key.keyId, typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ iss: key.teamId, iat: issuedAt, exp: expiry }));
    const signing = `${header}.${payload}`;

    // `ieee-p1363` is not optional. See the note above: the default DER encoding is a valid signature
    // that Apple refuses, and the symptom is 401 on every request with nothing to suggest the cause.
    const signature = createSign('SHA256').update(signing).sign({ key: key.privateKey, dsaEncoding: 'ieee-p1363' });

    return { token: `${signing}.${signature.toString('base64url')}`, expiresAt: expiry * 1000 };
}

/**
 * Mints on first use and re-mints before expiry, so the signing cost is paid about twice a year.
 *
 * A class rather than a memo because the key can change under it: an operator saving new credentials
 * reinitializes the plugin, and the instance goes with it.
 */
export class DeveloperTokenSource {
    private minted: MintedToken | undefined;

    constructor(
        private readonly key: DeveloperKey,
        private readonly now: () => number = Date.now,
    ) {}

    /**
     * The current token.
     *
     * Throws whatever `createSign` throws for a malformed key, which is the right shape of failure: a
     * key the operator pasted wrong is something they must fix, and a plugin that swallowed it would
     * report an empty catalog instead.
     */
    get(): string {
        const now = this.now();
        if (this.minted === undefined || this.minted.expiresAt - TOKEN_SKEW_MS <= now) {
            this.minted = signDeveloperToken(this.key, now);
        }
        return this.minted.token;
    }
}
