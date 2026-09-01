import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

import { sdkError } from './sdk.error';

/**
 * Whether the API is reachable at all, asked once for the whole origin.
 *
 * The distinction this draws is not the one `sdk.error.ts` draws. There, the line is between an
 * answer and a failure to get one, and it decides whether a request is worth repeating. Here the
 * line is between "this request failed" and "the server is gone", and it decides whether the
 * console should stop explaining itself page by page: forty surfaces each drawing their own
 * `ErrorAlert` for one dead API is forty copies of the same sentence, none of which says the thing
 * the operator needs to know, which is that nothing on screen is current.
 *
 * Every query in this console talks to the same origin, so one connectivity failure is enough to
 * answer the question for all of them.
 */

/** Seconds between automatic reconnect attempts, backing off while the server stays away. */
const RETRY_SCHEDULE = [5, 10, 20, 30] as const;

/** What `fetch` rejects with when the connection could not be made, across the engines. */
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

/**
 * True when a failure means the server is not there, rather than that it said no.
 *
 * A 401, a 404 and a 422 are all the API alive and answering, so none of them may raise the banner.
 * The two that count are a 502/503/504 — a proxy reporting nothing behind it, which is exactly what
 * nginx answers while the API restarts — and a rejection that never became a response at all.
 *
 * A plain 500 is deliberately NOT connectivity: the server is running and threw, which is one
 * page's problem and belongs in that page's alert.
 */
export function isConnectivityError(error: unknown): boolean {
    const status = sdkError(error)?.status;
    if (status !== undefined) {
        return status >= 502;
    }
    // Not an SdkError: the request never got far enough to have a status. `SdkError` is only
    // constructed from a real `Response`, so this is the whole of the offline case.
    if (error instanceof TypeError) {
        return true;
    }
    return error instanceof Error && NETWORK_FAILURE.test(error.message);
}

export interface ApiStatus {
    /** False while at least one query is failing for connectivity reasons. */
    reachable: boolean;
    /** Seconds until the next automatic attempt. Zero while reachable. */
    retryInSeconds: number;
    /** An attempt is in flight. */
    checking: boolean;
    /** Try again now rather than waiting out the countdown. */
    retryNow: () => void;
}

/** Any active query failing on connectivity means the origin is unreachable. */
function readReachable(queryClient: QueryClient): boolean {
    return !queryClient
        .getQueryCache()
        .getAll()
        .some(query => query.state.status === 'error' && isConnectivityError(query.state.error));
}

/**
 * The banner's state.
 *
 * Subscribed through `useSyncExternalStore` rather than an effect that calls `setState`, and that is
 * not a style preference: the query cache notifies its subscribers SYNCHRONOUSLY, so a query
 * settling while some other component is rendering would set state mid-render and React would warn
 * about updating a component while rendering a different one. The snapshot is a boolean, so
 * referential equality holds and React bails out of the no-op updates that arrive with every
 * unrelated cache event.
 */
export function useApiStatus(): ApiStatus {
    const queryClient = useQueryClient();

    const subscribe = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(onChange), [queryClient]);
    const snapshot = useCallback(() => readReachable(queryClient), [queryClient]);
    const reachable = useSyncExternalStore(subscribe, snapshot, () => true);

    const [retryInSeconds, setRetryInSeconds] = useState(0);
    const [checking, setChecking] = useState(false);
    // Which rung of the schedule the next wait comes from. A ref rather than state because changing
    // it must not re-run the countdown effect that reads it.
    const attempt = useRef(0);

    const retryNow = useCallback(() => {
        setChecking(true);
        // Active queries only: refetching every cached key would replay pages the operator left
        // some time ago, and the question being asked is only whether the server answers at all.
        void queryClient.refetchQueries({ type: 'active' }).finally(() => setChecking(false));
    }, [queryClient]);

    useEffect(() => {
        if (reachable) {
            attempt.current = 0;
            return;
        }
        // Seeded alongside the interval that decrements it: setting only the interval leaves the
        // banner showing the previous attempt's number for a second before the first tick.
        const wait = () => RETRY_SCHEDULE[Math.min(attempt.current, RETRY_SCHEDULE.length - 1)]!;
        setRetryInSeconds(wait());
        const id = window.setInterval(() => {
            setRetryInSeconds(current => {
                if (current > 1) return current - 1;
                attempt.current += 1;
                retryNow();
                return wait();
            });
        }, 1000);
        return () => {
            window.clearInterval(id);
        };
    }, [reachable, retryNow]);

    // Derived rather than reset by the effect above: `reachable` already means "no countdown", and
    // zeroing the state as well would be two places agreeing about one fact.
    return { reachable, retryInSeconds: reachable ? 0 : retryInSeconds, checking, retryNow };
}
