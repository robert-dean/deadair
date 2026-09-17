import { PluginError, errorText } from '@deadair/plugin-sdk';
import { Utils } from 'youtubei.js';

/**
 * Whether the call that failed needed the operator's credential.
 *
 * It is the one thing the error itself does not say, and the whole of {@link toPluginError} turns
 * on it. See the `ParsingError` case.
 */
export type CallKind =
    /** A library or playlist read: it cannot succeed without a working cookie. */
    | 'authenticated'
    /** A search or a track lookup: it works signed out, so a failure says nothing about the cookie. */
    | 'public';

const SIGNED_OUT = 'you must be signed in';
/** What the account endpoint answers with when the credential is dead. */
const NO_PAGE = 'page contents not found';
const UNAVAILABLE = 'this video is unavailable';

/** Phrases YouTube uses for a refusal that is about the RECORD rather than about us. */
const REFUSALS = [
    'not available in your country',
    'age-restricted',
    'age restricted',
    'sign in to confirm your age',
    'private video',
    'members-only',
];

const has = (haystack: string, needle: string): boolean => haystack.toLowerCase().includes(needle);

/**
 * A `youtubei.js` failure in the host's vocabulary.
 *
 * The codes are not cosmetic. `auth` is non-retryable and quarantines on the spot, `upstream`
 * counts against plugin health and quarantines on the third, and `not_found` / `forbidden` are
 * resource-scoped and count for nothing. Getting one wrong either takes a working plugin off the
 * air or hides a dead credential behind a retry that can never succeed.
 *
 * **The `ParsingError` rule is the one that was measured rather than reasoned about, and the
 * obvious answer is wrong.** When the cookie expires, the upstream does not answer 401: it answers
 * a signed-out PAGE, and `youtubei.js` fails to find the nodes it wanted in it:
 * `Expected node of any type Grid, MusicShelf, got ItemSection`. Read as what it looks like, that
 * is a library bug and belongs in `upstream`. Read as what it is, it is the credential, and
 * `upstream` would be wrong twice: it tells the operator YouTube is having trouble when the fix is
 * to paste a new cookie, and it spends the plugin's three lives retrying a call that cannot
 * succeed until they do. So a parse failure on a call that NEEDED the credential is `auth`.
 *
 * The same error on a public call keeps its innocent reading, because there the credential is not
 * what is in question. That really is the upstream having moved under the library.
 */
export function toPluginError(error: unknown, kind: CallKind): PluginError {
    if (error instanceof PluginError) return error;

    const text = errorText(error);

    if (error instanceof Utils.ParsingError) {
        return kind === 'authenticated'
            ? new PluginError(`YouTube Music answered a signed-out page, so the cookie is no longer valid: ${text}`).withCode('auth')
            : new PluginError(`YouTube Music answered something this plugin could not read: ${text}`).withCode('upstream');
    }

    // The no-cookie case, and the only one the upstream states plainly.
    if (has(text, SIGNED_OUT)) return new PluginError(`YouTube Music refused an unauthenticated request: ${text}`).withCode('auth');
    if (has(text, NO_PAGE)) return new PluginError(`YouTube Music did not accept the cookie: ${text}`).withCode('auth');

    // Resource-scoped: this record, not this plugin. `getTrack` turns it into `undefined` before it
    // ever reaches here; anything else that raises it is reporting on one item.
    if (has(text, UNAVAILABLE)) return new PluginError(text).withCode('not_found');
    if (REFUSALS.some(phrase => has(text, phrase))) return new PluginError(text).withCode('forbidden');

    return new PluginError(`YouTube Music request failed: ${text}`).withCode('upstream');
}

/** Whether this failure is the "no such record" one, which callers answer with `undefined`. */
export const isUnavailable = (error: unknown): boolean => has(errorText(error), UNAVAILABLE);
