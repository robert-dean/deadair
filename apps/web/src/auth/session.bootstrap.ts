import { SdkError } from '@deadair/sdk';

import { sdk } from '../api/client';
import { clearSession, isAuthenticated, sessionEpoch, setSession } from './session.store';

/**
 * What a redeem concluded about the refresh cookie.
 *
 * - `restored`: the cookie yielded a token, which is now in the store.
 * - `rejected`: the server answered, and its answer was that this cookie buys no session.
 *   A verdict about the cookie itself, so it is worth remembering.
 * - `unavailable`: we never got an answer. Says nothing about the cookie, so it is not.
 */
type RefreshOutcome = 'restored' | 'rejected' | 'unavailable';

interface Attempt {
    /** The session epoch this attempt answers for. Re-read when it settles; see `restoreSession`. */
    epoch: number;
    /** Undefined until the attempt settles. */
    outcome?: RefreshOutcome;
    result: Promise<RefreshOutcome>;
}

let attempt: Attempt | undefined;

/**
 * Whether a rejection is the server's verdict on the cookie rather than a failure to ask.
 *
 * A 4xx is an answer: the cookie is missing, expired, malformed, or revoked, and asking again with
 * the same cookie will get the same 4xx. Anything else means the question never landed. A `TypeError`
 * from `fetch` (offline, DNS, the dev API not up yet) or a 5xx (the API is up but its dependencies
 * are not) leaves the cookie's fate genuinely unknown, and caching "unknown" as "anonymous" is what
 * strands a perfectly valid session at /login until a hard reload.
 */
function isDefinitiveRejection(error: unknown): boolean {
    return error instanceof SdkError && error.status >= 400 && error.status < 500;
}

async function refresh(): Promise<RefreshOutcome> {
    try {
        // No body token: the httpOnly refresh cookie carries it.
        const response = await sdk.authentication.requestToken({ grant_type: 'refresh_token' });
        if (response.result !== 'token') {
            // A refresh that lands on an MFA challenge cannot be completed silently. The server did
            // answer, though, so this is as settled as a 401: the caller is anonymous until they log in.
            clearSession();
            return 'rejected';
        }
        setSession(response.access_token, response.expires_in);
        return 'restored';
    } catch (error) {
        if (!isDefinitiveRejection(error)) {
            // The API is unreachable or broken. Leave the store untouched: a live token stays usable,
            // and an expired one already reads as anonymous through `isAuthenticated`, so nothing
            // downstream can send it either way. Clearing here would only manufacture a logout out of
            // someone else's outage.
            return 'unavailable';
        }
        // No cookie, or a dead one. Drop whatever token remains so nothing downstream tries to use it.
        clearSession();
        return 'rejected';
    }
}

/**
 * Whether the cached attempt still answers the question being asked.
 *
 * Loop guard: **at most one redeem per session epoch.** A definitive rejection is cached exactly like
 * a success, so a page whose cookie cannot be redeemed asks once and then answers every further gate
 * evaluation from cache instead of hammering the API on each redirect. It is only re-armed when
 * something actually changed: the epoch moved (a 401 killed a live session, or a sign-in stored a
 * token and with it a fresh refresh cookie the cached verdict never saw), the token it handed back
 * has since expired, or `resetSessionBootstrap()` was called outright (logout).
 */
function answersNow(cached: Attempt): boolean {
    if (cached.epoch !== sessionEpoch()) {
        return false;
    }
    if (cached.outcome === undefined) {
        // Still in flight. Every concurrent caller waits on this one redeem rather than starting another.
        return true;
    }
    // An attempt that never reached the server answers nothing, so it is not allowed to stand in for a
    // 401. It is retained only until it settles (above), which is what keeps the retry to one redeem
    // per gate evaluation instead of one per caller.
    if (cached.outcome === 'unavailable') {
        return false;
    }
    // A success whose token has since expired is no longer an answer: the cookie deserves another go
    // before the gate concludes the user is anonymous and strands them at /login.
    return !(cached.outcome === 'restored' && !isAuthenticated());
}

/**
 * Exchanges the refresh cookie for an access token, at most once per session epoch.
 * Resolves false rather than throwing when there is no usable session.
 */
export function restoreSession(): Promise<boolean> {
    if (attempt && answersNow(attempt)) {
        return attempt.result.then(outcome => outcome === 'restored');
    }
    const record: Attempt = { epoch: sessionEpoch(), result: refresh() };
    attempt = record;
    // The epoch is re-read on settle rather than kept from the call: a redeem moves the epoch itself
    // either way, clearing the dead token when it fails and storing a new one when it succeeds, and
    // neither self-inflicted bump may count as "something changed" or the attempt would re-arm itself
    // on the next gate evaluation. `refresh` never rejects.
    void record.result.then(outcome => {
        record.outcome = outcome;
        record.epoch = sessionEpoch();
    });
    return record.result.then(outcome => outcome === 'restored');
}

/** Clears the cached attempt so the next `restoreSession()` hits the API again. */
export function resetSessionBootstrap(): void {
    attempt = undefined;
}
