import { isClientError, sdkError } from './sdk.error';

/** Total attempts, first try included. Three keeps a blip survivable without stacking latency. */
export const MAX_ATTEMPTS = 3;

/**
 * The longest we will sit waiting on a `retry-after` before giving the answer back to the caller.
 * The API's limiter runs 100 points per 5 seconds, so a real `retry-after` is well under this;
 * anything longer means the caller is far enough over the line that a spinner is a worse answer
 * than telling them how long to wait.
 */
export const MAX_WAIT_MS = 10_000;

/** Backoff ceiling for failures that carry no `retry-after` of their own. */
const MAX_BACKOFF_MS = 30_000;

/** 429. The API's rate limiter, which also sends `retry-after` and the `x-ratelimit-*` trio. */
export function isRateLimited(error: unknown): boolean {
    return sdkError(error)?.status === 429;
}

/**
 * How long the server asked us to wait, in milliseconds, or undefined when it did not say.
 *
 * `rateLimiterMiddleware` sends `msBeforeNext / 1000`, so the value is **fractional seconds**
 * (`0.42`), not the integer seconds the RFC suggests — parsing as an int would floor a sub-second
 * wait to zero and produce a hot retry loop. The HTTP-date form is accepted as well, since a proxy
 * in front of the API may rewrite the header into it.
 */
export function retryAfterMs(error: unknown): number | undefined {
    const header = sdkError(error)?.headers.get('retry-after');
    if (!header) {
        return undefined;
    }
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000);
    }
    const at = Date.parse(header);
    return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** A 4xx that is a timing problem rather than a verdict, so worth trying again. */
function isRetryableClientError(error: unknown): boolean {
    const status = sdkError(error)?.status;
    return status === 408 || status === 429;
}

/**
 * Whether a failed request is worth repeating.
 *
 * A 4xx is the server's verdict and will not change on a replay — 400, 401, 403, 404, 409 and 422
 * all mean "asked and answered". The exceptions are 408 and 429, which say *when* rather than *no*.
 * Everything else is a failure to get an answer at all: a 5xx, or a rejection that is not an
 * `SdkError` (a `TypeError` out of `fetch` is offline, DNS, or the dev API not up yet).
 */
export function retryOnTransient(failureCount: number, error: unknown): boolean {
    if (failureCount >= MAX_ATTEMPTS) {
        return false;
    }
    if (isClientError(error) && !isRetryableClientError(error)) {
        return false;
    }
    // A limiter window we would spend longer waiting out than the user will tolerate. Stop, and
    // let the UI say "try again in N seconds" with the number the server actually gave us.
    const wait = retryAfterMs(error);
    if (wait !== undefined && wait > MAX_WAIT_MS) {
        return false;
    }
    return true;
}

/**
 * The same rule for mutations, minus the 5xx.
 *
 * A `GET` that fails halfway changed nothing, so replaying it is free. A `POST` that comes back
 * 500 may well have applied — the failure could be in the response path — and re-sending it would
 * create a second administrator, a second session, a second anything. Only 408 and 429 are safe,
 * because both mean the request was refused before it ran.
 */
export function retryOnTransientMutation(failureCount: number, error: unknown): boolean {
    if (!isRetryableClientError(error)) {
        return false;
    }
    return retryOnTransient(failureCount, error);
}

/**
 * How long to wait before the next attempt.
 *
 * The server's own `retry-after` wins when there is one; otherwise exponential backoff with full
 * jitter. The jitter is not decoration: the root route's gate and a route loader can both be in
 * flight against the same rate-limited API, and a fixed schedule would have them collide on every
 * retry.
 */
export function transientRetryDelay(failureCount: number, error: unknown): number {
    const wait = retryAfterMs(error);
    if (wait !== undefined) {
        return Math.min(wait, MAX_WAIT_MS);
    }
    return Math.random() * Math.min(1000 * 2 ** failureCount, MAX_BACKOFF_MS);
}
