import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { sdk } from '../api/client';
import { queryKeys } from '../api/query.keys';
import { isClientError } from '../api/sdk.error';
import { clearSession, isAuthenticated, sessionEpoch, setSession } from './session.store';

/**
 * A settled answer about the refresh cookie, stamped with the session epoch it was reached at.
 *
 * The epoch travels with the verdict because the query key cannot: see `sessionRestoreOptions`.
 */
interface RestoreVerdict {
    restored: boolean;
    epoch: number;
}

/**
 * Exchanges the httpOnly refresh cookie for an access token.
 *
 * Resolves a verdict about the cookie; throws when it never got one. That split is the whole
 * design, and it is what the query cache is built on:
 *
 * - resolves `true` — the cookie yielded a token, which is now in the store.
 * - resolves `false` — the server answered, and its answer was that this cookie buys no session.
 *   A 4xx means the cookie is missing, expired, malformed or revoked, and asking again with the
 *   same cookie gets the same 4xx. Worth caching, and caching it is the loop guard: a page whose
 *   cookie cannot be redeemed asks once, not once per redirect.
 * - throws — the question never landed. A `TypeError` from `fetch` (offline, DNS, the dev API not
 *   up yet) or a 5xx (the API is up but its dependencies are not) says nothing about the cookie,
 *   and caching "unknown" as "anonymous" is what strands a valid session at /login until a hard
 *   reload. Query holds no data for a rejected fetch, so the next caller asks again.
 */
async function redeemRefreshCookie(): Promise<boolean> {
    try {
        // No body token: the httpOnly refresh cookie carries it.
        const response = await sdk.authentication.requestToken({ grant_type: 'refresh_token' });
        if (response.result !== 'token') {
            // A refresh that lands on an MFA challenge cannot be completed silently. The server did
            // answer, though, so this is as settled as a 401: the caller is anonymous until they log in.
            clearSession();
            return false;
        }
        setSession(response.access_token, response.expires_in);
        return true;
    } catch (error) {
        if (!isClientError(error)) {
            // Leave the store untouched: a live token stays usable, and an expired one already reads
            // as anonymous through `isAuthenticated`, so nothing downstream can send it either way.
            // Clearing here would only manufacture a logout out of someone else's outage.
            throw error;
        }
        // No cookie, or a dead one. Drop whatever token remains so nothing downstream tries to use it.
        clearSession();
        return false;
    }
}

/**
 * The redeem, as a query.
 *
 * **Deliberately not keyed on the session epoch.** The redeem moves the epoch itself — `clearSession`
 * on a refusal, `setSession` on a success — so an epoch-keyed query would invalidate the very key it
 * had just written and redeem forever. A query key cannot be rewritten once a fetch is under way,
 * so the epoch is stamped onto the *value* instead, read back after the redeem settles, and compared
 * in `restoreSession` below. Same guard as the hand-rolled cache this replaced; different hiding place.
 *
 * `retry: false` against the app-wide default. This runs on the root route's gate, in front of first
 * paint, and an unreachable API is exactly the case where backing off three times would hold the
 * whole app on a blank screen. Failing fast is right here: `restoreSession` reports `false`, the gate
 * renders anyway, and the next navigation asks again because nothing was cached.
 */
const sessionRestoreOptions = queryOptions({
    queryKey: queryKeys.session.restore(),
    queryFn: async (): Promise<RestoreVerdict> => ({ restored: await redeemRefreshCookie(), epoch: sessionEpoch() }),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
});

/**
 * Whether a cached verdict still answers the question being asked.
 *
 * It stops answering when something actually changed. Either the epoch moved since it settled — a
 * 401 killed a live session, or a sign-in stored a token and with it a fresh refresh cookie this
 * verdict never saw — or the token it handed back has since expired, which makes a `restored` no
 * longer a session.
 */
function stillAnswers(verdict: RestoreVerdict): boolean {
    if (verdict.epoch !== sessionEpoch()) {
        return false;
    }
    return !(verdict.restored && !isAuthenticated());
}

/**
 * Exchanges the refresh cookie for an access token, at most once per settled verdict.
 * Resolves false rather than throwing when there is no usable session: the root route awaits this
 * outside its try, and a rejection there would take the whole gate down.
 */
export async function restoreSession(queryClient: QueryClient): Promise<boolean> {
    if (isAuthenticated()) {
        // A live token needs no redeem. This is also what keeps a cached success honest as the token
        // ages: the moment it expires we fall through and the cookie gets another go.
        return true;
    }
    const cached = queryClient.getQueryData<RestoreVerdict>(queryKeys.session.restore());
    if (cached && !stillAnswers(cached)) {
        // Synchronous, and before the first await: a second caller arriving after this sees no cached
        // verdict and joins the fetch below rather than cancelling it.
        queryClient.removeQueries({ queryKey: queryKeys.session.restore() });
    }
    try {
        const verdict = await queryClient.ensureQueryData(sessionRestoreOptions);
        return verdict.restored;
    } catch {
        // The API never answered. Says nothing about the cookie, and nothing was cached, so the
        // next gate evaluation will ask again.
        return false;
    }
}

/** Drops the cached verdict so the next `restoreSession()` hits the API again. */
export function resetSessionBootstrap(queryClient: QueryClient): void {
    queryClient.removeQueries({ queryKey: queryKeys.session.restore() });
}
