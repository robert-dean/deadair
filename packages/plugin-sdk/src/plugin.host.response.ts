/**
 * Sugar over {@link HostFetchResponse}. Nothing here crosses the boundary.
 *
 * These are free functions rather than methods on `HostFetchResponse` on
 * purpose: a method would make the payload itself unserializable and blow the
 * rule the whole boundary is built on (see `docs/decisions/plugin-isolation.md`
 * and `boundary.json.safe.ts`). As functions they run in the plugin's own
 * realm against a POJO it already holds, so they behave identically whether
 * `host.fetch` was an in-process call or an IPC round trip.
 */

import type { HostFetchResponse } from './plugin.host.js';

/** How much of an unparseable body to quote back. Enough to identify it, not enough to fill a log line. */
const BODY_SNIPPET_LENGTH = 120;

const snippet = (body: string): string => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return '<empty body>';
    return trimmed.length <= BODY_SNIPPET_LENGTH ? trimmed : `${trimmed.slice(0, BODY_SNIPPET_LENGTH)}…`;
};

/**
 * The body parsed as JSON.
 *
 * Throws when it is not JSON, with the status, the URL and the start of the
 * body in the message. That detail is the point: the common failure is an API
 * returning an HTML error page or a rate-limit notice with a 200, and
 * `Unexpected token < in JSON at position 0` says nothing about which call
 * did it.
 *
 * Note this does not check {@link HostFetchResponse.ok}. A 4xx with a JSON
 * error body is worth parsing, so deciding what a bad status means is left to
 * the caller.
 */
export function jsonBody<T>(response: HostFetchResponse): T {
    try {
        return JSON.parse(response.body) as T;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`expected JSON from ${response.url} (HTTP ${response.status}) but got ${snippet(response.body)}: ${reason}`, { cause: error });
    }
}

/**
 * {@link jsonBody}, but `undefined` instead of a throw when the body will not
 * parse. For the callers that treat an unparseable body the same as a missing
 * one and have nothing useful to add to the error.
 */
export function tryJsonBody<T>(response: HostFetchResponse): T | undefined {
    try {
        return JSON.parse(response.body) as T;
    } catch {
        return undefined;
    }
}
