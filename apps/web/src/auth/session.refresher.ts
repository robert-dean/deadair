/**
 * A one-slot registry for "redeem the refresh cookie", and the only indirection in the API layer.
 *
 * It exists to break a genuine import cycle. The API client wants to recover from a 401 by
 * redeeming the refresh cookie, which lives in `session.bootstrap`; but the bootstrap redeems it
 * by calling `sdk.authentication.requestToken`, which lives in the API client. Neither can import
 * the other. The client imports this module instead, and `api/query.client` installs the real
 * implementation at boot, where both halves are already in scope.
 */
export type SessionRefresher = () => Promise<boolean>;

let refresher: SessionRefresher | undefined;

/** Installs the redeem. Passing undefined uninstalls it, which is what tests want between cases. */
export function setSessionRefresher(fn: SessionRefresher | undefined): void {
    refresher = fn;
}

/**
 * Redeems the refresh cookie, resolving whether a usable session came back.
 *
 * Resolves false when nothing is installed — a unit test exercising the fetch wrapper in isolation,
 * or a call that somehow lands before boot finishes. False is the safe answer there: the caller
 * treats it as "no session", which is exactly the behaviour this module replaced.
 */
export function refreshSession(): Promise<boolean> {
    return refresher ? refresher() : Promise.resolve(false);
}
