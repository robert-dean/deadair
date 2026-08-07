import { createHash, randomBytes } from 'node:crypto';

import { SUBSONIC_API_VERSION, SUBSONIC_CLIENT_NAME } from './navidrome.manifest.js';

/**
 * Subsonic's authentication, which is a salted hash in the query string.
 *
 * `node:crypto` here is arithmetic, not I/O: nothing in this file touches the
 * network, the filesystem or the clock, so the rule that egress goes through
 * `host.fetch` is intact. MD5 is not a choice — it is what the protocol
 * specifies, and the point of it is that the account's password never crosses
 * the wire, not that the digest is hard to reverse.
 */

/** Bytes of salt per token. The spec asks for at least six characters; this is sixteen. */
const SALT_BYTES = 8;

/** The credentials every request carries, before the call's own parameters. */
export interface SubsonicAuthParams {
    /** Username. */
    u: string;
    /** Token: `md5(password + salt)`. */
    t: string;
    /** The salt that token was made with. */
    s: string;
    /** Protocol version. */
    v: string;
    /** Client name. */
    c: string;
    /** Response format. */
    f: string;
}

const token = (password: string, salt: string): string =>
    createHash('md5')
        .update(password + salt, 'utf8')
        .digest('hex');

const newSalt = (): string => randomBytes(SALT_BYTES).toString('hex');

/**
 * Mints the auth parameters for a Subsonic request.
 *
 * Two ways to ask for them, and the difference is not cosmetic:
 *
 * - {@link SubsonicAuth.params} makes a fresh salt every time. Right for a call
 *   the plugin makes itself, and for the stream URL, which nothing keys off.
 * - {@link SubsonicAuth.stableParams} reuses one salt fixed when the plugin was
 *   initialized. Right for a URL that is *stored*, which today means cover art:
 *   `art_assets` rows are keyed by their source URL, so a per-call salt would
 *   mint a different string for the same image every time it was mentioned —
 *   one row and one download of identical bytes per mention, and a cache that
 *   could never hit.
 *
 * Reusing a salt costs nothing an attacker could not already have. The digest is
 * of a password the operator gave us for a server they run, the URL is being
 * written down either way, and anyone holding one of these URLs can already
 * fetch that image.
 */
export class SubsonicAuth {
    private readonly stableSalt = newSalt();

    constructor(
        private readonly username: string,
        private readonly password: string,
    ) {}

    /** Auth parameters with a fresh salt. */
    params(): SubsonicAuthParams {
        return this.withSalt(newSalt());
    }

    /** Auth parameters with this instance's fixed salt, for a URL that will be stored. */
    stableParams(): SubsonicAuthParams {
        return this.withSalt(this.stableSalt);
    }

    private withSalt(salt: string): SubsonicAuthParams {
        return {
            u: this.username,
            t: token(this.password, salt),
            s: salt,
            v: SUBSONIC_API_VERSION,
            c: SUBSONIC_CLIENT_NAME,
            f: 'json',
        };
    }
}
